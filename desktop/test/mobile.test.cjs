'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MobileClient } = require('../../shared/mobile.cjs');

test('follows the Trondheim permit pages and reads the product without purchasing', async () => {
  const calls = [];
  const replies = {
    'client/suc-verify': { resultCode: 'SUCCESS', token: 'temporary-token', refreshToken: 'remembered-session', parkingServices: [
      { clientServices: { products: { pathToPermitShops: 'permit/shops' } } }
    ] },
    'permit/shops': { resultCode: 'SUCCESS', shops: [
      { shopType: 'AUTOPARK', path: 'permit/shop/autopark' },
      { shopType: 'PERMIT', path: 'permit/shop/places' }
    ] },
    'permit/shop/places': { resultCode: 'SUCCESS', title: 'Choose a city', sections: [
      { action: 'NEXT_PAGE', elements: [
        ...Array.from({ length: 35 }, (_, i) => ({ title: `City ${i}`, path: `permit/city/${i}` })),
        { title: 'Trondheim', path: 'permit/city/trondheim' }
      ] }
    ] },
    'permit/city/trondheim': { resultCode: 'SUCCESS', title: 'Trondheim', sections: [
      { action: 'NEXT_PAGE', elements: [
        ...Array.from({ length: 23 }, (_, i) => ({ title: `Other permit ${i}`, path: `permit/other/${i}` })),
        { title: 'Tieto Booking Sluppen P40', path: 'permit/trondheim/tieto-variants' }
      ] }
    ] },
    'permit/trondheim/tieto-variants': { resultCode: 'SUCCESS', sections: [
      { action: 'SELECT', elements: [
        { title: 'Tieto Booking Sluppen P40', path: 'permit/product/tieto' }
      ] }
    ] },
    'permit/product/tieto': { resultCode: 'SUCCESS', product: {
      name: 'Tieto Booking Sluppen P40', variants: [
        { id: 'variant-1', priceCents: 0, availability: { inStock: true, itemsInStock: 1 } }
      ]
    } }
  };
  const client = new MobileClient(async (url, options) => {
    const path = new URL(url).pathname.slice(1);
    calls.push({ path, method: options.method, token: options.headers['X-Token'] });
    return { ok: true, status: 200, json: async () => replies[path] };
  });
  client.phoneNumber = '12345678';
  await client.verifyCode('123456');
  assert.equal(client.refreshToken, 'remembered-session');
  const variants = await client.getTietoVariants();
  assert.equal(variants[0].id, 'variant-1');
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
    'POST client/suc-verify', 'GET permit/shops', 'GET permit/shop/places',
    'GET permit/city/trondheim', 'GET permit/trondheim/tieto-variants', 'GET permit/product/tieto'
  ]);
  assert.equal(calls[1].token, 'temporary-token');
});

const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('renews an expired session once, saves it and retries with the same booking key', async () => {
  const calls = [];
  const client = new MobileClient(async (url, options) => {
    const path = new URL(url).pathname.slice(1);
    calls.push({ path, ...options });
    if (path === 'client/reauth') {
      assert.deepEqual(JSON.parse(options.body), {
        refreshToken: 'long-lived-session', clientIdentifier: 'SNWKJJSP7NZ4J1DY'
      });
      return reply({ resultCode: 'SUCCESS', token: 'renewed-token' });
    }
    if (options.headers['X-Token'] === 'expired-token') {
      return reply({ resultCode: 'PERMANENT_ERROR', errorCode: 'SESSION_NOT_FOUND' });
    }
    assert.equal(client.savedToken, 'renewed-token');
    return reply({ resultCode: 'SUCCESS', permit: { name: 'Tieto Booking Sluppen P40' } });
  });
  client.token = 'expired-token';
  client.refreshToken = 'long-lived-session';
  client.persistSession = async () => { client.savedToken = client.token; };
  client.productsService = { pathToAquirePermit: 'permit/acquire' };
  await client.acquirePermit('variant-1', [], 'same-booking-key');
  assert.deepEqual(calls.map(call => call.path), ['permit/acquire', 'client/reauth', 'permit/acquire']);
  assert.equal(calls[0].body, calls[2].body);
  assert.equal(calls[0].headers['X-GLT-IDEMPOTENCY-KEY'], calls[2].headers['X-GLT-IDEMPOTENCY-KEY']);
});

test('concurrent expired reads share one renewal', async () => {
  let renewals = 0;
  const client = new MobileClient(async (url, options) => {
    if (new URL(url).pathname === '/client/reauth') {
      renewals++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return reply({ resultCode: 'SUCCESS', token: 'new-token' });
    }
    return options.headers['X-Token'] === 'old-token' ? reply({}, 401) : reply({ resultCode: 'SUCCESS' });
  });
  client.token = 'old-token';
  client.refreshToken = 'remember-me';
  await Promise.all([client.request('client/account', { authenticated: true }),
    client.request('permit/list', { method: 'POST', body: '', authenticated: true })]);
  assert.equal(renewals, 1);
});

test('revoked renewal stops without a loop and old sessions require sign-in', async () => {
  let calls = 0;
  const client = new MobileClient(async () => { calls++; return reply({}, 401); });
  client.token = 'old-token';
  client.refreshToken = 'revoked-session';
  await assert.rejects(client.request('client/account', { authenticated: true }), /sign in again/);
  assert.equal(calls, 2);
  client.refreshToken = undefined;
  await assert.rejects(client.request('client/account', { authenticated: true }), /sign in again/);
  assert.equal(calls, 3);
});

test('network errors and unsupported-client errors never trigger renewal or resubmit a booking', async () => {
  for (const outcome of ['network', 'unsupported']) {
    let calls = 0;
    const client = new MobileClient(async () => {
      calls++;
      if (outcome === 'network') throw new Error('Connection lost');
      return reply({ errorCode: 'UNSUPPORTED_CLIENT' }, 403);
    });
    client.token = 'token';
    client.refreshToken = 'refresh';
    client.productsService = { pathToAquirePermit: 'permit/acquire' };
    await assert.rejects(client.acquirePermit('variant', [], 'key'));
    assert.equal(calls, 1);
    assert.equal(client.refreshToken, 'refresh');
  }
});

test('sign-out during renewal cannot restore credentials or retry the request', async () => {
  let calls = 0;
  const client = new MobileClient(async url => {
    calls++;
    if (new URL(url).pathname === '/client/reauth') {
      client.token = undefined;
      client.refreshToken = undefined;
      return reply({ resultCode: 'SUCCESS', token: 'must-not-save' });
    }
    return reply({}, 401);
  });
  client.token = 'old';
  client.refreshToken = 'remember-me';
  await assert.rejects(client.request('client/account', { authenticated: true }), /sign in again/);
  assert.equal(calls, 2);
  assert.equal(client.token, undefined);
});

test('rejects a service path outside the SmartPark host', async () => {
  const client = new MobileClient();
  await assert.rejects(client.request('https://example.org/steal'), /invalid service path/);
  await assert.rejects(client.request('../escape'), /invalid service path/);
});

test('sends the app acquisition shape with an idempotency key', async () => {
  let request;
  const client = new MobileClient(async (url, options) => {
    request = { url: String(url), ...options };
    return { ok: true, status: 200, json: async () => ({ resultCode: 'SUCCESS', permit: {
      name: 'Tieto Booking Sluppen P40'
    } }) };
  });
  client.token = 'temporary-token';
  client.productsService = { pathToAquirePermit: '/permit/dynamic/acquire' };
  const fields = [{ name: 'plate_number_1', value: 'AB12345' },
    { name: 'start_date', value: '2026-09-25' }];
  await client.acquirePermit('variant-1', fields, 'unique-request-id');
  assert.equal(new URL(request.url).pathname, '/permit/dynamic/acquire');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['X-GLT-IDEMPOTENCY-KEY'], 'unique-request-id');
  assert.deepEqual(JSON.parse(request.body), {
    productVariantId: 'variant-1', paymentOptionId: null, formData: fields
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MobileClient } = require('../mobile.cjs');

test('follows the Trondheim permit pages and reads the product without purchasing', async () => {
  const calls = [];
  const replies = {
    'client/suc-verify': { resultCode: 'SUCCESS', token: 'temporary-token', parkingServices: [
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
  const variants = await client.getTietoVariants();
  assert.equal(variants[0].id, 'variant-1');
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
    'POST client/suc-verify', 'GET permit/shops', 'GET permit/shop/places',
    'GET permit/city/trondheim', 'GET permit/trondheim/tieto-variants', 'GET permit/product/tieto'
  ]);
  assert.equal(calls[1].token, 'temporary-token');
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

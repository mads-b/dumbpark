'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bookTieto, osloDate, assessVehiclePermit, assessMobilePermits, reconcileBookingAttempt } = require('../../shared/booking.cjs');
const { SessionExpiredError } = require('../../shared/mobile.cjs');

const now = new Date('2026-09-25T08:30:00Z');
const variant = { id: 'variant-1', priceCents: 0,
  availability: { inStock: true }, formFields: [
    { name: 'plate_number_1', required: true },
    { name: 'start_date', required: true },
    { name: 'note', required: false }
  ] };

function clientWith(overrides = {}) {
  const calls = [];
  const client = {
    confirmationDelayMs: 0,
    getMyPermits: async () => { calls.push('list'); return []; },
    getTietoVariants: async () => { calls.push('catalog'); return [variant]; },
    previewOrder: async (id, fields) => { calls.push(['preview', id, fields]);
      return { availability: { inStock: true }, price: { priceCents: 0 } }; },
    acquirePermit: async (id, fields, key) => { calls.push(['acquire', id, fields, key]);
      return { permit: { name: 'Tieto Booking Sluppen P40', expiresAt: '2026-09-25 22:30:00' } }; },
    ...overrides
  };
  return { client, calls };
}

test('uses the Oslo date and books one free available variant once', async () => {
  const { client, calls } = clientWith();
  const result = await bookTieto(client, { plateNumber: 'AB12345', now });
  assert.equal(result.state, 'booked');
  assert.ok(Number.isFinite(result.validToEpochMs));
  assert.equal(osloDate(now), '2026-09-25');
  assert.deepEqual(calls[2].slice(0, 3), ['preview', 'variant-1', [
    { name: 'plate_number_1', value: 'AB12345' },
    { name: 'start_date', value: '2026-09-25' }
  ]]);
  assert.match(calls[3][3], /^[0-9a-f-]{36}$/);
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'acquire').length, 1);
});

test('does not acquire when a Tieto permit is already active', async () => {
  const { client, calls } = clientWith({
    getMyPermits: async () => [{ name: 'Tieto Booking Sluppen P40',
      validFrom: '2026-09-25 08:00:00', expiresAt: '2026-09-25 20:00:00' }]
  });
  assert.equal((await bookTieto(client, { now })).state, 'active');
  assert.deepEqual(calls, []);
});

test('active assessment includes a numeric expiry for local validity checks', () => {
  const permit = { name: 'Tieto Booking Sluppen P40',
    validFrom: '2026-09-25T08:00:00Z', expiresAt: '2026-09-25T20:00:00Z' };
  const result = assessMobilePermits([permit], now);
  assert.equal(result.state, 'active');
  assert.equal(result.validToEpochMs, Date.parse(permit.expiresAt));
});

test('reports when the active permit covers a different saved car', async () => {
  const permit = { name: 'Tieto Booking Sluppen P40',
    validFrom: '2026-09-25 08:00:00', expiresAt: '2026-09-25 20:00:00',
    formFields: [{ name: 'plate_number_1', value: 'AB12345' }] };
  const { client } = clientWith({ getMyPermits: async () => [permit] });
  assert.equal(assessVehiclePermit([permit], 'CD67890', now).state, 'vehicle-mismatch');
  assert.equal((await bookTieto(client, { plateNumber: 'CD67890', now })).state, 'vehicle-mismatch');
  assert.equal(assessVehiclePermit([permit], 'AB 12345', now).state, 'active');
});

test('stops if the price or required form fields change', async () => {
  const { client, calls } = clientWith({
    getTietoVariants: async () => [{ ...variant,
      formFields: [...variant.formFields, { name: 'coupon', required: true }] }]
  });
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'unknown');
  assert.deepEqual(calls, ['list']);
});

test('does not retry acquisition after a lost response', async () => {
  let attempts = 0;
  const { client } = clientWith({
    acquirePermit: async () => { attempts++; throw new Error('connection lost'); }
  });
  const result = await bookTieto(client, { plateNumber: 'AB12345', now });
  assert.equal(result.state, 'unknown');
  assert.equal(attempts, 1);
});

test('waits for an accepted order to appear as an active permit', async () => {
  let reads = 0;
  let acquisitions = 0;
  const { client } = clientWith({
    getMyPermits: async () => {
      reads++;
      return reads >= 3 ? [{ name: 'Tieto Booking Sluppen P40',
        validFrom: '2026-09-25 08:00:00', expiresAt: '2026-09-25 22:30:00' }] : [];
    },
    acquirePermit: async () => { acquisitions++; return { orderId: 'order-1' }; }
  });
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'active');
  assert.equal(acquisitions, 1);
  assert.equal(client.pendingOrderId, undefined);
});

test('does not create a second order while the first remains pending', async () => {
  let acquisitions = 0;
  const { client } = clientWith({
    acquirePermit: async () => { acquisitions++; return { orderId: 'order-1' }; }
  });
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'pending');
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'pending');
  assert.equal(acquisitions, 1);
});

test('a delayed completed permit retires yesterday’s saved order and permits a new day booking', async () => {
  let acquisitions = 0;
  let permits = [];
  const saved = [];
  const { client } = clientWith({
    getMyPermits: async () => permits,
    persistSession: async () => saved.push(JSON.parse(JSON.stringify({
      pendingOrderId: client.pendingOrderId, bookingAttempt: client.bookingAttempt,
      uncertainAcquisition: client.uncertainAcquisition
    }))),
    acquirePermit: async () => { acquisitions++; return acquisitions === 1 ? { orderId: 'order-1' }
      : { permit: { name: 'Tieto Booking Sluppen P40', expiresAt: '2026-09-26T20:30:00Z' } }; }
  });
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'pending');
  const restored = { ...client, ...saved.at(-1) };
  restored.persistSession = async () => {};
  permits = [{ name: 'Tieto Booking Sluppen P40', validFrom: '2026-09-25T08:30:00Z',
    expiresAt: '2026-09-25T20:30:00Z', formFields: [{ name: 'plate_number_1', value: 'AB12345' }] }];
  const tomorrow = new Date('2026-09-26T08:30:00Z');
  assert.equal((await bookTieto(restored, { plateNumber: 'AB12345', now: tomorrow })).state, 'booked');
  assert.equal(acquisitions, 2);
  assert.equal(restored.pendingOrderId, undefined);
  assert.equal(restored.bookingAttempt, undefined);
});

test('old or unrelated expired permits do not erase an unresolved attempt', async () => {
  const oldPermit = { name: 'Tieto Booking Sluppen P40', validFrom: '2026-09-25T07:00:00Z',
    expiresAt: '2026-09-25T08:00:00Z', formFields: [{ name: 'plate_number_1', value: 'AB12345' }] };
  let permits = [oldPermit];
  const { client, calls } = clientWith({ getMyPermits: async () => permits,
    acquirePermit: async () => ({ orderId: 'order-1' }) });
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'pending');
  const tomorrow = new Date('2026-09-26T08:30:00Z');
  for (const unmatched of [oldPermit, { ...oldPermit, validFrom: '2026-09-25T08:30:00Z',
    expiresAt: '2026-09-25T20:30:00Z', formFields: [{ name: 'plate_number_1', value: 'CD67890' }] }]) {
    permits = [unmatched];
    assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now: tomorrow })).state, 'pending');
    assert.equal(client.pendingOrderId, 'order-1');
  }
  assert.equal(calls.filter(call => call === 'catalog').length, 1);
});

test('concurrent taps share the acquisition and a permit check cannot erase its running guard', async () => {
  let finish;
  let started;
  const acquired = new Promise(resolve => { started = resolve; });
  let acquisitions = 0;
  const { client } = clientWith({ acquirePermit: async () => {
    acquisitions++; started(); return new Promise(resolve => { finish = resolve; });
  } });
  const first = bookTieto(client, { plateNumber: 'AB12345', now });
  await acquired;
  const second = bookTieto(client, { plateNumber: 'AB12345', now });
  assert.equal(first, second);
  assert.equal(await reconcileBookingAttempt(client, [{ name: 'Tieto Booking Sluppen P40',
    validFrom: '2026-09-25T08:30:00Z', expiresAt: '2026-09-25T20:30:00Z',
    formFields: [{ name: 'plate_number_1', value: 'AB12345' }] }], { plateNumber: 'AB12345', now }), false);
  assert.equal(client.uncertainAcquisition, true);
  finish({ permit: { name: 'Tieto Booking Sluppen P40', expiresAt: '2026-09-25T20:30:00Z' } });
  assert.equal((await first).state, 'booked');
  assert.equal((await second).state, 'booked');
  assert.equal(acquisitions, 1);
});

test('a storage failure before acquisition does not invent an uncertain booking', async () => {
  const { client, calls } = clientWith({ persistSession: async () => { throw new Error('Storage failed'); } });
  await assert.rejects(bookTieto(client, { plateNumber: 'AB12345', now }), /Storage failed/);
  assert.equal(client.uncertainAcquisition, false);
  assert.equal(client.bookingAttempt, undefined);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'acquire'), false);
  client.persistSession = async () => {};
  assert.equal((await bookTieto(client, { plateNumber: 'AB12345', now })).state, 'booked');
});

test('an explicit authentication rejection clears the unsent booking guard and requests sign-in', async () => {
  const { client, calls } = clientWith({ acquirePermit: async () => { throw new SessionExpiredError(); } });
  await assert.rejects(bookTieto(client, { plateNumber: 'AB12345', now }), SessionExpiredError);
  assert.equal(client.uncertainAcquisition, false);
  assert.equal(client.bookingAttempt, undefined);
  assert.equal(calls.filter(call => call === 'list').length, 1);
});

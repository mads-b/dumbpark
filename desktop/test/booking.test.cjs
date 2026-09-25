'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { bookTieto, osloDate, assessVehiclePermit, assessMobilePermits } = require('../../shared/booking.cjs');

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

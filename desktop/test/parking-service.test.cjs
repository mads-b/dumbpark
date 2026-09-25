'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ParkingService } = require('../../shared/parking-service.cjs');

test('shared service persists vehicle selection and refuses an unsigned booking', async () => {
  const saved = [];
  const service = new ParkingService({ token: undefined }, {
    saveVehicles: async vehicles => saved.push(vehicles)
  });
  await service.addVehicle('ab12345');
  await service.addVehicle('cd67890');
  await service.selectVehicle('AB12345');
  assert.equal(service.vehicles.selectedPlate, 'AB12345');
  assert.equal(saved.length, 3);
  assert.deepEqual(await service.atWork('AB12345'), {
    state: 'needs-sign-in', message: 'Sign in to SmartPark to check and book your permit.'
  });
  assert.equal((await service.checkPermit()).state, 'needs-sign-in');
});

test('shared service reads the active permit without purchasing', async () => {
  let reads = 0;
  const client = {
    token: 'test-token',
    getMyPermits: async () => {
      reads++;
      return [{ name: 'Tieto Booking Sluppen P40',
        validFrom: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
        formFields: [{ name: 'plate_number_1', value: 'AB12345' }] }];
    }
  };
  const service = new ParkingService(client);
  await service.addVehicle('AB12345');
  assert.equal((await service.checkPermit()).state, 'active');
  assert.equal((await service.atWork('AB12345')).state, 'active');
  assert.equal(reads, 2);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyVehicles, addVehicle, selectVehicle, parseVehicles } = require('../../shared/vehicles.cjs');

test('migrates the previously saved single plate and keeps it selected', () => {
  assert.deepEqual(parseVehicles('ab12345'), {
    plateNumbers: ['AB12345'], selectedPlate: 'AB12345'
  });
});

test('keeps multiple plates distinct and remembers the selected one', () => {
  const two = addVehicle(addVehicle(emptyVehicles(), 'ab12345'), 'cd67890');
  assert.deepEqual(parseVehicles(JSON.stringify(selectVehicle(two, 'ab12345'))), {
    plateNumbers: ['AB12345', 'CD67890'], selectedPlate: 'AB12345'
  });
  assert.deepEqual(addVehicle(two, 'cd67890').plateNumbers, ['AB12345', 'CD67890']);
  assert.throws(() => selectVehicle(two, 'XX00000'), /saved vehicle/);
});

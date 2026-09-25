'use strict';

const { validPlate } = require('./booking.cjs');

const emptyVehicles = () => ({ plateNumbers: [], selectedPlate: null });
const normalizePlate = value => typeof value === 'string' ? value.trim().toUpperCase() : '';

function addVehicle(state, value, select = true) {
  const plate = normalizePlate(value);
  if (!validPlate(plate)) throw new Error('Enter a valid vehicle plate.');
  const plateNumbers = state.plateNumbers.includes(plate)
    ? [...state.plateNumbers] : [...state.plateNumbers, plate];
  return { plateNumbers, selectedPlate: select || !state.selectedPlate ? plate : state.selectedPlate };
}

function selectVehicle(state, value) {
  const plate = normalizePlate(value);
  if (!state.plateNumbers.includes(plate)) throw new Error('Choose a saved vehicle plate.');
  return { plateNumbers: [...state.plateNumbers], selectedPlate: plate };
}

function parseVehicles(value) {
  if (!value) return emptyVehicles();
  let saved;
  try { saved = JSON.parse(value); } catch { saved = value; }
  if (typeof saved === 'string') {
    return validPlate(saved) ? addVehicle(emptyVehicles(), saved) : emptyVehicles();
  }
  if (!saved || !Array.isArray(saved.plateNumbers)) return emptyVehicles();
  let state = emptyVehicles();
  for (const plate of saved.plateNumbers) {
    if (validPlate(plate)) state = addVehicle(state, plate, false);
  }
  const selected = normalizePlate(saved.selectedPlate);
  return state.plateNumbers.includes(selected) ? selectVehicle(state, selected) : state;
}

module.exports = { emptyVehicles, normalizePlate, addVehicle, selectVehicle, parseVehicles };

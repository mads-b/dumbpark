'use strict';

const { assessMobilePermits, assessVehiclePermit, plateFromPermits, validPlate, bookTieto } = require('./booking.cjs');
const { emptyVehicles, addVehicle, selectVehicle } = require('./vehicles.cjs');

class ParkingService {
  constructor(client, { vehicles = emptyVehicles(), saveVehicles = async () => {}, saveSession = async () => {} } = {}) {
    this.client = client;
    this.vehicles = vehicles;
    this.saveVehicles = saveVehicles;
    this.saveSession = saveSession;
  }

  async updateVehicles(next) {
    await this.saveVehicles(next);
    this.vehicles = next;
    return next;
  }

  addVehicle(plateNumber) {
    return this.updateVehicles(addVehicle(this.vehicles, plateNumber));
  }

  selectVehicle(plateNumber) {
    return this.updateVehicles(selectVehicle(this.vehicles, plateNumber));
  }

  async atWork(plateNumber) {
    if (!plateNumber || !this.vehicles.plateNumbers.includes(plateNumber)) {
      return { state: 'needs-plate', message: 'Choose or add a vehicle plate.' };
    }
    if (plateNumber !== this.vehicles.selectedPlate) await this.selectVehicle(plateNumber);
    if (!this.client.token) {
      return { state: 'needs-sign-in', message: 'Sign in to SmartPark to check and book your permit.' };
    }
    try {
      const result = await bookTieto(this.client, { plateNumber });
      await this.saveSession().catch(() => false);
      return result;
    } catch (error) {
      return { state: 'error', message: `Booking stopped: ${error.message}` };
    }
  }

  async checkPermit() {
    if (!this.client.token) {
      return { state: 'needs-sign-in', message: 'Sign in to SmartPark to check your parking status.' };
    }
    try {
      const state = assessVehiclePermit(await this.client.getMyPermits(), this.vehicles.selectedPlate);
      if (state.state === 'missing') {
        return { state: 'missing', message: this.vehicles.plateNumbers.length
          ? '⚠ No active Tieto P40 booking! At work? Click the green button below now.'
          : '⚠ No active Tieto P40 booking! Add a car with +, then click the green button below.' };
      }
      return state;
    } catch (error) {
      return { state: 'unknown', message: `Could not check your parking status: ${error.message}` };
    }
  }

  async afterSignIn() {
    let assessment;
    try {
      const permits = await this.client.getMyPermits();
      assessment = assessMobilePermits(permits);
      const plate = plateFromPermits(permits);
      if (plate && validPlate(plate)) await this.updateVehicles(addVehicle(this.vehicles, plate, false));
    } catch { /* Sign-in still succeeds if the initial permit read fails. */ }
    return assessment;
  }

  clearSession() {
    this.client.token = undefined;
    this.client.productsService = undefined;
    this.client.pendingOrderId = undefined;
    this.client.uncertainAcquisition = false;
    this.vehicles = emptyVehicles();
  }
}

module.exports = { ParkingService };

'use strict';

const { MobileClient } = require('../shared/mobile.cjs');
const { ParkingService } = require('../shared/parking-service.cjs');
const { parseVehicles, emptyVehicles } = require('../shared/vehicles.cjs');

const callbacks = { session: [], vehicles: [], focus: [], login: [], booking: [], reminders: [] };
const pending = new Map();
let nextId = 0;
let pendingPhone;
let initializationStarted = false;
const emit = (kind, value) => { for (const callback of callbacks[kind]) callback(value); };

function nativeCall(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++nextId);
    pending.set(id, { resolve, reject });
    window.DumbParkNative.call(id, method, JSON.stringify(payload));
  });
}

window.dumbParkNativeResult = raw => {
  const answer = JSON.parse(raw);
  const waiter = pending.get(answer.id);
  if (!waiter) return;
  pending.delete(answer.id);
  if (answer.error) waiter.reject(new Error(answer.error));
  else waiter.resolve(answer.value);
};

async function nativeFetch(url, options) {
  const result = await nativeCall('request', {
    url: String(url), method: options.method, headers: options.headers, body: options.body
  });
  return { ok: result.status >= 200 && result.status < 300, status: result.status,
    json: async () => JSON.parse(result.body || '{}') };
}

const client = new MobileClient(nativeFetch);
let saved = {};
try { saved = JSON.parse(window.DumbParkNative.readState() || '{}'); } catch { /* Start signed out. */ }
client.token = saved.session?.token || undefined;
client.pendingOrderId = saved.session?.pendingOrderId || undefined;
client.uncertainAcquisition = Boolean(saved.session?.uncertainAcquisition);
let permitListPath = saved.session?.pathToMyPermits || null;
let vehicles = parseVehicles(saved.vehicles);

function persist() {
  const result = window.DumbParkNative.writeState(JSON.stringify({
    session: { token: client.token, pendingOrderId: client.pendingOrderId,
      uncertainAcquisition: client.uncertainAcquisition,
      pathToMyPermits: client.productsService?.pathToMyPermits || permitListPath }, vehicles
  }));
  if (result !== 'ok') throw new Error(result || 'Could not save encrypted state.');
}
client.persistSession = async () => persist();
const service = new ParkingService(client, { vehicles,
  saveVehicles: async state => { vehicles = state; persist(); emit('vehicles', state); },
  saveSession: async () => persist()
});

window.dumbParkChallengeError = message => emit('login', { message: `Verification challenge: ${message}` });
window.dumbParkNativeBookRequested = async () => {
  const shouldBook = await nativeCall('consumeBookingIntent');
  if (shouldBook) emit('booking');
};
window.dumbParkNativeFocus = () => emit('focus');
window.dumbParkNativeReminderChanged = () => emit('reminders');

window.dumbPark = {
  capabilities: { canSignIn: true, arrivalReminders: true },
  atWork: plate => service.atWork(plate),
  addVehicle: plate => service.addVehicle(plate),
  selectVehicle: plate => service.selectVehicle(plate),
  checkPermit: () => service.checkPermit(),
  async requestCode(phone) {
    if (!/^\+?[0-9 ]{8,16}$/.test(phone)) throw new Error('Enter a valid phone number.');
    pendingPhone = phone;
    const url = await client.getChallengeUrl();
    await nativeCall('openChallenge', { url });
    return 'Complete the SmartPark verification window.';
  },
  async verifyCode(code) {
    await client.verifyCode(code);
    permitListPath = client.productsService?.pathToMyPermits || null;
    persist();
    const assessment = await service.afterSignIn();
    emit('session', { signedIn: true });
    return { message: 'Signed in to SmartPark.', assessment };
  },
  async signOut() {
    service.clearSession();
    vehicles = emptyVehicles();
    pendingPhone = undefined;
    permitListPath = null;
    persist();
    emit('vehicles', vehicles);
    emit('session', { signedIn: false });
  },
  getReminderStatus: () => nativeCall('reminderStatus'),
  enableReminders: () => nativeCall('enableReminders'),
  disableReminders: () => nativeCall('disableReminders'),
  onSessionState: callback => {
    callbacks.session.push(callback);
    if (!initializationStarted) {
      initializationStarted = true;
      setTimeout(restoreSession, 0);
    }
  },
  onVehiclePlateState: callback => callbacks.vehicles.push(callback),
  onDashboardFocus: callback => callbacks.focus.push(callback),
  onLoginState: callback => callbacks.login.push(callback),
  onBookingRequested: callback => callbacks.booking.push(callback),
  onReminderStateChanged: callback => callbacks.reminders.push(callback)
};

async function restoreSession() {
  if (client.token) {
    try {
      const account = await client.request('client/account', { authenticated: true });
      client.productsService = account.parkingServices?.[0]?.clientServices?.products;
      if (!client.productsService?.pathToPermitShops) throw new Error('Permit shop unavailable.');
      permitListPath = client.productsService.pathToMyPermits || null;
      persist();
    } catch {
      client.token = undefined;
      client.productsService = undefined;
      client.pendingOrderId = undefined;
      client.uncertainAcquisition = false;
      permitListPath = null;
      persist();
    }
  }
  emit('vehicles', service.vehicles);
  emit('session', { signedIn: Boolean(client.token) });
  window.dumbParkNativeBookRequested();
}

window.dumbParkNativeChallengeComplete = async token => {
  try {
    await client.requestCode(pendingPhone, token);
    emit('login', { message: 'SMS code sent. Enter it in DumbPark.' });
  } catch (error) { emit('login', { message: error.message }); }
};

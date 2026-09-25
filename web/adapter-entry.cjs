'use strict';

const { ParkingService } = require('../shared/parking-service.cjs');
const { emptyVehicles, parseVehicles } = require('../shared/vehicles.cjs');

const cookieName = 'dumbpark_vehicles';
const cookiePath = location.pathname.endsWith('/') ? location.pathname :
  location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
const cookieFlags = `Path=${cookiePath}; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;

function readVehicles() {
  const item = document.cookie.split('; ').find(part => part.startsWith(`${cookieName}=`));
  if (!item) return emptyVehicles();
  try { return parseVehicles(decodeURIComponent(item.slice(cookieName.length + 1))); }
  catch { return emptyVehicles(); }
}

function writeVehicles(state) {
  document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(state))}; ${cookieFlags}; Max-Age=31536000`;
}

const callbacks = { session: [], vehicles: [], focus: [], login: [] };
function emit(kind, state) { for (const callback of callbacks[kind]) callback(state); }

const client = { token: undefined };
const service = new ParkingService(client, {
  vehicles: readVehicles(),
  saveVehicles: async state => { writeVehicles(state); emit('vehicles', state); }
});

window.dumbPark = {
  capabilities: { canSignIn: false },
  atWork: plate => service.atWork(plate),
  addVehicle: plate => service.addVehicle(plate),
  selectVehicle: plate => service.selectVehicle(plate),
  checkPermit: () => service.checkPermit(),
  requestCode: async () => { throw new Error('SmartPark does not provide a web verification callback for this site.'); },
  verifyCode: async () => { throw new Error('Web sign-in is unavailable.'); },
  signOut: async () => {
    service.clearSession();
    document.cookie = `${cookieName}=; ${cookieFlags}; Max-Age=0`;
    emit('vehicles', service.vehicles);
    emit('session', { signedIn: false });
  },
  onSessionState: callback => {
    callbacks.session.push(callback);
    setTimeout(() => callback({ signedIn: false }), 0);
  },
  onVehiclePlateState: callback => {
    callbacks.vehicles.push(callback);
    setTimeout(() => callback(service.vehicles), 0);
  },
  onDashboardFocus: callback => callbacks.focus.push(callback),
  onLoginState: callback => callbacks.login.push(callback)
};

window.addEventListener('focus', () => {
  service.vehicles = readVehicles();
  emit('vehicles', service.vehicles);
  emit('focus');
});

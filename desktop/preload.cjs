'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dumbPark', {
  atWork: plateNumber => ipcRenderer.invoke('at-work', plateNumber),
  addVehicle: plateNumber => ipcRenderer.invoke('add-vehicle', plateNumber),
  selectVehicle: plateNumber => ipcRenderer.invoke('select-vehicle', plateNumber),
  checkPermit: () => ipcRenderer.invoke('check-permit'),
  requestCode: phoneNumber => ipcRenderer.invoke('request-code', phoneNumber),
  verifyCode: code => ipcRenderer.invoke('verify-code', code),
  signOut: () => ipcRenderer.invoke('sign-out'),
  onSessionState: callback => ipcRenderer.on('session-state', (_event, state) => callback(state)),
  onVehiclePlateState: callback => ipcRenderer.on('vehicle-plate-state', (_event, state) => callback(state)),
  onLoginState: callback => ipcRenderer.on('login-state', (_event, state) => callback(state))
});

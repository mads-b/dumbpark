'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, powerMonitor, safeStorage } = require('electron');
const { plateFromPermits, validPlate } = require('../shared/booking.cjs');
const { MobileClient } = require('../shared/mobile.cjs');
const { emptyVehicles, addVehicle, parseVehicles } = require('../shared/vehicles.cjs');
const { ParkingService } = require('../shared/parking-service.cjs');

const mobileClient = new MobileClient();
let dashboard;
let challengeWindow;
let pendingPhone;
let vehicles = emptyVehicles();
const parkingService = new ParkingService(mobileClient, {
  saveVehicles: saveVehicles,
  saveSession: saveMobileSession
});

const sessionFile = () => path.join(app.getPath('userData'), 'mobile-session.bin');
const plateFile = () => path.join(app.getPath('userData'), 'vehicle-plate.bin');

function sendToDashboard(channel, payload) {
  if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(channel, payload);
}

function fromDashboard(event) {
  if (!dashboard || event.sender !== dashboard.webContents) {
    throw new Error('This action is only available in DumbPark.');
  }
}

async function saveVehicles(next) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure vehicle storage is unavailable.');
  await fs.writeFile(plateFile(), safeStorage.encryptString(JSON.stringify(next)));
  vehicles = next;
  sendToDashboard('vehicle-plate-state', vehicles);
  return vehicles;
}

async function restoreVehicles() {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const value = safeStorage.decryptString(await fs.readFile(plateFile()));
    vehicles = parseVehicles(value);
  } catch { vehicles = emptyVehicles(); }
}

async function saveMobileSession() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(JSON.stringify({
    token: mobileClient.token,
    pendingOrderId: mobileClient.pendingOrderId || null,
    uncertainAcquisition: mobileClient.uncertainAcquisition
  }));
  await fs.writeFile(sessionFile(), encrypted);
  return true;
}

async function restoreMobileSession() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    const stored = safeStorage.decryptString(await fs.readFile(sessionFile()));
    const saved = stored.startsWith('{') ? JSON.parse(stored) : { token: stored };
    mobileClient.token = saved.token;
    mobileClient.pendingOrderId = saved.pendingOrderId || undefined;
    mobileClient.uncertainAcquisition = Boolean(saved.uncertainAcquisition);
    const account = await mobileClient.request('client/account', { authenticated: true });
    mobileClient.productsService = account.parkingServices?.[0]?.clientServices?.products;
    if (!mobileClient.productsService?.pathToPermitShops) throw new Error('Permit shop unavailable.');
    return true;
  } catch {
    mobileClient.token = undefined;
    mobileClient.productsService = undefined;
    mobileClient.pendingOrderId = undefined;
    mobileClient.uncertainAcquisition = false;
    await fs.rm(sessionFile(), { force: true });
    return false;
  }
}

function createDashboard() {
  dashboard = new BrowserWindow({
    width: 580,
    height: 650,
    minWidth: 460,
    minHeight: 500,
    title: 'DumbPark',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'dumbpark.ico' : 'dumbpark.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  dashboard.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  dashboard.webContents.on('did-finish-load', () => {
    sendToDashboard('session-state', { signedIn: Boolean(mobileClient.token) });
    sendToDashboard('vehicle-plate-state', vehicles);
  });
  dashboard.on('focus', () => sendToDashboard('dashboard-focus'));
  dashboard.on('closed', () => { dashboard = null; });
}

async function createChallenge() {
  const url = await mobileClient.getChallengeUrl();
  if (challengeWindow && !challengeWindow.isDestroyed()) challengeWindow.close();
  challengeWindow = new BrowserWindow({
    width: 520,
    height: 440,
    title: 'SmartPark verification',
    parent: dashboard,
    webPreferences: {
      preload: path.join(__dirname, 'challenge-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  challengeWindow.loadURL(url);
  challengeWindow.on('closed', () => { challengeWindow = null; });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.dumbpark.app');
  powerMonitor.on('resume', () => sendToDashboard('dashboard-focus'));
  powerMonitor.on('unlock-screen', () => sendToDashboard('dashboard-focus'));
  mobileClient.persistSession = async () => { await saveMobileSession(); };
  const mobileRestored = await restoreMobileSession();
  await restoreVehicles();
  parkingService.vehicles = vehicles;
  if (mobileRestored && !vehicles.plateNumbers.length) {
    try {
      const plate = plateFromPermits(await mobileClient.getMyPermits());
      if (plate && validPlate(plate)) await parkingService.updateVehicles(addVehicle(parkingService.vehicles, plate));
    } catch { /* The plate can be entered in the dashboard. */ }
  }

  ipcMain.handle('at-work', async (event, plateNumber) => {
    fromDashboard(event);
    return parkingService.atWork(plateNumber);
  });

  ipcMain.handle('add-vehicle', async (event, plateNumber) => {
    fromDashboard(event);
    return parkingService.addVehicle(plateNumber);
  });

  ipcMain.handle('select-vehicle', async (event, plateNumber) => {
    fromDashboard(event);
    return parkingService.selectVehicle(plateNumber);
  });

  ipcMain.handle('check-permit', async event => {
    fromDashboard(event);
    return parkingService.checkPermit();
  });

  ipcMain.handle('request-code', async (event, phoneNumber) => {
    fromDashboard(event);
    if (typeof phoneNumber !== 'string' || !/^\+?[0-9 ]{8,16}$/.test(phoneNumber)) {
      throw new Error('Enter a valid phone number.');
    }
    pendingPhone = phoneNumber;
    await createChallenge();
    return 'Complete the SmartPark verification in the new window.';
  });

  ipcMain.handle('verify-code', async (event, code) => {
    fromDashboard(event);
    await mobileClient.verifyCode(code);
    const remembered = await saveMobileSession().catch(() => false);
    sendToDashboard('session-state', { signedIn: true });
    const assessment = await parkingService.afterSignIn();
    return { message: remembered ? 'Signed in to SmartPark.' : 'Signed in for this run.', assessment };
  });

  ipcMain.handle('sign-out', async event => {
    fromDashboard(event);
    parkingService.clearSession();
    pendingPhone = undefined;
    vehicles = parkingService.vehicles;
    await fs.rm(sessionFile(), { force: true });
    await fs.rm(plateFile(), { force: true });
    sendToDashboard('vehicle-plate-state', vehicles);
    sendToDashboard('session-state', { signedIn: false });
    return true;
  });

  ipcMain.on('challenge-token', async (event, token) => {
    if (event.sender !== challengeWindow?.webContents ||
      !challengeWindow.webContents.getURL().startsWith('https://parko.giantleap.no/client-challenge.html')) return;
    try {
      await mobileClient.requestCode(pendingPhone, token);
      sendToDashboard('login-state', { message: 'SMS code sent. Enter it in DumbPark.' });
      challengeWindow.close();
    } catch (error) {
      sendToDashboard('login-state', { message: error.message });
    }
  });
  ipcMain.on('challenge-error', (event, message) => {
    if (event.sender !== challengeWindow?.webContents) return;
    sendToDashboard('login-state', { message: `Verification challenge: ${String(message).slice(0, 100)}` });
  });

  createDashboard();
  app.on('activate', () => { if (!dashboard) createDashboard(); });
});

app.on('window-all-closed', () => app.quit());

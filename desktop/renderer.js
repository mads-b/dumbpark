'use strict';

const $ = id => document.getElementById(id);
let statusRequest = 0;
let currentVehicles = { plateNumbers: [], selectedPlate: null };

function showResult(result) {
  const state = result?.state || 'error';
  $('result').dataset.state = state;
  $('result').textContent = result?.message || 'SmartPark did not return a booking status.';
}

function showSignedIn(signedIn) {
  $('session-badge').textContent = signedIn ? 'Signed in' : 'Not signed in';
  $('session-badge').classList.toggle('good', signedIn);
  $('login-panel').hidden = signedIn;
  $('sign-out').hidden = !signedIn;
}

function showVehicles(state) {
  currentVehicles = state;
  const select = $('vehicle-plate');
  select.replaceChildren();
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Select a car';
  prompt.disabled = state.plateNumbers.length > 0;
  select.append(prompt);
  for (const plate of state.plateNumbers) {
    const option = document.createElement('option');
    option.value = plate;
    option.textContent = plate;
    select.append(option);
  }
  select.value = state.selectedPlate || '';
}

async function refreshPermit() {
  const request = ++statusRequest;
  showResult({ state: 'checking', message: 'Checking your parking status…' });
  try {
    const result = await window.dumbPark.checkPermit();
    if (request === statusRequest) showResult(result);
  } catch (error) {
    if (request === statusRequest) showResult({ state: 'error', message: error.message });
  }
}

$('show-add-vehicle').addEventListener('click', () => {
  const form = $('add-vehicle-form');
  form.hidden = !form.hidden;
  if (!form.hidden) $('new-vehicle-plate').focus();
});

$('cancel-add-vehicle').addEventListener('click', () => {
  $('add-vehicle-form').hidden = true;
  $('new-vehicle-plate').value = '';
  $('vehicle-status').textContent = '';
});

$('add-vehicle-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('save-vehicle');
  button.disabled = true;
  try {
    showVehicles(await window.dumbPark.addVehicle($('new-vehicle-plate').value));
    $('add-vehicle-form').hidden = true;
    $('new-vehicle-plate').value = '';
    $('vehicle-status').textContent = 'Car saved and selected.';
    await refreshPermit();
  } catch (error) {
    $('vehicle-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('vehicle-plate').addEventListener('change', async () => {
  try {
    showVehicles(await window.dumbPark.selectVehicle($('vehicle-plate').value));
    $('vehicle-status').textContent = '';
    await refreshPermit();
  } catch (error) {
    showVehicles(currentVehicles);
    $('vehicle-status').textContent = error.message;
  }
});

$('at-work').addEventListener('click', async () => {
  const button = $('at-work');
  button.disabled = true;
  statusRequest++;
  showResult({ state: 'checking', message: 'Checking your Tieto P40 permit…' });
  try {
    showResult(await window.dumbPark.atWork($('vehicle-plate').value));
  } catch (error) {
    showResult({ state: 'error', message: error.message });
  } finally {
    button.disabled = false;
  }
});

$('request-code').addEventListener('click', async () => {
  const button = $('request-code');
  button.disabled = true;
  $('login-status').textContent = 'Opening SmartPark verification…';
  try {
    $('login-status').textContent = await window.dumbPark.requestCode($('phone').value.trim());
  } catch (error) {
    $('login-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('verify-code').addEventListener('click', async () => {
  const button = $('verify-code');
  button.disabled = true;
  $('login-status').textContent = 'Signing in…';
  try {
    const result = await window.dumbPark.verifyCode($('code').value.trim());
    $('code').value = '';
    showSignedIn(true);
    $('login-status').textContent = result.message;
    await refreshPermit();
  } catch (error) {
    $('login-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('sign-out').addEventListener('click', async () => {
  try {
    await window.dumbPark.signOut();
    statusRequest++;
    showSignedIn(false);
    showResult({ state: 'ready', message: 'Signed out. Sign in to check or book parking.' });
  } catch (error) {
    showResult({ state: 'error', message: error.message });
  }
});

window.dumbPark.onSessionState(state => {
  showSignedIn(state.signedIn);
  if (state.signedIn) refreshPermit();
  else showResult({ state: 'needs-sign-in', message: 'Sign in to SmartPark to check your parking status.' });
});
window.dumbPark.onVehiclePlateState(showVehicles);
window.dumbPark.onLoginState(state => { $('login-status').textContent = state.message; });

'use strict';

const $ = id => document.getElementById(id);
let statusRequest = 0;
let currentVehicles = { plateNumbers: [], selectedPlate: null };
let displayedResult;
let signedInToSmartPark = false;
let bookingInProgress = false;
let focusRefreshPending = false;

function showResult(result) {
  displayedResult = result;
  const state = result?.state || 'error';
  $('result').dataset.state = state;
  $('result').textContent = result?.message || 'SmartPark did not return a booking status.';
}

function showSignedIn(signedIn) {
  signedInToSmartPark = signedIn;
  const webSignInUnavailable = window.dumbPark.capabilities?.canSignIn === false;
  $('session-badge').textContent = signedIn ? 'Signed in' : 'Not signed in';
  $('session-badge').classList.toggle('good', signedIn);
  $('login-panel').hidden = signedIn || webSignInUnavailable;
  $('web-limitation').hidden = signedIn || !webSignInUnavailable;
  if (webSignInUnavailable) {
    $('tagline').textContent = 'Web preview of the one-click parking app.';
    $('arrival-description').textContent = 'Vehicle selection works here. Permit checks and booking will be available when SmartPark supports web sign-in.';
    $('at-work').disabled = true;
    $('at-work').textContent = 'Web booking unavailable';
  }
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

function focusCallToAction(unverified = false) {
  const prompt = currentVehicles.plateNumbers.length
    ? 'At work? Click the green button below now.'
    : 'Add a car with +, then click the green button below.';
  return { state: 'missing', message: unverified
    ? `⚠ No current Tieto P40 booking is confirmed. SmartPark could not verify a new one. ${prompt}`
    : `⚠ Your previous Tieto P40 booking has expired. ${prompt}` };
}

async function refreshPermit({ keepCallToAction = false } = {}) {
  const request = ++statusRequest;
  if (!keepCallToAction) showResult({ state: 'checking', message: 'Checking your parking status…' });
  try {
    const result = await window.dumbPark.checkPermit();
    if (request === statusRequest) {
      showResult(keepCallToAction && result.state === 'unknown' ? focusCallToAction(true) : result);
    }
  } catch (error) {
    if (request === statusRequest) {
      showResult(keepCallToAction ? focusCallToAction(true) : { state: 'error', message: error.message });
    }
  }
}

async function checkPermitOnFocus() {
  if (!signedInToSmartPark || bookingInProgress || focusRefreshPending ||
      displayedResult?.state === 'checking') return;
  let keepCallToAction = displayedResult?.state === 'missing';
  if (displayedResult?.state === 'active' || displayedResult?.state === 'booked') {
    const expiry = displayedResult.validToEpochMs;
    if (Number.isFinite(expiry) && expiry > Date.now()) return;
    showResult(focusCallToAction());
    keepCallToAction = true;
  }
  focusRefreshPending = true;
  try { await refreshPermit({ keepCallToAction }); }
  finally { focusRefreshPending = false; }
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
  bookingInProgress = true;
  statusRequest++;
  showResult({ state: 'checking', message: 'Checking your Tieto P40 permit…' });
  try {
    showResult(await window.dumbPark.atWork($('vehicle-plate').value));
  } catch (error) {
    showResult({ state: 'error', message: error.message });
  } finally {
    button.disabled = false;
    bookingInProgress = false;
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
  else {
    statusRequest++;
    showResult({ state: 'needs-sign-in', message: window.dumbPark.capabilities?.canSignIn === false
      ? 'SmartPark web sign-in is unavailable. Use the Windows app to check or book parking.'
      : 'Sign in to SmartPark to check your parking status.' });
  }
});
window.dumbPark.onVehiclePlateState(showVehicles);
window.dumbPark.onDashboardFocus(checkPermitOnFocus);
window.dumbPark.onLoginState(state => { $('login-status').textContent = state.message; });

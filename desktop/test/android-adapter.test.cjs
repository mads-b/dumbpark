'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

test('Android reminder tap reaches the shared booking UI only after a native tap', async () => {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'android', 'adapter-entry.cjs')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022'
  }).outputFiles[0].text;
  let tapped = false;
  let requests = 0;
  const window = { DumbParkNative: {
    readState: () => '{}', writeState: () => 'ok',
    call: (id, method) => {
      if (method === 'request') requests++;
      setTimeout(() => window.dumbParkNativeResult(JSON.stringify({ id,
        value: method === 'consumeBookingIntent' ? tapped : 'ready' })), 0);
    }
  } };
  vm.runInNewContext(bundle, { window, setTimeout });
  // External scripts can yield to the event loop between adapter.js and renderer.js.
  await new Promise(resolve => setTimeout(resolve, 20));
  const booked = [];
  const sessions = [];
  window.dumbPark.onBookingRequested(() => booked.push(true));
  window.dumbPark.onSessionState(state => sessions.push(state.signedIn));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sessions, [false]);
  assert.equal(booked.length, 0);
  tapped = true;
  await window.dumbParkNativeBookRequested();
  assert.equal(booked.length, 1);
  assert.equal((await window.dumbPark.atWork('AB12345')).state, 'needs-plate');
  assert.equal(requests, 0);
  assert.equal(window.dumbPark.capabilities.arrivalReminders, true);
});

test('Android restores an expired session, persists renewal, and keeps it through an offline restart', async () => {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'android', 'adapter-entry.cjs')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022'
  }).outputFiles[0].text;
  let saved = JSON.stringify({ session: { token: 'expired', refreshToken: 'remember-me' },
    vehicles: { plateNumbers: ['AB12345'], selectedPlate: 'AB12345' } });
  let renewals = 0;
  let offline = false;
  async function open() {
    const window = { DumbParkNative: {
      readState: () => saved,
      writeState: value => { saved = value; return 'ok'; },
      call: (id, method, raw) => {
        let value = false;
        let error;
        if (method === 'request') {
          const payload = JSON.parse(raw);
          if (offline) error = 'Network unavailable';
          else if (new URL(payload.url).pathname === '/client/reauth') {
            renewals++;
            value = { status: 200, body: JSON.stringify({ resultCode: 'SUCCESS', token: 'renewed' }) };
          } else if (payload.headers['X-Token'] === 'expired') value = { status: 401, body: '{}' };
          else value = { status: 200, body: JSON.stringify({ resultCode: 'SUCCESS', permits: [],
            parkingServices: [{ clientServices: { products: {
              pathToPermitShops: 'permit/shops', pathToMyPermits: 'permit/list'
            } } }] }) };
        }
        setTimeout(() => window.dumbParkNativeResult(JSON.stringify({ id, value, error })), 0);
      }
    } };
    vm.runInNewContext(bundle, { window, setTimeout, URL, AbortSignal });
    const state = await new Promise(resolve => window.dumbPark.onSessionState(resolve));
    return { window, state };
  }
  assert.equal((await open()).state.signedIn, true);
  assert.equal(renewals, 1);
  assert.equal(JSON.parse(saved).session.token, 'renewed');
  assert.equal(JSON.parse(saved).session.refreshToken, 'remember-me');
  assert.equal(JSON.parse(saved).session.pathToMyPermits, 'permit/list');
  offline = true;
  const restarted = await open();
  assert.equal(restarted.state.signedIn, true);
  assert.equal(JSON.parse(saved).session.token, 'renewed');
  assert.equal((await restarted.window.dumbPark.checkPermit()).state, 'unknown');
  offline = false;
  assert.equal((await restarted.window.dumbPark.checkPermit()).state, 'missing');
  assert.equal(renewals, 1);
  await restarted.window.dumbPark.signOut();
  assert.equal(JSON.parse(saved).session.refreshToken, undefined);
});

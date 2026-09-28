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

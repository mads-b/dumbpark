'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

test('browser adapter uses the shared service and persists cars without a token', async () => {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', 'web', 'adapter-entry.cjs')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022'
  }).outputFiles[0].text;
  const listeners = {};
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  const document = { cookie: '' };
  vm.runInNewContext(bundle, {
    window, document, location: { pathname: '/dumbpark/', protocol: 'https:' }, setTimeout
  });
  const states = [];
  window.dumbPark.onSessionState(state => states.push(state));
  await new Promise(setImmediate);
  assert.deepEqual(states.map(state => state.signedIn), [false]);
  assert.equal(window.dumbPark.capabilities.canSignIn, false);
  await window.dumbPark.addVehicle('ab12345');
  assert.match(document.cookie, /dumbpark_vehicles=/);
  assert.match(document.cookie, /SameSite=Strict; Secure/);
  assert.equal((await window.dumbPark.atWork('AB12345')).state, 'needs-sign-in');
  await assert.rejects(window.dumbPark.requestCode(), /web verification callback/);
  assert.equal(typeof listeners.focus, 'function');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('focus clears an expired permit immediately and checks for a new one', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, classList: { toggle() {} }, addEventListener() {},
      replaceChildren() {}, append() {}, textContent: '', hidden: false, value: ''
    });
    return elements.get(id);
  };
  const callbacks = {};
  let now = 900;
  let reads = 0;
  let resolveSecondRead;
  const dumbPark = {
    onSessionState: callback => { callbacks.session = callback; },
    onVehiclePlateState: callback => { callbacks.vehicles = callback; },
    onDashboardFocus: callback => { callbacks.focus = callback; },
    onLoginState() {},
    checkPermit: () => {
      reads++;
      return reads === 1
        ? Promise.resolve({ state: 'active', message: 'Permit active.', validToEpochMs: 1000 })
        : new Promise(resolve => { resolveSecondRead = resolve; });
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'renderer.js'), 'utf8');
  vm.runInNewContext(source, {
    window: { dumbPark },
    document: { getElementById: element, createElement: () => ({ value: '', textContent: '' }) },
    Date: { now: () => now }
  });

  callbacks.vehicles({ plateNumbers: ['AB12345'], selectedPlate: 'AB12345' });
  callbacks.session({ signedIn: true });
  await new Promise(setImmediate);
  assert.equal(element('result').dataset.state, 'active');

  callbacks.focus();
  assert.equal(reads, 1);
  now = 1000;
  callbacks.focus();
  assert.equal(element('result').dataset.state, 'missing');
  assert.match(element('result').textContent, /expired.*green button/i);
  assert.equal(reads, 2);
  callbacks.focus();
  assert.equal(reads, 2);

  resolveSecondRead({ state: 'active', message: 'New permit active.', validToEpochMs: 2000 });
  await new Promise(setImmediate);
  assert.equal(element('result').dataset.state, 'active');
  assert.equal(element('result').textContent, 'New permit active.');

  now = 2000;
  callbacks.focus();
  resolveSecondRead({ state: 'unknown', message: 'Network unavailable.' });
  await new Promise(setImmediate);
  assert.equal(element('result').dataset.state, 'missing');
  assert.match(element('result').textContent, /could not verify.*green button/i);
});

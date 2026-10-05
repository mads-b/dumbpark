'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'renderer.js'), 'utf8');
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

function mount(saved) {
  const elements = new Map();
  const focusCallbacks = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: false, disabled: false, textContent: '', dataset: {}, attributes: {},
      listeners: {}, classList: { toggle() {} },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; }
    });
    return elements.get(id);
  };
  const dumbPark = {
    capabilities: { arrivalReminders: true },
    getReminderStatus: async () => saved,
    enableReminders: async () => { saved = { enabled: true, setupPending: false, message: 'On' }; return saved; },
    disableReminders: async () => { saved = { enabled: false, setupPending: false, message: 'Off' }; return saved; },
    repairReminders: async () => {
      saved = { ...saved, healthy: true, details: 'Both work geofences registered.' }; return saved;
    },
    openReminderSettings: async () => {},
    onReminderStateChanged() {}, onBookingRequested() {}, onSessionState() {},
    onVehiclePlateState() {}, onLoginState() {},
    onDashboardFocus(callback) { focusCallbacks.push(callback); }
  };
  vm.runInNewContext(renderer, { window: { dumbPark }, document: { getElementById: element } });
  return { element, focusCallbacks, savedState: () => saved };
}

test('arrival reminder control reflects saved state after focus and reload', async () => {
  const app = mount({ enabled: true, setupPending: false, message: 'On' });
  const button = app.element('enable-reminders');
  await nextTick();
  assert.equal(button.textContent, 'Turn off arrival reminders');
  assert.equal(button.attributes['aria-pressed'], 'true');

  for (const callback of app.focusCallbacks) await callback();
  assert.equal(button.textContent, 'Turn off arrival reminders');

  await button.listeners.click();
  assert.equal(button.textContent, 'Enable arrival reminders');
  assert.equal(button.attributes['aria-pressed'], 'false');

  await button.listeners.click();
  assert.equal(button.textContent, 'Turn off arrival reminders');
  const reopened = mount(app.savedState());
  await nextTick();
  assert.equal(reopened.element('enable-reminders').textContent, 'Turn off arrival reminders');
});

test('enabled reminders show a health warning and can re-arm without changing the setting', async () => {
  const app = mount({ enabled: true, requestedEnabled: true, healthy: false,
    message: 'Enabled, but registration needs recovery.', details: 'Last arrival: not recorded' });
  await nextTick();
  assert.equal(app.element('enable-reminders').textContent, 'Turn off arrival reminders');
  assert.equal(app.element('android-reminders').dataset.healthy, 'false');
  assert.equal(app.element('reminder-details').textContent, 'Last arrival: not recorded');
  assert.equal(app.element('repair-reminders').hidden, false);
  await app.element('repair-reminders').listeners.click();
  assert.equal(app.savedState().enabled, true);
  assert.equal(app.element('android-reminders').dataset.healthy, 'true');
  assert.equal(app.element('reminder-details').textContent, 'Both work geofences registered.');
  assert.equal(app.element('repair-reminders').disabled, false);
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DutyState = require('../dean-duty-state.js');

function memory() {
  const data = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) { data[key] = String(value); },
    removeItem: function (key) { delete data[key]; }
  };
}

const store = memory();
assert.strictEqual(DutyState.read(store), null);

DutyState.write(store, {
  q: '100', h: '240', model: 'RA2096', rpm: '3500', fluid: 'water', t: '68',
  tempTyped: false, shown: true
});
const saved = DutyState.read(store);
assert.strictEqual(saved.q, '100');
assert.strictEqual(saved.h, '240');
assert.strictEqual(saved.model, 'RA2096');
assert.strictEqual(saved.rpm, '3500');
assert.strictEqual(saved.fluid, 'water');
assert.strictEqual(saved.t, '68');
assert.strictEqual(saved.shown, true);
assert.strictEqual(saved.service, 'ra');
assert.strictEqual(DutyState.shouldRestoreResults(saved), true);
const hot = DutyState.applyParams(saved, new URLSearchParams('service=hot-water'));
assert.strictEqual(hot.service, 'rwa');
assert.strictEqual(hot.q, '100');
assert.strictEqual(DutyState.applyParams(hot, new URLSearchParams('service=thermal')).service, 'ra');

const modelOnly = DutyState.applyParams(saved, new URLSearchParams('model=RA3146'));
assert.strictEqual(modelOnly.model, 'RA3146');
assert.strictEqual(modelOnly.q, '100');
assert.strictEqual(modelOnly.h, '240');
const fromUrl = DutyState.applyParams(saved, new URLSearchParams('model=RA3146&flow=80'));
assert.strictEqual(fromUrl.model, 'RA3146');
assert.strictEqual(fromUrl.q, '80');
assert.strictEqual(fromUrl.h, '240');
assert.strictEqual(fromUrl.shown, true);

const canonical = DutyState.applyParams(saved, new URLSearchParams('flow=40&q=100&head=10&h=240'));
assert.strictEqual(canonical.q, '100');
assert.strictEqual(canonical.h, '240');

const hidden = DutyState.applyParams({ q: '100', h: '240', t: '68', shown: false }, null);
assert.strictEqual(DutyState.shouldRestoreResults(hidden), false);
assert.strictEqual(DutyState.shouldRestoreResults(DutyState.applyParams({ q: '', h: '240', t: '68', shown: true }, null)), false);

store.setItem(DutyState.KEY, '{');
assert.strictEqual(DutyState.read(store), null);

DutyState.write(store, saved);
DutyState.clear(store);
assert.strictEqual(DutyState.read(store), null);

const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert.ok(page.indexOf('src="dean-duty-state.js"') > 0);
assert.ok(page.indexOf('localStorage') > 0);
assert.ok(page.indexOf("addEventListener('pageshow'") > 0);
assert.ok(page.indexOf('id="sel-service"') > 0);
assert.ok(page.indexOf('Hot Water / Glycol') > 0);
assert.ok(page.indexOf('Thermal Fluid') > 0);
assert.ok(page.indexOf('id="duty-clear"') > 0);
assert.ok(page.indexOf('>Clear<') > 0);
assert.ok(page.indexOf('target="_blank" rel="noopener"') > 0);
assert.ok(page.indexOf('target="_top"') < 0);

console.log('dean-duty-state tests passed');

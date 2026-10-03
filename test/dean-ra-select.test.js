const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));

function pick(q, h) {
  return DeanRA.select(catalog, { q_gpm: q, h_ft: h });
}

function assertCovered(result, q, h) {
  assert.strictEqual(result.covered, true, 'expected a cover for ' + q + ' gpm / ' + h + ' ft');
  const hit = result.pick;
  assert.ok(hit.endMargin >= -1e-6, 'duty is past the last real point');
  assert.ok(q + 1e-6 >= hit.qMin && q - 1e-6 <= hit.qMax, 'flow outside the real segment');
  if (hit.kind === 'catalog') {
    const on = DeanRA.headAt(
      hit.curve.impellers.find(function (imp) { return imp.diameter_in === hit.upperDiameter; }).points,
      q
    );
    assert.ok(Math.abs(on.h - h) <= DeanRA.ON_LINE_FT + 1e-6);
  } else {
    const top = Math.max(hit.hUpper, hit.hLower);
    const bot = Math.min(hit.hUpper, hit.hLower);
    assert.ok(h <= top + 1e-6 && h >= bot - 1e-6, 'head left the adjacent-diameter envelope');
    assert.ok(hit.between[1] - hit.between[0] > 0);
  }
  assert.notStrictEqual(hit.curve.rpm, 1150);
}

// Exact catalog point on RA1060 6 in at 80 gpm / 147 ft.
{
  const r = pick(80, 147);
  assertCovered(r, 80, 147);
  assert.strictEqual(r.pick.curve.model, 'RA1060-A2');
  assert.strictEqual(r.pick.kind, 'catalog');
  assert.strictEqual(r.pick.upperDiameter, 6);
  assert.strictEqual(r.pick.curve.rpm, 3500);
  assert.strictEqual(r.pick.curve.frame, 'RA2096');
}

// Between the 6 in and 5.5 in lines on the same pump.
{
  const r = pick(80, 130);
  assertCovered(r, 80, 130);
  assert.strictEqual(r.pick.curve.model, 'RA1060-A2');
  assert.strictEqual(r.pick.kind, 'between');
  assert.deepStrictEqual(r.pick.between, [5.5, 6]);
  assert.ok(r.pick.impellerLabel || true);
  assert.ok(DeanRA.impellerLabel(r.pick).indexOf('between catalog diameters') >= 0);
  assert.ok(DeanRA.impellerLabel(r.pick).indexOf('not a published curve') >= 0);
}

// Above every published line.
{
  const r = pick(40, 800);
  assert.strictEqual(r.covered, false);
  assert.strictEqual(r.pick, null);
}

// Past the end of the small pump, still inside a larger one: 200 gpm at 140 ft.
// RA1060 ends at 160 gpm, so it must not be chosen.
{
  const r = pick(200, 140);
  assertCovered(r, 200, 140);
  assert.notStrictEqual(r.pick.curve.model, 'RA1060-A2');
  assert.ok(r.pick.endMargin > 0);
}

// 1750 rpm sheet only. A low head at mid flow is the #2 curve, not the 3500 #1.
{
  const r = pick(500, 90);
  assertCovered(r, 500, 90);
  assert.strictEqual(r.pick.curve.model, 'R40100-B2');
  assert.strictEqual(r.pick.curve.rpm, 1750);
  assert.strictEqual(r.pick.kind, 'between');
}

// High head at the same flow stays on the 3500 rpm #1 curve.
{
  const r = pick(500, 360);
  assertCovered(r, 500, 360);
  assert.strictEqual(r.pick.curve.model, 'R40100-A1');
  assert.strictEqual(r.pick.curve.rpm, 3500);
}

// No 1150 rpm curve is in the catalog or the results.
{
  catalog.curves.forEach(function (c) {
    assert.notStrictEqual(c.rpm, 1150);
  });
  assert.strictEqual(catalog.curves.length, 13);
}

// Inferred flag follows a segment that uses an inferred point, and stays off a clean segment.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'RA1060-A2'; });
  const six = curve.impellers.find(function (imp) { return imp.diameter_in === 6; });
  const at = DeanRA.headAt(six.points, 130);
  assert.strictEqual(at.inferred, true);
  const clean = DeanRA.headAt(six.points, 80);
  assert.strictEqual(clean.inferred, false);
  const onPoint = DeanRA.headAt(
    catalog.curves.find(function (c) { return c.model === 'R40100-B2'; }).impellers.find(function (imp) { return imp.diameter_in === 10; }).points,
    500
  );
  assert.strictEqual(onPoint.inferred, false);
  assert.strictEqual(onPoint.h, 104);
  const low = pick(500, 90);
  assert.strictEqual(low.pick.inferred, false);
  const throughLabel = pick(800, 90);
  assert.strictEqual(throughLabel.pick.curve.model, 'R40100-B2');
  assert.strictEqual(throughLabel.pick.inferred, true);
  const onSix = pick(80, 147);
  assert.strictEqual(onSix.pick.inferred, false);
}

// Do not extrapolate past the last real point of a line.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'RA1060-A2'; });
  const six = curve.impellers.find(function (imp) { return imp.diameter_in === 6; });
  assert.strictEqual(DeanRA.headAt(six.points, 200), null);
  assert.strictEqual(DeanRA.headAt(six.points, 0), null);
}

// Water and glycol call out the hot-oil line. Other fluids stay uncorrected.
{
  assert.ok(DeanRA.fluidNote('water').indexOf('not the RWA line') >= 0);
  assert.ok(DeanRA.fluidNote('eg').indexOf('not the RWA line') >= 0);
  assert.ok(DeanRA.fluidNote('pg').indexOf('hot-oil line') >= 0);
  assert.ok(DeanRA.fluidNote('other').indexOf('not viscosity-corrected') >= 0);
  assert.ok(DeanRA.fluidNote('hto').indexOf('No viscosity correction') >= 0);
  assert.ok(DeanRA.fluidNote('hto').indexOf('RWA') < 0);
}

// One recommendation, and every stored point still carries an inferred flag.
{
  let points = 0;
  catalog.curves.forEach(function (c) {
    c.impellers.forEach(function (imp) {
      imp.points.forEach(function (p) {
        points++;
        assert.strictEqual(typeof p.inferred, 'boolean');
        assert.strictEqual(typeof p.h_ft, 'number');
        assert.strictEqual(typeof p.q_gpm, 'number');
      });
    });
  });
  assert.strictEqual(points, 283);
  const r = pick(100, 100);
  assert.strictEqual(r.matchCount >= 1, true);
  assert.ok(r.pick);
}

console.log('dean-ra-select tests passed');

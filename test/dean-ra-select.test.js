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
    assert.strictEqual(hit.kind, 'trim');
    const top = Math.max(hit.hUpper, hit.hLower);
    const bot = Math.min(hit.hUpper, hit.hLower);
    assert.ok(h <= top + 1e-6 && h >= bot - 1e-6, 'head left the adjacent-diameter envelope');
    assert.ok(hit.between[1] - hit.between[0] > 0);
    const hd = DeanRA.affinityHead(hit.hLower, hit.hUpper, hit.lowerDiameter, hit.upperDiameter, hit.diameter_in);
    assert.ok(hd + 1e-4 >= h, 'trim head is below the duty');
    assert.ok(hit.diameter_in > hit.lowerDiameter - 1e-6 && hit.diameter_in < hit.upperDiameter + 1e-6);
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

// Between the 6 in and 5.5 in lines: eighth-inch trim, not a linear diameter.
{
  const r = pick(80, 130);
  assertCovered(r, 80, 130);
  assert.strictEqual(r.pick.curve.model, 'RA1060-A2');
  assert.strictEqual(r.pick.kind, 'trim');
  assert.strictEqual(r.pick.diameter_in, 5.75);
  assert.deepStrictEqual(r.pick.between, [5.5, 6]);
  const label = DeanRA.impellerLabel(r.pick);
  assert.ok(label.indexOf('5.75 in') === 0);
  assert.ok(label.indexOf('calculated between the 5.5 in and 6 in catalog diameters') >= 0);
  assert.ok(label.indexOf('not a published curve') >= 0);
}

// Within 3 ft of a catalog line, keep that diameter instead of solving a trim.
{
  const r = pick(80, 145);
  assertCovered(r, 80, 145);
  assert.strictEqual(r.pick.curve.model, 'RA1060-A2');
  assert.strictEqual(r.pick.kind, 'catalog');
  assert.strictEqual(r.pick.diameter_in, 6);
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
  assert.strictEqual(DeanRA.powerFrame(r.pick.curve), 'RA3146');
  assert.strictEqual(r.pick.curve.size, '4 x 6 x 10 #2');
  assert.strictEqual(r.pick.kind, 'trim');
  assert.strictEqual(r.pick.diameter_in, 9.375);
  assert.deepStrictEqual(r.pick.between, [9, 10]);
  const label = DeanRA.impellerLabel(r.pick);
  assert.ok(label.indexOf('9.375 in') === 0);
  assert.ok(label.indexOf('calculated between the 9 in and 10 in catalog diameters') >= 0);
  assert.ok(label.indexOf('not a published curve') >= 0);
  const next = DeanRA.affinityHead(r.pick.hLower, r.pick.hUpper, 9, 10, 9.25);
  assert.ok(next < 90);
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

// Page 11 (RA1080-A2) uses the corrected sheet heads, and dropped flows stay absent.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'RA1080-A2'; });
  function line(dia) {
    return curve.impellers.find(function (imp) { return imp.diameter_in === dia; }).points;
  }
  function at(dia, q) { return DeanRA.headAt(line(dia), q); }
  assert.strictEqual(at(8, 25).h, 294);
  assert.strictEqual(at(8, 40).h, 290);
  assert.strictEqual(at(8, 100).h, 293);
  assert.strictEqual(at(8, 100).inferred, false);
  assert.strictEqual(at(8, 160).h, 268);
  assert.strictEqual(at(8, 180), null);
  assert.strictEqual(at(7, 25).h, 221);
  assert.strictEqual(at(7, 60).h, 222);
  assert.strictEqual(at(7, 80).h, 222);
  assert.strictEqual(at(7, 100).h, 215);
  assert.strictEqual(at(6, 120).h, 146);
  assert.strictEqual(at(6, 120).inferred, true);
  assert.strictEqual(at(6, 140), null);
  assert.strictEqual(at(6, 160), null);
  assert.strictEqual(at(5, 100).h, 98);
  assert.strictEqual(at(5, 120), null);
  assert.strictEqual(at(5, 140), null);
  assert.strictEqual(at(5, 160), null);
  const onEight = pick(100, 293);
  assertCovered(onEight, 100, 293);
  assert.strictEqual(onEight.pick.curve.model, 'RA1080-A2');
  assert.strictEqual(onEight.pick.kind, 'catalog');
  assert.strictEqual(onEight.pick.upperDiameter, 8);
  assert.strictEqual(DeanRA.powerFrame(onEight.pick.curve), 'RA2096');
}

// The name on screen is the RA power frame printed on the sheet, not the curve-sheet id.
{
  var shown = {
    'RA1060-A2': 'RA2096',
    'RA1080-A2': 'RA2096',
    'R1085-A2': 'RA3146',
    'RA1560-A2': 'RA2096',
    'R1585-A2': 'RA3146',
    'R15100-A2': 'RA3146',
    'R2085-A2': 'RA3146',
    'R20100-A2': 'RA3146',
    'R3085-A1': 'RA3146',
    'R30100-A1': 'RA3146',
    'R4085-A1': 'RA3146',
    'R40100-B2': 'RA3146',
    'R40100-A1': 'RA3186'
  };
  catalog.curves.forEach(function (c) {
    assert.strictEqual(DeanRA.powerFrame(c), shown[c.model]);
    assert.notStrictEqual(DeanRA.powerFrame(c), c.model);
    assert.ok(shown[c.model] === 'RA2096' || shown[c.model] === 'RA3146' || shown[c.model] === 'RA3186');
  });
  var page21 = catalog.curves.find(function (c) { return c.model === 'R40100-B2'; });
  assert.strictEqual(page21.frame, 'RWA4166');
  assert.strictEqual(DeanRA.powerFrame(page21), 'RA3146');
}

// Offered trims stop at the smallest digitized line. Page 20 does not use 6.375 to 5.500.
{
  function dias(model) {
    return DeanRA.offeredDiameters(catalog.curves.find(function (c) { return c.model === model; }));
  }
  const page20 = dias('R4085-A1');
  assert.strictEqual(page20[0], 6.5);
  assert.strictEqual(page20[page20.length - 1], 8.5);
  assert.ok(page20.indexOf(6.375) < 0);
  assert.ok(page20.indexOf(5.5) < 0);
  assert.strictEqual(dias('RA1060-A2')[0], 4);
  assert.strictEqual(dias('RA1080-A2')[0], 5);
  assert.strictEqual(dias('R40100-B2')[0], 7);
  const page22 = dias('R40100-A1');
  assert.strictEqual(page22[0], 8);
  assert.ok(page22.indexOf(7.875) < 0);
  assert.strictEqual(page22[page22.length - 1], 10);
}

// Page 22 heads use a 0-to-450 ft scale. Flags stay, and 1800 gpm stays blank.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'R40100-A1'; });
  const expect = {
    10: [[100, 406, false], [300, 405, false], [600, 405, false], [1000, 394, false], [1400, 348, false]],
    9: [[100, 312, false], [300, 312, false], [600, 307, true], [1000, 278, false], [1400, 223, false]],
    8: [[100, 215, false], [300, 214, false], [600, 210, false], [1000, 185, true], [1400, 177, false]]
  };
  curve.impellers.forEach(function (imp) {
    const rows = expect[imp.diameter_in];
    assert.strictEqual(imp.points.length, rows.length);
    rows.forEach(function (row, i) {
      assert.strictEqual(imp.points[i].q_gpm, row[0]);
      assert.strictEqual(imp.points[i].h_ft, row[1]);
      assert.strictEqual(imp.points[i].inferred, row[2]);
    });
    assert.strictEqual(DeanRA.headAt(imp.points, 1800), null);
  });
  const high = pick(500, 360);
  assertCovered(high, 500, 360);
  assert.strictEqual(high.pick.curve.model, 'R40100-A1');
  assert.strictEqual(high.pick.curve.rpm, 3500);
  assert.strictEqual(DeanRA.powerFrame(high.pick.curve), 'RA3186');
}

// Do not extrapolate past the last real point of a line.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'RA1060-A2'; });
  const six = curve.impellers.find(function (imp) { return imp.diameter_in === 6; });
  assert.strictEqual(DeanRA.headAt(six.points, 200), null);
  assert.strictEqual(DeanRA.headAt(six.points, 0), null);
}

// RA and RWA share these curves. Water and glycol are not sent to a different line.
{
  ['water', 'eg', 'pg', 'hto', 'other'].forEach(function (fluid) {
    var note = DeanRA.fluidNote(fluid);
    assert.ok(note.indexOf('not the RWA') < 0, fluid);
    assert.ok(note.toLowerCase().indexOf('not rwa') < 0, fluid);
    assert.ok(note.indexOf('shared Dean RA / RWA hydraulics') >= 0, fluid);
    assert.ok(note.indexOf('hot-oil build') >= 0, fluid);
    assert.ok(note.indexOf('hot-water build') >= 0, fluid);
    assert.ok(note.indexOf('not a different head-capacity curve') >= 0, fluid);
  });
  assert.ok(DeanRA.fluidNote('water').indexOf('No viscosity correction') >= 0);
  assert.ok(DeanRA.fluidNote('eg').indexOf('No viscosity correction') >= 0);
  assert.ok(DeanRA.fluidNote('other').indexOf('not viscosity-corrected') >= 0);
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
  assert.strictEqual(points, 277);
  const r = pick(100, 100);
  assert.strictEqual(r.matchCount >= 1, true);
  assert.ok(r.pick);
}

console.log('dean-ra-select tests passed');

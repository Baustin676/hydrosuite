const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));

function pick(q, h) {
  return DeanRA.select(catalog, { q_gpm: q, h_ft: h });
}

function findModel(result, model) {
  const hit = (result.selections || []).find(function (s) { return s.curve.model === model; });
  assert.ok(hit, 'missing ' + model + ' from the list');
  return hit;
}

function assertHit(hit, q, h) {
  assert.ok(hit.endMargin >= -1e-6, 'duty is past the last real point');
  assert.ok(q + 1e-6 >= hit.qMin && q - 1e-6 <= hit.qMax, 'flow outside the real segment');
  assert.ok(hit.head_ft + 1e-4 >= h - DeanRA.ON_LINE_FT, 'head short of the duty');
  const frame = DeanRA.powerFrame(hit.curve);
  assert.ok(frame === 'RA2096' || frame === 'RA3146' || frame === 'RA3186');
  assert.notStrictEqual(frame, hit.curve.model);
  if (hit.kind === 'catalog') {
    const on = DeanRA.smoothHead(
      hit.curve.impellers.find(function (imp) { return imp.diameter_in === hit.upperDiameter; }).points,
      q
    );
    assert.ok(Math.abs(on.h - hit.head_ft) < 1e-6);
    assert.ok(on.h + 1e-4 >= h - DeanRA.ON_LINE_FT);
  } else {
    assert.strictEqual(hit.kind, 'trim');
    const top = Math.max(hit.hUpper, hit.hLower);
    const bot = Math.min(hit.hUpper, hit.hLower);
    assert.ok(h <= top + 1e-6 && h >= bot - 1e-6, 'head left the adjacent-diameter envelope');
    assert.ok(hit.between[1] - hit.between[0] > 0);
    const hd = DeanRA.affinityHead(hit.hLower, hit.hUpper, hit.lowerDiameter, hit.upperDiameter, hit.diameter_in);
    assert.ok(Math.abs(hd - hit.head_ft) < 1e-6);
    assert.ok(hd + 1e-4 >= h, 'trim head is below the duty');
    assert.ok(hit.diameter_in > hit.lowerDiameter - 1e-6 && hit.diameter_in < hit.upperDiameter + 1e-6);
  }
  assert.notStrictEqual(hit.curve.rpm, 1150);
}

function assertCovered(result, q, h) {
  assert.strictEqual(result.covered, true, 'expected a cover for ' + q + ' gpm / ' + h + ' ft');
  assert.ok(result.selections && result.selections.length === result.matchCount);
  assert.strictEqual(result.pick, result.selections[0]);
  result.selections.forEach(function (hit) { assertHit(hit, q, h); });
  for (let i = 1; i < result.selections.length; i++) {
    const prev = result.selections[i - 1].head_ft - h;
    const cur = result.selections[i].head_ft - h;
    if (prev >= -1e-6 && cur >= -1e-6) {
      assert.ok(cur + DeanRA.ON_LINE_FT + 0.05 >= prev, 'closer trim ranked after a looser one');
    }
  }
}

// Exact catalog point on RA1060 6 in at 80 gpm / 147 ft.
{
  const r = pick(80, 147);
  assertCovered(r, 80, 147);
  const hit = findModel(r, 'RA1060-A2');
  assert.strictEqual(hit.kind, 'catalog');
  assert.strictEqual(hit.upperDiameter, 6);
  assert.strictEqual(hit.curve.rpm, 3500);
  assert.strictEqual(hit.curve.frame, 'RA2096');
  assert.strictEqual(hit.head_ft, 147);
}

// Between the 6 in and 5.5 in lines: eighth-inch trim, not a linear diameter.
// The list is every size that can meet the duty, not this one pump.
{
  const r = pick(80, 130);
  assertCovered(r, 80, 130);
  assert.ok(r.selections.length > 1);
  const hit = findModel(r, 'RA1060-A2');
  assert.strictEqual(hit.kind, 'trim');
  assert.strictEqual(hit.diameter_in, 5.75);
  assert.deepStrictEqual(hit.between, [5.5, 6]);
  const label = DeanRA.impellerLabel(hit);
  assert.ok(label.indexOf('5.75 in') === 0);
  assert.ok(label.indexOf('calculated between the 5.5 in and 6 in catalog diameters') >= 0);
  assert.ok(label.indexOf('not a published curve') >= 0);
}

// Within 3 ft of a catalog line, keep that diameter instead of solving a trim.
{
  const r = pick(80, 145);
  assertCovered(r, 80, 145);
  const hit = findModel(r, 'RA1060-A2');
  assert.strictEqual(hit.kind, 'catalog');
  assert.strictEqual(hit.diameter_in, 6);
}

// Above every published line.
{
  const r = pick(40, 800);
  assert.strictEqual(r.covered, false);
  assert.strictEqual(r.pick, null);
}

// Past the end of the small pump, still inside a larger one: 200 gpm at 140 ft.
// RA1060 ends at 160 gpm, so it must not be in the list.
{
  const r = pick(200, 140);
  assertCovered(r, 200, 140);
  assert.ok(r.selections.every(function (s) { return s.curve.model !== 'RA1060-A2'; }));
  assert.ok(r.selections.some(function (s) { return s.endMargin > 0; }));
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
  assert.strictEqual(at(8, 40).h, 293);
  assert.strictEqual(at(8, 60).h, 293);
  assert.strictEqual(at(8, 80).h, 293);
  assert.strictEqual(at(8, 100).h, 293);
  assert.strictEqual(at(8, 100).inferred, false);
  assert.strictEqual(at(8, 160).h, 268);
  assert.strictEqual(at(8, 180), null);
  assert.strictEqual(at(7, 25).h, 221);
  assert.strictEqual(at(7, 60).h, 221);
  assert.strictEqual(at(7, 80).h, 221);
  assert.strictEqual(at(7, 100).h, 215);
  assert.strictEqual(at(6, 120).h, 145);
  assert.strictEqual(at(6, 120).inferred, true);
  assert.strictEqual(at(6, 140), null);
  assert.strictEqual(at(6, 160), null);
  assert.strictEqual(at(5, 100).h, 98);
  assert.strictEqual(at(5, 120), null);
  assert.strictEqual(at(5, 140), null);
  assert.strictEqual(at(5, 160), null);
  const onEight = pick(100, 293);
  assertCovered(onEight, 100, 293);
  const eight = findModel(onEight, 'RA1080-A2');
  assert.strictEqual(eight.kind, 'catalog');
  assert.strictEqual(eight.upperDiameter, 8);
  assert.strictEqual(DeanRA.powerFrame(eight.curve), 'RA2096');
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
    const measured = DeanRA.measuredPoints(imp.points);
    assert.strictEqual(measured.length, rows.length);
    rows.forEach(function (row, i) {
      assert.strictEqual(measured[i].q_gpm, row[0]);
      assert.strictEqual(measured[i].h_ft, row[1]);
      assert.strictEqual(measured[i].inferred, row[2]);
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

// Water at ambient is the reference. The default water note does not mention a viscosity correction.
{
  ['water', 'water60', 'water180', 'eg50', 'therminol66', 'dowthermA', 'seawater', 'custom'].forEach(function (fluid) {
    var note = DeanRA.fluidNote(fluid, { q_gpm: 400, h_ft: 200 });
    assert.ok(note.indexOf('Water at ambient is the reference these curves were drawn for.') >= 0, fluid);
    assert.ok(note.toLowerCase().indexOf('not the rwa') < 0, fluid);
    assert.ok(note.toLowerCase().indexOf('not rwa') < 0, fluid);
  });
  assert.ok(DeanRA.fluidNote('water').indexOf('still the catalog water curve') < 0);
  assert.ok(DeanRA.fluidNote('water60').indexOf('still the catalog water curve') < 0);
  assert.ok(DeanRA.fluidNote('water').toLowerCase().indexOf('viscosity') < 0);
  assert.ok(DeanRA.fluidNote('water60').toLowerCase().indexOf('viscosity') < 0);
  assert.strictEqual(
    DeanRA.fluidNote('water'),
    'Water at ambient is the reference these curves were drawn for.'
  );
}

// Published Hydraulic Institute preliminary correction, USCS worked example:
// 440 gpm at 230 ft, 120 cSt → B = 5.70, CQ = 0.934, water duty 471 gpm at 246 ft.
{
  const hi = DeanRA.hiPreliminary(440, 230, 120);
  assert.ok(Math.abs(hi.B - 5.70) < 0.02, 'B ' + hi.B);
  assert.ok(Math.abs(hi.CQ - 0.934) < 0.002, 'CQ ' + hi.CQ);
  assert.ok(Math.abs(hi.CH - hi.CQ) < 1e-12);
  assert.ok(Math.abs(hi.qWater - 471) < 1, 'Qw ' + hi.qWater);
  assert.ok(Math.abs(hi.hWater - 246) < 1, 'Hw ' + hi.hWater);
  assert.strictEqual(hi.range, 'ok');
  const low = DeanRA.hiPreliminary(400, 200, 1);
  assert.strictEqual(low.range, 'low');
  assert.strictEqual(low.CQ, 1);
  assert.strictEqual(low.CH, 1);
  const high = DeanRA.hiPreliminary(20, 40, 3000);
  assert.strictEqual(high.range, 'high');
  assert.strictEqual(high.CQ, null);
}

// Stored menu properties drive the correction. Missing properties are not invented.
{
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const seen = {};
  const re = /<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(html))) {
    seen[m[1]] = m[2];
    const sg = /SG=([0-9.]+)/.exec(m[2]);
    const mu = /μ=([0-9.]+)/.exec(m[2]);
    if (m[1] === 'custom') {
      assert.ok(!sg && !mu);
      assert.strictEqual(DeanRA.fluids[m[1]], undefined);
      continue;
    }
    assert.ok(sg && mu, m[1]);
    const rec = DeanRA.fluids[m[1]];
    assert.ok(rec, 'missing stored fluid ' + m[1]);
    assert.strictEqual(rec.sg, Number(sg[1]));
    assert.strictEqual(rec.visc, Number(mu[1]));
  }
  Object.keys(DeanRA.fluids).forEach(function (id) {
    assert.ok(seen[id], id);
  });
  const duty = { q_gpm: 400, h_ft: 200 };
  ['custom', 'hto'].forEach(function (fluid) {
    const note = DeanRA.fluidNote(fluid, duty);
    assert.ok(note.indexOf('No viscosity or specific gravity is stored') >= 0, fluid);
    assert.ok(note.indexOf(DeanRA.DISCLAIMER) >= 0, fluid);
    const sel = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: fluid, temp: 68, unit: 'F' });
    assert.strictEqual(sel.correction.applied, false);
    assert.strictEqual(sel.correction.status, 'missing');
    assert.strictEqual(sel.pick.curve.model, pick(400, 200).pick.curve.model);
  });
  const wrongTemp = DeanRA.fluidNote('therminol66', { q_gpm: 400, h_ft: 200, temp: 68, unit: 'F' });
  assert.ok(wrongTemp.indexOf('stored at 150 °C') >= 0);
  assert.ok(wrongTemp.indexOf('not at the temperature entered') >= 0);
  assert.ok(wrongTemp.toLowerCase().indexOf('corrected flow') < 0);
}

// A non-water fluid corrects the catalog water curve. It does not invent heads, efficiency, BHP, or NPSHr.
{
  const water = pick(400, 200);
  const same = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: 'water', temp: 68, unit: 'F' });
  assert.strictEqual(same.correction.status, 'water');
  assert.strictEqual(same.correction.applied, false);
  assert.strictEqual(same.pick.curve.model, water.pick.curve.model);
  assert.strictEqual(same.pick.diameter_in, water.pick.diameter_in);
  assert.strictEqual(same.pick.kind, water.pick.kind);

  const hot = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: 'water60', temp: 140, unit: 'F' });
  assert.strictEqual(hot.correction.status, 'water');
  assert.strictEqual(hot.pick.curve.model, water.pick.curve.model);
  assert.strictEqual(hot.pick.diameter_in, water.pick.diameter_in);

  const thin = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: 'therminol66', temp: 150, unit: 'C' });
  assert.strictEqual(thin.correction.status, 'unchanged');
  assert.strictEqual(thin.correction.applied, false);
  assert.strictEqual(thin.correction.CQ, 1);
  assert.strictEqual(thin.correction.sg, 0.963);
  assert.strictEqual(thin.correction.visc, 1.850);
  assert.ok(thin.correction.B <= 1);
  assert.strictEqual(thin.pick.curve.model, water.pick.curve.model);
  assert.strictEqual(thin.pick.diameter_in, water.pick.diameter_in);
  assert.ok(thin.correction.note.indexOf('Hydraulic Institute') >= 0);
  assert.ok(thin.correction.note.indexOf('1.85 cP') >= 0);
  assert.ok(thin.correction.note.indexOf('0.963') >= 0);
  assert.ok(thin.correction.note.indexOf('stay on the catalog water curve') >= 0);
  assert.ok(thin.correction.note.indexOf(DeanRA.DISCLAIMER) >= 0);
  assert.ok(thin.correction.note.indexOf('The plotted curve is still the catalog water curve.') < 0);

  const xlt = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: 'xlt', temp: -40, unit: 'C' });
  assert.strictEqual(xlt.correction.status, 'corrected');
  assert.strictEqual(xlt.correction.applied, true);
  assert.strictEqual(xlt.correction.sg, 0.985);
  assert.strictEqual(xlt.correction.visc, 12);
  assert.ok(xlt.correction.qWater > 400);
  assert.ok(xlt.correction.hWater > 200);
  assert.ok(xlt.correction.CQ < 1);
  assert.ok(Math.abs(xlt.correction.CH - xlt.correction.CQ) < 1e-12);
  assert.ok(xlt.correction.note.indexOf('Corrected flow') >= 0);
  assert.ok(xlt.correction.note.indexOf('corrected head') >= 0);
  assert.ok(xlt.correction.note.indexOf('not a Dean sheet') >= 0);
  assert.ok(xlt.correction.note.indexOf(DeanRA.DISCLAIMER) >= 0);
  assert.ok(xlt.matchCount < water.matchCount);
  assert.ok(water.matches.some(function (hit) { return hit.curve.model === 'R20100-A2'; }));
  assert.ok(!xlt.matches.some(function (hit) { return hit.curve.model === 'R20100-A2'; }));
  const tag = DeanRA.correctionTag(xlt.correction);
  assert.ok(tag[0].indexOf('HI correction') >= 0);
  assert.ok(tag[1].indexOf('12 cP') >= 0);
  assert.ok(tag[1].indexOf('0.985') >= 0);
  const pieces = DeanRA.correctedPieces(
    xlt.pick.curve.impellers[0].points,
    xlt.correction.CQ,
    xlt.correction.CH
  );
  const raw = DeanRA.smoothPieces(xlt.pick.curve.impellers[0].points);
  assert.strictEqual(pieces.length, raw.length);
  assert.ok(Math.abs(pieces[0].q0 - raw[0].q0 * xlt.correction.CQ) < 1e-6);
  assert.ok(Math.abs(pieces[0].h0 - raw[0].h0 * xlt.correction.CH) < 1e-6);
  assert.strictEqual(xlt.pick.curve.impellers[0].points[0].q_gpm, raw[0].q0);

  const oil = DeanRA.select(catalog, { q_gpm: 400, h_ft: 200, fluid: 'fo6', temp: 122, unit: 'F' });
  assert.strictEqual(oil.correction.applied, true);
  assert.notStrictEqual(oil.pick.curve.model, water.pick.curve.model);
  assert.strictEqual(DeanRA.powerFrame(oil.pick.curve), 'RA3186');
  assert.ok(oil.correction.qWater > 450);
  assert.ok(oil.correction.hWater > 220);

  [water, xlt, oil, thin].forEach(function (result) {
    assert.strictEqual(result.pick.efficiency, undefined);
    assert.strictEqual(result.pick.bhp, undefined);
    assert.strictEqual(result.pick.npshr, undefined);
    assert.strictEqual(result.correction.efficiency, undefined);
    assert.strictEqual(result.correction.bhp, undefined);
    assert.strictEqual(result.correction.npshr, undefined);
    assert.strictEqual(result.matches.length, result.matchCount);
    assert.strictEqual(result.matches[0], result.pick);
    result.matches.forEach(function (hit) {
      var frame = DeanRA.powerFrame(hit.curve);
      assert.ok(frame === 'RA2096' || frame === 'RA3146' || frame === 'RA3186');
    });
  });
  const models = {};
  water.matches.forEach(function (hit) { models[hit.curve.model] = true; });
  ['R20100-A2', 'R3085-A1', 'R30100-A1', 'R4085-A1'].forEach(function (model) {
    assert.strictEqual(models[model], true, model);
  });
  assert.strictEqual(Object.keys(models).length, 4);
}

// Every impeller line falls or stays level as flow rises, and a trim stays between its neighbors.
{
  catalog.curves.forEach(function (curve) {
    const imps = curve.impellers.slice().sort(function (a, b) { return b.diameter_in - a.diameter_in; });
    imps.forEach(function (imp) {
      const pts = imp.points.slice().sort(function (a, b) { return a.q_gpm - b.q_gpm; });
      for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i].h_ft <= pts[i - 1].h_ft + 1e-6, curve.model + ' ' + imp.diameter_in + ' rises at ' + pts[i].q_gpm);
      }
    });
    for (let i = 0; i < imps.length - 1; i++) {
      const hi = imps[i], lo = imps[i + 1];
      const q0 = Math.max(hi.points[0].q_gpm, lo.points[0].q_gpm);
      const q1 = Math.min(hi.points[hi.points.length - 1].q_gpm, lo.points[lo.points.length - 1].q_gpm);
      if (q1 <= q0) continue;
      const steps = DeanRA.offeredDiameters(curve).filter(function (d) {
        return d > lo.diameter_in + 1e-6 && d < hi.diameter_in - 1e-6;
      });
      const prevH = {};
      for (let s = 0; s <= 20; s++) {
        const q = q0 + (q1 - q0) * s / 20;
        const a = DeanRA.headAt(hi.points, q);
        const b = DeanRA.headAt(lo.points, q);
        if (!a || !b) continue;
        assert.ok(a.h + 1e-6 >= b.h, curve.model + ' lines cross at ' + q);
        steps.forEach(function (d) {
          const h = DeanRA.affinityHead(b.h, a.h, lo.diameter_in, hi.diameter_in, d);
          assert.ok(h <= a.h + 1e-4 && h >= b.h - 1e-4, 'trim left the catalog pair');
          if (prevH[d] != null) {
            assert.ok(h <= prevH[d] + 1e-4, curve.model + ' trim ' + d + ' rises at ' + q);
          }
          prevH[d] = h;
        });
      }
    }
  });
  const bump = pick(80, 250);
  assertCovered(bump, 80, 250);
  const hit = findModel(bump, 'RA1080-A2');
  assert.strictEqual(hit.kind, 'trim');
  assert.strictEqual(hit.diameter_in, 7.5);
  assert.deepStrictEqual(hit.between, [7, 8]);
}

// The plotted curve is a smooth monotone fit through the points, not a chord past the last point.
{
  catalog.curves.forEach(function (curve) {
    const imps = curve.impellers.slice().sort(function (a, b) { return b.diameter_in - a.diameter_in; });
    imps.forEach(function (imp) {
      const pts = DeanRA.measuredPoints(imp.points);
      pts.forEach(function (p) {
        const on = DeanRA.smoothHead(imp.points, p.q_gpm);
        assert.ok(Math.abs(on.h - p.h_ft) < 1e-6, curve.model + ' fit missed ' + p.q_gpm);
      });
      assert.strictEqual(DeanRA.smoothHead(imp.points, pts[0].q_gpm - 1), null);
      assert.strictEqual(DeanRA.smoothHead(imp.points, pts[pts.length - 1].q_gpm + 1), null);
      const pieces = DeanRA.smoothPieces(imp.points);
      assert.strictEqual(pieces.length, Math.max(0, pts.length - 1));
      if (pieces.length) {
        assert.strictEqual(pieces[0].q0, pts[0].q_gpm);
        assert.strictEqual(pieces[pieces.length - 1].q1, pts[pts.length - 1].q_gpm);
      }
      let prev = pts[0].h_ft;
      for (let i = 0; i < pts.length - 1; i++) {
        for (let s = 1; s <= 16; s++) {
          const q = pts[i].q_gpm + (pts[i + 1].q_gpm - pts[i].q_gpm) * s / 16;
          const h = DeanRA.smoothHead(imp.points, q).h;
          assert.ok(h <= prev + 1e-4, curve.model + ' ' + imp.diameter_in + ' smooth curve rises at ' + q);
          prev = h;
        }
      }
    });
    for (let i = 0; i < imps.length - 1; i++) {
      const hi = imps[i], lo = imps[i + 1];
      const q0 = Math.max(hi.points[0].q_gpm, lo.points[0].q_gpm);
      const q1 = Math.min(hi.points[hi.points.length - 1].q_gpm, lo.points[lo.points.length - 1].q_gpm);
      if (q1 <= q0) continue;
      const diameters = DeanRA.offeredDiameters(curve).filter(function (d) {
        return d > lo.diameter_in + 1e-6 && d < hi.diameter_in - 1e-6;
      });
      const prevH = {};
      for (let s = 0; s <= 24; s++) {
        const q = q0 + (q1 - q0) * s / 24;
        const a = DeanRA.smoothHead(hi.points, q);
        const b = DeanRA.smoothHead(lo.points, q);
        if (!a || !b) continue;
        assert.ok(a.h + 1e-3 >= b.h, curve.model + ' smooth lines cross at ' + q);
        diameters.forEach(function (d) {
          const h = DeanRA.affinityHead(b.h, a.h, lo.diameter_in, hi.diameter_in, d);
          assert.ok(h <= a.h + 1e-3 && h >= b.h - 1e-3, 'smooth trim left the catalog pair');
          if (prevH[d] != null) {
            assert.ok(h <= prevH[d] + 1e-3, curve.model + ' smooth trim ' + d + ' rises at ' + q);
          }
          prevH[d] = h;
        });
      }
    }
  });
  const seven = catalog.curves.find(function (c) { return c.model === 'R20100-A2'; })
    .impellers.find(function (imp) { return imp.diameter_in === 7; });
  const mid = DeanRA.smoothHead(seven.points, 150);
  const chord = 200 + (122 - 200) * (150 - 100) / 100;
  assert.ok(Math.abs(mid.h - chord) > 1, 'expected a curve, not the straight chord');
  assert.ok(mid.h < 200 && mid.h > 122);
}

// Catalog readings stay 277. Interpolated samples are extra, and not sheet readings.
{
  let points = 0;
  let interpolated = 0;
  catalog.curves.forEach(function (c) {
    c.impellers.forEach(function (imp) {
      imp.points.forEach(function (p) {
        assert.strictEqual(typeof p.h_ft, 'number');
        assert.strictEqual(typeof p.q_gpm, 'number');
        assert.ok(!('efficiency' in p) && !('bhp' in p) && !('bep' in p));
        if (p.interpolated) {
          interpolated++;
          assert.strictEqual(p.interpolated, true);
          assert.ok(!('inferred' in p));
        } else {
          points++;
          assert.strictEqual(typeof p.inferred, 'boolean');
        }
      });
    });
  });
  assert.strictEqual(points, 277);
  assert.ok(interpolated > points);
  const r = pick(100, 100);
  assert.ok(r.selections.length >= 1);
  assert.strictEqual(r.pick, r.selections[0]);
}

// Stored samples are a smooth fit through the catalog points, inside the measured flow.
{
  catalog.curves.forEach(function (curve) {
    curve.impellers.forEach(function (imp) {
      const measured = DeanRA.measuredPoints(imp.points);
      const fresh = DeanRA.interpolatedPoints(measured);
      const qMin = measured[0].q_gpm;
      const qMax = measured[measured.length - 1].q_gpm;
      let prev = measured[0].h_ft;
      imp.points.forEach(function (p) {
        assert.ok(p.h_ft <= prev + 1e-6, curve.model + ' ' + imp.diameter_in + ' rises at ' + p.q_gpm);
        prev = p.h_ft;
        assert.ok(p.q_gpm + 1e-9 >= qMin && p.q_gpm - 1e-9 <= qMax);
      });
      const stored = imp.points.filter(function (p) { return p.interpolated; });
      assert.ok(stored.length >= 3, curve.model + ' ' + imp.diameter_in + ' has no interpolated samples');
      stored.forEach(function (p) {
        const on = DeanRA.smoothHead(measured, p.q_gpm);
        assert.ok(on, 'sample outside the catalog flow');
        assert.ok(Math.abs(on.h - p.h_ft) <= 0.02, curve.model + ' sample left the fit at ' + p.q_gpm);
        assert.ok(p.q_gpm > qMin + 1e-9 && p.q_gpm < qMax - 1e-9);
      });
      assert.strictEqual(fresh.length, stored.length);
    });
  });
  const seven = catalog.curves.find(function (c) { return c.model === 'R20100-A2'; })
    .impellers.find(function (imp) { return imp.diameter_in === 7; });
  const mid = seven.points.find(function (p) { return p.interpolated && p.q_gpm > 100 && p.q_gpm < 200; });
  const chord = 200 + (122 - 200) * (mid.q_gpm - 100) / 100;
  assert.ok(Math.abs(mid.h_ft - chord) > 1, 'interpolated point is still the straight chord');
}

// A published line bows the way a pump curve does: above the end-to-end chord,
// and steeper at the high-flow end than near the start of the measured range.
{
  const imp = catalog.curves.find(function (c) { return c.model === 'R20100-A2'; })
    .impellers.find(function (i) { return i.diameter_in === 10; });
  const pts = DeanRA.measuredPoints(imp.points);
  const qA = pts[0].q_gpm;
  const qB = pts[pts.length - 1].q_gpm;
  function at(q) { return DeanRA.smoothHead(imp.points, q).h; }
  function slope(q0, q1) { return (at(q1) - at(q0)) / (q1 - q0); }
  const early = slope(qA + (qB - qA) * 0.05, qA + (qB - qA) * 0.2);
  const late = slope(qA + (qB - qA) * 0.75, qA + (qB - qA) * 0.95);
  assert.ok(late < early - 0.15, 'head should fall faster as flow increases');
  const midQ = (qA + qB) / 2;
  const chord = at(qA) + (at(qB) - at(qA)) * (midQ - qA) / (qB - qA);
  assert.ok(at(midQ) > chord + 8, 'the line should bow above the straight chord');
}

// 400 gpm at 200 ft is a list of every size that can meet it, not one winner.
{
  const r = pick(400, 200);
  assertCovered(r, 400, 200);
  assert.ok(r.selections.length >= 2);
  const seen = {};
  r.selections.forEach(function (s) {
    const key = s.curve.size + '@' + s.curve.rpm;
    assert.ok(!seen[key], 'duplicate size ' + key);
    seen[key] = true;
    assert.ok(DeanRA.dutySeat(s, 400, 200).indexOf('400 gpm') >= 0);
    assert.ok(DeanRA.dutySeat(s, 400, 200).toLowerCase().indexOf('efficiency') < 0);
  });
  assert.ok(DeanRA.RANK_NOTE.toLowerCase().indexOf('not ranked by efficiency') >= 0);
  assert.ok(DeanRA.RANK_NOTE.indexOf('IntelliQuip') >= 0);
  assert.ok(DeanRA.CATALOG_LIMIT_NOTE.indexOf('10 in') >= 0);
  assert.ok(DeanRA.SHARED_CURVE_NOTE.indexOf('RA and RWA share the same head-capacity curve') >= 0);
}

// IntelliQuip datasheets Blake supplied are duty-specific and are not curve readings.
{
  const iq = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/intelliquip-selections.json'), 'utf8'));
  assert.strictEqual(iq.source, 'IntelliQuip');
  function curve(size, rpm) {
    return catalog.curves.find(function (c) {
      return c.size === size && c.rpm === (rpm || 3500);
    });
  }
  const two = DeanRA.intelliquipFor(iq, curve('2 x 3 x 8.5'), { q_gpm: 200, h_ft: 150, fluid: 'water' });
  assert.strictEqual(two.source, 'IntelliQuip');
  assert.strictEqual(two.impeller_in, 6.5);
  assert.strictEqual(two.head_actual_ft, 157.2);
  assert.strictEqual(two.efficiency_pct, 62.29);
  assert.strictEqual(two.npshr_ft, 7.37);
  assert.strictEqual(two.power_rated_hp, 12.16);
  assert.strictEqual(two.power_max_hp, 15.11);
  assert.strictEqual(two.motor_hp, 20);
  assert.strictEqual(two.motor_kw, 14.91);
  const three = DeanRA.intelliquipFor(iq, curve('3 x 4 x 8.5'), { q_gpm: 400, h_ft: 150, fluid: 'water' });
  assert.strictEqual(three.head_actual_ft, 154.7);
  assert.strictEqual(three.efficiency_pct, 74.6);
  assert.strictEqual(three.npshr_ft, 12.2);
  assert.strictEqual(three.impeller_in, 6.5);
  assert.strictEqual(three.power_rated_hp, 20.31);
  assert.strictEqual(three.power_max_hp, 26.84);
  assert.strictEqual(three.motor_hp, 30);
  const one = DeanRA.intelliquipFor(iq, curve('1 x 1.5 x 8'), { q_gpm: 100, h_ft: 250, fluid: 'water' });
  assert.strictEqual(one.head_actual_ft, 254.3);
  assert.strictEqual(one.efficiency_pct, 56.55);
  assert.strictEqual(one.npshr_ft, 7.97);
  assert.strictEqual(one.impeller_in, 7.5);
  assert.strictEqual(one.power_rated_hp, 11.16);
  assert.strictEqual(one.power_max_hp, 14.35);
  assert.strictEqual(one.motor_hp, 15);
  const six = DeanRA.intelliquipFor(iq, curve('1 x 1.5 x 6'), { q_gpm: 100, h_ft: 130, fluid: 'water' });
  assert.strictEqual(six.source, 'IntelliQuip');
  assert.strictEqual(six.head_actual_ft, 131.5);
  assert.strictEqual(six.efficiency_pct, 63.08);
  assert.strictEqual(six.npshr_ft, 6.7);
  assert.strictEqual(six.impeller_in, 5.88);
  assert.strictEqual(six.power_rated_hp, 5.2);
  assert.strictEqual(six.power_max_hp, 6.45);
  assert.strictEqual(six.motor_hp, 7.5);
  assert.strictEqual(six.motor_kw, 5.59);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('1 x 1.5 x 6'), { q_gpm: 80, h_ft: 130, fluid: 'water' }), null);
  const fifteen = DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 6'), { q_gpm: 120, h_ft: 100, fluid: 'water' });
  assert.strictEqual(fifteen.source, 'IntelliQuip');
  assert.strictEqual(fifteen.head_actual_ft, 106.2);
  assert.strictEqual(fifteen.efficiency_pct, 59.56);
  assert.strictEqual(fifteen.npshr_ft, 5.03);
  assert.strictEqual(fifteen.impeller_in, 5.38);
  assert.strictEqual(fifteen.power_rated_hp, 5.09);
  assert.strictEqual(fifteen.power_max_hp, 6.67);
  assert.strictEqual(fifteen.motor_hp, 7.5);
  assert.strictEqual(fifteen.motor_kw, 5.59);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 6'), { q_gpm: 100, h_ft: 100, fluid: 'water' }), null);
  const oneThree = DeanRA.intelliquipFor(iq, curve('1 x 3 x 8.5'), { q_gpm: 80, h_ft: 250, fluid: 'water' });
  assert.strictEqual(oneThree.source, 'IntelliQuip');
  assert.strictEqual(oneThree.head_actual_ft, 251.2);
  assert.strictEqual(oneThree.efficiency_pct, 46.2);
  assert.strictEqual(oneThree.npshr_ft, 5.69);
  assert.strictEqual(oneThree.impeller_in, 8);
  assert.strictEqual(oneThree.power_rated_hp, 10.98);
  assert.strictEqual(oneThree.power_max_hp, 14.11);
  assert.strictEqual(oneThree.motor_hp, 15);
  assert.strictEqual(oneThree.motor_kw, 11.19);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('1 x 3 x 8.5'), { q_gpm: 100, h_ft: 250, fluid: 'water' }), null);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('3 x 4 x 8.5'), { q_gpm: 400, h_ft: 200, fluid: 'water' }), null);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('2 x 3 x 8.5'), { q_gpm: 200, h_ft: 150, fluid: 'eg50' }), null);
  const fifteenEight = DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 8.5'), { q_gpm: 150, h_ft: 100, fluid: 'water' });
  assert.strictEqual(fifteenEight.source, 'IntelliQuip');
  assert.strictEqual(fifteenEight.head_actual_ft, 102.6);
  assert.strictEqual(fifteenEight.efficiency_pct, 49.9);
  assert.strictEqual(fifteenEight.npshr_ft, 8.85);
  assert.strictEqual(fifteenEight.impeller_in, 6.13);
  assert.strictEqual(fifteenEight.power_rated_hp, 7.59);
  assert.strictEqual(fifteenEight.power_max_hp, 7.84);
  assert.strictEqual(fifteenEight.motor_hp, 10);
  assert.strictEqual(fifteenEight.motor_kw, 7.46);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 8.5'), { q_gpm: 150, h_ft: 130, fluid: 'water' }), null);
  const fifteenTen = DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 10'), { q_gpm: 150, h_ft: 350, fluid: 'water' });
  assert.strictEqual(fifteenTen.source, 'IntelliQuip');
  assert.strictEqual(fifteenTen.head_actual_ft, 350.5);
  assert.strictEqual(fifteenTen.efficiency_pct, 53.84);
  assert.strictEqual(fifteenTen.npshr_ft, 5.36);
  assert.strictEqual(fifteenTen.impeller_in, 9.5);
  assert.strictEqual(fifteenTen.power_rated_hp, 24.65);
  assert.strictEqual(fifteenTen.power_max_hp, 32.37);
  assert.strictEqual(fifteenTen.motor_hp, 40);
  assert.strictEqual(fifteenTen.motor_kw, 29.83);
  const twoTen = DeanRA.intelliquipFor(iq, curve('2 x 3 x 10'), { q_gpm: 250, h_ft: 300, fluid: 'water' });
  assert.strictEqual(twoTen.source, 'IntelliQuip');
  assert.strictEqual(twoTen.head_actual_ft, 303.1);
  assert.strictEqual(twoTen.efficiency_pct, 63.49);
  assert.strictEqual(twoTen.npshr_ft, 7.7);
  assert.strictEqual(twoTen.impeller_in, 9.25);
  assert.strictEqual(twoTen.power_rated_hp, 29.82);
  assert.strictEqual(twoTen.power_max_hp, 36.51);
  assert.strictEqual(twoTen.motor_hp, 40);
  assert.strictEqual(twoTen.motor_kw, 29.83);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('2 x 3 x 10'), { q_gpm: 250, h_ft: 250, fluid: 'water' }), null);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('1.5 x 3 x 10'), { q_gpm: 150, h_ft: 300, fluid: 'water' }), null);
  const threeTen = DeanRA.intelliquipFor(iq, curve('3 x 4 x 10'), { q_gpm: 400, h_ft: 360, fluid: 'water' });
  assert.strictEqual(threeTen.source, 'IntelliQuip');
  assert.strictEqual(threeTen.head_actual_ft, 367.6);
  assert.strictEqual(threeTen.efficiency_pct, 67.43);
  assert.strictEqual(threeTen.npshr_ft, 9.05);
  assert.strictEqual(threeTen.impeller_in, 9.5);
  assert.strictEqual(threeTen.power_rated_hp, 53.91);
  assert.strictEqual(threeTen.power_max_hp, 80.48);
  assert.strictEqual(threeTen.motor_hp, 100);
  assert.strictEqual(threeTen.motor_kw, 74.57);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('3 x 4 x 10'), { q_gpm: 400, h_ft: 300, fluid: 'water' }), null);
  const fourEight = DeanRA.intelliquipFor(iq, curve('4 x 6 x 8.5'), { q_gpm: 700, h_ft: 250, fluid: 'water' });
  assert.strictEqual(fourEight.source, 'IntelliQuip');
  assert.strictEqual(fourEight.head_actual_ft, 250.6);
  assert.strictEqual(fourEight.efficiency_pct, 79.21);
  assert.strictEqual(fourEight.npshr_ft, 14.63);
  assert.strictEqual(fourEight.impeller_in, 8.13);
  assert.strictEqual(fourEight.power_rated_hp, 55.92);
  assert.strictEqual(fourEight.power_max_hp, 67.32);
  assert.strictEqual(fourEight.motor_hp, 75);
  assert.strictEqual(fourEight.motor_kw, 55.93);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('4 x 6 x 8.5'), { q_gpm: 400, h_ft: 200, fluid: 'water' }), null);
  const fourTen = DeanRA.intelliquipFor(iq, curve('4 x 6 x 10 #1'), { q_gpm: 800, h_ft: 350, fluid: 'water' });
  assert.strictEqual(fourTen.source, 'IntelliQuip');
  assert.strictEqual(fourTen.curve ? fourTen.curve.rpm : fourTen.rpm, 3500);
  assert.strictEqual(fourTen.head_actual_ft, 360.6);
  assert.strictEqual(fourTen.efficiency_pct, 69.03);
  assert.strictEqual(fourTen.npshr_ft, 19);
  assert.strictEqual(fourTen.impeller_in, 9.5);
  assert.strictEqual(fourTen.power_rated_hp, 103);
  assert.strictEqual(fourTen.power_max_hp, 141);
  assert.strictEqual(fourTen.motor_hp, 150);
  assert.strictEqual(fourTen.motor_kw, 112);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('4 x 6 x 10 #1'), { q_gpm: 800, h_ft: 350, fluid: 'eg50' }), null);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('4 x 6 x 10 #2', 1750), { q_gpm: 800, h_ft: 350, fluid: 'water' }), null);
  const fourTenSlow = DeanRA.intelliquipFor(iq, curve('4 x 6 x 10 #2', 1750), { q_gpm: 600, h_ft: 90, fluid: 'water' });
  assert.strictEqual(fourTenSlow.source, 'IntelliQuip');
  assert.strictEqual(fourTenSlow.rpm, 1750);
  assert.strictEqual(fourTenSlow.head_actual_ft, 91.04);
  assert.strictEqual(fourTenSlow.efficiency_pct, 72.71);
  assert.strictEqual(fourTenSlow.npshr_ft, 5.09);
  assert.strictEqual(fourTenSlow.impeller_in, 9.75);
  assert.strictEqual(fourTenSlow.power_rated_hp, 18.75);
  assert.strictEqual(fourTenSlow.power_max_hp, 27.61);
  assert.strictEqual(fourTenSlow.motor_hp, 30);
  assert.strictEqual(fourTenSlow.motor_kw, 22.37);
  assert.strictEqual(DeanRA.intelliquipFor(iq, curve('4 x 6 x 10 #1'), { q_gpm: 600, h_ft: 90, fluid: 'water' }), null);
  const at400 = pick(400, 150);
  const row = findModel(at400, 'R3085-A1');
  assert.strictEqual(row.kind, 'catalog');
  assert.strictEqual(row.diameter_in, 6.5);
  const sixFive = catalog.curves.find(function (c) { return c.model === 'R3085-A1'; })
    .impellers.find(function (imp) { return imp.diameter_in === 6.5; });
  assert.ok(Math.abs(row.head_ft - DeanRA.smoothHead(sixFive.points, 400).h) < 1e-6);
  assert.ok(row.head_ft > 150 && row.head_ft < 160);
  const at100 = pick(100, 250);
  const small = findModel(at100, 'RA1080-A2');
  assert.strictEqual(small.diameter_in, 7.5);
  assert.strictEqual(small.kind, 'trim');
}

console.log('dean-ra-select tests passed');

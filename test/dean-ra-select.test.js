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
  assert.strictEqual(bump.pick.curve.model, 'RA1080-A2');
  assert.strictEqual(bump.pick.kind, 'trim');
  assert.strictEqual(bump.pick.diameter_in, 7.5);
  assert.deepStrictEqual(bump.pick.between, [7, 8]);
}

// The plotted curve is a smooth monotone fit through the points, not a chord past the last point.
{
  catalog.curves.forEach(function (curve) {
    const imps = curve.impellers.slice().sort(function (a, b) { return b.diameter_in - a.diameter_in; });
    imps.forEach(function (imp) {
      const pts = imp.points.slice().sort(function (a, b) { return a.q_gpm - b.q_gpm; });
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

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));

function pick(q, h, rpm) {
  return DeanRA.select(catalog, { q_gpm: q, h_ft: h, fluid: 'water', rpm: rpm || 3500 });
}

function findSize(result, size) {
  const hit = (result.selections || []).find(function (s) {
    return s.curve.size.replace(/\s+/g, '') === size.replace(/\s+/g, '');
  });
  assert.ok(hit, 'missing ' + size);
  return hit;
}

// Eighth-inch trim from D squared, between the two catalog lines.
{
  const r = pick(80, 130);
  const hit = findSize(r, '1 x 1.5 x 6');
  assert.strictEqual(hit.kind, 'trim');
  assert.deepStrictEqual(hit.between, [5.5, 6]);
  assert.ok(hit.diameter_in > 5.5 && hit.diameter_in < 6);
  const hd = DeanRA.affinityHead(hit.hLower, hit.hUpper, hit.lowerDiameter, hit.upperDiameter, hit.diameter_in);
  assert.ok(Math.abs(hd - hit.head_ft) < 1e-6);
  assert.ok(hit.head_ft + 1e-6 >= 130);
  const label = DeanRA.impellerLabel(hit);
  assert.strictEqual(label, DeanRA.formatDia(hit.diameter_in) + ' in');
  assert.ok(hit.efficiency_pct > 40);
  assert.ok(hit.pct_bep > 20 && hit.pct_bep < 150);
  assert.ok(hit.bhp > 0);
  assert.ok(hit.motor_hp >= hit.bhp);
  assert.ok(hit.bhp_end > 0);
  assert.ok(hit.motor_hp + 1e-9 >= hit.bhp_end);
}

// A duty above every line is not covered.
{
  const r = pick(40, 800);
  assert.strictEqual(r.covered, false);
  assert.strictEqual(r.pick, null);
}

// Do not run a line past its last point.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'RA1060-A2' && c.rpm === 3500; });
  const six = curve.impellers.find(function (imp) { return imp.diameter_in === 6; });
  assert.strictEqual(DeanRA.headAt(six.points, 400), null);
  const r = pick(400, 100);
  assert.ok(r.selections.every(function (s) { return s.curve.model !== 'RA1060-A2'; }));
}

// Speed switch. 3500 does not return the 1750-only #2, and 1150 is only that sheet.
{
  const fast = pick(200, 150, 3500);
  assert.ok(fast.selections.every(function (s) { return s.curve.rpm === 3500; }));
  assert.ok(fast.selections.every(function (s) { return s.curve.model !== 'R40100-B2'; }));
  const slow = pick(500, 90, 1750);
  assert.strictEqual(slow.covered, true);
  assert.ok(slow.selections.every(function (s) { return s.curve.rpm === 1750; }));
  const verySlow = pick(400, 30, 1150);
  assert.ok(verySlow.selections.every(function (s) { return s.curve.model === 'R40100-B2' && s.curve.rpm === 1150; }));
  const speeds = {};
  catalog.curves.forEach(function (c) { speeds[c.rpm] = (speeds[c.rpm] || 0) + 1; });
  assert.strictEqual(speeds[3500], 12);
  assert.strictEqual(speeds[1750], 13);
  assert.strictEqual(speeds[1150], 1);
}

// Page 22 is the 100-450 ft scale. The 8 in line is near 240 ft at low flow, not the old 215.
{
  const curve = catalog.curves.find(function (c) { return c.model === 'R40100-A1' && c.rpm === 3500; });
  const eight = curve.impellers.find(function (imp) { return imp.diameter_in === 8; });
  const at = DeanRA.headAt(eight.points, 300);
  assert.ok(at.h > 230 && at.h < 250, '8 in at 300 gpm should sit near 240 ft, got ' + at.h);
  const ten = curve.impellers.find(function (imp) { return imp.diameter_in === 10; });
  const high = DeanRA.headAt(ten.points, 600);
  assert.ok(high.h > 400 && high.h < 420, '10 in at 600 gpm got ' + high.h);
}

// 4x6x8.5 is not offered below the 6.5 in line.
{
  const dias = DeanRA.offeredDiameters(catalog.curves.find(function (c) { return c.model === 'R4085-A1' && c.rpm === 3500; }));
  assert.strictEqual(dias[0], 6.5);
  assert.ok(dias.indexOf(5.5) < 0);
}

// Each stored fit falls and bows down, and stays near the reads it was fit to.
{
  catalog.curves.forEach(function (curve) {
    curve.impellers.forEach(function (imp) {
      const fit = imp.fit;
      assert.ok(fit, curve.model + ' missing fit');
      const q0 = fit.q0;
      const q1 = fit.q1;
      let prev = Infinity;
      let prevSlope = Infinity;
      for (let i = 0; i <= 24; i++) {
        const q = q0 + (q1 - q0) * i / 24;
        const h = DeanRA.evalFit(fit, q);
        const dq = (q1 - q0) / 48;
        const q2 = q + dq;
        const slope = q2 >= q1 - 1e-6
          ? prevSlope
          : (fit.pieces
            ? (DeanRA.evalFit(fit, q2) - h) / dq
            : fit.b + 2 * fit.c * q + 3 * (fit.d || 0) * q * q);
        assert.ok(h < prev, curve.model + ' ' + imp.diameter_in + ' not falling at ' + q);
        assert.ok(slope < 0.02, curve.model + ' ' + imp.diameter_in + ' slope');
        if (i > 0) assert.ok(slope <= prevSlope + 0.02, curve.model + ' ' + imp.diameter_in + ' not concave');
        prev = h;
        prevSlope = slope;
      }
      const samples = DeanRA.diameterSamples(curve, imp.diameter_in, 40);
      assert.ok(samples.length > 20);
    });
  });
}

// Every line falls, trims stay between the printed lines, and the name on screen is the frame.
{
  const shown = { 'RA1060-A2': 'RA2096', 'RA1080-A2': 'RA2096', 'RA1560-A2': 'RA2096', 'R1085-A2': 'RA3146', 'R1585-A2': 'RA3146', 'R2085-A2': 'RA3146', 'R3085-A1': 'RA3146', 'R4085-A1': 'RA3146', 'R15100-A2': 'RA3146', 'R20100-A2': 'RA3146', 'R30100-A1': 'RA3146', 'R40100-B2': 'RA3146', 'R40100-A1': 'RA3186' };
  catalog.curves.forEach(function (curve) {
    assert.strictEqual(DeanRA.powerFrame(curve), shown[curve.model]);
    const imps = curve.impellers.slice().sort(function (a, b) { return b.diameter_in - a.diameter_in; });
    imps.forEach(function (imp) {
      for (let i = 1; i < imp.points.length; i++) {
        assert.ok(imp.points[i].h_ft <= imp.points[i - 1].h_ft + 0.5, curve.model + ' ' + imp.diameter_in + ' rises');
      }
    });
  });
}

// Rank is efficiency. A low percent of BEP is flagged. Outside 20-150% is omitted.
{
  const r = pick(200, 150);
  assert.ok(r.selections.length >= 2);
  assert.ok(r.pick.efficiency_pct >= r.selections[r.selections.length - 1].efficiency_pct - 2);
  r.selections.forEach(function (hit) {
    assert.ok(hit.pct_bep >= 20 && hit.pct_bep <= 150);
    if (hit.pct_bep < 50) assert.strictEqual(hit.bep_zone, 'low');
    if (hit.pct_bep >= 70 && hit.pct_bep <= 120) assert.strictEqual(hit.bep_zone, 'preferred');
  });
  assert.ok(DeanRA.CATALOG_LIMIT_NOTE.indexOf('10 in') >= 0);
  assert.ok(DeanRA.VISCOSITY_NOTE.indexOf('70 SSU') >= 0);
  assert.ok(DeanRA.SHARED_CURVE_NOTE.indexOf('RA and RWA') >= 0);
}

// BHP carries specific gravity. NPSHr is absent when this speed was not tested, never a scaled number.
{
  const water = pick(200, 150);
  const oil = DeanRA.select(catalog, { q_gpm: 200, h_ft: 150, fluid: 'crude', temp: 68, unit: 'F', rpm: 3500 });
  assert.ok(Math.abs(oil.pick.bhp / water.pick.bhp - 0.87) < 0.05, 'crude SG should scale power');
  const slow = catalog.curves.find(function (c) { return c.model === 'RA1060-A2' && c.rpm === 1750; });
  assert.ok(slow.npshr_fit && slow.npshr_fit.c1 > 0, '1750 NPSHr comes from the printed chart');
  assert.ok(DeanRA.npshrAt(slow, 40) > 2);
  const fast = catalog.curves.find(function (c) { return c.model === 'R40100-B2' && c.rpm === 1150; });
  assert.ok(fast.impellers.every(function (imp) { return imp.diameter_in >= 8; }));
}

// Hydraulic Institute correction is unchanged.
{
  const hi = DeanRA.hiPreliminary(440, 230, 120);
  assert.ok(Math.abs(hi.B - 5.70) < 0.02);
  assert.ok(Math.abs(hi.CQ - 0.934) < 0.002);
  const note = DeanRA.fluidNote('water');
  assert.strictEqual(note, 'Water at ambient is the reference these curves were drawn for.');
}

// Each size still links to its PumpResource page with the trim preselected.
{
  const pages = {
    'RA1060-A2': 'https://pumpresource.us/dean-ra2096-pump/',
    'RA1560-A2': 'https://pumpresource.us/dean-ra2096-pump/',
    'RA1080-A2': 'https://pumpresource.us/dean-ra2096-pump/',
    'R2085-A2': 'https://pumpresource.us/dean-ra3146-pump/',
    'R40100-B2': 'https://pumpresource.us/dean-ra3146-pump/',
    'R40100-A1': 'https://pumpresource.us/dean-ra3186-pump/'
  };
  Object.keys(pages).forEach(function (model) {
    const curve = catalog.curves.find(function (c) { return c.model === model && (model !== 'R40100-B2' || c.rpm === 1750); });
    let max = 0;
    curve.impellers.forEach(function (imp) { if (imp.diameter_in > max) max = imp.diameter_in; });
    const link = DeanRA.productLink(curve, max);
    assert.ok(link.href.indexOf(pages[model]) === 0, model);
    assert.strictEqual(link.trim, 'Full Sized Impeller (No Trim)');
    assert.ok(link.href.toLowerCase().indexOf('rwa') < 0);
  });
  const two = catalog.curves.find(function (c) { return c.model === 'R2085-A2' && c.rpm === 3500; });
  const at = DeanRA.productLink(two, 7.375);
  assert.strictEqual(at.href, 'https://pumpresource.us/dean-ra3146-pump/?size=2x3x8.5&trim=7.375');
  assert.strictEqual(DeanRA.productLink({ size: '1 x 2 x 11.5', frame: 'RA3146', impellers: [{ diameter_in: 11.5 }] }, 11.5), null);
}

// The fluid menu still matches the stored properties.
{
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const re = /<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === 'custom') continue;
    const sg = /SG=([0-9.]+)/.exec(m[2]);
    const mu = /μ=([0-9.]+)/.exec(m[2]);
    if (!sg) continue;
    assert.strictEqual(DeanRA.fluids[m[1]].sg, Number(sg[1]));
    assert.strictEqual(DeanRA.fluids[m[1]].visc, Number(mu[1]));
  }
  assert.ok(html.indexOf('3500 rpm') > 0);
  assert.ok(html.indexOf('1750 rpm') > 0);
  assert.ok(html.indexOf('1150 rpm') > 0);
  assert.ok(html.indexOf('70 SSU') > 0);
}

console.log('dean-ra-select tests passed');

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
    assert.ok(link.href.split('?')[0].toLowerCase().indexOf('rwa') < 0);
    assert.ok(link.href.indexOf('model=' + encodeURIComponent(curve.frame)) > 0);
  });
  const two = catalog.curves.find(function (c) { return c.model === 'R2085-A2' && c.rpm === 3500; });
  const at = DeanRA.productLink(two, 7.375);
  assert.strictEqual(at.href, 'https://pumpresource.us/dean-ra3146-pump/?size=2x3x8.5&trim=7.375&model=RA3146');
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
  assert.ok(html.indexOf('id="sel-model"') > 0);
  assert.ok(html.indexOf('All models') > 0);
}

// A chosen frame lists only that model's sizes, still ranked by efficiency.
{
  const all = pick(100, 240);
  assert.strictEqual(all.pick.curve.size.replace(/\s+/g, ''), '1x1.5x8');
  assert.strictEqual(DeanRA.powerFrame(all.pick.curve), 'RA2096');
  const framed = DeanRA.select(catalog, { q_gpm: 100, h_ft: 240, fluid: 'water', rpm: 3500, frame: 'RA3146' });
  const expected = all.selections.filter(function (s) { return s.curve.frame === 'RA3146'; });
  assert.ok(expected.length > 1);
  assert.strictEqual(framed.selections.length, expected.length);
  framed.selections.forEach(function (hit, i) {
    assert.strictEqual(hit.curve.frame, 'RA3146');
    assert.strictEqual(hit.curve.model, expected[i].curve.model);
  });
  assert.ok(framed.selections[0].efficiency_pct + 0.5 >= framed.selections[framed.selections.length - 1].efficiency_pct);
  const same = DeanRA.select(catalog, { q_gpm: 100, h_ft: 240, fluid: 'water', rpm: 3500, frame: '' });
  assert.strictEqual(same.selections.length, all.selections.length);
  const miss = DeanRA.select(catalog, { q_gpm: 100, h_ft: 240, fluid: 'water', rpm: 3500, frame: 'RA3186' });
  assert.strictEqual(miss.covered, false);
  assert.strictEqual(miss.pick, null);
  const names = DeanRA.frames(catalog);
  ['RA2096', 'RA3146', 'RA3186', 'RWA4166'].forEach(function (name) {
    assert.ok(names.indexOf(name) >= 0, name);
  });
}

// Every line falls and bows down. A larger trim stays above a smaller one.
// Each stored fit passes within 2 ft of Cody's printed heads, and it stops
// at the last of those heads.
{
  catalog.curves.forEach(function (curve) {
    const offered = DeanRA.offeredDiameters(curve);
    const lines = offered.map(function (dia) {
      return { dia: dia, samples: DeanRA.diameterSamples(curve, dia, 48) };
    }).filter(function (line) { return line.samples.length > 2; });
    lines.forEach(function (line) {
      for (let i = 1; i < line.samples.length; i++) {
        assert.ok(line.samples[i].h < line.samples[i - 1].h - 1e-6, curve.model + ' ' + line.dia + ' rises');
        if (i > 1) {
          const d2 = line.samples[i].h - 2 * line.samples[i - 1].h + line.samples[i - 2].h;
          assert.ok(d2 <= 0.2, curve.model + ' ' + line.dia + ' bows up at sample ' + i);
        }
      }
    });
    for (let i = 0; i < lines.length - 1; i++) {
      const lower = lines[i];
      const upper = lines[i + 1];
      lower.samples.forEach(function (pt) {
        let hi = null;
        for (let k = 0; k < upper.samples.length - 1; k++) {
          const a = upper.samples[k];
          const b = upper.samples[k + 1];
          if (pt.q + 1e-6 >= a.q && pt.q <= b.q + 1e-6) {
            const t = (pt.q - a.q) / (b.q - a.q || 1);
            hi = a.h + t * (b.h - a.h);
            break;
          }
        }
        if (hi == null) return;
        assert.ok(pt.h <= hi + 0.5, curve.size + ' ' + curve.rpm + ' ' + lower.dia + ' crosses ' + upper.dia + ' at ' + pt.q.toFixed(0));
      });
    }
  });

  const anchors = JSON.parse(fs.readFileSync(path.join(__dirname, 'cody-anchors.json'), 'utf8'));
  anchors.forEach(function (row) {
    const curve = catalog.curves.find(function (c) { return c.model === row.model && c.rpm === row.rpm; });
    const imp = curve.impellers.find(function (item) { return Math.abs(item.diameter_in - row.diameter_in) < 1e-6; });
    assert.ok(row.q_gpm <= imp.fit.q1 + 0.2 && row.q_gpm >= imp.fit.q0 - 0.2, row.model + ' extrapolated');
    const h = DeanRA.evalFit(imp.fit, row.q_gpm);
    const err = h - row.h_ft;
    assert.ok(Math.abs(err) <= 2, row.model + ' ' + row.rpm + ' ' + row.diameter_in + ' @ ' + row.q_gpm + ' is ' + err.toFixed(2) + ' ft off');
  });

  const slow = catalog.curves.find(function (c) { return c.model === 'R40100-B2' && c.rpm === 1150; });
  assert.deepStrictEqual(slow.impellers.map(function (imp) { return imp.diameter_in; }), [10, 9, 8]);
  const nine = slow.impellers.find(function (imp) { return imp.diameter_in === 9; });
  const eight = slow.impellers.find(function (imp) { return imp.diameter_in === 8; });
  assert.ok(Math.abs(nine.fit.q1 - 805) < 1);
  assert.ok(Math.abs(eight.fit.q1 - 640) < 1);
  assert.strictEqual(DeanRA.headAt(nine.points, 900), null);
  const at775 = DeanRA.npshrAt(slow, 775);
  assert.ok(at775 > 6 && at775 < 9, '1150 NPSHr at 775 gpm got ' + at775);
  assert.strictEqual(DeanRA.npshrAt(slow, 200), null);
  assert.strictEqual(DeanRA.npshrAt(slow, 1200), null);
}

// Store package price: motor frame picks the formed-steel baseplate and the coupling.
{
  const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-prices.json'), 'utf8'));
  const ra3146 = prices.products.find(function (p) { return p.url.indexOf('dean-ra3146-pump') >= 0; });
  const curve = catalog.curves.find(function (c) {
    return c.frame === 'RA3146' && c.rpm === 3500 && c.size.replace(/\s+/g, '') === '3x4x8.5';
  });
  const full = curve.impellers.reduce(function (max, imp) { return Math.max(max, imp.diameter_in); }, 0);
  const quote = DeanRA.packageQuote(prices, curve, full, 50, 3500);
  assert.strictEqual(quote.frame, '326TS');
  assert.ok(/Economy Steel 326TS/.test(quote.baseplate));
  assert.ok(!/drip/i.test(quote.baseplate));
  assert.ok(/Dodge D-Flex Spacer\/Coupling 326TS/.test(quote.coupling));
  const byName = {};
  quote.lines.forEach(function (line) { byName[line.name] = line; });
  assert.strictEqual(byName.Pump.amount, ra3146.sizes['3x4x8.5']);
  assert.strictEqual(byName.Trim, undefined);
  assert.strictEqual(byName.Motor.amount, 7309);
  assert.strictEqual(byName.Baseplate.amount, 1934);
  assert.strictEqual(byName.Coupling.amount, 654);
  assert.strictEqual(quote.total, 12707 + 7309 + 1934 + 654);
  const ra3246 = prices.products.find(function (p) { return p.url.indexOf('dean-ra3246-pump') >= 0; });
  assert.strictEqual(ra3246.trim_adder_usd, 0);
  const wide = {
    frame: 'RA3246',
    size: '6 x 8 x 15.5',
    rpm: 1750,
    impellers: [{ diameter_in: 15.5 }, { diameter_in: 15 }]
  };
  const trimmed = DeanRA.packageQuote(prices, wide, 15, 50, 1750);
  const trimLine = trimmed.lines.find(function (line) { return line.name === 'Trim'; });
  assert.strictEqual(trimLine.amount, 0);
  assert.strictEqual(trimmed.frame, '326T');
  const duty = pick(100, 240);
  const shown = DeanRA.packageQuote(prices, duty.pick.curve, duty.pick.diameter_in, duty.pick.motor_hp, 3500);
  assert.strictEqual(shown.frame, '254T');
  assert.ok(/Formed Steel/.test(shown.baseplate));
  assert.strictEqual(shown.coupling, 'Included with pump');
  var shownCoupling = shown.lines.find(function (line) { return line.name === 'Coupling'; });
  assert.strictEqual(shownCoupling.included, true);
  assert.strictEqual(shownCoupling.amount, 0);
  assert.strictEqual(shown.total, 8174 + 155 + 2382 + 1093);
  const only = DeanRA.select(catalog, { q_gpm: 100, h_ft: 240, fluid: 'water', rpm: 3500, frame: 'RA3146' });
  const priced = DeanRA.packageQuote(prices, only.pick.curve, only.pick.diameter_in, only.pick.motor_hp, 3500);
  assert.strictEqual(priced.frame, '254T');
  assert.ok(/Economy Steel 254T/.test(priced.baseplate));
  assert.ok(/254T/.test(priced.coupling));
  assert.strictEqual(priced.total, 10630 + 155 + 2382 + 1513 + 501);
}

console.log('dean-ra-select tests passed');

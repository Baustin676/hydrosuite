/* 52-point check against Tusk's IntelliQuip results.
   Tusk is the acceptance check. The curves come from the Dean data pak.
   G037-G042 RWA rows are duplicates. G043's 203.94% efficiency is ignored. */
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));
const csv = fs.readFileSync(path.join(__dirname, 'tusk_results.csv'), 'utf8').trim().split(/\n/);

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
}

const rows = [];
csv.slice(1).forEach(function (line) {
  const c = line.split(',');
  if (!c[0] || c[0] === 'id') return;
  if (String(c[4]).indexOf('RWA') === 0) return;
  const eff = Number(c[8]);
  if (!(eff <= 100)) return;
  rows.push({
    id: c[0],
    q: Number(c[1]),
    h: Number(c[2]),
    rank: Number(c[3]),
    size: c[4].replace(/^RA\s+/, ''),
    rpm: Number(c[5]),
    d: Number(c[6]),
    head: Number(c[7]),
    eff: eff,
    hp: Number(c[9]),
    maxHp: Number(c[10]),
    npshr: Number(c[11]),
    bep: Number(c[12]),
    motor: Number(c[13])
  });
});

const byId = {};
rows.forEach(function (r) {
  if (!byId[r.id]) byId[r.id] = [];
  byId[r.id].push(r);
});

function have(size, rpm) {
  return catalog.curves.some(function (c) {
    return norm(c.size) === norm(size) && Number(c.rpm) === Number(rpm);
  });
}

const ids = Object.keys(byId).sort();
let matchAll = 0;
let matchCovered = 0;
let coveredPoints = 0;
const trimErr = [];
const effErr = [];
const hpErr = [];
const perSize = {};

ids.forEach(function (id) {
  const list = byId[id].slice().sort(function (a, b) { return b.eff - a.eff; });
  const duty = list[0];
  const covered = list.filter(function (r) { return have(r.size, r.rpm); });
  const tuskBest = covered[0];
  if (!tuskBest) return;
  coveredPoints += 1;
  const result = DeanRA.select(catalog, { q_gpm: duty.q, h_ft: duty.h, fluid: 'water', temp: 68, unit: 'F', rpm: duty.rpm });
  const pick = result.pick;
  const pickSize = pick ? norm(pick.curve.size) : '';
  if (pick && pickSize === norm(list[0].size) && pick.curve.rpm === list[0].rpm) matchAll += 1;
  if (pick && pickSize === norm(tuskBest.size)) matchCovered += 1;

  const ours = {};
  (result.selections || []).forEach(function (hit) { ours[norm(hit.curve.size)] = hit; });
  covered.forEach(function (r) {
    const hit = ours[norm(r.size)];
    const key = norm(r.size) + '@' + r.rpm;
    if (!perSize[key]) perSize[key] = { n: 0, trim: [], within: 0, eff: [], hp: [] };
    if (!hit) return;
    perSize[key].n += 1;
    const td = hit.diameter_in - r.d;
    trimErr.push(td);
    perSize[key].trim.push(td);
    if (Math.abs(td) <= 0.125 + 1e-6) {
      perSize[key].within += 1;
    }
    if (hit.efficiency_pct != null) {
      const de = hit.efficiency_pct - r.eff;
      effErr.push(de);
      perSize[key].eff.push(de);
    }
    // Tusk rated hp uses the duty head.
    const bhp = DeanRA.brakeHorsepower(r.q, r.h, hit.efficiency_pct, 1);
    if (bhp != null && r.hp > 0) {
      const dh = (bhp - r.hp) / r.hp * 100;
      hpErr.push(dh);
      perSize[key].hp.push(dh);
    }
  });
});

function meanAbs(a) {
  if (!a.length) return null;
  return a.reduce(function (s, v) { return s + Math.abs(v); }, 0) / a.length;
}
function maxAbs(a) {
  return a.reduce(function (m, v) { return Math.max(m, Math.abs(v)); }, 0);
}

const lines = [];
lines.push('# 52-point check, after the re-read');
lines.push('');
lines.push('Tusk rows: ' + rows.length + ' after dropping RWA duplicates and the G043 efficiency glitch. ' + ids.length + ' duties.');
lines.push('');
lines.push('| Measure | Result |');
lines.push('|---|---|');
lines.push('| #1 matches Tusk overall #1 | ' + matchAll + ' / ' + coveredPoints + ' |');
lines.push('| #1 matches Tusk best covered size | ' + matchCovered + ' / ' + coveredPoints + ' |');
lines.push('| Trim pairs | ' + trimErr.length + ' |');
lines.push('| Trim mean abs | ' + meanAbs(trimErr).toFixed(3) + ' in |');
lines.push('| Trim max | ' + maxAbs(trimErr).toFixed(3) + ' in |');
lines.push('| Trim within 1/8 in | ' + trimErr.filter(function (e) { return Math.abs(e) <= 0.125 + 1e-9; }).length + ' / ' + trimErr.length + ' |');
lines.push('| Efficiency mean abs | ' + meanAbs(effErr).toFixed(2) + ' points |');
lines.push('| Efficiency max | ' + maxAbs(effErr).toFixed(1) + ' points |');
lines.push('| Efficiency within 2 points | ' + effErr.filter(function (e) { return Math.abs(e) <= 2; }).length + ' / ' + effErr.length + ' |');
lines.push('| HP mean abs, duty head | ' + meanAbs(hpErr).toFixed(1) + '% |');
lines.push('| HP max | ' + maxAbs(hpErr).toFixed(1) + '% |');
lines.push('');
lines.push('| Size | Pairs | Trim mean abs | Within 1/8 | Eff mean abs | HP mean abs |');
lines.push('|---|---|---|---|---|---|');
Object.keys(perSize).sort().forEach(function (key) {
  const s = perSize[key];
  lines.push('| ' + key + ' | ' + s.n + ' | ' + (s.trim.length ? meanAbs(s.trim).toFixed(3) : '—') + ' | ' + s.within + '/' + s.n + ' | ' + (s.eff.length ? meanAbs(s.eff).toFixed(2) : '—') + ' | ' + (s.hp.length ? meanAbs(s.hp).toFixed(1) + '%' : '—') + ' |');
});

const text = lines.join('\n') + '\n';
console.log(text);

const assert = require('assert');
assert.ok(matchCovered >= 45, 'covered #1 match fell to ' + matchCovered);
assert.ok(trimErr.filter(function (e) { return Math.abs(e) <= 0.125 + 1e-9; }).length / trimErr.length >= 0.85);
assert.ok(meanAbs(effErr) <= 2.0, 'efficiency mean abs ' + meanAbs(effErr));
assert.ok(meanAbs(trimErr) <= 0.08, 'trim mean abs ' + meanAbs(trimErr));

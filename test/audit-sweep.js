/* Grid over fluids, temperatures, duties, speeds, and services.
   Fails on a throw, a NaN, a negative head or power, or efficiency over 100%.
   Prints brake-horsepower jumps between neighboring temperatures. */
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));
const fluids = ['water', 'therminol55', 'therminol66', 'therminolVP1', 'dowthermA', 'dowthermQ', 'syltherm800', 'xlt', 'pg50', 'eg50', 'mineralOil100', 'crude'];
const temps = [-40, -20, 0, 32, 70, 150, 212, 250, 320, 400, 500, 570, 600, 650];
const duties = [[50, 80], [100, 200], [200, 150], [400, 100]];
const speeds = [3500, 1750];
const services = ['ra', 'rwa'];

const problems = [];
const jumps = [];
let ran = 0;
let blocked = 0;
let covered = 0;

function badNumber(value) {
  return typeof value === 'number' && !isFinite(value);
}

fluids.forEach(function (fluid) {
  duties.forEach(function (duty) {
    speeds.forEach(function (rpm) {
      services.forEach(function (service) {
        let previous = null;
        temps.forEach(function (temp) {
          ran += 1;
          let result;
          try {
            result = DeanRA.select(catalog, {
              q_gpm: duty[0], h_ft: duty[1], fluid: fluid, temp: temp, unit: 'F', rpm: rpm, service: service
            });
          } catch (err) {
            problems.push(fluid + ' ' + temp + 'F ' + duty.join('/') + ' ' + rpm + ' ' + service + ' threw ' + err.message);
            previous = null;
            return;
          }
          if (result.blocked) {
            blocked += 1;
            if (!result.message) problems.push(fluid + ' ' + temp + 'F blocked without a message');
            previous = null;
            return;
          }
          if (!result.covered) {
            previous = null;
            return;
          }
          covered += 1;
          const bySize = {};
          (result.selections || []).forEach(function (hit) {
            const size = hit.curve.frame + ' ' + hit.curve.size;
            ['bhp', 'bhp_end', 'bhp_max', 'efficiency_pct', 'head_ft', 'npshr_ft'].forEach(function (key) {
              if (badNumber(hit[key])) problems.push(size + ' ' + key + ' is NaN at ' + fluid + ' ' + temp);
            });
            if (hit.head_ft < 0) problems.push(size + ' negative head at ' + fluid + ' ' + temp);
            if (hit.bhp < 0 || hit.bhp_end < 0) problems.push(size + ' negative power at ' + fluid + ' ' + temp);
            if (hit.efficiency_pct > 100) problems.push(size + ' efficiency ' + hit.efficiency_pct + ' at ' + fluid + ' ' + temp);
            if (hit.bhp > 0) bySize[size] = hit.bhp;
          });
          if (previous) {
            Object.keys(bySize).forEach(function (size) {
              const before = previous.power[size];
              if (!(before > 0)) return;
              const ratio = bySize[size] / before;
              if (ratio > 4 || ratio < 0.25) {
                jumps.push(fluid + ' ' + previous.temp + '→' + temp + ' ' + size + ' ' + before.toFixed(2) + '→' + bySize[size].toFixed(2));
              }
            });
          }
          previous = { temp: temp, power: bySize };
        });
      });
    });
  });
});

console.log('sweep ran ' + ran + ', covered ' + covered + ', blocked ' + blocked);
if (jumps.length) {
  console.log('bhp jumps:');
  jumps.slice(0, 40).forEach(function (line) { console.log('  ' + line); });
  if (jumps.length > 40) console.log('  … ' + (jumps.length - 40) + ' more');
}
if (problems.length) {
  problems.slice(0, 30).forEach(function (line) { console.log('FAIL ' + line); });
  process.exit(1);
}
console.log('audit sweep passed');

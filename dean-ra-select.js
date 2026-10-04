/* Dean RA catalog selector.
   Uses only digitized head-capacity points. Interpolates along one impeller
   line. A duty between two lines is an eighth-inch trim from diameter-squared
   affinity, not a linear diameter. Does not extrapolate or speed-scale.
   A non-water fluid corrects that water curve with the Hydraulic Institute
   preliminary method (ANSI/HI 9.6.7 section 9.6.7.4.6). It does not invent
   catalog heads, efficiency, BHP, or NPSHr. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeanRA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var CATALOG_FT = 3;
  var ON_LINE_FT = CATALOG_FT;
  var EIGHTH = 0.125;
  // Store limits. A trim never goes below the smallest digitized line.
  var OFFERED = {
    'RA1060-A2': [4, 6],
    'RA1560-A2': [4, 6],
    'RA1080-A2': [5, 8],
    'R1085-A2': [5.5, 8.5],
    'R1585-A2': [5.5, 8.5],
    'R2085-A2': [5.5, 8.5],
    'R3085-A1': [5.5, 8.5],
    'R4085-A1': [5.5, 8.5],
    'R15100-A2': [7, 10],
    'R20100-A2': [7, 10],
    'R30100-A1': [7, 10],
    'R40100-B2': [7, 10],
    'R40100-A1': [8, 10]
  };

  function sortedPoints(points) {
    return points.slice().sort(function (a, b) { return a.q_gpm - b.q_gpm; });
  }

  /** Head on one impeller line. Null when q is outside the real points.
      An exact catalog flow uses that point's own inferred flag. A flow
      between two points is inferred when either real point was. */
  function headAt(points, q) {
    var pts = sortedPoints(points);
    if (!pts.length) return null;
    var qMin = pts[0].q_gpm;
    var qMax = pts[pts.length - 1].q_gpm;
    if (q < qMin - 1e-9 || q > qMax + 1e-9) return null;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (Math.abs(q - a.q_gpm) <= 1e-6) {
        return { h: a.h_ft, inferred: !!a.inferred, qMin: qMin, qMax: qMax };
      }
      if (q > a.q_gpm && q < b.q_gpm) {
        var span = b.q_gpm - a.q_gpm;
        var t = (q - a.q_gpm) / span;
        return {
          h: a.h_ft + t * (b.h_ft - a.h_ft),
          inferred: !!(a.inferred || b.inferred),
          qMin: qMin,
          qMax: qMax
        };
      }
    }
    var last = pts[pts.length - 1];
    if (Math.abs(q - last.q_gpm) <= 1e-6) {
      return { h: last.h_ft, inferred: !!last.inferred, qMin: qMin, qMax: qMax };
    }
    return null;
  }

  function byDiameterDesc(curve) {
    return curve.impellers.slice().sort(function (a, b) {
      return b.diameter_in - a.diameter_in;
    });
  }

  function cleanDia(d) {
    return Math.round(d * 1000) / 1000;
  }

  function affinityHead(hLo, hHi, dLo, dHi, d) {
    var denom = dHi * dHi - dLo * dLo;
    if (Math.abs(denom) < 1e-9) return hLo;
    return hLo + (hHi - hLo) * (d * d - dLo * dLo) / denom;
  }

  // Fritsch–Carlson / PCHIP endpoint slope. Keeps a monotone interpolant from leaving the interval.
  function edgeSlope(h0, h1, d0, d1) {
    var d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (d * d0 <= 0) return 0;
    if (d0 * d1 < 0 && Math.abs(d) > Math.abs(3 * d0)) return 3 * d0;
    return d;
  }

  function pchipSlopes(pts) {
    var n = pts.length;
    var m = new Array(n);
    if (n < 2) {
      if (n === 1) m[0] = 0;
      return m;
    }
    var h = [];
    var d = [];
    for (var i = 0; i < n - 1; i++) {
      var dq = pts[i + 1].q_gpm - pts[i].q_gpm;
      h.push(dq);
      d.push(dq === 0 ? 0 : (pts[i + 1].h_ft - pts[i].h_ft) / dq);
    }
    if (n === 2) {
      m[0] = d[0];
      m[1] = d[0];
      return m;
    }
    for (var k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) m[k] = 0;
      else {
        var w1 = 2 * h[k] + h[k - 1];
        var w2 = h[k] + 2 * h[k - 1];
        m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
      }
    }
    m[0] = edgeSlope(h[0], h[1], d[0], d[1]);
    m[n - 1] = edgeSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    return m;
  }

  function hermite(a, b, m0, m1, q) {
    var dx = b.q_gpm - a.q_gpm;
    var t = (q - a.q_gpm) / dx;
    var t2 = t * t;
    var t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.h_ft +
      (t3 - 2 * t2 + t) * dx * m0 +
      (-2 * t3 + 3 * t2) * b.h_ft +
      (t3 - t2) * dx * m1;
  }

  /** Head on the smooth monotone curve through one impeller. Null outside the real points. */
  function smoothHead(points, q) {
    var pts = sortedPoints(points);
    if (!pts.length) return null;
    var qMin = pts[0].q_gpm;
    var qMax = pts[pts.length - 1].q_gpm;
    if (q < qMin - 1e-9 || q > qMax + 1e-9) return null;
    for (var i = 0; i < pts.length; i++) {
      if (Math.abs(q - pts[i].q_gpm) <= 1e-6) {
        return { h: pts[i].h_ft, qMin: qMin, qMax: qMax };
      }
    }
    if (pts.length < 2) return null;
    var slopes = pchipSlopes(pts);
    for (var j = 0; j < pts.length - 1; j++) {
      if (q > pts[j].q_gpm && q < pts[j + 1].q_gpm) {
        return {
          h: hermite(pts[j], pts[j + 1], slopes[j], slopes[j + 1], q),
          qMin: qMin,
          qMax: qMax
        };
      }
    }
    return null;
  }

  /** Cubic pieces of that curve, from the first real point to the last. No extension. */
  function smoothPieces(points) {
    var pts = sortedPoints(points);
    if (pts.length < 2) return [];
    var slopes = pchipSlopes(pts);
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      if (pts[i + 1].q_gpm <= pts[i].q_gpm) continue;
      out.push({
        q0: pts[i].q_gpm,
        h0: pts[i].h_ft,
        m0: slopes[i],
        q1: pts[i + 1].q_gpm,
        h1: pts[i + 1].h_ft,
        m1: slopes[i + 1]
      });
    }
    return out;
  }

  function offeredDiameters(curve) {
    var spec = OFFERED[curve.model];
    if (!spec || !curve.impellers.length) return [];
    var digitizedMin = curve.impellers[0].diameter_in;
    var digitizedMax = curve.impellers[0].diameter_in;
    curve.impellers.forEach(function (imp) {
      if (imp.diameter_in < digitizedMin) digitizedMin = imp.diameter_in;
      if (imp.diameter_in > digitizedMax) digitizedMax = imp.diameter_in;
    });
    var minD = Math.max(spec[0], digitizedMin);
    var maxD = Math.min(spec[1], digitizedMax);
    var out = [];
    var i0 = Math.round(minD / EIGHTH);
    var i1 = Math.round(maxD / EIGHTH);
    for (var i = i0; i <= i1; i++) out.push(cleanDia(i * EIGHTH));
    return out;
  }

  function makeHit(curve, q, h, upper, lower, trimD) {
    var qMax = upper.at.qMax;
    var qMin = upper.at.qMin;
    var inferred = !!upper.at.inferred;
    var kind = 'catalog';
    var diameter = upper.imp.diameter_in;
    var between = null;
    var gap = 0;
    var hUpper = upper.at.h;
    var hLower = null;
    var lowerDiameter = null;
    if (lower) {
      qMax = Math.min(qMax, lower.at.qMax);
      qMin = Math.max(qMin, lower.at.qMin);
      inferred = inferred || !!lower.at.inferred;
      kind = 'trim';
      diameter = trimD;
      between = [lower.imp.diameter_in, upper.imp.diameter_in];
      gap = Math.abs(upper.at.h - lower.at.h);
      hLower = lower.at.h;
      lowerDiameter = lower.imp.diameter_in;
    }
    return {
      curve: curve,
      kind: kind,
      diameter_in: diameter,
      between: between,
      inferred: inferred,
      endMargin: qMax - q,
      qMax: qMax,
      qMin: qMin,
      gap: gap,
      hUpper: hUpper,
      hLower: hLower,
      upperDiameter: upper.imp.diameter_in,
      lowerDiameter: lowerDiameter
    };
  }

  function solveTrim(curve, q, h, hi, lo) {
    var dHi = hi.imp.diameter_in;
    var dLo = lo.imp.diameter_in;
    var steps = offeredDiameters(curve).filter(function (d) {
      return d >= dLo - 1e-6 && d <= dHi + 1e-6;
    });
    var chosen = null;
    steps.forEach(function (d) {
      var hd = affinityHead(lo.at.h, hi.at.h, dLo, dHi, d);
      if (hd + 1e-4 >= h && (chosen === null || d < chosen)) chosen = d;
    });
    if (chosen === null) return null;
    if (Math.abs(chosen - dHi) <= 1e-6) return makeHit(curve, q, h, hi, null);
    if (Math.abs(chosen - dLo) <= 1e-6) return makeHit(curve, q, h, lo, null);
    return makeHit(curve, q, h, hi, lo, chosen);
  }

  function coversHead(h, ha, hb) {
    var top = Math.max(ha, hb);
    var bot = Math.min(ha, hb);
    return h <= top + 1e-6 && h >= bot - 1e-6;
  }

  function evaluateCurve(curve, q, h) {
    var imps = byDiameterDesc(curve);
    var readings = [];
    for (var i = 0; i < imps.length; i++) {
      readings.push({ imp: imps[i], at: headAt(imps[i].points, q) });
    }
    var nearest = null;
    readings.forEach(function (reading) {
      if (!reading.at) return;
      var dist = Math.abs(reading.at.h - h);
      if (dist > CATALOG_FT + 1e-9) return;
      if (!nearest || dist < nearest.dist - 1e-6 || (Math.abs(dist - nearest.dist) <= 1e-6 && reading.at.h > nearest.reading.at.h)) {
        nearest = { dist: dist, reading: reading };
      }
    });
    if (nearest) return makeHit(curve, q, h, nearest.reading, null);

    var best = null;
    for (var j = 0; j < imps.length - 1; j++) {
      var hi = readings[j];
      var lo = readings[j + 1];
      if (!hi.at || !lo.at) continue;
      if (!coversHead(h, hi.at.h, lo.at.h)) continue;
      var hit = solveTrim(curve, q, h, hi, lo);
      if (!hit) continue;
      if (!best || compareHits(hit, best) < 0) best = hit;
    }
    return best;
  }

  /** Higher is a better fit. End margin matters until about half the line is left;
      extra unused capacity on a much larger pump does not outrank a duty that
      already sits inside a smaller curve with room before the last point. */
  function scoreHit(hit) {
    var span = Math.max(hit.qMax - hit.qMin, 1);
    var endFrac = hit.endMargin / span;
    var q = hit.qMax - hit.endMargin;
    var pos = (q - hit.qMin) / span;
    var marginScore = Math.min(Math.max(endFrac, 0), 0.45) / 0.45;
    var fit = 1 - Math.min(1, Math.abs(pos - 0.55) / 0.55);
    var catalogBonus = hit.kind === 'catalog' ? 0.12 : 0;
    return marginScore * 2 + fit + catalogBonus;
  }

  /** Lower return means a is the better recommendation. */
  function compareHits(a, b) {
    var ds = scoreHit(b) - scoreHit(a);
    if (Math.abs(ds) > 0.02) return ds;
    if (a.kind !== b.kind) return a.kind === 'catalog' ? -1 : 1;
    if (Math.abs(a.gap - b.gap) > 0.5) return a.gap - b.gap;
    if (a.qMax !== b.qMax) return a.qMax - b.qMax;
    return String(a.curve.model).localeCompare(String(b.curve.model));
  }

  function select(catalog, duty) {
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    var correction = correctDuty(duty);
    var qUse = q;
    var hUse = h;
    if (correction.applied) {
      qUse = correction.qWater;
      hUse = correction.hWater;
    }
    var found = [];
    (catalog.curves || []).forEach(function (curve) {
      var hit = evaluateCurve(curve, qUse, hUse);
      if (hit) found.push(hit);
    });
    found.sort(compareHits);
    return {
      covered: found.length > 0,
      pick: found[0] || null,
      matchCount: found.length,
      matches: found,
      correction: correction
    };
  }

  // Properties already printed on the fluid menu. Nothing here is guessed.
  // temp/unit is the condition those viscosity and specific-gravity values belong to.
  var FLUIDS = {
    water: { name: 'Water', sg: 1.000, visc: 1.002, temp: 68, unit: 'F' },
    water60: { name: 'Water', sg: 0.983, visc: 0.467, temp: 140, unit: 'F' },
    water80: { name: 'Water', sg: 0.972, visc: 0.354, temp: 176, unit: 'F' },
    water100: { name: 'Water', sg: 0.958, visc: 0.282, temp: 212, unit: 'F' },
    water121: { name: 'Water', sg: 0.943, visc: 0.230, temp: 250, unit: 'F' },
    water150: { name: 'Water', sg: 0.917, visc: 0.183, temp: 302, unit: 'F' },
    water180: { name: 'Water', sg: 0.887, visc: 0.150, temp: 356, unit: 'F' },
    condensate: { name: 'Steam Condensate', sg: 0.965, visc: 0.314, temp: 90, unit: 'C' },
    seawater: { name: 'Seawater', sg: 1.025, visc: 1.072, temp: 20, unit: 'C' },
    eg30: { name: 'Ethylene Glycol 30%', sg: 1.055, visc: 2.50, temp: 20, unit: 'C' },
    eg50: { name: 'Ethylene Glycol 50%', sg: 1.085, visc: 4.50, temp: 20, unit: 'C' },
    eg50c: { name: 'Ethylene Glycol 50%', sg: 1.095, visc: 11.5, temp: -10, unit: 'C' },
    pg30: { name: 'Propylene Glycol 30%', sg: 1.034, visc: 2.80, temp: 20, unit: 'C' },
    pg50: { name: 'Propylene Glycol 50%', sg: 1.057, visc: 7.50, temp: 20, unit: 'C' },
    dowthermA: { name: 'Dowtherm A', sg: 0.980, visc: 0.910, temp: 150, unit: 'C' },
    dowthermA260: { name: 'Dowtherm A', sg: 0.899, visc: 0.430, temp: 260, unit: 'C' },
    dowthermQ: { name: 'Dowtherm Q', sg: 0.960, visc: 1.650, temp: 100, unit: 'C' },
    dowthermQ200: { name: 'Dowtherm Q', sg: 0.893, visc: 0.680, temp: 200, unit: 'C' },
    therminol55: { name: 'Therminol 55', sg: 0.847, visc: 1.200, temp: 100, unit: 'C' },
    therminol66: { name: 'Therminol 66', sg: 0.963, visc: 1.850, temp: 150, unit: 'C' },
    therminol66h: { name: 'Therminol 66', sg: 0.856, visc: 0.560, temp: 300, unit: 'C' },
    therminolVP1: { name: 'Therminol VP-1', sg: 0.973, visc: 0.510, temp: 200, unit: 'C' },
    syltherm800: { name: 'Syltherm 800', sg: 0.820, visc: 0.540, temp: 200, unit: 'C' },
    syltherm800h: { name: 'Syltherm 800', sg: 0.726, visc: 0.280, temp: 350, unit: 'C' },
    xlt: { name: 'Syltherm XLT', sg: 0.985, visc: 12.00, temp: -40, unit: 'C' },
    mineralOil100: { name: 'Mineral Oil HTF', sg: 0.840, visc: 5.500, temp: 100, unit: 'C' },
    mineralOil200: { name: 'Mineral Oil HTF', sg: 0.780, visc: 1.800, temp: 200, unit: 'C' },
    crude: { name: 'Light Crude Oil', sg: 0.870, visc: 5.00, temp: 68, unit: 'F' },
    crudemed: { name: 'Medium Crude Oil', sg: 0.900, visc: 15.0, temp: 68, unit: 'F' },
    diesel: { name: 'Diesel / No.2 Fuel Oil', sg: 0.850, visc: 3.00, temp: 68, unit: 'F' },
    fo6: { name: 'Fuel Oil No.6', sg: 0.990, visc: 300, temp: 122, unit: 'F' },
    gasoline: { name: 'Gasoline', sg: 0.720, visc: 0.50, temp: 68, unit: 'F' },
    jetA: { name: 'Jet Fuel A', sg: 0.800, visc: 1.50, temp: 68, unit: 'F' },
    isovg32: { name: 'Lube Oil ISO VG 32', sg: 0.860, visc: 32.0, temp: 104, unit: 'F' },
    isovg68: { name: 'Lube Oil ISO VG 68', sg: 0.870, visc: 68.0, temp: 104, unit: 'F' },
    hcl: { name: 'HCl 20%', sg: 1.100, visc: 1.60, temp: 68, unit: 'F' },
    sulfuric: { name: 'H₂SO₄ 98%', sg: 1.840, visc: 26.0, temp: 68, unit: 'F' },
    sulfuric10: { name: 'H₂SO₄ 10%', sg: 1.065, visc: 1.30, temp: 68, unit: 'F' },
    naoh: { name: 'NaOH 10%', sg: 1.110, visc: 1.50, temp: 68, unit: 'F' },
    methanol: { name: 'Methanol', sg: 0.791, visc: 0.59, temp: 68, unit: 'F' },
    ethanol: { name: 'Ethanol', sg: 0.789, visc: 1.20, temp: 68, unit: 'F' },
    ammonia: { name: 'Liquid Ammonia', sg: 0.610, visc: 0.16, temp: -33, unit: 'C' }
  };

  var AMBIENT = 'Water at ambient is the reference these curves were drawn for.';
  var DISCLAIMER = "These curves are not a direct duplicate of Dean's and are for reference only.";

  function fluidClass(fluid) {
    var f = String(fluid || '').toLowerCase();
    if (f === 'water') return 'water';
    if (f === 'eg' || f === 'pg' || f.indexOf('glycol') >= 0) return 'glycol';
    if (f === 'hto' || f.indexOf('oil') >= 0 || f.indexOf('therminol') >= 0 || f.indexOf('dowtherm') >= 0) return 'oil';
    return 'other';
  }

  function isWaterFluid(fluid) {
    var f = String(fluid || '').toLowerCase().trim();
    return f === 'water' || /^water\d+$/.test(f);
  }

  function formatMu(n) {
    var rounded = Math.round(Number(n) * 1000) / 1000;
    return rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatSg(n) {
    return Number(n).toFixed(3);
  }

  function formatNu(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function formatB(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function formatFactor(n) {
    return (Math.round(Number(n) * 10000) / 10000).toFixed(4);
  }

  function formatDutyNum(n) {
    var r = Math.round(Number(n) * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
    return r.toFixed(1);
  }

  function formatStoredTemp(rec) {
    return String(rec.temp) + ' °' + rec.unit;
  }

  function toFahrenheit(temp, unit) {
    var n = Number(temp);
    if (unit === 'C') return n * 9 / 5 + 32;
    return n;
  }

  // A missing temperature means "use the stored condition."
  // A different temperature has no stored viscosity, so it does not match.
  function temperatureMatches(rec, temp, unit) {
    if (temp == null || temp === '' || unit == null || unit === '') return true;
    var n = Number(temp);
    if (!isFinite(n)) return false;
    var entered = unit === 'C' || unit === 'F' ? toFahrenheit(n, unit) : NaN;
    if (!isFinite(entered)) return false;
    return Math.abs(entered - toFahrenheit(rec.temp, rec.unit)) <= 0.25;
  }

  // ANSI/HI 9.6.7-2004 section 9.6.7.4.6, USCS.
  // B = 4.70 * V^0.5 / (Q^0.25 * H^0.125), V in cSt, Q in gpm, H in ft.
  // CQ = CH = 2.71^(-0.165 * (log10 B)^3.15) when 1 < B < 40.
  // Qw = Qvis / CQ, Hw = Hvis / CH. B ≤ 1 leaves head and flow unchanged.
  // B ≥ 40 is outside the published fit and is not applied.
  function hiPreliminary(qGpm, hFt, nuCst) {
    var q = Number(qGpm);
    var h = Number(hFt);
    var nu = Number(nuCst);
    var B = 4.70 * Math.sqrt(nu) / (Math.pow(q, 0.25) * Math.pow(h, 0.125));
    if (!(B > 1)) {
      return { B: B, CQ: 1, CH: 1, qWater: q, hWater: h, range: 'low' };
    }
    if (B >= 40) {
      return { B: B, CQ: null, CH: null, qWater: null, hWater: null, range: 'high' };
    }
    var logB = Math.log(B) / Math.LN10;
    var CQ = Math.pow(2.71, -0.165 * Math.pow(logB, 3.15));
    return { B: B, CQ: CQ, CH: CQ, qWater: q / CQ, hWater: h / CQ, range: 'ok' };
  }

  function propertyClause(rec, nu) {
    return 'Viscosity ' + formatMu(rec.visc) + ' cP and specific gravity ' + formatSg(rec.sg) +
      ' (' + formatNu(nu) + ' cSt) at ' + formatStoredTemp(rec) + '. ';
  }

  function correctDuty(duty) {
    duty = duty || {};
    var fluid = duty.fluid;
    if (fluid == null || fluid === '' || isWaterFluid(fluid)) {
      return { status: 'water', applied: false, note: AMBIENT };
    }
    var rec = FLUIDS[fluid];
    if (!rec || rec.sg == null || rec.visc == null || !(rec.sg > 0) || !(rec.visc > 0)) {
      return {
        status: 'missing',
        applied: false,
        note: AMBIENT + ' No viscosity or specific gravity is stored for this fluid, so no correction is applied. ' + DISCLAIMER
      };
    }
    if (!temperatureMatches(rec, duty.temp, duty.unit)) {
      return {
        status: 'temperature',
        applied: false,
        note: AMBIENT + ' Viscosity and specific gravity for this fluid are stored at ' + formatStoredTemp(rec) +
          ', not at the temperature entered. They are not used here, and no correction is applied. ' + DISCLAIMER
      };
    }
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    var nu = rec.visc / rec.sg;
    var base = AMBIENT + ' Hydraulic Institute correction of the catalog water curve (ANSI/HI 9.6.7), not a Dean sheet. ' +
      propertyClause(rec, nu);
    var props = { sg: rec.sg, visc: rec.visc, nu: nu, temp: rec.temp, unit: rec.unit, name: rec.name };
    if (!(q > 0) || !(h > 0)) {
      return Object.assign({ status: 'ready', applied: false, note: base + DISCLAIMER }, props);
    }
    var hi = hiPreliminary(q, h, nu);
    if (hi.range === 'high') {
      return Object.assign({
        status: 'out-of-range',
        applied: false,
        B: hi.B,
        note: base + 'Parameter B is ' + formatB(hi.B) + ', outside the published range below 40, so head and flow are not corrected. ' + DISCLAIMER
      }, props);
    }
    if (hi.range === 'low') {
      return Object.assign({
        status: 'unchanged',
        applied: false,
        B: hi.B,
        CQ: 1,
        CH: 1,
        qWater: q,
        hWater: h,
        note: base + 'Parameter B is ' + formatB(hi.B) + ', so corrected head and flow stay on the catalog water curve. ' + DISCLAIMER
      }, props);
    }
    return Object.assign({
      status: 'corrected',
      applied: true,
      B: hi.B,
      CQ: hi.CQ,
      CH: hi.CH,
      qWater: hi.qWater,
      hWater: hi.hWater,
      note: base + 'Corrected flow ' + formatDutyNum(hi.qWater) + ' gpm (CQ = ' + formatFactor(hi.CQ) +
        ') and corrected head ' + formatDutyNum(hi.hWater) + ' ft (CH = ' + formatFactor(hi.CH) +
        '), from parameter B = ' + formatB(hi.B) + '. ' + DISCLAIMER
    }, props);
  }

  function correctionTag(corr) {
    if (!corr || corr.status === 'water') return [];
    if (corr.status === 'missing') {
      return ['No viscosity or specific gravity stored', 'Catalog water curve, no correction'];
    }
    if (corr.status === 'temperature') {
      return ['No viscosity at this temperature', 'Catalog water curve, no correction'];
    }
    if (corr.status === 'out-of-range') {
      return [
        'HI correction of the water curve',
        'μ ' + formatMu(corr.visc) + ' cP · SG ' + formatSg(corr.sg),
        'B = ' + formatB(corr.B) + ', outside the published range'
      ];
    }
    if (!corr.applied) {
      return [
        'HI correction of the water curve',
        'μ ' + formatMu(corr.visc) + ' cP · SG ' + formatSg(corr.sg),
        'B = ' + formatB(corr.B) + ', head and flow unchanged'
      ];
    }
    return [
      'HI correction of the water curve',
      'μ ' + formatMu(corr.visc) + ' cP · SG ' + formatSg(corr.sg),
      'CQ ' + formatFactor(corr.CQ) + ' · CH ' + formatFactor(corr.CH)
    ];
  }

  // Scale a catalog water curve by the HI flow and head factors. Slopes follow dh/dq.
  function correctedPieces(points, cq, ch) {
    var pieces = smoothPieces(points);
    if (!(cq > 0) || !(ch > 0)) return [];
    return pieces.map(function (p) {
      return {
        q0: p.q0 * cq,
        h0: p.h0 * ch,
        m0: p.m0 * ch / cq,
        q1: p.q1 * cq,
        h1: p.h1 * ch,
        m1: p.m1 * ch / cq
      };
    });
  }

  function fluidNote(fluid, duty) {
    var spec = { fluid: fluid };
    if (duty) {
      spec.q_gpm = duty.q_gpm;
      spec.h_ft = duty.h_ft;
      spec.temp = duty.temp;
      spec.unit = duty.unit;
    }
    return correctDuty(spec).note;
  }

  function impellerLabel(hit) {
    if (!hit) return '';
    if (hit.kind === 'catalog') {
      return formatDia(hit.diameter_in) + ' in catalog diameter';
    }
    var lo = formatDia(hit.between[0]);
    var hi = formatDia(hit.between[1]);
    return formatDia(hit.diameter_in) + ' in, calculated between the ' + lo + ' in and ' + hi + ' in catalog diameters, not a published curve';
  }

  function formatDia(d) {
    var eighths = Math.round(d / EIGHTH);
    var millis = Math.round(eighths * EIGHTH * 1000);
    return (millis / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  var POWER_FRAMES = { RA2096: true, RA3146: true, RA3186: true };

  // The model on screen is the RA power frame printed on the sheet.
  // Curve-sheet ids stay in the data and are not this name.
  function powerFrame(curve) {
    if (!curve) return '';
    if (POWER_FRAMES[curve.frame]) return curve.frame;
    var types = curve.pump_types || [];
    for (var i = 0; i < types.length; i++) {
      if (POWER_FRAMES[types[i]]) return types[i];
    }
    return '';
  }

  function frameLine(curve) {
    var types = curve.pump_types || [];
    var frame = curve.frame || '';
    if (frame && types.length) {
      var extra = types.filter(function (t) { return t !== frame; });
      if (extra.length) return frame + ' (sheet also lists ' + extra.join(', ') + ')';
      return frame;
    }
    if (frame) return frame;
    if (types.length) return types.join(', ');
    return 'not printed on the sheet';
  }

  return {
    ON_LINE_FT: ON_LINE_FT,
    DISCLAIMER: DISCLAIMER,
    headAt: headAt,
    select: select,
    fluidClass: fluidClass,
    fluidNote: fluidNote,
    fluids: FLUIDS,
    correctDuty: correctDuty,
    correctionTag: correctionTag,
    hiPreliminary: hiPreliminary,
    correctedPieces: correctedPieces,
    impellerLabel: impellerLabel,
    formatDia: formatDia,
    affinityHead: affinityHead,
    smoothHead: smoothHead,
    smoothPieces: smoothPieces,
    offeredDiameters: offeredDiameters,
    powerFrame: powerFrame,
    frameLine: frameLine
  };
});

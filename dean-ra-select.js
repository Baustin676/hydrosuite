/* Dean RA catalog selector.
   Uses digitized head-capacity points. A monotone cubic spline supplies
   intermediate points inside each impeller's measured flow range; those
   points are marked interpolated and are not new sheet readings.
   The spline passes through every catalog head and falls or stays level
   as flow increases. It is not extended past the first or last catalog flow.
   A duty between two lines is an eighth-inch trim from diameter-squared
   affinity, not a linear diameter. Does not extrapolate or speed-scale.
   A duty returns every catalog size at the selected speed that can meet it.
   The order is efficiency. 70 to 120 percent of BEP is preferred, 50 to 130
   is allowable, and anything under 50 percent of BEP is flagged. A size
   outside 20 to 150 percent of BEP is left off the list.
   A non-water fluid corrects that water curve with the Hydraulic Institute
   preliminary method (ANSI/HI 9.6.7 section 9.6.7.4.6). It does not invent
   catalog heads, efficiency, BHP, or NPSHr. The list is then ordered by where
   that corrected water flow sits on the catalog range. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeanRA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var FLUID_CURVES = (typeof FluidCurves !== 'undefined') ? FluidCurves : require('./fluid-curves.js');
  var FLUID_VAPOR = (typeof FluidVapor !== 'undefined') ? FluidVapor : require('./fluid-vapor.js');
  var ATM_PSIA = 14.696;
  // Published use limits. A temperature outside these, or outside the table, is refused.
  var FLUID_LIMITS = {
    water: { freezeF: 32 },
    therminol55: { pourF: -65, warnAboveF: 570, blockAboveF: 600 },
    therminol66: { pourF: -25, blockAboveF: 650 },
    therminolVP1: { crystallizeF: 54, blockAboveF: 750 },
    dowthermA: { freezeF: 54, blockAboveF: 750 },
    dowthermQ: { minUseF: -30, blockAboveF: 625 },
    syltherm800: { minUseF: -40, blockAboveF: 750 },
    xlt: { minUseF: -150, blockAboveF: 500 },
    pg30: { blockAboveF: 250 },
    pg50: { blockAboveF: 250 },
    eg30: { blockAboveF: 250 },
    eg50: { blockAboveF: 250 }
  };
  var FLUID_ALIAS = {
    eg50c: 'eg50',
    therminol66h: 'therminol66',
    dowthermA260: 'dowthermA',
    dowthermQ200: 'dowthermQ',
    syltherm800h: 'syltherm800',
    mineralOil200: 'mineralOil100'
  };
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

  // Sheet readings only. Interpolated samples are not catalog points.
  function measuredPoints(points) {
    var list = [];
    for (var i = 0; i < (points || []).length; i++) {
      if (!points[i].interpolated) list.push(points[i]);
    }
    return sortedPoints(list);
  }

  /** Head on one impeller line. Null when q is outside the real points.
      An exact catalog flow uses that point's own inferred flag. A flow
      between two points is inferred when either real point was. */
  function headAt(points, q) {
    var pts = measuredPoints(points);
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

  // Natural cubic spline slopes, then clamped so each cubic piece stays monotone.
  // The harmonic-mean slopes of a piecewise cubic hug each chord, so a long
  // gap between catalog readings looks like a straight segment. The spline
  // keeps one continuous bow through the same readings.
  function monotoneSlopes(pts) {
    var n = pts.length;
    var m = new Array(n);
    if (n < 2) {
      if (n === 1) m[0] = 0;
      return m;
    }
    var h = [];
    var s = [];
    for (var i = 0; i < n - 1; i++) {
      var dq = pts[i + 1].q_gpm - pts[i].q_gpm;
      h.push(dq);
      s.push(dq === 0 ? 0 : (pts[i + 1].h_ft - pts[i].h_ft) / dq);
    }
    if (n === 2) {
      m[0] = s[0];
      m[1] = s[0];
      return m;
    }
    var lower = new Array(n);
    var diag = new Array(n);
    var upper = new Array(n);
    var rhs = new Array(n);
    for (var z = 0; z < n; z++) {
      lower[z] = 0;
      diag[z] = 0;
      upper[z] = 0;
      rhs[z] = 0;
    }
    diag[0] = 1;
    rhs[0] = 0;
    diag[n - 1] = 1;
    rhs[n - 1] = 0;
    for (var row = 1; row < n - 1; row++) {
      lower[row] = h[row - 1];
      diag[row] = 2 * (h[row - 1] + h[row]);
      upper[row] = h[row];
      rhs[row] = 6 * (s[row] - s[row - 1]);
    }
    for (var k = 1; k < n; k++) {
      var w = diag[k - 1] === 0 ? 0 : lower[k] / diag[k - 1];
      diag[k] -= w * upper[k - 1];
      rhs[k] -= w * rhs[k - 1];
    }
    var second = new Array(n);
    second[n - 1] = diag[n - 1] === 0 ? 0 : rhs[n - 1] / diag[n - 1];
    for (var back = n - 2; back >= 0; back--) {
      second[back] = diag[back] === 0 ? 0 : (rhs[back] - upper[back] * second[back + 1]) / diag[back];
    }
    m[0] = s[0] - h[0] * (2 * second[0] + second[1]) / 6;
    for (var p = 1; p < n - 1; p++) {
      m[p] = s[p - 1] + h[p - 1] * (2 * second[p] + second[p - 1]) / 6;
    }
    m[n - 1] = s[n - 2] + h[n - 2] * (second[n - 2] + 2 * second[n - 1]) / 6;
    function clampSlope(index, secants) {
      var lo = -Infinity;
      var hi = Infinity;
      for (var c = 0; c < secants.length; c++) {
        var sec = secants[c];
        if (Math.abs(sec) < 1e-12) {
          m[index] = 0;
          return;
        }
        if (sec < 0) {
          lo = Math.max(lo, 3 * sec);
          hi = Math.min(hi, 0);
        } else {
          lo = Math.max(lo, 0);
          hi = Math.min(hi, 3 * sec);
        }
      }
      if (!(lo <= hi)) {
        m[index] = 0;
        return;
      }
      if (m[index] < lo) m[index] = lo;
      if (m[index] > hi) m[index] = hi;
    }
    clampSlope(0, [s[0]]);
    for (var t = 1; t < n - 1; t++) clampSlope(t, [s[t - 1], s[t]]);
    clampSlope(n - 1, [s[n - 2]]);
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

  function pieceAt(fit, q) {
    var pieces = fit.pieces || [];
    for (var i = 0; i < pieces.length; i++) {
      if (q <= pieces[i].q1 + 1e-6 || i === pieces.length - 1) return pieces[i];
    }
    return null;
  }

  function evalFit(fit, q) {
    var piece = fit.pieces ? pieceAt(fit, q) : null;
    if (piece) {
      var u = q - piece.q0;
      return piece.h0 + piece.m0 * u + piece.c * u * u;
    }
    return fit.a + fit.b * q + fit.c * q * q + (fit.d || 0) * q * q * q;
  }

  function fitSlope(fit, q) {
    var piece = fit.pieces ? pieceAt(fit, q) : null;
    if (piece) return piece.m0 + 2 * piece.c * (q - piece.q0);
    return fit.b + 2 * fit.c * q + 3 * (fit.d || 0) * q * q;
  }

  /** Head on the smooth curve. A stored fit is the concave polynomial.
      Otherwise the monotone spline through the measured points is used. */
  function smoothHead(points, q) {
    var fit = points && points.fit;
    if (fit && (isFinite(fit.a) || fit.pieces)) {
      var qLo = fit.q0;
      var qHi = fit.q1;
      if (q < qLo - 1e-9 || q > qHi + 1e-9) return null;
      return { h: evalFit(fit, q), qMin: qLo, qMax: qHi };
    }
    var pts = measuredPoints(points);
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
    var slopes = monotoneSlopes(pts);
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

  /** Cubic pieces of that curve, from the first real point to the last. No extension.
      A polynomial fit is drawn as short pieces that match its value and slope. */
  function smoothPieces(points) {
    var fit = points && points.fit;
    if (fit && (isFinite(fit.a) || fit.pieces) && fit.q1 > fit.q0) {
      var pieces = [];
      var n = 16;
      for (var i = 0; i < n; i++) {
        var q0 = fit.q0 + (fit.q1 - fit.q0) * i / n;
        var q1 = fit.q0 + (fit.q1 - fit.q0) * (i + 1) / n;
        pieces.push({
          q0: q0,
          h0: evalFit(fit, q0),
          m0: fitSlope(fit, q0),
          q1: q1,
          h1: evalFit(fit, q1),
          m1: fitSlope(fit, q1)
        });
      }
      return pieces;
    }
    var pts = measuredPoints(points);
    if (pts.length < 2) return [];
    var slopes = monotoneSlopes(pts);
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

  /** Samples of the smooth fit, strictly inside the measured flow range.
      Each sample is marked interpolated. Heads are not invented past the
      first or last catalog flow, and the sequence does not rise with flow. */
  function interpolatedPoints(points) {
    var pts = measuredPoints(points);
    var out = [];
    if (pts.length < 2) return out;
    var prevH = pts[0].h_ft;
    for (var i = 0; i < pts.length - 1; i++) {
      var q0 = pts[i].q_gpm;
      var q1 = pts[i + 1].q_gpm;
      var hNext = pts[i + 1].h_ft;
      var dq = q1 - q0;
      if (!(dq > 0)) continue;
      var n = Math.max(3, Math.round(dq / 8));
      for (var s = 1; s <= n; s++) {
        var q = Math.round((q0 + dq * s / (n + 1)) * 10) / 10;
        if (q <= q0 + 1e-9 || q >= q1 - 1e-9) continue;
        if (out.length && Math.abs(out[out.length - 1].q_gpm - q) < 1e-6) continue;
        var sm = smoothHead(pts, q);
        if (!sm) continue;
        var h = Math.round(sm.h * 100) / 100;
        if (h > prevH) h = Math.round(prevH * 100) / 100;
        if (h < hNext) h = hNext;
        if (h > prevH) h = prevH;
        prevH = h;
        out.push({ q_gpm: q, h_ft: h, interpolated: true });
      }
      prevH = hNext;
    }
    return out;
  }

  function curvePoints(points) {
    return sortedPoints(measuredPoints(points).concat(interpolatedPoints(points)));
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
    var headFt = upper.at.h;
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
      headFt = affinityHead(hLower, hUpper, lowerDiameter, upper.imp.diameter_in, trimD);
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
      lowerDiameter: lowerDiameter,
      head_ft: headFt
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
      readings.push({ imp: imps[i], at: readingAt(imps[i].points, q) });
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
      if (!best || compareTrimFits(hit, best, h) < 0) best = hit;
    }
    if (best) return best;
    return minimumDiameterHit(readings, curve, q, h);
  }

  // The duty is under every drawn line. Keep the smallest digitized diameter
  // when that line still meets the head and one eighth smaller would not.
  // That diameter is not invented below the catalog, and a line that stays
  // above the duty even after an eighth-inch cut is not a match.
  function minimumDiameterHit(readings, curve, q, h) {
    var lowest = null;
    for (var i = 0; i < readings.length; i++) {
      if (!readings[i].at) continue;
      if (!lowest || readings[i].imp.diameter_in < lowest.imp.diameter_in) lowest = readings[i];
    }
    if (!lowest || lowest.at.h + 1e-6 < h) return null;
    var d = lowest.imp.diameter_in;
    var dDown = d - EIGHTH;
    if (dDown <= 0) return makeHit(curve, q, h, lowest, null);
    var hDown = lowest.at.h * (dDown * dDown) / (d * d);
    if (hDown + 1e-6 >= h) return null;
    return makeHit(curve, q, h, lowest, null);
  }

  /** Which trim to keep on one size. Closest trim that still meets the duty.
      Head differences inside the sheet-reading tolerance are the same fit.
      This does not order the list of sizes. */
  function compareTrimFits(a, b, dutyH) {
    var ea = a.head_ft - dutyH;
    var eb = b.head_ft - dutyH;
    var aMeets = ea >= -1e-6;
    var bMeets = eb >= -1e-6;
    if (aMeets !== bMeets) return aMeets ? -1 : 1;
    if (Math.abs(ea - eb) > CATALOG_FT) return aMeets ? ea - eb : eb - ea;
    if (Math.abs(a.endMargin - b.endMargin) > 1) return b.endMargin - a.endMargin;
    var size = String(a.curve.size).localeCompare(String(b.curve.size), undefined, { numeric: true });
    if (size) return size;
    if (a.curve.rpm !== b.curve.rpm) return a.curve.rpm - b.curve.rpm;
    return String(a.curve.model).localeCompare(String(b.curve.model));
  }

  // Where the requested flow sits on the catalog flow range of the impeller
  // that meets the duty. For a trim, that range is the overlap of the two
  // catalog lines the trim sits between. 0 is the left end, 1 is the right end.
  // A span of one point has no left or right, so it sits at the preferred place.
  function flowFraction(hit, q) {
    var span = hit.qMax - hit.qMin;
    if (!(span > 1e-9)) return 0.62;
    var f = (q - hit.qMin) / span;
    if (f < 0) return 0;
    if (f > 1) return 1;
    return f;
  }

  // Lower is a better seat. The preferred place is the middle-right of the
  // catalog flow range: from the middle of the curve through about three
  // quarters of the way to the end. Left of that is far from where best
  // efficiency would be. Past the right edge is the end of the curve.
  // The number is only a sort key. It is not efficiency, power, or NPSHr.
  function seatScore(fraction) {
    var lo = 0.5;
    var hi = 0.75;
    var at = 0.62;
    var outside = 0;
    if (fraction < lo) outside = lo - fraction;
    else if (fraction > hi) outside = fraction - hi;
    return outside * outside * 4 + Math.abs(fraction - at) * 0.02;
  }

  function sameCurveOrder(a, b) {
    var size = String(a.curve.size).localeCompare(String(b.curve.size), undefined, { numeric: true });
    if (size) return size;
    if (a.curve.rpm !== b.curve.rpm) return a.curve.rpm - b.curve.rpm;
    return String(a.curve.model).localeCompare(String(b.curve.model));
  }

  function specificGravity(duty, correction) {
    if (correction && correction.sg > 0) return correction.sg;
    // A mismatched single-point fluid has no specific gravity at the entered temperature.
    if (correction && correction.status === 'temperature') return null;
    if (!duty || duty.fluid == null || duty.fluid === '' || isWaterFluid(duty.fluid)) return 1;
    var rec = FLUIDS[canonicalFluid(duty.fluid)];
    return rec && rec.sg > 0 ? rec.sg : 1;
  }

  function viscosityCst(duty, correction) {
    if (correction && correction.nu > 0) return correction.nu;
    if (!duty || isWaterFluid(duty.fluid) || duty.fluid == null || duty.fluid === '') return 1;
    var rec = FLUIDS[duty.fluid];
    if (!rec || !(rec.sg > 0) || !(rec.visc > 0)) return null;
    return rec.visc / rec.sg;
  }

  // About 70 SSU. The sheets stop at that viscosity.
  var SSU_70_CST = 13.1;

  function efficiencyAt(curve, q, diameter) {
    var e = curve && curve.efficiency;
    var bep = curve && curve.bep;
    if (!e || !bep || !(e.qbep_gpm > 0) || !(bep.diameter_in > 0) || !(diameter > 0)) return null;
    var x = q / (e.qbep_gpm * diameter / bep.diameter_in);
    var eta = e.c0 + e.c1 * x + e.c2 * x * x + e.c3 * (diameter / bep.diameter_in);
    if (e.peak_pct && eta > e.peak_pct) eta = e.peak_pct;
    if (!(eta > 0)) return null;
    return eta;
  }

  function pctBep(curve, q, diameter) {
    var e = curve && curve.efficiency;
    var bep = curve && curve.bep;
    if (!e || !bep || !(e.qbep_gpm > 0) || !(diameter > 0)) return null;
    return 100 * q / (e.qbep_gpm * diameter / bep.diameter_in);
  }

  // preferred 70-120, allowable 50-130. Lower is a better seat inside a tie.
  function bepPenalty(pct) {
    if (pct == null) return 1000;
    if (pct >= 70 && pct <= 120) return 0;
    if (pct < 70) return 70 - pct;
    return pct - 120;
  }

  function bepZone(pct) {
    if (pct == null) return '';
    if (pct < 50) return 'low';
    if (pct < 70) return 'allowable';
    if (pct <= 120) return 'preferred';
    if (pct <= 130) return 'allowable';
    return 'high';
  }

  function brakeHorsepower(q, h, effPct, sg) {
    if (!(q > 0) || !(h > 0) || !(effPct > 0) || !(sg > 0)) return null;
    return q * h * sg / (3960 * (effPct / 100));
  }

  function motorHorsepower(bhp) {
    if (!(bhp > 0)) return null;
    for (var i = 0; i < MOTORS.length; i++) {
      if (MOTORS[i] + 1e-9 >= bhp) return MOTORS[i];
    }
    return null;
  }

  function npshrAt(curve, q) {
    var n = curve && curve.npshr_fit;
    if (!n) return null;
    // Do not extrapolate, and do not scale NPSHr from another speed.
    if (q < n.q_min - 1e-6 || q > n.q_max + 1e-6) return null;
    var knots = n.knots;
    if (knots && knots.length >= 2) {
      if (q <= knots[0].q) return knots[0].h;
      for (var i = 0; i < knots.length - 1; i++) {
        var a = knots[i];
        var b = knots[i + 1];
        if (q <= b.q + 1e-9) {
          var dx = b.q - a.q;
          var t = dx === 0 ? 0 : (q - a.q) / dx;
          var t2 = t * t;
          var t3 = t2 * t;
          return (2 * t3 - 3 * t2 + 1) * a.h +
            (t3 - 2 * t2 + t) * dx * a.m +
            (-2 * t3 + 3 * t2) * b.h +
            (t3 - t2) * dx * b.m;
        }
      }
      return knots[knots.length - 1].h;
    }
    var v = n.c0 + n.c1 * q + n.c2 * q * q;
    if (n.floor != null && v < n.floor) v = n.floor;
    if (v < 0) v = 0;
    return v;
  }

  function headOnTrim(hit, q) {
    if (!hit) return null;
    if (hit.kind !== 'trim') {
      var imp = null;
      (hit.curve.impellers || []).forEach(function (item) {
        if (item.diameter_in === hit.diameter_in) imp = item;
      });
      var on = imp && smoothHead(imp.points, q);
      return on ? on.h : null;
    }
    var upper = null;
    var lower = null;
    (hit.curve.impellers || []).forEach(function (item) {
      if (item.diameter_in === hit.upperDiameter) upper = item;
      if (item.diameter_in === hit.lowerDiameter) lower = item;
    });
    if (!upper || !lower) return null;
    var a = smoothHead(upper.points, q);
    var b = smoothHead(lower.points, q);
    if (!a || !b) return null;
    return affinityHead(b.h, a.h, hit.lowerDiameter, hit.upperDiameter, hit.diameter_in);
  }

  function impellerByDiameter(curve, diameter) {
    var found = null;
    (curve && curve.impellers || []).forEach(function (imp) {
      if (Math.abs(imp.diameter_in - diameter) < 1e-6) found = imp;
    });
    return found;
  }

  function impellerEndFlow(imp) {
    var fit = imp && imp.points && imp.points.fit;
    if (fit && fit.q1 > 0) return fit.q1;
    var pts = measuredPoints(imp && imp.points);
    return pts.length ? pts[pts.length - 1].q_gpm : null;
  }

  // End power of one printed impeller, at that line's own last flow.
  function printedEndPower(curve, imp, cq, ch, ceta, sg) {
    var q1 = impellerEndFlow(imp);
    if (!(q1 > 0)) return null;
    var sm = smoothHead(imp.points, q1);
    if (!sm || !(sm.h > 0)) return null;
    var effWater = efficiencyAt(curve, q1, imp.diameter_in);
    var eff = effWater == null ? null : effWater * ceta;
    return brakeHorsepower(q1 * cq, sm.h * ch, eff, sg);
  }

  // A printed line ends at its own last flow. An interpolated trim's end
  // power is the diameter blend of the two printed lines' own end powers.
  // The head curve still stops where those lines overlap.
  function endBrake(hit, cq, ch, ceta, sg) {
    if (hit.kind === 'trim' && hit.lowerDiameter != null && hit.upperDiameter != null) {
      var upper = impellerByDiameter(hit.curve, hit.upperDiameter);
      var lower = impellerByDiameter(hit.curve, hit.lowerDiameter);
      var pu = upper && printedEndPower(hit.curve, upper, cq, ch, ceta, sg);
      var pl = lower && printedEndPower(hit.curve, lower, cq, ch, ceta, sg);
      var span = hit.upperDiameter - hit.lowerDiameter;
      if (pu != null && pl != null && span > 0) {
        var t = (hit.diameter_in - hit.lowerDiameter) / span;
        return pl + (pu - pl) * t;
      }
    }
    var hEnd = headOnTrim(hit, hit.qMax);
    var effWater = efficiencyAt(hit.curve, hit.qMax, hit.diameter_in);
    var eff = effWater == null ? null : effWater * ceta;
    return hEnd == null ? null : brakeHorsepower(hit.qMax * cq, hEnd * ch, eff, sg);
  }

  function decorateHit(hit, q, sg, corr) {
    var cq = 1;
    var ch = 1;
    var ceta = 1;
    if (corr && corr.applied) {
      if (corr.CQ > 0) cq = corr.CQ;
      if (corr.CH > 0) ch = corr.CH;
      if (corr.Ceta > 0) ceta = corr.Ceta;
    }
    var pct = pctBep(hit.curve, q, hit.diameter_in);
    var effWater = efficiencyAt(hit.curve, q, hit.diameter_in);
    var eff = effWater == null ? null : effWater * ceta;
    var power = brakeHorsepower(q * cq, hit.head_ft * ch, eff, sg);
    var powerEnd = endBrake(hit, cq, ch, ceta, sg);
    var powerMax = power;
    if (powerEnd != null && (powerMax == null || powerEnd > powerMax)) powerMax = powerEnd;
    hit.pct_bep = pct;
    hit.bep_zone = bepZone(pct);
    hit.efficiency_pct = eff;
    hit.cq = cq;
    hit.ch = ch;
    hit.ceta = ceta;
    hit.bhp = power;
    hit.bhp_end = powerEnd;
    hit.bhp_max = powerMax;
    hit.motor_hp = motorHorsepower(powerMax);
    hit.npshr_ft = npshrAt(hit.curve, q);
    hit.head_end_ft = headOnTrim(hit, hit.qMax);
    hit.notes = [];
    return hit;
  }

  /** Lower return means a ranks first. Order is efficiency. Within half a
      point, a duty inside 70-120 percent of BEP ranks ahead of one outside it. */
  function compareSelections(a, b) {
    var ea = a.efficiency_pct;
    var eb = b.efficiency_pct;
    if (ea == null && eb == null) return sameCurveOrder(a, b);
    if (ea == null) return 1;
    if (eb == null) return -1;
    // A real efficiency lead wins. The BEP window only breaks a near tie.
    if (Math.abs(ea - eb) <= 0.5) {
      var da = bepPenalty(a.pct_bep);
      var db = bepPenalty(b.pct_bep);
      if (Math.abs(da - db) > 0.2) return da - db;
    }
    if (Math.abs(ea - eb) > 0.05) return eb - ea;
    return sameCurveOrder(a, b);
  }

  function attachFits(catalog) {
    (catalog.curves || []).forEach(function (curve) {
      (curve.impellers || []).forEach(function (imp) {
        if (imp.fit && imp.points) imp.points.fit = imp.fit;
      });
    });
  }

  /** Dense samples of one sold diameter. Printed lines use their polynomial.
      A trim uses D squared between the two smoothed lines that bracket it. */
  function diameterSamples(curve, diameter, n) {
    attachFits({ curves: [curve] });
    var imps = (curve.impellers || []).slice().sort(function (a, b) {
      return a.diameter_in - b.diameter_in;
    });
    var count = n || 80;
    var exact = null;
    imps.forEach(function (imp) {
      if (Math.abs(imp.diameter_in - diameter) < 1e-6) exact = imp;
    });
    function span(imp) {
      var fit = imp.points && imp.points.fit;
      if (fit) return [fit.q0, fit.q1];
      var pts = measuredPoints(imp.points);
      if (!pts.length) return null;
      return [pts[0].q_gpm, pts[pts.length - 1].q_gpm];
    }
    function at(imp, q) {
      var sm = smoothHead(imp.points, q);
      return sm ? sm.h : null;
    }
    if (exact) {
      var ends = span(exact);
      if (!ends) return [];
      var out = [];
      for (var i = 0; i <= count; i++) {
        var q = ends[0] + (ends[1] - ends[0]) * i / count;
        var h = at(exact, q);
        if (h != null) out.push({ q: q, h: h });
      }
      return out;
    }
    var lo = null;
    var hi = null;
    for (var j = 0; j < imps.length - 1; j++) {
      if (imps[j].diameter_in < diameter - 1e-6 && imps[j + 1].diameter_in > diameter + 1e-6) {
        lo = imps[j];
        hi = imps[j + 1];
      }
    }
    if (!lo || !hi) return [];
    var a = span(lo);
    var b = span(hi);
    if (!a || !b) return [];
    var q0 = Math.max(a[0], b[0]);
    var q1 = Math.min(a[1], b[1]);
    if (!(q1 > q0)) return [];
    var trim = [];
    var prev = 1e9;
    for (var k = 0; k <= count; k++) {
      var qq = q0 + (q1 - q0) * k / count;
      var hl = at(lo, qq);
      var hh = at(hi, qq);
      if (hl == null || hh == null) continue;
      var hv = affinityHead(hl, hh, lo.diameter_in, hi.diameter_in, diameter);
      if (hv > prev) hv = prev;
      prev = hv;
      trim.push({ q: qq, h: hv });
    }
    return trim;
  }

  function blockedResult(message, correction) {
    return {
      covered: false,
      blocked: true,
      message: message,
      selections: [],
      pick: null,
      matchCount: 0,
      matches: [],
      correction: correction || {},
      warnings: []
    };
  }

  function uniqueText(list) {
    var out = [];
    list.forEach(function (item) {
      if (item && out.indexOf(item) < 0) out.push(item);
    });
    return out;
  }

  // Dean C-1.4.42 and C-1.4.46. The minimum is -20 °F where Dean lists one.
  function frameBounds(frame) {
    if (frame === 'RWA2096') return { min: -20, max: 320, name: 'RWA2096' };
    if (frame === 'RWA4166' || frame === 'RWA4206') return { min: -20, max: 400, name: frame };
    if (frame && frame.indexOf('RWA') === 0) return { min: -20, max: 400, name: frame };
    if (frame && frame.indexOf('RA') === 0) return { min: -20, max: 650, name: frame };
    return null;
  }

  function frameBlock(frame, tempF) {
    var bounds = frameBounds(frame);
    if (!bounds || tempF == null || !isFinite(tempF)) return '';
    if (tempF > bounds.max + 1e-6) return bounds.name + ' is limited to ' + degF(bounds.max);
    if (tempF < bounds.min - 1e-6) return bounds.name + ' is not rated below −20 °F.';
    return '';
  }

  function limitId(id) {
    id = canonicalFluid(id);
    if (!id || isWaterFluid(id)) return 'water';
    return id;
  }

  function fluidName(id) {
    id = limitId(id);
    if (id === 'water') return 'Water';
    var curve = FLUID_CURVES[id];
    if (curve && curve.name) return curve.name;
    var rec = FLUIDS[id];
    return rec && rec.name ? rec.name : String(id);
  }

  function tableEnds(id) {
    var curve = FLUID_CURVES[id];
    if (!curve || !curve.points || !curve.points.length) return null;
    return { lo: curve.points[0][0], hi: curve.points[curve.points.length - 1][0] };
  }

  function lowestValidF(id) {
    id = limitId(id);
    if (id === 'water') return 32;
    var ends = tableEnds(id);
    var lim = FLUID_LIMITS[id] || {};
    var lo = ends ? ends.lo : null;
    if (lim.freezeF != null) lo = lo == null ? lim.freezeF : Math.max(lo, lim.freezeF);
    if (lim.crystallizeF != null) lo = lo == null ? lim.crystallizeF : Math.max(lo, lim.crystallizeF);
    if (lim.pourF != null) lo = lo == null ? lim.pourF : Math.max(lo, lim.pourF);
    if (lim.minUseF != null) lo = lo == null ? lim.minUseF : Math.max(lo, lim.minUseF);
    return lo;
  }

  // Refuse a temperature the fluid is not published for. No clamping.
  function fluidBlock(id, tempF) {
    if (tempF == null || !isFinite(tempF)) return { blocked: false, warn: '' };
    id = limitId(id);
    var name = fluidName(id);
    var lim = FLUID_LIMITS[id] || {};
    if (id === 'water' && tempF > 400 + 1e-6) {
      return { blocked: true, message: 'No property data for water above 400 °F.' };
    }
    if (lim.freezeF != null && tempF < lim.freezeF - 1e-6) {
      return { blocked: true, message: name + ' freezes at ' + degF(lim.freezeF) };
    }
    if (lim.crystallizeF != null && tempF < lim.crystallizeF - 1e-6) {
      return { blocked: true, message: name + ' crystallizes at ' + degF(lim.crystallizeF) };
    }
    if (lim.pourF != null && tempF < lim.pourF - 1e-6) {
      return { blocked: true, message: name + ' is below its pour point of ' + degF(lim.pourF) };
    }
    if (lim.minUseF != null && tempF < lim.minUseF - 1e-6) {
      return { blocked: true, message: name + ' is not rated below ' + degF(lim.minUseF) };
    }
    if (lim.blockAboveF != null && tempF > lim.blockAboveF + 1e-6) {
      return { blocked: true, message: name + ' is not rated above ' + degF(lim.blockAboveF) };
    }
    var ends = tableEnds(id);
    if (ends && (tempF < ends.lo - 1e-6 || tempF > ends.hi + 1e-6)) {
      if (id === 'mineralOil100') {
        return { blocked: true, message: 'No viscosity data for mineral oil at ' + degF(tempF) };
      }
      var side = tempF < ends.lo ? 'below ' + degF(ends.lo) : 'above ' + degF(ends.hi);
      return { blocked: true, message: 'No property data for ' + name + ' ' + side };
    }
    var warn = '';
    if (lim.warnAboveF != null && tempF > lim.warnAboveF + 1e-6 && !(tempF > lim.blockAboveF + 1e-6)) {
      warn = 'Above ' + degF(lim.warnAboveF) + ', ' + name +
        ' is past its recommended bulk temperature (' + degF(lim.warnAboveF) +
        '). Extended use is allowed to ' + degF(lim.blockAboveF);
    }
    return { blocked: false, warn: warn };
  }

  function vaporAt(id, tempF) {
    id = limitId(id);
    var series = FLUID_VAPOR[id];
    var pts = series && series.points;
    if (!pts || !pts.length || tempF == null || !isFinite(tempF)) return null;
    if (tempF < pts[0][0] - 1e-6 || tempF > pts[pts.length - 1][0] + 1e-6) return null;
    var i = 0;
    while (i < pts.length - 1 && pts[i + 1][0] < tempF - 1e-9) i++;
    var a = pts[i];
    var b = pts[Math.min(i + 1, pts.length - 1)];
    var span = b[0] - a[0];
    var u = span ? (tempF - a[0]) / span : 0;
    return a[1] + (b[1] - a[1]) * u;
  }

  function atmosphericBoilF(id) {
    id = limitId(id);
    var series = FLUID_VAPOR[id];
    var pts = series && series.points;
    if (!pts) return null;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i - 1][1] < ATM_PSIA && pts[i][1] >= ATM_PSIA) {
        var span = pts[i][1] - pts[i - 1][1];
        var u = span ? (ATM_PSIA - pts[i - 1][1]) / span : 0;
        return pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u;
      }
    }
    return null;
  }

  function numberOrNull(value) {
    if (value == null || value === '' || !isFinite(Number(value))) return null;
    return Number(value);
  }

  function suctionGiven(duty) {
    return numberOrNull(duty && duty.npsha) != null || numberOrNull(duty && duty.psig) != null;
  }

  function boilingMessage(id, tempF, duty) {
    var boil = atmosphericBoilF(id);
    if (boil == null || tempF == null || tempF + 1e-6 < boil) return '';
    if (suctionGiven(duty)) return '';
    return fluidName(id) + ' boils near ' + degF(Math.round(boil)) +
      ' at atmospheric pressure. Enter a suction pressure or NPSHa.';
  }

  function availableNpsha(duty, id, tempF, sg) {
    var given = numberOrNull(duty && duty.npsha);
    if (given != null) return given;
    var psig = numberOrNull(duty && duty.psig);
    var vapor = vaporAt(id, tempF);
    if (psig == null || vapor == null || !(sg > 0)) return null;
    return (psig + ATM_PSIA - vapor) * 2.31 / sg;
  }

  function propertiesAt(id, tempF) {
    id = limitId(id);
    if (fluidBlock(id, tempF).blocked) return null;
    if (id === 'water') {
      var water = waterProperties(tempF);
      if (!water || water.clamped) return null;
      return { sg: water.sg, nu: water.visc / water.sg };
    }
    var curve = FLUID_CURVES[id];
    if (curve) {
      var props = sampleCurve(curve, tempF);
      if (props.flags && props.flags.length) return null;
      return { sg: props.sg, nu: props.nu };
    }
    var rec = FLUIDS[id];
    if (rec && rec.sg > 0 && rec.visc > 0 && temperatureMatches(rec, tempF, 'F')) {
      return { sg: rec.sg, nu: rec.visc / rec.sg };
    }
    return null;
  }

  function startupTemperature(duty, id) {
    var raw = duty && (duty.t_start != null ? duty.t_start : duty.tStart);
    var entered = numberOrNull(raw);
    if (entered != null) entered = toFahrenheit(entered, duty.unit === 'C' ? 'C' : 'F');
    var floor = lowestValidF(id);
    if (entered == null) {
      var fallback = 70;
      if (floor != null && floor > fallback) fallback = floor;
      return { f: fallback };
    }
    var gate = fluidBlock(id, entered);
    if (gate.blocked) return { blocked: true, message: gate.message };
    return { f: entered };
  }

  function coldPower(hit, qVis, hVis, nu, sg) {
    var hi = hiPreliminary(qVis, hVis, nu);
    if (hi.range === 'high') return { range: 'high', B: hi.B };
    var cq = hi.CQ > 0 ? hi.CQ : 1;
    var ch = hi.CH > 0 ? hi.CH : 1;
    var ceta = hi.Ceta > 0 ? hi.Ceta : 1;
    var made = headOnTrim(hit, hi.qWater);
    var head = made > 0 ? made : hVis;
    var effWater = efficiencyAt(hit.curve, hi.qWater, hit.diameter_in);
    var eff = effWater == null ? null : effWater * ceta;
    return {
      range: hi.range,
      bhp: brakeHorsepower(hi.qWater * cq, head * ch, eff, sg),
      end: endBrake(hit, cq, ch, ceta, sg),
      B: hi.B
    };
  }

  // One quieter pass at the water best-efficiency point. It can raise power.
  // It does not pick a new trim.
  function applyBepPower(hit, qWater, nu, sg) {
    var e = hit.curve && hit.curve.efficiency;
    var bep = hit.curve && hit.curve.bep;
    if (!e || !bep || !(e.qbep_gpm > 0) || !(bep.diameter_in > 0) || !(nu > 1)) return false;
    var qBep = e.qbep_gpm * hit.diameter_in / bep.diameter_in;
    var hBep = headOnTrim(hit, qBep);
    if (!(qBep > 0) || !(hBep > 0)) return false;
    var hi = hiPreliminary(qBep, hBep, nu);
    if (hi.range !== 'ok' || !(hi.Ceta > 0) || !(hit.ceta > 0) || hi.Ceta >= hit.ceta - 1e-9) return false;
    var before = hit.motor_hp;
    var effWater = efficiencyAt(hit.curve, qWater, hit.diameter_in);
    var eff = effWater == null ? null : effWater * hi.Ceta;
    var power = brakeHorsepower(qWater * hi.CQ, hit.head_ft * hi.CH, eff, sg);
    var powerEnd = endBrake(hit, hi.CQ, hi.CH, hi.Ceta, sg);
    if (power != null) hit.bhp = power;
    if (powerEnd != null) hit.bhp_end = powerEnd;
    var powerMax = hit.bhp;
    if (hit.bhp_end != null && (powerMax == null || hit.bhp_end > powerMax)) powerMax = hit.bhp_end;
    hit.bhp_max = powerMax;
    hit.motor_hp = motorHorsepower(powerMax);
    hit.cq = hi.CQ;
    hit.ch = hi.CH;
    hit.ceta = hi.Ceta;
    return hit.motor_hp != null && before != null && hit.motor_hp > before;
  }

  function finishHit(hit, duty, correction, qVis, hVis, qWater) {
    var id = canonicalFluid(duty && duty.fluid);
    if (!id) id = 'water';
    var nu = correction && correction.nu;
    var sg = correction && correction.sg;
    if (applyBepPower(hit, qWater, nu, sg)) {
      hit.notes.push('Power uses the Hydraulic Institute correction at best efficiency.');
    }
    var start = startupTemperature(duty, id);
    var operating = correction && correction.temp;
    if (!start.blocked && start.f != null && operating != null && Math.abs(start.f - operating) > 0.5) {
      var coldProps = propertiesAt(id, start.f);
      if (coldProps && coldProps.nu > 0 && coldProps.sg > 0) {
        var cold = coldPower(hit, qVis, hVis, coldProps.nu, coldProps.sg);
        hit.startup_f = start.f;
        if (cold.range === 'high') {
          hit.notes.push('Cold start at ' + degF(start.f) +
            ' is outside the Hydraulic Institute correction (B = ' + formatB(cold.B) +
            '). Warm the fluid, bypass, or use a VFD.');
        } else {
          if (cold.bhp != null && (hit.bhp_max == null || cold.bhp > hit.bhp_max)) {
            hit.bhp_max = cold.bhp;
            hit.motor_hp = motorHorsepower(hit.bhp_max);
          }
          hit.bhp_cold = cold.bhp;
          hit.bhp_cold_end = cold.end;
          if (cold.end != null && hit.motor_hp != null && cold.end > hit.motor_hp + 1e-6) {
            hit.notes.push('Cold start at ' + degF(start.f) +
              ' needs more power than this motor at the end of the curve. Warm the fluid, bypass, or use a VFD.');
          }
        }
      }
    }
    if (hit.motor_hp && hit.bhp_max >= hit.motor_hp * 0.98 - 1e-9) {
      hit.notes.push('Power is within 2% of the ' + formatDutyNum(hit.motor_hp) + ' hp step.');
    }
    var npsha = availableNpsha(duty, id, operating, sg);
    if (npsha != null && hit.npshr_ft > 0) {
      var need = Math.max(hit.npshr_ft + 3, 1.1 * hit.npshr_ft);
      hit.npsha_ft = npsha;
      if (npsha + 1e-6 < need) {
        hit.notes.push('NPSHa is below the margin. It should be at least ' + formatDutyNum(need) + ' ft.');
      }
    }
    return hit;
  }

  function select(catalog, duty) {
    duty = duty || {};
    attachFits(catalog);
    var frame = duty.frame == null ? '' : String(duty.frame).trim();
    if (frame === 'RA3246') return blockedResult('Curves for RA3246 are coming.');
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    var correction = correctDuty(duty);
    if (correction && correction.blocked) return blockedResult(correction.message, correction);
    var startGate = startupTemperature(duty, canonicalFluid(duty.fluid) || 'water');
    if (startGate.blocked) return blockedResult(startGate.message, correction);
    var qUse = q;
    var hUse = h;
    if (correction.applied) {
      qUse = correction.qWater;
      hUse = correction.hWater;
    }
    var rpm = duty.rpm == null || duty.rpm === '' ? null : Number(duty.rpm);
    var service = normalizeService(duty.service);
    var sg = specificGravity(duty, correction);
    var tempF = correction && correction.temp != null ? correction.temp : enteredFahrenheit(duty);
    if (frame) {
      var framed = frameBlock(frame, tempF);
      if (framed) return blockedResult(framed, correction);
    }
    var found = [];
    var omitted = [];
    (catalog.curves || []).forEach(function (curve) {
      var view = presentCurve(curve, service);
      if (!view) return;
      if (rpm != null && Number(view.rpm) !== rpm) return;
      if (frame && view.frame !== frame) return;
      if (!frame) {
        var skip = frameBlock(view.frame, tempF);
        if (skip) {
          omitted.push(skip);
          return;
        }
      }
      var hit = evaluateCurve(view, qUse, hUse);
      if (!hit) return;
      decorateHit(hit, qUse, sg, correction);
      var pct = hit.pct_bep;
      if (pct != null && (pct < 20 || pct > 150)) return;
      finishHit(hit, duty, correction, q, h, qUse);
      found.push(hit);
    });
    if (!found.length && omitted.length) return blockedResult(uniqueText(omitted).join(' '), correction);
    found.sort(function (a, b) { return compareSelections(a, b); });
    var warnings = [];
    if (correction && correction.warn) warnings.push(correction.warn);
    uniqueText(omitted).forEach(function (message) {
      warnings.push(message.replace(' is ', ' is left off. It is ').replace('..', '.'));
    });
    return {
      covered: found.length > 0,
      blocked: false,
      message: '',
      selections: found,
      pick: found[0] || null,
      matchCount: found.length,
      matches: found,
      correction: correction,
      warnings: warnings
    };
  }

  // Head used for selection is the smooth curve. The inferred flag still
  // comes from the catalog segment, not from an interpolated sample.
  function readingAt(points, q) {
    var linear = headAt(points, q);
    var smooth = smoothHead(points, q);
    if (!linear || !smooth) return null;
    return {
      h: smooth.h,
      inferred: !!linear.inferred,
      qMin: smooth.qMin,
      qMax: smooth.qMax
    };
  }

  var CATALOG_LIMIT_NOTE = 'This catalog does not include pumps larger than 10 in, so a better Dean size may still exist above 10 in.';
  var RANK_NOTE = 'The list is ordered by efficiency. 70 to 120 percent of BEP is preferred. 50 to 130 percent is allowable. Below 50 percent of BEP is flagged, because low flow adds heat. A size outside 20 to 150 percent of BEP is not listed.';
  var SHARED_CURVE_NOTE = 'RA and RWA share the same head-capacity curve.';
  var VISCOSITY_NOTE = 'Dean sheets are drawn to 70 SSU. Above that, the Hydraulic Institute correction applies and the result is not a sheet reading.';
  var NPSH_MARGIN_NOTE = 'For a hot liquid near its vapor pressure, keep NPSH available at least 3 to 5 ft above NPSHr, or about 1.1 to 1.3 times NPSHr, whichever is larger.';
  var MOTORS = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500];

  function normalizeSize(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
  }

  // Duty-specific IntelliQuip values Blake supplied. Not a curve-sheet reading.
  // A record applies only to that size, speed, and duty. Other fluids do not use it.
  function intelliquipFor(records, curve, duty) {
    if (!curve || !duty) return null;
    if (duty.fluid && String(duty.fluid) !== 'water') return null;
    var list = records && records.records ? records.records : records;
    if (!list || !list.length) return null;
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    var size = normalizeSize(curve.size);
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec || normalizeSize(rec.size) !== size) continue;
      if (Number(rec.rpm) !== Number(curve.rpm)) continue;
      if (Math.abs(Number(rec.q_gpm) - q) > 0.05) continue;
      if (Math.abs(Number(rec.h_ft) - h) > 0.05) continue;
      return rec;
    }
    return null;
  }

  function formatFt(h) {
    var n = Math.round(Number(h) * 10) / 10;
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(1);
  }

  function formatGpm(q) {
    var n = Math.round(Number(q) * 10) / 10;
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(1);
  }

  // Where the duty sits on this catalog curve. Not an efficiency statement.
  function dutySeat(hit, q, h) {
    if (!hit) return '';
    var head = hit.head_ft;
    var above = head - h;
    var rel;
    if (above >= -0.05) {
      rel = Math.abs(above) < 0.05 ? 'level with the duty' : formatFt(above) + ' ft above the duty';
    } else {
      rel = formatFt(-above) + ' ft below the duty, inside the 3 ft sheet-reading tolerance';
    }
    var end = formatGpm(hit.endMargin) + ' gpm left before the curve ends';
    // The row already names the diameter with impellerLabel(), so this line only
    // says where the duty sits on that line and does not repeat the trim.
    if (hit.kind === 'catalog') {
      return 'At ' + formatGpm(q) + ' gpm the catalog line is ' + formatFt(head) + ' ft, ' + rel + ', with ' + end + '.';
    }
    return 'At ' + formatGpm(q) + ' gpm the trim is ' + formatFt(head) + ' ft, ' + rel + ', with ' + end + '.';
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

  function degF(n) {
    return formatDutyNum(n).replace(/^-/, '−') + ' °F';
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
      return { B: B, CQ: 1, CH: 1, Ceta: 1, qWater: q, hWater: h, range: 'low' };
    }
    if (B >= 40) {
      return { B: B, CQ: null, CH: null, Ceta: null, qWater: null, hWater: null, range: 'high' };
    }
    var logB = Math.log(B) / Math.LN10;
    var CQ = Math.pow(2.71, -0.165 * Math.pow(logB, 3.15));
    // ANSI/HI 9.6.7-2004 equation 7. Cη = 1 when B is 1 or less.
    var Ceta = Math.pow(B, -(0.0547 * Math.pow(B, 0.69)));
    return { B: B, CQ: CQ, CH: CQ, Ceta: Ceta, qWater: q / CQ, hWater: h / CQ, range: 'ok' };
  }

  function propertyClause(rec, nu) {
    return 'Viscosity ' + formatMu(rec.visc) + ' cP and specific gravity ' + formatSg(rec.sg) +
      ' (' + formatNu(nu) + ' cSt) at ' + formatStoredTemp(rec) + '. ';
  }

  // Saturated liquid water from 32 °F through 400 °F.
  // Density is IAPWS R7-97(2012), the industrial formulation, saturated liquid.
  // Viscosity is IAPWS R12-08. Specific gravity is that density in g/cm³.
  // 400 °F is the RWA4166 and RWA4206 pumping limit, and 320 °F is the
  // RWA2096 limit (Dean bulletin C-1.4.46). A temperature outside the table
  // stays on the nearest end. It is not extended past the RWA limit.
  var WATER_SAT_F = [
    [32, 0.999793, 1.7920],
    [40, 0.999924, 1.5453],
    [50, 0.999654, 1.3060],
    [60, 0.998969, 1.1211],
    [68, 0.998161, 1.0016],
    [80, 0.996564, 0.8572],
    [100, 0.993013, 0.6809],
    [120, 0.988507, 0.5569],
    [140, 0.983175, 0.4660],
    [160, 0.977111, 0.3975],
    [176, 0.971779, 0.3540],
    [200, 0.963039, 0.3026],
    [212, 0.958354, 0.2816],
    [230, 0.950950, 0.2546],
    [250, 0.942207, 0.2298],
    [275, 0.930535, 0.2045],
    [302, 0.917007, 0.1826],
    [320, 0.907451, 0.1704],
    [340, 0.896316, 0.1587],
    [356, 0.887005, 0.1504],
    [380, 0.872335, 0.1395],
    [400, 0.859427, 0.1315]
  ];

  function waterProperties(tempF) {
    var t = Number(tempF);
    if (!isFinite(t)) return null;
    var clamped = '';
    if (t < WATER_SAT_F[0][0]) {
      t = WATER_SAT_F[0][0];
      clamped = 'low';
    }
    var last = WATER_SAT_F[WATER_SAT_F.length - 1];
    if (t > last[0]) {
      t = last[0];
      clamped = 'high';
    }
    var i = 0;
    while (i < WATER_SAT_F.length - 1 && WATER_SAT_F[i + 1][0] < t - 1e-9) i++;
    var a = WATER_SAT_F[i];
    var b = WATER_SAT_F[Math.min(i + 1, WATER_SAT_F.length - 1)];
    var span = b[0] - a[0];
    var u = span ? (t - a[0]) / span : 0;
    return {
      f: t,
      sg: a[1] + (b[1] - a[1]) * u,
      visc: a[2] + (b[2] - a[2]) * u,
      clamped: clamped
    };
  }

  function waterDuty(duty, rec) {
    var entered = duty.temp != null && duty.temp !== '' && isFinite(Number(duty.temp));
    if (!entered) {
      var storedNu = rec.visc / rec.sg;
      return {
        status: 'water',
        applied: false,
        note: AMBIENT,
        sg: rec.sg,
        visc: rec.visc,
        nu: storedNu,
        name: rec.name || 'Water'
      };
    }
    var unit = duty.unit === 'C' ? 'C' : 'F';
    var enteredF = toFahrenheit(Number(duty.temp), unit);
    var gate = fluidBlock('water', enteredF);
    if (gate.blocked) {
      return { status: 'blocked', blocked: true, message: gate.message, name: 'Water', temp: enteredF, unit: 'F' };
    }
    var boil = boilingMessage('water', enteredF, duty);
    var props = waterProperties(enteredF);
    var nu = props.visc / props.sg;
    var note = AMBIENT + ' Specific gravity ' + formatSg(props.sg) + ' and viscosity ' +
      formatMu(props.visc) + ' cP (' + formatNu(nu) + ' cSt) from saturated liquid water at ' +
      formatDutyNum(props.f) + ' °F.';
    return {
      status: 'water',
      applied: false,
      note: note,
      warn: boil,
      sg: props.sg,
      visc: props.visc,
      nu: nu,
      temp: props.f,
      unit: 'F',
      clamped: '',
      name: 'Water'
    };
  }

  function resultsSummary(name, tempText, correction) {
    var line = String(name || '') + ', ' + String(tempText || '');
    if (correction && correction.sg > 0 && correction.status === 'water') {
      line += ', SG ' + formatSg(correction.sg);
    } else if (correction && correction.sg > 0 && correction.nu > 0) {
      line += ', SG ' + formatSg(correction.sg) + ', ' + formatNu(correction.nu) + ' cSt';
    }
    return line;
  }

  // NPSHr stays the curve reading in feet. The margin note names the specific
  // gravity used for power, so a hot-water result does not still read as cold water.
  function npshNote(correction) {
    if (!correction || correction.status !== 'water' || !(correction.sg > 0)) return '';
    if (!(correction.temp >= 200)) return '';
    return NPSH_MARGIN_NOTE + ' Specific gravity used for power is ' + formatSg(correction.sg) + '.';
  }

  function canonicalFluid(fluid) {
    var id = String(fluid || '');
    return FLUID_ALIAS[id] || id;
  }

  // Dean bulletin C-1.4.42: RA frames to 650 °F. Bulletin C-1.4.46: RWA4166 and
  // RWA4206 to 400 °F, RWA2096 to 320 °F.
  function seriesLimit(duty) {
    var service = normalizeService(duty && duty.service);
    var frame = String((duty && duty.frame) || '');
    if (service === 'rwa' || frame.indexOf('RWA') === 0) {
      if (frame === 'RWA2096') return { f: 320, name: 'RWA2096' };
      return { f: 400, name: frame.indexOf('RWA') === 0 ? frame : 'RWA' };
    }
    return { f: 650, name: frame.indexOf('RA') === 0 ? frame : 'RA' };
  }

  function enteredFahrenheit(duty) {
    if (!duty || duty.temp == null || duty.temp === '' || !isFinite(Number(duty.temp))) return null;
    return toFahrenheit(Number(duty.temp), duty.unit === 'C' ? 'C' : 'F');
  }

  function sampleCurve(curve, tempF) {
    var pts = curve.points;
    var used = tempF;
    var flags = [];
    if (used < pts[0][0]) {
      used = pts[0][0];
      flags.push('table-low');
    }
    var hot = pts[pts.length - 1][0];
    if (used > hot) {
      used = hot;
      flags.push('table-high');
    }
    if (curve.maxUseF != null && used > curve.maxUseF) {
      used = curve.maxUseF;
      flags.push('fluid-max');
    }
    if (used < pts[0][0]) used = pts[0][0];
    var i = 0;
    while (i < pts.length - 1 && pts[i + 1][0] < used - 1e-9) i++;
    var a = pts[i];
    var b = pts[Math.min(i + 1, pts.length - 1)];
    var span = b[0] - a[0];
    var u = span ? (used - a[0]) / span : 0;
    var sg = a[1] + (b[1] - a[1]) * u;
    var nu = (span && a[2] > 0 && b[2] > 0)
      ? Math.exp(Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * u)
      : a[2];
    return { sg: sg, nu: nu, visc: nu * sg, f: used, flags: flags };
  }

  function clampNote(props, series) {
    var bits = [];
    if (props.flags.indexOf('table-low') >= 0) {
      bits.push('The entered temperature is below the published table, so properties are held at ' + formatDutyNum(props.f) + ' °F.');
    }
    if (props.flags.indexOf('table-high') >= 0) {
      bits.push('The entered temperature is above the published table, so properties are held at ' + formatDutyNum(props.f) + ' °F.');
    }
    if (props.flags.indexOf('fluid-max') >= 0) {
      bits.push('The entered temperature is above this fluid\'s maximum use temperature, so properties are held at ' + formatDutyNum(props.f) + ' °F.');
    }
    if (props.flags.indexOf('series') >= 0) {
      bits.push('The entered temperature is above the ' + series.name + ' pumping limit of ' + formatDutyNum(series.f) + ' °F, so properties are held there.');
    }
    return bits.join(' ');
  }

  function curveDuty(duty, curve) {
    var entered = enteredFahrenheit(duty);
    var tempF = entered == null ? 68 : entered;
    var gate = fluidBlock(canonicalFluid(duty.fluid), tempF);
    if (gate.blocked) {
      return {
        status: 'blocked', blocked: true, message: gate.message, name: curve.name,
        temp: tempF, unit: 'F', source: curve.source, flags: []
      };
    }
    var boil = boilingMessage(canonicalFluid(duty.fluid), tempF, duty);
    if (boil && !isWaterFluid(duty.fluid)) {
      return {
        status: 'blocked', blocked: true, message: boil, name: curve.name,
        temp: tempF, unit: 'F', source: curve.source, flags: []
      };
    }
    var props = sampleCurve(curve, tempF);
    var nu = props.nu;
    var base = AMBIENT + ' Hydraulic Institute correction of the catalog water curve (ANSI/HI 9.6.7), not a Dean sheet. ' +
      curve.name + ' at ' + formatDutyNum(props.f) + ' °F: specific gravity ' + formatSg(props.sg) +
      ' and viscosity ' + formatMu(props.visc) + ' cP (' + formatNu(nu) + ' cSt). ';
    var bag = {
      sg: props.sg, visc: props.visc, nu: nu, temp: props.f, unit: 'F', name: curve.name,
      flags: props.flags, source: curve.source, warn: gate.warn || ''
    };
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    if (!(q > 0) || !(h > 0)) {
      return Object.assign({ status: 'ready', applied: false, note: base + DISCLAIMER }, bag);
    }
    var hi = hiPreliminary(q, h, nu);
    if (hi.range === 'high') {
      return {
        status: 'blocked', blocked: true, applied: false, B: hi.B, name: curve.name, temp: props.f,
        message: 'This viscosity is outside the Hydraulic Institute correction (B = ' + formatB(hi.B) +
          '). A positive-displacement pump is the usual choice.'
      };
    }
    if (hi.range === 'low') {
      return Object.assign({
        status: 'unchanged', applied: false, B: hi.B, CQ: 1, CH: 1, Ceta: 1, qWater: q, hWater: h,
        note: base + 'Parameter B is ' + formatB(hi.B) + ', so corrected head, flow, and efficiency stay on the catalog water curve. ' + DISCLAIMER
      }, bag);
    }
    return Object.assign({
      status: 'corrected', applied: true, B: hi.B, CQ: hi.CQ, CH: hi.CH, Ceta: hi.Ceta,
      qWater: hi.qWater, hWater: hi.hWater,
      note: base + 'Corrected flow ' + formatDutyNum(hi.qWater) + ' gpm (CQ = ' + formatFactor(hi.CQ) +
        '), corrected head ' + formatDutyNum(hi.hWater) + ' ft (CH = ' + formatFactor(hi.CH) +
        '), and efficiency factor Cη = ' + formatFactor(hi.Ceta) +
        ', from parameter B = ' + formatB(hi.B) + '. ' + DISCLAIMER
    }, bag);
  }

  function correctDuty(duty) {
    duty = duty || {};
    var fluid = canonicalFluid(duty.fluid);
    if (fluid == null || fluid === '' || isWaterFluid(fluid)) {
      var waterRec = FLUIDS[fluid] || FLUIDS.water;
      return waterDuty(duty, waterRec);
    }
    if (FLUID_CURVES[fluid]) return curveDuty(duty, FLUID_CURVES[fluid]);
    var rec = FLUIDS[fluid];
    if (!rec || rec.sg == null || rec.visc == null || !(rec.sg > 0) || !(rec.visc > 0)) {
      return {
        status: 'blocked',
        blocked: true,
        message: 'No property data for ' + ((rec && rec.name) || 'this fluid') + '.'
      };
    }
    if (!temperatureMatches(rec, duty.temp, duty.unit)) {
      return {
        status: 'blocked',
        blocked: true,
        name: rec.name,
        message: 'No property data for ' + rec.name + ' at ' + formatDutyNum(enteredFahrenheit(duty)) + ' °F.'
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
        status: 'blocked',
        blocked: true,
        applied: false,
        B: hi.B,
        message: 'This viscosity is outside the Hydraulic Institute correction (B = ' + formatB(hi.B) +
          '). A positive-displacement pump is the usual choice.'
      }, props);
    }
    if (hi.range === 'low') {
      return Object.assign({
        status: 'unchanged',
        applied: false,
        B: hi.B,
        CQ: 1,
        CH: 1,
        Ceta: 1,
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
      Ceta: hi.Ceta,
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
    return formatDia(hit.diameter_in) + ' in';
  }

  function formatDia(d) {
    var eighths = Math.round(d / EIGHTH);
    var millis = Math.round(eighths * EIGHTH * 1000);
    return (millis / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  var FULL_SIZED_TRIM = 'Full Sized Impeller (No Trim)';

  // Pages that sell these sizes. Labels match the option text: no spaces around x,
  // and the # mark keeps a space ("4x6x10 #2"). 4x6x10 #2 is sold on the RA3146
  // page. Trim options are eighth-inch labels, or the full-size sentence above.
  // trimMin/trimMax are the numeric option ends, not the full catalog diameter.
  var RA2096_SIZES = { '1x1.5x6': true, '1.5x3x6': true, '1x1.5x8': true };
  var RA3146_SIZES = {
    '1x3x8.5': true,
    '1.5x3x8.5': true,
    '2x3x8.5': true,
    '3x4x8.5': true,
    '4x6x8.5': true,
    '1.5x3x10': true,
    '2x3x10': true,
    '3x4x10': true,
    '4x6x10 #2': true
  };
  var RA3186_SIZES = { '4x6x10 #1': true };
  // Sold RWA sizes. Each one uses the RA curve of the same size.
  // Dean: hydraulic performance curves are the same for each R-series size.
  var RWA_BY_SIZE = {
    '1x1.5x6': 'RWA2096',
    '1.5x3x6': 'RWA2096',
    '1x1.5x8': 'RWA2096',
    '1x3x8.5': 'RWA4166',
    '1.5x3x8.5': 'RWA4166',
    '2x3x8.5': 'RWA4166',
    '3x4x8.5': 'RWA4166',
    '4x6x8.5': 'RWA4166',
    '1.5x3x10': 'RWA4166',
    '2x3x10': 'RWA4166',
    '3x4x10': 'RWA4166',
    '4x6x10 #2': 'RWA4166',
    '4x6x10 #1': 'RWA4206'
  };
  var STORE_PAGES = [
    {
      frame: 'RA2096',
      url: 'https://pumpresource.us/dean-ra2096-pump/',
      sizes: RA2096_SIZES,
      trimMin: 4,
      trimMax: 7.875
    },
    {
      frame: 'RWA2096',
      url: 'https://pumpresource.us/dean-rwa2096-pump/',
      sizes: RA2096_SIZES,
      trimMin: 4,
      trimMax: 7.875
    },
    {
      frame: 'RA3146',
      url: 'https://pumpresource.us/dean-ra3146-pump/',
      sizes: RA3146_SIZES,
      trimMin: 5.5,
      trimMax: 9.875
    },
    {
      frame: 'RWA4166',
      url: 'https://pumpresource.us/dean-rwa4166-pump/',
      sizes: RA3146_SIZES,
      trimMin: 5.5,
      trimMax: 9.875
    },
    {
      frame: 'RA3186',
      url: 'https://pumpresource.us/dean-ra3186-pump/',
      sizes: RA3186_SIZES,
      trimMin: 8,
      trimMax: 9.875
    },
    {
      frame: 'RWA4206',
      url: 'https://pumpresource.us/dean-rwa4206-pump/',
      sizes: RA3186_SIZES,
      trimMin: 8,
      trimMax: 9.875
    }
  ];

  function storeSizeLabel(size) {
    var raw = String(size || '').replace(/×/g, 'x').trim();
    var hashAt = raw.indexOf('#');
    var body = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    var mark = hashAt >= 0 ? raw.slice(hashAt + 1).replace(/\s+/g, '') : '';
    body = body.replace(/\s+/g, '');
    if (!body) return '';
    return mark ? body + ' #' + mark : body;
  }

  function eighthTrimSet(minDia, maxDia) {
    var set = {};
    var i0 = Math.round(minDia / EIGHTH);
    var i1 = Math.round(maxDia / EIGHTH);
    for (var i = i0; i <= i1; i++) set[formatDia(i * EIGHTH)] = true;
    return set;
  }

  var storePagesReady = null;
  function storePages() {
    if (storePagesReady) return storePagesReady;
    storePagesReady = STORE_PAGES.map(function (page) {
      return {
        frame: page.frame,
        url: page.url,
        sizes: page.sizes,
        trims: eighthTrimSet(page.trimMin, page.trimMax)
      };
    });
    return storePagesReady;
  }

  function pageForStoreSize(label) {
    var pages = storePages();
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].sizes[label]) return pages[i];
    }
    return null;
  }

  function catalogMaxDia(curve) {
    var max = null;
    var imps = (curve && curve.impellers) || [];
    for (var i = 0; i < imps.length; i++) {
      var d = Number(imps[i].diameter_in);
      if (!isFinite(d)) continue;
      if (max === null || d > max) max = d;
    }
    return max;
  }

  // The trim query is the store option a script can match.
  // Full catalog diameter → "Full Sized Impeller (No Trim)".
  // Any other shown eighth-inch label that the page lists → that label, such as "7.375".
  // Anything else is omitted. The parenthetical notes on some options are not part of the label.
  function storeTrimLabel(curve, diameterIn, page) {
    var d = Number(diameterIn);
    if (!isFinite(d)) return null;
    var max = catalogMaxDia(curve);
    if (max !== null && formatDia(d) === formatDia(max)) return FULL_SIZED_TRIM;
    var label = formatDia(d);
    if (page.trims[label]) return label;
    return null;
  }

  /** Link to the pump product page for this size, carrying the size and shown trim.
      Null when the size is not sold on one of those pages. */
  function pageForFrame(frame, label) {
    var pages = storePages();
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].frame === frame && pages[i].sizes[label]) return pages[i];
    }
    return null;
  }

  function productLink(curve, diameterIn) {
    if (!curve) return null;
    var size = storeSizeLabel(curve.size);
    var frame = curve.series === 'RWA' ? curve.frame : (raFrame(curve) || curve.frame);
    var page = pageForFrame(frame, size);
    if (!page) return null;
    var trim = storeTrimLabel(curve, diameterIn, page);
    var href = page.url + '?size=' + encodeURIComponent(size);
    if (trim) href += '&trim=' + encodeURIComponent(trim);
    var model = frame;
    if (model) href += '&model=' + encodeURIComponent(model);
    return { href: href, size: size, trim: trim, model: model };
  }

  function productLinkText(link) {
    if (!link) return '';
    if (!link.trim) return 'View ' + link.size;
    if (link.trim === FULL_SIZED_TRIM) return 'View ' + link.size + ', ' + link.trim;
    return 'View ' + link.size + ', ' + link.trim + ' in';
  }

  function priceProduct(table, frame) {
    var products = table && table.products || [];
    var slug = String(frame || '').toLowerCase();
    if (!slug) return null;
    var needle = 'dean-' + slug + '-pump';
    for (var i = 0; i < products.length; i++) {
      if (String(products[i].url || '').toLowerCase().indexOf(needle) >= 0) return products[i];
    }
    return null;
  }

  function matchingMotor(product, hp, motorRpm, sizeLabel) {
    if (!product || !(hp > 0) || !(motorRpm > 0)) return null;
    var sizeKey = String(sizeLabel || '').toLowerCase().replace(/\s+/g, '');
    var hits = [];
    (product.motors || []).forEach(function (motor) {
      if (Number(motor.hp) !== Number(hp) || Number(motor.rpm) !== Number(motorRpm)) return;
      if (motor.only) {
        var only = String(motor.only).toLowerCase().replace(/\s+/g, '');
        if (only !== sizeKey) return;
      }
      hits.push(motor);
    });
    hits.sort(function (a, b) { return (a.only ? 1 : 0) - (b.only ? 1 : 0); });
    return hits[0] || null;
  }

  /** Store package price for the pump, trim, motor, formed-steel baseplate, and coupling.
      Amounts are the store's figures. A missing option is null, which means call for price. */
  function packageQuote(table, curve, diameterIn, motorHp, pumpRpm) {
    var lines = [];
    var missing = false;
    function add(name, detail, amount, included) {
      if (included) {
        lines.push({ name: name, detail: 'Included with pump', amount: 0, included: true });
        return;
      }
      if (amount == null || !isFinite(Number(amount))) missing = true;
      lines.push({
        name: name,
        detail: detail || '',
        amount: amount == null || !isFinite(Number(amount)) ? null : Number(amount)
      });
    }
    var product = priceProduct(table, curve && curve.frame);
    var size = storeSizeLabel(curve && curve.size);
    var bare = product && product.sizes ? product.sizes[size] : null;
    add('Pump', curve && curve.size, bare);
    var max = catalogMaxDia(curve);
    var full = max != null && formatDia(diameterIn) === formatDia(max);
    if (!full) {
      var adder = product ? product.trim_adder_usd : null;
      add('Trim', formatDia(diameterIn) + ' in', adder);
    }
    var motorRpm = table && table.pump_rpm_to_motor_rpm ? table.pump_rpm_to_motor_rpm[String(pumpRpm)] : null;
    var motor = matchingMotor(product, motorHp, motorRpm, size);
    var frame = motor ? motor.frame : null;
    var motorDetail = (motorHp > 0 ? motorHp + ' hp' : 'Motor');
    if (motorRpm) motorDetail += ', ' + motorRpm + ' rpm';
    if (frame) motorDetail += ', ' + frame;
    add('Motor', motorDetail, motor ? motor.price_usd : null);
    var base = frame && product && product.baseplates ? product.baseplates[frame] : null;
    add('Baseplate', base ? base.label : (frame || ''), base ? base.price_usd : null);
    if (frame && product && product.baseplates && !base) {
      lines[lines.length - 1].reason = 'No formed-steel baseplate price is published.';
    }
    var coup = frame && product && product.couplings ? product.couplings[frame] : null;
    if (!coup && product && product.coupling_included) {
      add('Coupling', '', null, true);
    } else {
      add('Coupling', coup ? coup.label : (frame || ''), coup ? coup.price_usd : null);
    }
    var total = null;
    if (!missing) {
      total = 0;
      lines.forEach(function (line) { total += line.amount; });
    }
    return {
      frame: frame,
      baseplate: base ? base.label : null,
      coupling: coup ? coup.label : (product && product.coupling_included ? 'Included with pump' : null),
      lines: lines,
      total: total
    };
  }

  function frames(catalog, service) {
    var svc = normalizeService(service);
    var seen = {};
    var out = [];
    (catalog && catalog.curves || []).forEach(function (curve) {
      var view = presentCurve(curve, svc);
      if (!view || seen[view.frame]) return;
      seen[view.frame] = true;
      out.push(view.frame);
    });
    if (svc === 'ra' && !seen.RA3246) out.push('RA3246');
    out.sort();
    return out;
  }

  var POWER_FRAMES = { RA2096: true, RA3146: true, RA3186: true };

  function serviceCode(value) {
    var s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (s === 'rwa' || s === 'hot-water' || s === 'hot-water-glycol' || s === 'glycol') return 'rwa';
    if (s === 'ra' || s === 'thermal' || s === 'thermal-fluid') return 'ra';
    return '';
  }

  function normalizeService(value) {
    return serviceCode(value) || 'ra';
  }

  function raFrame(curve) {
    var types = (curve && curve.pump_types) || [];
    for (var i = 0; i < types.length; i++) {
      if (POWER_FRAMES[types[i]]) return types[i];
    }
    if (curve && POWER_FRAMES[curve.frame]) return curve.frame;
    return '';
  }

  function rwaFrameFor(curve) {
    return RWA_BY_SIZE[storeSizeLabel(curve && curve.size)] || '';
  }

  // The RWA entry keeps the same curve object fields, including the impeller
  // arrays. Only the series name changes.
  function presentCurve(curve, service) {
    if (!curve) return null;
    var svc = normalizeService(service);
    var frame = svc === 'rwa' ? rwaFrameFor(curve) : raFrame(curve);
    if (!frame) return null;
    var view = {};
    for (var key in curve) {
      if (Object.prototype.hasOwnProperty.call(curve, key)) view[key] = curve[key];
    }
    view.frame = frame;
    view.series = svc === 'rwa' ? 'RWA' : 'RA';
    return view;
  }

  // The name on a result is the series being sold. A raw sheet curve
  // still resolves to its RA frame.
  function powerFrame(curve) {
    if (!curve) return '';
    if (curve.series === 'RA' || curve.series === 'RWA') return curve.frame || '';
    if (POWER_FRAMES[curve.frame]) return curve.frame;
    return raFrame(curve);
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
    CATALOG_LIMIT_NOTE: CATALOG_LIMIT_NOTE,
    RANK_NOTE: RANK_NOTE,
    SHARED_CURVE_NOTE: SHARED_CURVE_NOTE,
    VISCOSITY_NOTE: VISCOSITY_NOTE,
    NPSH_MARGIN_NOTE: NPSH_MARGIN_NOTE,
    efficiencyAt: efficiencyAt,
    pctBep: pctBep,
    bepZone: bepZone,
    brakeHorsepower: brakeHorsepower,
    motorHorsepower: motorHorsepower,
    npshrAt: npshrAt,
    headAt: headAt,
    select: select,
    fluidClass: fluidClass,
    fluidNote: fluidNote,
    fluids: FLUIDS,
    fluidAlias: FLUID_ALIAS,
    canonicalFluid: canonicalFluid,
    fluidCurves: FLUID_CURVES,
    waterProperties: waterProperties,
    resultsSummary: resultsSummary,
    npshNote: npshNote,
    correctDuty: correctDuty,
    correctionTag: correctionTag,
    hiPreliminary: hiPreliminary,
    correctedPieces: correctedPieces,
    impellerLabel: impellerLabel,
    formatDia: formatDia,
    productLink: productLink,
    productLinkText: productLinkText,
    packageQuote: packageQuote,
    affinityHead: affinityHead,
    smoothHead: smoothHead,
    smoothPieces: smoothPieces,
    attachFits: attachFits,
    diameterSamples: diameterSamples,
    evalFit: evalFit,
    interpolatedPoints: interpolatedPoints,
    curvePoints: curvePoints,
    measuredPoints: measuredPoints,
    offeredDiameters: offeredDiameters,
    frames: frames,
    powerFrame: powerFrame,
    normalizeService: normalizeService,
    presentCurve: presentCurve,
    raFrame: raFrame,
    rwaFrameFor: rwaFrameFor,
    frameLine: frameLine,
    intelliquipFor: intelliquipFor,
    dutySeat: dutySeat,
    flowFraction: flowFraction,
    seatScore: seatScore
  };
});

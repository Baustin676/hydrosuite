/* Dean RA catalog selector.
   Uses digitized head-capacity points. A monotone cubic spline supplies
   intermediate points inside each impeller's measured flow range; those
   points are marked interpolated and are not new sheet readings.
   The spline passes through every catalog head and falls or stays level
   as flow increases. It is not extended past the first or last catalog flow.
   A duty between two lines is an eighth-inch trim from diameter-squared
   affinity, not a linear diameter. Does not extrapolate or speed-scale.
   A duty returns every catalog size that can meet it. The order is where the
   flow sits on that size's real catalog flow range, not efficiency.
   The middle-right of the range ranks first. A duty on the left, or at the
   far right end, ranks lower.
   A non-water fluid corrects that water curve with the Hydraulic Institute
   preliminary method (ANSI/HI 9.6.7 section 9.6.7.4.6). It does not invent
   catalog heads, efficiency, BHP, or NPSHr. The list is then ordered by where
   that corrected water flow sits on the catalog range. */
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

  /** Head on the smooth monotone curve through one impeller. Null outside the real points. */
  function smoothHead(points, q) {
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

  /** Cubic pieces of that curve, from the first real point to the last. No extension. */
  function smoothPieces(points) {
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

  /** Lower return means a ranks first. Order is the seat of the duty on each
      size's real catalog flow range, for every duty. */
  function compareSelections(a, b, q) {
    var sa = seatScore(flowFraction(a, q));
    var sb = seatScore(flowFraction(b, q));
    if (Math.abs(sa - sb) > 1e-12) return sa - sb;
    return sameCurveOrder(a, b);
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
    found.sort(function (a, b) { return compareSelections(a, b, qUse); });
    return {
      covered: found.length > 0,
      selections: found,
      pick: found[0] || null,
      matchCount: found.length,
      matches: found,
      correction: correction
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
  var RANK_NOTE = 'The list is ordered by where the duty sits on the curve. It is not ranked by efficiency. A duty in the middle-right of that size\'s catalog flow range comes first. A duty on the left side of the curve ranks lower, and a duty at the far right end ranks lower too. The curve sheets do not include efficiency, so this list can differ from IntelliQuip.';
  var SHARED_CURVE_NOTE = 'RA and RWA share the same head-capacity curve.';

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
    if (hit.kind === 'catalog') {
      return 'On the ' + formatDia(hit.diameter_in) + ' in catalog line. At ' + formatGpm(q) +
        ' gpm that line is ' + formatFt(head) + ' ft, ' + rel + ', with ' + end + '.';
    }
    return formatDia(hit.diameter_in) + ' in trim between the ' + formatDia(hit.between[0]) +
      ' in and ' + formatDia(hit.between[1]) + ' in catalog lines. At ' + formatGpm(q) +
      ' gpm the trim is ' + formatFt(head) + ' ft, ' + rel + ', with ' + end + '.';
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

  var FULL_SIZED_TRIM = 'Full Sized Impeller (No Trim)';

  // Pages that sell these sizes. Labels match the option text: no spaces around x,
  // and the # mark keeps a space ("4x6x10 #2"). 4x6x10 #2 is sold on the RA3146
  // page. Trim options are eighth-inch labels, or the full-size sentence above.
  // trimMin/trimMax are the numeric option ends, not the full catalog diameter.
  var STORE_PAGES = [
    {
      url: 'https://pumpresource.us/dean-ra2096-pump/',
      sizes: { '1x1.5x6': true, '1.5x3x6': true, '1x1.5x8': true },
      trimMin: 4,
      trimMax: 7.875
    },
    {
      url: 'https://pumpresource.us/dean-ra3146-pump/',
      sizes: {
        '1x3x8.5': true,
        '1.5x3x8.5': true,
        '2x3x8.5': true,
        '3x4x8.5': true,
        '4x6x8.5': true,
        '1.5x3x10': true,
        '2x3x10': true,
        '3x4x10': true,
        '4x6x10 #2': true
      },
      trimMin: 5.5,
      trimMax: 9.875
    },
    {
      url: 'https://pumpresource.us/dean-ra3186-pump/',
      sizes: { '4x6x10 #1': true },
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
  function productLink(curve, diameterIn) {
    if (!curve) return null;
    var size = storeSizeLabel(curve.size);
    var page = pageForStoreSize(size);
    if (!page) return null;
    var trim = storeTrimLabel(curve, diameterIn, page);
    var href = page.url + '?size=' + encodeURIComponent(size);
    if (trim) href += '&trim=' + encodeURIComponent(trim);
    return { href: href, size: size, trim: trim };
  }

  function productLinkText(link) {
    if (!link) return '';
    if (!link.trim) return 'View ' + link.size;
    if (link.trim === FULL_SIZED_TRIM) return 'View ' + link.size + ', ' + link.trim;
    return 'View ' + link.size + ', ' + link.trim + ' in';
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
    CATALOG_LIMIT_NOTE: CATALOG_LIMIT_NOTE,
    RANK_NOTE: RANK_NOTE,
    SHARED_CURVE_NOTE: SHARED_CURVE_NOTE,
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
    productLink: productLink,
    productLinkText: productLinkText,
    affinityHead: affinityHead,
    smoothHead: smoothHead,
    smoothPieces: smoothPieces,
    interpolatedPoints: interpolatedPoints,
    curvePoints: curvePoints,
    measuredPoints: measuredPoints,
    offeredDiameters: offeredDiameters,
    powerFrame: powerFrame,
    frameLine: frameLine,
    intelliquipFor: intelliquipFor,
    dutySeat: dutySeat,
    flowFraction: flowFraction,
    seatScore: seatScore
  };
});

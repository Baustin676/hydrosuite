/* Dean RA catalog selector.
   Uses digitized head-capacity points. A smooth monotone fit supplies
   intermediate points inside each impeller's measured flow range; those
   points are marked interpolated and are not new sheet readings.
   A duty between two lines is an eighth-inch trim from diameter-squared
   affinity, not a linear diameter. Does not extrapolate or speed-scale.
   A duty returns every catalog size that can meet it. The order is hydraulic
   fit, not efficiency. */
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
    var pts = measuredPoints(points);
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
      if (!best || compareHits(hit, best, h) < 0) best = hit;
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

  /** Lower return means a ranks first.
      Closest trim that still meets the duty. Head differences inside the
      sheet-reading tolerance are the same fit, so the pump with more flow
      left before the curve ends ranks first. This is not an efficiency ranking. */
  function compareHits(a, b, dutyH) {
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

  function select(catalog, duty) {
    var q = Number(duty.q_gpm);
    var h = Number(duty.h_ft);
    var found = [];
    (catalog.curves || []).forEach(function (curve) {
      var hit = evaluateCurve(curve, q, h);
      if (hit) found.push(hit);
    });
    found.sort(function (a, b) { return compareHits(a, b, h); });
    return {
      covered: found.length > 0,
      selections: found,
      pick: found[0] || null,
      matchCount: found.length
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

  var CATALOG_LIMIT_NOTE = 'This catalog does not include pumps larger than 10 in, so a better Dean size may exist above that.';
  var RANK_NOTE = 'The list is ranked by how closely the trim meets the requested head on the catalog water curve. Head differences inside the 3 ft sheet-reading tolerance count as the same fit, and those pumps are then ordered by how much flow is left before the curve ends. It is not ranked by efficiency. The curve sheets do not include efficiency, so this list can differ from IntelliQuip.';
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

  // Ambient water is the reference the curves were drawn for.
  // Any other fluid still plots that catalog water curve. No viscosity correction.
  function fluidNote(fluid) {
    var ambient = 'Water at ambient is the reference these curves were drawn for.';
    if (isWaterFluid(fluid)) return ambient;
    return ambient + ' The plotted curve is still the catalog water curve.';
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
    CATALOG_LIMIT_NOTE: CATALOG_LIMIT_NOTE,
    RANK_NOTE: RANK_NOTE,
    SHARED_CURVE_NOTE: SHARED_CURVE_NOTE,
    headAt: headAt,
    select: select,
    fluidClass: fluidClass,
    fluidNote: fluidNote,
    impellerLabel: impellerLabel,
    formatDia: formatDia,
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
    dutySeat: dutySeat
  };
});

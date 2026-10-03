/* Dean RA catalog selector.
   Uses only digitized head-capacity points. Interpolates along one impeller
   line. A duty between two lines is an eighth-inch trim from diameter-squared
   affinity, not a linear diameter. Does not extrapolate or speed-scale. */
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
    var found = [];
    (catalog.curves || []).forEach(function (curve) {
      var hit = evaluateCurve(curve, q, h);
      if (hit) found.push(hit);
    });
    found.sort(compareHits);
    return {
      covered: found.length > 0,
      pick: found[0] || null,
      matchCount: found.length
    };
  }

  function fluidClass(fluid) {
    var f = String(fluid || '').toLowerCase();
    if (f === 'water') return 'water';
    if (f === 'eg' || f === 'pg' || f.indexOf('glycol') >= 0) return 'glycol';
    if (f === 'hto' || f.indexOf('oil') >= 0 || f.indexOf('therminol') >= 0 || f.indexOf('dowtherm') >= 0) return 'oil';
    return 'other';
  }

  function fluidNote(fluid) {
    var kind = fluidClass(fluid);
    var build = 'These catalog curves are the shared Dean RA / RWA hydraulics. The RA frame is the hot-oil build and the RWA is the hot-water build: a materials and temperature distinction, not a different head-capacity curve.';
    if (kind === 'other') {
      return build + ' The curve is plotted as drawn. It is not viscosity-corrected.';
    }
    return build + ' The curve is catalog water performance as drawn. No viscosity correction is applied.';
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
    headAt: headAt,
    select: select,
    fluidClass: fluidClass,
    fluidNote: fluidNote,
    impellerLabel: impellerLabel,
    formatDia: formatDia,
    affinityHead: affinityHead,
    offeredDiameters: offeredDiameters,
    powerFrame: powerFrame,
    frameLine: frameLine
  };
});

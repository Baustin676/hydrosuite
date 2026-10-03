/* Dean RA catalog selector.
   Uses only digitized head-capacity points. Interpolates along one impeller
   line and between adjacent catalog diameters. Does not extrapolate. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeanRA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var ON_LINE_FT = 0.75;

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

  function makeHit(curve, q, h, upper, lower) {
    var qMax = upper.at.qMax;
    var qMin = upper.at.qMin;
    var inferred = !!upper.at.inferred;
    var kind = 'catalog';
    var diameter = upper.imp.diameter_in;
    var between = null;
    var fraction = null;
    var gap = 0;
    var hUpper = upper.at.h;
    var hLower = null;
    if (lower) {
      qMax = Math.min(qMax, lower.at.qMax);
      qMin = Math.max(qMin, lower.at.qMin);
      inferred = inferred || !!lower.at.inferred;
      kind = 'between';
      var top = Math.max(upper.at.h, lower.at.h);
      var bot = Math.min(upper.at.h, lower.at.h);
      gap = top - bot;
      fraction = gap === 0 ? 0 : (h - bot) / gap;
      var dTop = upper.at.h >= lower.at.h ? upper.imp.diameter_in : lower.imp.diameter_in;
      var dBot = upper.at.h >= lower.at.h ? lower.imp.diameter_in : upper.imp.diameter_in;
      diameter = dBot + fraction * (dTop - dBot);
      between = [Math.min(upper.imp.diameter_in, lower.imp.diameter_in), Math.max(upper.imp.diameter_in, lower.imp.diameter_in)];
      hLower = lower.at.h;
    }
    return {
      curve: curve,
      kind: kind,
      diameter_in: diameter,
      between: between,
      fraction: fraction,
      inferred: inferred,
      endMargin: qMax - q,
      qMax: qMax,
      qMin: qMin,
      gap: gap,
      hUpper: hUpper,
      hLower: hLower,
      upperDiameter: upper.imp.diameter_in,
      lowerDiameter: lower ? lower.imp.diameter_in : null
    };
  }

  function coversHead(h, ha, hb) {
    var top = Math.max(ha, hb);
    var bot = Math.min(ha, hb);
    return h <= top + 1e-6 && h >= bot - 1e-6;
  }

  function evaluateCurve(curve, q, h) {
    var imps = byDiameterDesc(curve);
    var best = null;
    function consider(hit) {
      if (!hit) return;
      if (!best || compareHits(hit, best) < 0) best = hit;
    }
    for (var i = 0; i < imps.length; i++) {
      var at = headAt(imps[i].points, q);
      if (!at) continue;
      if (Math.abs(at.h - h) <= ON_LINE_FT) {
        consider(makeHit(curve, q, h, { imp: imps[i], at: at }, null));
      }
      if (i + 1 >= imps.length) continue;
      var atNext = headAt(imps[i + 1].points, q);
      if (!atNext) continue;
      if (!coversHead(h, at.h, atNext.h)) continue;
      if (Math.abs(at.h - h) <= ON_LINE_FT || Math.abs(atNext.h - h) <= ON_LINE_FT) continue;
      consider(makeHit(curve, q, h, { imp: imps[i], at: at }, { imp: imps[i + 1], at: atNext }));
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
    if (kind === 'water' || kind === 'glycol') {
      return 'This catalog is the Dean RA hot-oil line, not the RWA line. The curve is catalog water performance as drawn. No viscosity correction is applied.';
    }
    if (kind === 'oil') {
      return 'Dean RA line for heat-transfer oil. The curve is catalog water performance as drawn. No viscosity correction is applied.';
    }
    return 'Catalog curve plotted as drawn. It is not viscosity-corrected.';
  }

  function impellerLabel(hit) {
    if (!hit) return '';
    if (hit.kind === 'catalog') {
      return formatDia(hit.diameter_in) + ' in catalog diameter';
    }
    var lo = formatDia(hit.between[0]);
    var hi = formatDia(hit.between[1]);
    return 'between catalog diameters ' + lo + ' in and ' + hi + ' in (not a published curve)';
  }

  function formatDia(d) {
    var n = Math.round(d * 100) / 100;
    return (Math.abs(n - Math.round(n)) < 1e-6) ? String(Math.round(n)) : String(n);
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
    powerFrame: powerFrame,
    frameLine: frameLine
  };
});

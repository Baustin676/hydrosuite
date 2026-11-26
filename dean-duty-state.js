/* Saved duty for the selector. The iframe reloads when a PDF or another
   tab takes focus, and the inputs would otherwise come back empty. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DutyState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var KEY = 'hydrosuite.duty';
  var ALIASES = [
    ['flow', 'q'], ['q', 'q'],
    ['head', 'h'], ['h', 'h'],
    ['model', 'model'],
    ['rpm', 'rpm'],
    ['fluid', 'fluid'],
    ['temp', 't'], ['t', 't'],
    ['tstart', 'tStart'], ['tStart', 'tStart'],
    ['npsha', 'npsha'],
    ['psig', 'psig'],
    ['service', 'service']
  ];

  function serviceCode(value) {
    var s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (s === 'rwa' || s === 'hot-water' || s === 'hot-water-glycol' || s === 'glycol') return 'rwa';
    if (s === 'ra' || s === 'thermal' || s === 'thermal-fluid') return 'ra';
    return '';
  }

  function blank() {
    return { q: '', h: '', model: '', rpm: '3500', fluid: 'water', t: '68', tStart: '', npsha: '', psig: '', service: 'ra', tempTyped: false, shown: false };
  }

  function sanitize(raw) {
    var state = blank();
    if (!raw || typeof raw !== 'object') return state;
    ['q', 'h', 'model', 'rpm', 'fluid', 't', 'tStart', 'npsha', 'psig'].forEach(function (key) {
      if (raw[key] != null) state[key] = String(raw[key]);
    });
    if (raw.service != null) {
      var code = serviceCode(raw.service);
      if (code) state.service = code;
    }
    state.tempTyped = !!raw.tempTyped;
    state.shown = !!raw.shown;
    return state;
  }

  function read(storage) {
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return null;
      return sanitize(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function write(storage, state) {
    storage.setItem(KEY, JSON.stringify(sanitize(state)));
  }

  function clear(storage) {
    try { storage.removeItem(KEY); } catch (e) {}
  }

  function paramValue(params, name) {
    if (!params) return null;
    if (typeof params.get === 'function') {
      if (typeof params.has === 'function' && !params.has(name)) return null;
      var value = params.get(name);
      return value == null ? null : String(value);
    }
    if (!Object.prototype.hasOwnProperty.call(params, name) || params[name] == null) return null;
    return String(params[name]);
  }

  // A query parameter replaces the saved field. Later aliases win, so q beats flow.
  function applyParams(saved, params) {
    var state = sanitize(saved || blank());
    ALIASES.forEach(function (pair) {
      var value = paramValue(params, pair[0]);
      if (value == null) return;
      if (pair[1] === 'service') {
        var code = serviceCode(value);
        if (code) state.service = code;
        return;
      }
      state[pair[1]] = value;
    });
    return state;
  }

  function shouldRestoreResults(state) {
    if (!state || !state.shown) return false;
    var q = Number(state.q);
    var h = Number(state.h);
    var t = Number(state.t);
    return isFinite(q) && q > 0 && isFinite(h) && h > 0 && isFinite(t);
  }

  return {
    KEY: KEY,
    blank: blank,
    sanitize: sanitize,
    read: read,
    write: write,
    clear: clear,
    applyParams: applyParams,
    shouldRestoreResults: shouldRestoreResults
  };
});

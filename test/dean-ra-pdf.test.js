const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DeanRA = require('../dean-ra-select.js');
const DeanPdf = require('../dean-ra-pdf.js');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-curves.json'), 'utf8'));
const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dean-ra-prices.json'), 'utf8'));
const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const embed = fs.readFileSync(path.join(__dirname, '../embed/pumpresource-hydrosuite-pro.html'), 'utf8');

const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010200000100010000fffe00104c61766336302e33312e31303200ffdb00430008040404040405050505050506060606060606060606060607070708080807070706060707080808080909090808080809090a0a0a0c0c0b0b0e0e0e111114ffc4004b00010100000000000000000000000000000007010100000000000000000000000000000000100100000000000000000000000000000000110100000000000000000000000000000000ffc00011080008000803012200021100031100ffda000c03010002110311003f00bf800fffd9',
  'hex'
);

function oneDecimal(n) {
  const v = Math.round(Number(n) * 10) / 10;
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1')
    .replace(/\\([0-7]{3})/g, function (_, oct) { return String.fromCharCode(parseInt(oct, 8)); })
    .replace(/\\([()\\])/g, '$1');
}

function pageCount(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  return (text.match(/\/Type \/Page(?!s)/g) || []).length;
}

assert.strictEqual(DeanPdf.money(11804), '$11,804');
assert.strictEqual(DeanPdf.money(0), '$0');
assert.strictEqual(DeanPdf.money(null), 'Call for price');
assert.strictEqual(DeanPdf.BRAND, 'PumpResource');
assert.strictEqual(DeanPdf.SITE, 'pumpresource.us');
assert.strictEqual(DeanPdf.PHONE, '888-341-7085');
assert.strictEqual(DeanPdf.REFERENCE, 'Reference only. Up to 70 SSU.');
assert.strictEqual(DeanPdf.FREIGHT, 'Freight is calculated at checkout.');

const duty = DeanRA.select(catalog, { q_gpm: 100, h_ft: 240, fluid: 'water', temp: 68, unit: 'F', rpm: 3500 });
const hit = duty.pick;
assert.strictEqual(DeanRA.powerFrame(hit.curve), 'RA2096');
assert.strictEqual(hit.curve.size.replace(/\s+/g, ''), '1x1.5x8');
const quote = DeanRA.packageQuote(prices, hit.curve, hit.diameter_in, hit.motor_hp, hit.curve.rpm);
assert.strictEqual(quote.total, 8174 + 155 + 2382 + 1093);
const rows = DeanPdf.quoteRows(quote);
assert.strictEqual(rows[0].label, 'Pump 1 x 1.5 x 8');
assert.strictEqual(rows[0].amount, DeanPdf.money(8174));
const trim = rows.find(function (row) { return row.label.indexOf('Trim') === 0; });
assert.strictEqual(trim.amount, DeanPdf.money(155));
const motor = rows.find(function (row) { return row.label.indexOf('Motor') === 0; });
assert.ok(motor.label.indexOf('15 hp, 3600 rpm, 254T') > 0);
const coupling = rows.find(function (row) { return row.label === 'Coupling'; });
assert.strictEqual(coupling.amount, 'Included with pump');
assert.strictEqual(rows[rows.length - 1].label, 'Package');
assert.strictEqual(rows[rows.length - 1].amount, '$11,804');

const sheet = DeanPdf.build({
  date: 'November 24, 2026',
  title: 'RA2096  \u00b7  1 x 1.5 x 8',
  subtitle: '100 gpm at 240 ft  \u00b7  3500 rpm  \u00b7  ' + DeanRA.impellerLabel(hit) + ' impeller',
  details: [
    { label: 'Fluid', value: 'Water' },
    { label: 'Temperature', value: '68 \u00b0F' },
    { label: 'Speed', value: '3500 rpm' },
    { label: 'Impeller', value: DeanRA.impellerLabel(hit) },
    { label: 'Efficiency', value: oneDecimal(hit.efficiency_pct) + '%' },
    { label: 'BEP', value: oneDecimal(hit.pct_bep) + '%' },
    { label: 'Power', value: oneDecimal(hit.bhp) + ' hp' },
    { label: 'Motor', value: oneDecimal(hit.motor_hp) + ' hp' },
    { label: 'NPSHr', value: oneDecimal(hit.npshr_ft) + ' ft' }
  ],
  reference: DeanPdf.REFERENCE,
  freight: DeanPdf.FREIGHT,
  chart: TINY_JPEG,
  chartWidth: 720,
  chartHeight: 480,
  quote: quote
});
const text = pdfText(sheet);
assert.strictEqual(pageCount(sheet), 1);
assert.ok(text.indexOf('%PDF-1.4') === 0);
assert.ok(text.indexOf('PumpResource') > 0);
assert.ok(text.indexOf('pumpresource.us') > 0);
assert.ok(text.indexOf('888-341-7085') > 0);
assert.ok(text.indexOf('November 24, 2026') > 0);
assert.ok(text.indexOf('RA2096') > 0);
assert.ok(text.indexOf('1 x 1.5 x 8') > 0);
assert.ok(text.indexOf('100 gpm at 240 ft') > 0);
assert.ok(text.indexOf('3500 rpm') > 0);
assert.ok(text.indexOf('Water') > 0);
assert.ok(text.indexOf('68') > 0);
assert.ok(text.indexOf(DeanRA.impellerLabel(hit)) > 0);
assert.ok(text.indexOf(oneDecimal(hit.efficiency_pct) + '%') > 0);
assert.ok(text.indexOf(oneDecimal(hit.pct_bep) + '%') > 0);
assert.ok(text.indexOf(oneDecimal(hit.bhp) + ' hp') > 0);
assert.ok(text.indexOf('15 hp') > 0);
assert.ok(text.indexOf('NPSHr') > 0);
assert.ok(text.indexOf('$8,174') > 0);
assert.ok(text.indexOf('$155') > 0);
assert.ok(text.indexOf('$2,382') > 0);
assert.ok(text.indexOf('$1,093') > 0);
assert.ok(text.indexOf('$11,804') > 0);
assert.ok(text.indexOf('15 hp, 3600 rpm, 254T') > 0);
assert.ok(text.indexOf('Economy Formed Steel (254T)') > 0);
assert.ok(text.indexOf('Included with pump') > 0);
assert.ok(text.indexOf(DeanPdf.REFERENCE) > 0);
assert.ok(text.indexOf(DeanPdf.FREIGHT) > 0);
assert.ok(text.indexOf('/DCTDecode') > 0);
assert.ok(Buffer.from(sheet).indexOf(TINY_JPEG) > 0);
assert.ok(!/hagler/i.test(text));
assert.ok(text.indexOf('not a direct duplicate') < 0);
assert.strictEqual(Buffer.from(DeanPdf.build(sheet && {
  date: 'November 24, 2026',
  title: 'RA2096  \u00b7  1 x 1.5 x 8',
  subtitle: '100 gpm at 240 ft',
  chart: TINY_JPEG,
  chartWidth: 720,
  chartHeight: 480,
  quote: quote
})).equals(Buffer.from(DeanPdf.build({
  date: 'November 24, 2026',
  title: 'RA2096  \u00b7  1 x 1.5 x 8',
  subtitle: '100 gpm at 240 ft',
  chart: TINY_JPEG,
  chartWidth: 720,
  chartHeight: 480,
  quote: quote
}))), true);

const longNote = new Array(80).fill('Corrected water duty stays with the catalog curve for this fluid.').join(' ');
const longSheet = DeanPdf.build({
  date: 'November 24, 2026',
  title: 'RA2096  \u00b7  1 x 1.5 x 8',
  subtitle: '100 gpm at 240 ft',
  correction: longNote,
  chart: TINY_JPEG,
  chartWidth: 720,
  chartHeight: 480,
  quote: quote
});
const longPages = pageCount(longSheet);
assert.ok(longPages >= 2 && longPages <= 3, 'long sheet pages ' + longPages);

const wide = catalog.curves.find(function (c) {
  return c.frame === 'RA3146' && c.rpm === 3500 && c.size.replace(/\s+/g, '') === '3x4x8.5';
});
const full = wide.impellers.reduce(function (max, imp) { return Math.max(max, imp.diameter_in); }, 0);
const fullQuote = DeanRA.packageQuote(prices, wide, full, 50, 3500);
assert.ok(!DeanPdf.quoteRows(fullQuote).some(function (row) { return row.label.indexOf('Trim') === 0; }));
const fullText = pdfText(DeanPdf.build({
  date: 'November 24, 2026',
  title: 'RA3146',
  subtitle: 'full impeller',
  chart: TINY_JPEG,
  chartWidth: 720,
  chartHeight: 480,
  quote: fullQuote
}));
assert.ok(fullText.indexOf('Trim') < 0);
assert.ok(fullText.indexOf(DeanPdf.money(fullQuote.total)) > 0);

const missing = pdfText(DeanPdf.build({
  date: 'November 24, 2026',
  title: 'RA2096',
  subtitle: '100 gpm at 240 ft',
  quote: { lines: [{ name: 'Pump', detail: '1 x 1.5 x 8', amount: null }], total: null }
}));
assert.ok(missing.indexOf('Call for price') > 0);

assert.ok(page.indexOf('id="pdf-btn"') > 0);
assert.ok(page.indexOf('>Download PDF<') > 0);
assert.ok(page.indexOf('src="dean-ra-pdf.js"') > 0);
assert.ok(page.indexOf("type: 'hydrosuite:download'") > 0);
assert.ok(page.indexOf("'hydrosuite:ready'") > 0);
assert.ok(page.indexOf('parentCanDownload') > 0);
assert.ok(page.indexOf('window.print') < 0);
assert.ok(page.indexOf('scrollIntoView') < 0);
assert.ok(!/hagler/i.test(page));
assert.ok(!/hagler/i.test(fs.readFileSync(path.join(__dirname, '../dean-ra-pdf.js'), 'utf8')));
assert.ok(page.indexOf(DeanPdf.REFERENCE) > 0);
assert.ok(page.indexOf(DeanPdf.FREIGHT) > 0);
assert.ok(fs.readFileSync(path.join(__dirname, '../dean-ra-pdf.js'), 'utf8').indexOf('888-341-7085') > 0);
const downloadFn = page.slice(page.indexOf('function downloadActivePdf'), page.indexOf('var pdfBtn'));
assert.ok(downloadFn.indexOf('postScrollToResults') < 0);
assert.ok(downloadFn.indexOf('scrollIntoView') < 0);
const drawFn = page.slice(page.indexOf('function drawDeanSelection'), page.indexOf('function sampleCurve'));
assert.ok(drawFn.indexOf('offscreen') > 0);
assert.ok(drawFn.indexOf('if (!offscreen) postFrameHeight();') > 0);
assert.ok(embed.indexOf('hydrosuite:download') > 0);
assert.ok(embed.indexOf('saveDownload') > 0);

console.log('dean-ra-pdf tests passed');

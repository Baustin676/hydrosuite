/* Client-side PDF for one Dean RA selection.
   No dependencies. The file is built in the browser and saved from the
   click, including inside the cross-origin store iframe, where
   window.print() is unreliable. Prices are the quote passed in. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeanPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var BRAND = 'PumpResource';
  var SITE = 'pumpresource.us';
  var PHONE = '888-341-7085';
  var REFERENCE = 'Reference only. Up to 70 SSU.';
  var FREIGHT = 'Freight is calculated at checkout.';
  var PAGE_W = 612;
  var PAGE_H = 792;
  var MARGIN = 40;
  var BOTTOM = 36;
  var CONTENT_W = PAGE_W - MARGIN * 2;
  var BAR = 6;
  var WIDTH = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,
    556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,
    0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,
    278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,
    400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,
    667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,
    722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,
    556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500
  ];
  var WIDTH_BOLD = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,
    556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,
    0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,
    278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,
    400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,
    722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,
    722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,
    611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556
  ];
  var EXTRA = {
    8211: 150, 8212: 151, 8216: 145, 8217: 146, 8220: 147, 8221: 148,
    8226: 149, 8230: 133, 8364: 128, 8482: 153
  };

  function winBytes(text) {
    var s = String(text == null ? '' : text);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { i++; out.push(32); continue; }
      if (c === 9 || c === 10 || c === 13) { out.push(32); continue; }
      if (c >= 32 && c <= 126) { out.push(c); continue; }
      if (c >= 160 && c <= 255) { out.push(c); continue; }
      if (EXTRA[c]) { out.push(EXTRA[c]); continue; }
      if (c >= 0x2080 && c <= 0x2089) { out.push(48 + (c - 0x2080)); continue; }
      out.push(32);
    }
    return out;
  }

  function pdfStr(text) {
    var bytes = winBytes(text);
    var out = '(';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) out += '\\' + ('000' + c.toString(8)).slice(-3);
      else out += String.fromCharCode(c);
    }
    return out + ')';
  }

  function textWidth(text, size, bold) {
    var table = bold ? WIDTH_BOLD : WIDTH;
    var bytes = winBytes(text);
    var w = 0;
    for (var i = 0; i < bytes.length; i++) w += table[bytes[i]] || 0;
    return w * size / 1000;
  }

  function wrap(text, size, bold, maxW) {
    var words = String(text == null ? '' : text).split(/\s+/);
    var lines = [];
    var cur = '';
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (!word) continue;
      var next = cur ? cur + ' ' + word : word;
      if (!cur || textWidth(next, size, bold) <= maxW) cur = next;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push('');
    return lines;
  }

  function num(v) {
    var s = Number(v).toFixed(2);
    if (s === '-0.00') return '0';
    s = s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return s;
  }

  function money(amount) {
    if (amount == null || !isFinite(Number(amount))) return 'Call for price';
    var v = Math.round(Number(amount));
    return '$' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function quoteRows(quote) {
    var rows = [];
    if (!quote || !quote.lines) return rows;
    quote.lines.forEach(function (line) {
      var label = line.included ? line.name : (line.name + (line.detail ? ' ' + line.detail : ''));
      var amount = line.included ? 'Included with pump' : money(line.amount);
      rows.push({ label: label, amount: amount });
    });
    rows.push({ label: 'Package', amount: money(quote.total), total: true });
    return rows;
  }

  function jpegSize(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      throw new Error('chart');
    }
    var i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var marker = bytes[i + 1];
      if (marker === 0xD8) { i += 2; continue; }
      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker >= 0xD0 && marker <= 0xD7) { i += 2; continue; }
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8]
        };
      }
      if (!len || i + 2 + len > bytes.length) break;
      i += 2 + len;
    }
    throw new Error('chart');
  }

  function Doc() {
    this.chunks = [];
    this.pos = 0;
    this.xref = {};
    this.next = 1;
  }
  Doc.prototype.alloc = function () { return this.next++; };
  Doc.prototype.add = function (part) {
    this.chunks.push(part);
    this.pos += part.length;
  };
  Doc.prototype.stream = function (dictInner, data) {
    var id = this.alloc();
    this.xref[id] = this.pos;
    var len = data.length;
    this.add(id + ' 0 obj\n<< ' + (dictInner ? dictInner + ' ' : '') + '/Length ' + len + ' >>\nstream\n');
    this.add(data);
    this.add('endstream\nendobj\n');
    return id;
  };
  Doc.prototype.plain = function (body) {
    var id = this.alloc();
    this.xref[id] = this.pos;
    this.add(id + ' 0 obj\n' + body);
    if (body.charAt(body.length - 1) !== '\n') this.add('\n');
    this.add('endobj\n');
    return id;
  };
  Doc.prototype.bytes = function (rootId, infoId) {
    var size = this.next;
    var start = this.pos;
    var xref = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (var i = 1; i < size; i++) {
      var off = this.xref[i];
      var s = off == null ? '0000000000' : String(off);
      while (s.length < 10) s = '0' + s;
      xref += s + (off == null ? ' 00000 f \n' : ' 00000 n \n');
    }
    xref += 'trailer\n<< /Size ' + size + ' /Root ' + rootId + ' 0 R /Info ' + infoId + ' 0 R >>\n';
    xref += 'startxref\n' + start + '\n%%EOF\n';
    this.add(xref);
    var n = 0;
    for (var c = 0; c < this.chunks.length; c++) n += this.chunks[c].length;
    var out = new Uint8Array(n);
    var o = 0;
    for (var k = 0; k < this.chunks.length; k++) {
      var part = this.chunks[k];
      if (typeof part === 'string') {
        for (var j = 0; j < part.length; j++) out[o++] = part.charCodeAt(j) & 255;
      } else {
        out.set(part, o);
        o += part.length;
      }
    }
    return out;
  };

  function build(spec) {
    spec = spec || {};
    var ink = '0.078 0.078 0.078';
    var muted = '0.361 0.361 0.361';
    var amber = '0.988 0.690 0.173';
    var line = '0.894 0.894 0.894';
    var brown = '0.478 0.306 0.063';
    var doc = new Doc();
    doc.add('%PDF-1.4\n%');
    doc.add(String.fromCharCode(226, 227, 207, 211));
    doc.add('\n');
    var font1 = doc.plain('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var font2 = doc.plain('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var pagesId = doc.alloc();
    var ops = [];
    var images = [];
    var pageIds = [];
    var y = 0;
    var topY = 0;
    var started = false;
    var continued = false;

    function drawString(text, x, top, size, bold, color) {
      var baseline = PAGE_H - (top + size * 0.74);
      ops.push('BT /F' + (bold ? '2' : '1') + ' ' + num(size) + ' Tf ' + color + ' rg 1 0 0 1 ' +
        num(x) + ' ' + num(baseline) + ' Tm ' + pdfStr(text) + ' Tj ET\n');
    }
    function hline(top, color, width) {
      var yy = PAGE_H - top;
      ops.push('q ' + color + ' RG ' + num(width) + ' w ' + num(MARGIN) + ' ' + num(yy) + ' m ' +
        num(MARGIN + CONTENT_W) + ' ' + num(yy) + ' l S Q\n');
    }
    function finishPage() {
      var stream = ops.join('');
      if (!stream || stream.charAt(stream.length - 1) !== '\n') stream += '\n';
      var contentId = doc.stream('', stream);
      var res = '/Font << /F1 ' + font1 + ' 0 R /F2 ' + font2 + ' 0 R >>';
      if (images.length) {
        var xo = [];
        for (var i = 0; i < images.length; i++) xo.push('/' + images[i].name + ' ' + images[i].id + ' 0 R');
        res += ' /XObject << ' + xo.join(' ') + ' >>';
      }
      var id = doc.alloc();
      doc.xref[id] = doc.pos;
      doc.add(id + ' 0 obj\n<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H +
        '] /Resources << ' + res + ' >> /Contents ' + contentId + ' 0 R >>\nendobj\n');
      pageIds.push(id);
    }
    function header(first) {
      var date = spec.date || '';
      if (first) {
        drawString(BRAND, MARGIN, y, 16, true, ink);
        if (date) drawString(date, MARGIN + CONTENT_W - textWidth(date, 9, false), y + 0.74 * 7, 9, false, muted);
        y += 20;
        drawString(SITE, MARGIN, y, 9, false, muted);
        drawString(PHONE, MARGIN + CONTENT_W - textWidth(PHONE, 9, false), y, 9, false, muted);
        y += 16;
        hline(y, amber, 1.6);
        y += 14;
      } else {
        var left = BRAND;
        if (spec.title) left += '  \u00b7  ' + spec.title;
        var leftSize = 10;
        if (textWidth(left, leftSize, true) > CONTENT_W - textWidth(date, 9, false) - 12) left = BRAND;
        drawString(left, MARGIN, y, leftSize, true, ink);
        if (date) drawString(date, MARGIN + CONTENT_W - textWidth(date, 9, false), y + 1, 9, false, muted);
        y += 16;
        hline(y, line, 0.6);
        y += 12;
      }
    }
    function newPage() {
      if (started) finishPage();
      started = true;
      ops = [];
      images = [];
      var first = !continued;
      ops.push('q ' + amber + ' rg 0 ' + num(PAGE_H - BAR) + ' ' + num(PAGE_W) + ' ' + num(BAR) + ' re f Q\n');
      y = 24;
      header(first);
      continued = true;
      topY = y;
    }
    function need(h) {
      if (y > topY + 0.5 && y + h > PAGE_H - BOTTOM) newPage();
    }
    function paragraph(text, size, bold, color, after) {
      if (!text) return;
      var lines = wrap(text, size, bold, CONTENT_W);
      var lead = size * 1.35;
      for (var i = 0; i < lines.length; i++) {
        need(lead);
        drawString(lines[i], MARGIN, y, size, bold, color);
        y += lead;
      }
      y += after || 0;
    }
    function trailingReserve() {
      var rows = quoteRows(spec.quote);
      var h = 8 + 14;
      if (spec.limitNote) h += 16;
      h += 8;
      if (rows.length) h += 10 + rows.length * 16 + 8;
      h += 16;
      return h;
    }
    function drawChart() {
      if (!spec.chart || !spec.chart.length) return;
      var dim = jpegSize(spec.chart);
      var aspect = (spec.chartWidth > 0 && spec.chartHeight > 0)
        ? spec.chartHeight / spec.chartWidth
        : dim.height / dim.width;
      function box(maxH) {
        var w = CONTENT_W;
        var h = w * aspect;
        if (h > 360) { h = 360; w = h / aspect; }
        if (maxH && h > maxH) { h = maxH; w = h / aspect; }
        if (w > CONTENT_W) { w = CONTENT_W; h = w * aspect; }
        return { w: w, h: h };
      }
      var room = PAGE_H - BOTTOM - y - trailingReserve();
      var b;
      if (room >= 200) b = box(Math.min(room, 336));
      else {
        newPage();
        b = box(Math.min(PAGE_H - BOTTOM - y - 16, 420));
      }
      var imgId = doc.stream(
        '/Type /XObject /Subtype /Image /Width ' + dim.width + ' /Height ' + dim.height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
        spec.chart
      );
      var name = 'Im' + images.length;
      images.push({ name: name, id: imgId });
      var x = MARGIN + (CONTENT_W - b.w) / 2;
      var pdfY = PAGE_H - (y + b.h);
      ops.push('q ' + num(b.w) + ' 0 0 ' + num(b.h) + ' ' + num(x) + ' ' + num(pdfY) + ' cm /' + name + ' Do Q\n');
      ops.push('q ' + line + ' RG 0.75 w ' + num(x) + ' ' + num(pdfY) + ' ' + num(b.w) + ' ' + num(b.h) + ' re S Q\n');
      y += b.h + 10;
    }

    newPage();
    var titleLines = wrap(spec.title || 'Dean RA', 18, true, CONTENT_W);
    for (var t = 0; t < titleLines.length; t++) {
      need(22);
      drawString(titleLines[t], MARGIN, y, 18, true, ink);
      y += 22;
    }
    y += 2;
    if (spec.subtitle) paragraph(spec.subtitle, 11, false, ink, 8);
    else y += 6;

    var items = spec.details || [];
    if (items.length) {
      var colGap = 16;
      var colW = (CONTENT_W - colGap) / 2;
      var labelW = 92;
      var rowH = 16;
      var rowCount = Math.ceil(items.length / 2);
      need(rowCount * rowH);
      for (var r = 0; r < rowCount; r++) {
        for (var c = 0; c < 2; c++) {
          var item = items[r * 2 + c];
          if (!item) continue;
          var x = MARGIN + c * (colW + colGap);
          drawString(item.label, x, y, 10, false, muted);
          drawString(item.value, x + labelW, y, 10, false, ink);
        }
        y += rowH;
      }
      y += 6;
    }
    if (spec.flag) paragraph(spec.flag, 10, true, brown, 6);
    if (spec.correction) paragraph(spec.correction, 10, false, ink, 6);
    y += 4;
    drawChart();
    paragraph(spec.reference || REFERENCE, 9, false, muted, 4);
    if (spec.limitNote) paragraph(spec.limitNote, 9, false, ink, 4);

    var rows = quoteRows(spec.quote);
    if (rows.length) {
      y += 6;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var strong = !!row.total;
        var sz = strong ? 11 : 10;
        var lead = 15;
        var amountW = textWidth(row.amount, sz, strong);
        var lines = wrap(row.label, sz, strong, CONTENT_W - amountW - 16);
        need(lead * lines.length + (strong ? 8 : 0));
        if (strong) {
          y += 3;
          hline(y, line, 0.7);
          y += 6;
        }
        drawString(lines[0], MARGIN, y, sz, strong, ink);
        drawString(row.amount, MARGIN + CONTENT_W - amountW, y, sz, strong, ink);
        y += lead;
        for (var extra = 1; extra < lines.length; extra++) {
          drawString(lines[extra], MARGIN, y, sz, strong, ink);
          y += lead;
        }
      }
      y += 8;
    }
    paragraph(spec.freight || FREIGHT, 9, false, muted, 0);

    if (started) finishPage();
    var kids = [];
    for (var p = 0; p < pageIds.length; p++) kids.push(pageIds[p] + ' 0 R');
    doc.xref[pagesId] = doc.pos;
    doc.add(pagesId + ' 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageIds.length + ' >>\nendobj\n');
    var infoTitle = BRAND + (spec.title ? ' ' + spec.title : '');
    var infoId = doc.plain('<< /Title ' + pdfStr(infoTitle) + ' /Author ' + pdfStr(BRAND) +
      ' /Creator ' + pdfStr(BRAND) + ' >>');
    var rootId = doc.plain('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    return doc.bytes(rootId, infoId);
  }

  return {
    build: build,
    money: money,
    quoteRows: quoteRows,
    BRAND: BRAND,
    SITE: SITE,
    PHONE: PHONE,
    REFERENCE: REFERENCE,
    FREIGHT: FREIGHT
  };
});

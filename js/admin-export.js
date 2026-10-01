/* Export pages for the Control Centre.
   One list of sections is passed in, the same list the Admins tab uses.
   Each page is a PDF carrying a Naluno watermark. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoExport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SLICE = {
    overview: ['users', 'attention'],
    health: ['worker', 'sw', 'healthLabel'],
    alerts: ['attention', 'alerts'],
    mail: ['mail'],
    ads: ['ads'],
    users: ['users'],
    identity: ['identity'],
    broadcast: ['content'],
    signals: ['signals'],
    journey: ['content'],
    creators: ['creators'],
    toga: ['toga'],
    community: ['safety'],
    trust: ['safety'],
    safety: ['safety'],
    economy: ['economy'],
    support: ['economy'],
    money: ['payments', 'economy'],
    content: ['content'],
    visitors: ['site'],
    reach: ['site'],
    quality: ['metrics'],
    analytics: ['metrics', 'site'],
    records: ['traffic'],
    notifications: ['proof'],
    search: ['users'],
    flags: ['flags'],
    audit: ['audit'],
    books: ['costs'],
    discovery: ['content'],
    known: ['knownApps'],
    rights: ['origin'],
    luganda: ['luganda'],
    admins: ['admins'],
  };

  function sections(roles) {
    return (roles || []).filter(function (pair) {
      return pair && pair[0] && pair[0] !== 'export';
    });
  }

  function rowTime(row) {
    if (!row || typeof row !== 'object') return null;
    const keys = ['created_at', 'createdAt', 'at', 'ts', 'updatedAt', 'updated_at', 'publishAt', 'lastAt', 'day'];
    for (let i = 0; i < keys.length; i++) {
      const v = row[keys[i]];
      if (typeof v === 'number' && isFinite(v) && v > 100000000000) return v;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const n = Date.parse(v);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }

  function inPeriod(row, from, to) {
    const t = rowTime(row);
    if (t == null) return true;
    return t >= from && t <= to;
  }

  function pushLine(out, text) {
    const s = String(text == null ? '' : text).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || out.length > 140) return;
    out.push(s.slice(0, 96));
  }

  function walk(value, from, to, out, depth) {
    if (value == null || out.length > 140 || depth > 5) return;
    if (Array.isArray(value)) {
      let n = 0;
      value.forEach(function (item) {
        if (n >= 36 || out.length > 140) return;
        if (item && typeof item === 'object' && !inPeriod(item, from, to)) return;
        n += 1;
        walk(item, from, to, out, depth + 1);
      });
      return;
    }
    if (typeof value !== 'object') {
      pushLine(out, String(value));
      return;
    }
    const bits = [];
    Object.keys(value).forEach(function (k) {
      const v = value[k];
      if (v && typeof v === 'object') return;
      if (k === 'audio' || k === 'hash' || k === 'password' || k === 'token') return;
      bits.push(k + ' ' + v);
    });
    if (bits.length) pushLine(out, bits.slice(0, 6).join('  |  '));
    Object.keys(value).forEach(function (k) {
      if (value[k] && typeof value[k] === 'object') walk(value[k], from, to, out, depth + 1);
    });
  }

  function linesFor(tab, data, from, to) {
    const out = [];
    const start = new Date(from);
    const end = new Date(to);
    function day(d) {
      if (!isFinite(d.getTime())) return '';
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    pushLine(out, 'Naluno');
    pushLine(out, String(tab || 'section'));
    pushLine(out, 'Period  ' + day(start) + '  to  ' + day(end));
    const keys = SLICE[tab] || [tab];
    let any = false;
    keys.forEach(function (k) {
      if (!data || data[k] == null) return;
      any = true;
      walk(data[k], from, to, out, 0);
    });
    if (!any) pushLine(out, 'No rows for this section in that period.');
    return out;
  }

  function pdfEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function pdf(title, lines) {
    const body = lines && lines.length ? lines : ['Naluno', title || 'Export'];
    const pages = [];
    let cur = [];
    body.forEach(function (line) {
      if (cur.length >= 42) { pages.push(cur); cur = []; }
      cur.push(String(line));
    });
    if (cur.length) pages.push(cur);
    const objects = [];
    function add(obj) { objects.push(obj); return objects.length; }
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];
    pages.forEach(function (linesOn) {
      let stream = 'q 0.82 g BT /F1 52 Tf 0.707 0.707 -0.707 0.707 78 240 Tm (' + pdfEscape('NALUNO') + ') Tj ET Q\n';
      stream += 'BT /F1 9 Tf 48 800 Td 14 TL\n';
      linesOn.forEach(function (line, i) {
        stream += (i === 0 ? '' : 'T*\n') + '(' + pdfEscape(line) + ') Tj\n';
      });
      stream += 'ET\n';
      stream += 'BT /F1 8 Tf 48 36 Td (Naluno) Tj ET';
      const contents = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      const page = add('<< /Type /Page /Parent PAGES /MediaBox [0 0 595 842] /Contents ' + contents + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>');
      pageIds.push(page);
    });
    const kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    const pagesObj = add('<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + kids + '] >>');
    const catalog = add('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>');
    let out = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(function (obj, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + obj.replace('Parent PAGES', 'Parent ' + pagesObj + ' 0 R') + '\nendobj\n';
    });
    const xref = out.length;
    out += 'xref\n0 ' + (objects.length + 1) + '\n';
    out += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer << /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return out;
  }

  return { sections: sections, linesFor: linesFor, pdf: pdf, inPeriod: inPeriod };
});

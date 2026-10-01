/* Export pages for the Control Centre.
   The pages use the same columns as the desk: a name, then rows.
   They do not print tokens, keys, or raw documents. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoExport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function sections(roles) {
    return (roles || []).filter(function (pair) {
      return pair && pair[0] && pair[0] !== 'export';
    });
  }

  function ms(v) {
    if (v && typeof v.toMillis === 'function') v = v.toMillis();
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v) {
      const n = Date.parse(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function inPeriod(v, from, to) {
    const n = ms(v);
    if (n == null) return false;
    return n >= from && n <= to;
  }

  function day(v) {
    const n = ms(v);
    if (n == null) return '';
    const d = new Date(n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function cell(v) {
    return String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28);
  }

  function keep(row, from, to) {
    if (!row) return false;
    const when = row.created_at || row.createdAt || row.at || row.ts || row.updatedAt || row.publishAt || row.lastSeen || row.lastAt;
    if (ms(when) == null) return true;
    return inPeriod(when, from, to);
  }

  function who(row) {
    if (!row) return '';
    return row.name || row.handle || row.creatorName || row.email || row.actorEmail || '';
  }

  function stateOf(b) {
    if (!b) return '';
    if (b.hidden) return 'Taken down';
    if (b.held) return 'Held';
    if (b.live) return 'Live';
    if (b.visibility === 'private') return 'Private';
    return 'Public';
  }

  function table(name, headers, rows) {
    return { name: name, headers: headers, rows: rows.filter(function (r) { return r && r.length; }) };
  }

  function tablesFor(tab, data, from, to) {
    data = data || {};
    const u = data.users || {};
    const c = data.content || {};
    const s = data.signals || {};
    const ads = data.ads || {};
    const mail = (data.mail && data.mail.list) || [];
    const people = (u.list || []).filter(function (row) { return keep(row, from, to); });
    const casts = (c.recent || c.broadcasts || []).filter(function (row) { return keep(row, from, to); });
    const signals = (s.list || []).filter(function (row) { return keep(row, from, to); });
    const audits = (data.audit || []).filter(function (row) { return keep(row, from, to); });
    const out = [];

    if (tab === 'overview' || tab === 'users' || tab === 'search') {
      out.push(table('People', ['Name', 'Handle', 'Joined', 'Last seen', 'State'], people.slice(0, 40).map(function (row) {
        const state = row.suspended ? 'Suspended' : (row.restricted ? 'Restricted' : (row.deleted ? 'Closed' : 'Ok'));
        return [who(row), row.handle || row.number || '', day(row.createdAt || row.created_at), day(row.lastSeen), state];
      })));
    }
    if (tab === 'overview') {
      out.unshift(table('Are people coming back', ['Registered', 'On the app now', 'Active today', 'Active this week', 'Active this month'], [[
        u.total || 0, u.active_now || 0, u.dau || 0, u.wau || 0, u.mau || 0,
      ]]));
    }
    if (tab === 'broadcast' || tab === 'content' || tab === 'journey' || tab === 'discovery') {
      out.push(table('Broadcasts', ['Title', 'Creator', 'State', 'Views', 'When'], casts.slice(0, 40).map(function (b) {
        return [b.title || '(untitled)', who(b), stateOf(b), b.views || 0, day(b.createdAt)];
      })));
    }
    if (tab === 'signals') {
      out.push(table('Signals', ['Who', 'When'], signals.slice(0, 40).map(function (row) {
        return [who(row) || row.creatorName || '', day(row.createdAt || row.ts)];
      })));
    }
    if (tab === 'ads') {
      const list = (ads.list || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('Ads', ['Name', 'Status', 'Impressions', 'Clicks'], list.slice(0, 40).map(function (row) {
        return [row.name || row.headline || row.title || '', row.status || '', row.impressions || 0, row.clicks || 0];
      })));
    }
    if (tab === 'mail') {
      out.push(table('Mail', ['When', 'From', 'Subject'], mail.filter(function (row) { return keep(row, from, to); }).slice(0, 40).map(function (row) {
        return [day(row.createdAt || row.at), row.from || row.email || '', row.subject || row.kind || ''];
      })));
    }
    if (tab === 'audit') {
      out.push(table('Audit', ['When', 'Who', 'Action', 'Target', 'Reason'], audits.slice(0, 40).map(function (row) {
        return [day(row.created_at), row.actorEmail || '', row.action || '', row.target || '', row.reason || ''];
      })));
    }
    if (tab === 'safety' || tab === 'trust' || tab === 'community') {
      const reports = ((data.safety && data.safety.reports) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('Reports', ['When', 'Status', 'Note'], reports.slice(0, 40).map(function (row) {
        return [day(row.createdAt || row.at), row.status || '', row.reason || row.note || ''];
      })));
    }
    if (tab === 'economy' || tab === 'money' || tab === 'support' || tab === 'books') {
      const ledger = ((data.economy && data.economy.ledger) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('Ledger', ['When', 'Event', 'Points', 'Status'], ledger.slice(0, 40).map(function (row) {
        return [day(row.createdAt || row.at), row.type || row.event || '', row.points || 0, row.status || ''];
      })));
    }
    if (tab === 'creators' || tab === 'toga') {
      const list = ((data.creators && data.creators.list) || (data.toga && data.toga.list) || []);
      out.push(table('Creators', ['Creator', 'Broadcasts', 'Views'], list.slice(0, 40).map(function (row) {
        return [who(row), row.broadcasts || 0, row.views || row.score || 0];
      })));
    }
    if (tab === 'health' || tab === 'quality' || tab === 'analytics') {
      const list = ((data.metrics && data.metrics.list) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('What the app reported', ['Name', 'When'], list.slice(0, 40).map(function (row) {
        return [row.name || '', day(row.createdAt)];
      })));
    }
    if (tab === 'visitors' || tab === 'reach') {
      const days = (data.site && data.site.days) || [];
      out.push(table('Visits', ['Day', 'Visits', 'App opens'], days.slice(0, 40).map(function (row) {
        return [row.day || day(row.at), row.visits || row.sessions || 0, row.opens || 0];
      })));
    }
    if (tab === 'notifications') {
      out.push(table('Alerts', ['Handed', 'Failed', 'Arrived', 'Opened'], [[
        (data.proof && data.proof.handed) || 0,
        (data.proof && data.proof.failed) || 0,
        (data.proof && data.proof.arrived) || 0,
        (data.proof && data.proof.opened) || 0,
      ]]));
    }
    if (tab === 'alerts') {
      out.push(table('Needs attention', ['Note'], ((data.attention || data.alerts || []).slice(0, 20)).map(function (row) {
        return [row.text || row];
      })));
    }
    if (tab === 'flags') {
      const flags = data.flags || {};
      out.push(table('Switches', ['Switch', 'On'], Object.keys(flags).slice(0, 30).map(function (k) {
        return [k, flags[k] ? 'Yes' : 'No'];
      })));
    }
    if (tab === 'identity') {
      out.push(table('Identity', ['Handle', 'State'], ((data.identity && data.identity.list) || []).slice(0, 40).map(function (row) {
        return [row.handle || who(row), row.status || row.state || ''];
      })));
    }
    if (tab === 'known') {
      out.push(table('Known', ['Name', 'Status'], (data.knownApps || []).filter(function (row) { return keep(row, from, to); }).slice(0, 40).map(function (row) {
        return [row.name || who(row), row.status || ''];
      })));
    }
    if (tab === 'rights') {
      const list = ((data.origin && data.origin.list) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('Rights', ['Title', 'When', 'State'], list.slice(0, 40).map(function (row) {
        return [row.title || who(row), day(row.createdAt), row.status || ''];
      })));
    }
    if (tab === 'admins') {
      out.push(table('Admins', ['Email'], (data.admins || []).map(function (row) {
        return [row.email || who(row)];
      })));
    }
    if (tab === 'luganda') {
      out.push(table('Luganda', ['Line'], (data.luganda || []).map(function (row) {
        return [row.text || row];
      })));
    }
    if (!out.length) out.push(table(tab || 'Section', ['Note'], [['Nothing in this section for that period.']]));
    return out;
  }

  function pdfEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function pageLines(title, period, tables) {
    const lines = ['Naluno', title || 'Export', period || ''];
    (tables || []).forEach(function (t) {
      lines.push('');
      lines.push(t.name || '');
      lines.push((t.headers || []).map(cell).join(' | '));
      const rows = t.rows && t.rows.length ? t.rows : [['Nothing in this period.']];
      rows.forEach(function (row) {
        lines.push((row || []).map(cell).join(' | '));
      });
    });
    return lines.filter(function (line) { return line != null; });
  }

  function pdf(title, tables, period) {
    const body = pageLines(title, period, tables);
    const pages = [];
    let cur = [];
    body.forEach(function (line) {
      if (cur.length >= 40) { pages.push(cur); cur = []; }
      cur.push(String(line));
    });
    if (cur.length) pages.push(cur);
    const objects = [];
    function add(obj) { objects.push(obj); return objects.length; }
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];
    pages.forEach(function (linesOn) {
      let stream = 'q 0.84 g BT /F1 52 Tf 0.707 0.707 -0.707 0.707 78 240 Tm (NALUNO) Tj ET Q\n';
      stream += 'BT /F1 9 Tf 40 800 Td 14 TL\n';
      linesOn.forEach(function (line, i) {
        stream += (i === 0 ? '' : 'T*\n') + '(' + pdfEscape(line) + ') Tj\n';
      });
      stream += 'ET\nBT /F1 8 Tf 40 36 Td (Naluno) Tj ET';
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

  return { sections: sections, tablesFor: tablesFor, pdf: pdf, inPeriod: inPeriod };
});

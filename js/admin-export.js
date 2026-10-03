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
    return String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 42);
  }
  function money2(n) {
    const x = Number(n);
    if (!isFinite(x)) return '0.00';
    return (Math.round(x * 100) / 100).toFixed(2);
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
    if (tab === 'economy') {
      const ledger = ((data.economy && data.economy.ledger) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('Ledger', ['When', 'Event', 'Points', 'Status'], ledger.slice(0, 40).map(function (row) {
        return [day(row.created_at || row.createdAt || row.at), row.event_type || row.type || row.event || '', row.points || 0, row.status || ''];
      })));
    }
    if (tab === 'money' || tab === 'support' || tab === 'books') {
      const split = (data.economy && data.economy.support_split) || {};
      out.push(table('Support paid out', ['Paid to creators', 'Held by Naluno', 'Naluno share', 'Real payouts'], [[
        money2(split.toCreator), money2(split.held), money2(split.fee), split.payoutsOn ? 'On' : 'Off',
      ]]));
      out.push(table('Each creator', ['Creator', 'Paid to them', 'Held', 'Share', 'Account'], (split.creators || []).slice(0, 40).map(function (c) {
        return [c.uid || '', money2(c.toCreator), money2(c.held), money2(c.fee), c.ready ? 'Ready' : 'None'];
      })));
      const spend = data.deskSpend || [];
      out.push(table('Money spent', ['When', 'What it went to', 'Amount', 'Who'], spend.slice(0, 40).map(function (row) {
        return [day(row.at), row.purpose || '', money2(row.amount), row.byEmail || ''];
      })));
    }
    if (tab === 'creators') {
      const list = (data.creators && data.creators.list) || [];
      out.push(table('Creators', ['Creator', 'Broadcasts', 'Views'], list.slice(0, 40).map(function (row) {
        return [who(row), row.broadcasts || 0, row.views || row.score || 0];
      })));
    }
    if (tab === 'toga') {
      const list = (data.toga && (data.toga.top || data.toga.list)) || [];
      out.push(table('Toga this month', ['Rank', 'Handle', 'Name', 'Points', 'Views', 'Circle', 'Talk', 'New'], list.slice(0, 10).map(function (row, i) {
        return [i + 1, row.handle ? ('@' + String(row.handle).replace(/^@/, '')) : '', row.name || '', row.score || row.scoreMonth || 0, row.viewsMonth || 0, row.circleMonth || 0, row.engageMonth || 0, row.fresh ? 'NEW' : ''];
      })));
    }
    if (tab === 'health') {
      const list = ((data.metrics && data.metrics.list) || []).filter(function (row) { return keep(row, from, to); });
      out.push(table('What the app reported', ['Name', 'When'], list.slice(0, 40).map(function (row) {
        return [row.name || '', day(row.createdAt)];
      })));
    }
    if (tab === 'analytics' || tab === 'visitors' || tab === 'quality' || tab === 'reach') {
      const site = data.site || {};
      out.push(table('Visits', ['Today', 'On the site now', 'Unique today', 'New today', 'Returning today', 'Week', '30 days'], [[
        site.today || 0, site.live || 0, site.uniques_today || 0, site.new_today || 0, site.returning_today || 0, site.week || 0, site.month || 0,
      ]]));
      function bars(name, rows) {
        out.push(table(name, ['Name', 'Count'], (rows || []).slice(0, 16).map(function (row) {
          return [row.label || '', row.n || 0];
        })));
      }
      bars('Countries', site.countries);
      bars('Where they came from', site.sources);
      bars('Landing pages', site.land || site.paths);
      bars('Devices', site.devices);
      out.push(table('Days', ['Day', 'Visits', 'App opens', 'Attention ms'], (site.days || []).slice(0, 31).map(function (row) {
        return [row.id || row.day || '', row.visits || 0, row.appOpens || row.openApp || 0, row.attentionMs || row.ms || 0];
      })));
      if (tab === 'quality') {
        out.push(table('Bots and crawlers', ['Name', 'Website', 'Sessions'], (site.bot_names || []).slice(0, 40).map(function (b) {
          return [b.label || '', b.site || '', b.n || 0];
        })));
      }
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
    if (tab === 'records') {
      out.push(table('Records', ['Note'], [['Open Records in the console for calls, videos and messages in a period. This file does not copy message text.']]));
    }
    if (tab === 'legal') {
      const legalAudits = audits.filter(function (row) {
        const a = String(row.action || '');
        return a.indexOf('incident-') === 0 || a.indexOf('legal-') === 0 || a.indexOf('emergency-') === 0
          || a.indexOf('security-') === 0 || a.indexOf('evidence-') === 0 || a.indexOf('disclosure-') === 0
          || a === 'console-open' || a === 'console-sign-out' || a === 'legal-lookup';
      });
      out.push(table('Trust, Safety and Legal', ['When', 'Who', 'Action', 'Target'], legalAudits.slice(0, 40).map(function (row) {
        return [day(row.created_at), who(row), row.action || '', row.target || ''];
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
    const pages = [];
    function pushPage(rows) { if (rows.length) pages.push(rows); }
    let cur = [];
    function addRow(kind, cells) {
      if (cur.length >= 24) { pushPage(cur); cur = []; }
      cur.push({ kind: kind, cells: cells });
    }
    addRow('title', [title || 'Export']);
    addRow('sub', [period || '']);
    (tables || []).forEach(function (t) {
      addRow('name', [t.name || '']);
      const headers = t.headers || [];
      const rows = t.rows && t.rows.length ? t.rows : [['Nothing in this period.']];
      addRow('head', headers.length ? headers : ['']);
      rows.forEach(function (row) { addRow('row', row || []); });
    });
    pushPage(cur);
    if (!pages.length) pages.push([{ kind: 'title', cells: ['Naluno'] }]);
    const objects = [];
    function add(obj) { objects.push(obj); return objects.length; }
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];
    const pageW = 842;
    const pageH = 595;
    pages.forEach(function (rowsOn) {
      let stream = 'q 0.92 g BT /F1 9 Tf 0.707 0.707 -0.707 0.707 280 70 Tm (Naluno) Tj ET Q\n';
      stream += 'BT /F1 8 Tf\n';
      let y = pageH - 36;
      rowsOn.forEach(function (row) {
        const cells = row.cells || [];
        const n = Math.max(1, cells.length);
        const left = 28;
        const width = pageW - 56;
        const col = width / n;
        const size = row.kind === 'title' ? 14 : (row.kind === 'name' ? 11 : 8);
        stream += '/F1 ' + size + ' Tf\n';
        cells.forEach(function (c, i) {
          const text = cell(c).slice(0, Math.max(8, Math.floor(col / 4.6)));
          const x = left + i * col;
          stream += '1 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Tm (' + pdfEscape(text) + ') Tj\n';
        });
        y -= row.kind === 'title' ? 20 : 14;
      });
      stream += 'ET\nBT /F1 8 Tf 1 0 0 1 28 18 Tm (Naluno) Tj ET';
      const contents = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      const page = add('<< /Type /Page /Parent PAGES /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Contents ' + contents + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>');
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

/* Console: Diagnostics (15 Oct g).

   What went wrong on people's phones, told to Naluno instead of to them:
   - every call attempt (connected or not): the stage it reached, how long
     each stage took, the relay decision, the route it used (candidate types
     only), connection states, restarts, and how it ended;
   - problems the app hit (database refusals with the database's own words
     and index links, script errors, push and upload failures).
   Reads `diagReports` (written by the phones, readable only by the desk).
   Nothing here can change a report. */
(function (root) {
  const DAY = 86400000;

  function ms(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_) { return 0; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return Number(v) || 0;
  }
  function when(r) { return ms(r.at) || Number(r.clientAt) || 0; }
  function median(xs) {
    xs = xs.filter(function (x) { return typeof x === 'number' && isFinite(x) && x >= 0; }).sort(function (a, b) { return a - b; });
    if (!xs.length) return null;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2);
  }
  function gap(st, a, b) { return (st && typeof st[a] === 'number' && typeof st[b] === 'number' && st[b] >= st[a]) ? st[b] - st[a] : null; }
  function bump(o, k, n) { k = String(k == null || k === '' ? '—' : k); o[k] = (o[k] || 0) + (n || 1); }
  function topList(o, n) { return Object.keys(o).map(function (k) { return [k, o[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 12); }
  /* A connected call that later dropped on the network is a failure for the
     person, even though it once connected. */
  function failed(c) {
    if (!c) return false;
    if (c.outcome !== 'connected') return /network|answer-failed|answer-switch|setup-error|media|denied|callee-media|nooffer/.test(String(c.outcome) + ' ' + String(c.endReason || ''));
    return /network/.test(String(c.endReason || ''));
  }

  /** Pure: reports (diagReports documents) → what the tab shows. */
  function summarize(reports, opts) {
    opts = opts || {};
    const since = Number(opts.since) || 0;
    const build = opts.build || '';
    const rows = (reports || []).filter(function (r) { return r && when(r) >= since && (!build || r.build === build); });
    const calls = rows.filter(function (r) { return r.type === 'call' && r.call; });
    const apps = rows.filter(function (r) { return r.type === 'app' && Array.isArray(r.entries); });
    const out = { reports: rows.length, builds: {}, platforms: {}, calls: null, problems: [], failedCalls: [] };
    rows.forEach(function (r) { bump(out.builds, r.build || '?'); bump(out.platforms, r.platform || '?'); });

    const callers = calls.filter(function (r) { return r.call.role === 'caller'; });
    const callees = calls.filter(function (r) { return r.call.role === 'callee'; });
    const outcome = {}, iceDec = {}, route = {}, endReason = {};
    let connected = 0, relayUsed = 0, restarted = 0, recovered = 0, netFail = 0;
    calls.forEach(function (r) {
      const c = r.call;
      bump(outcome, c.outcome);
      if (c.endReason) bump(endReason, c.endReason);
      if (c.ice && c.ice.decision) bump(iceDec, c.role + ' · ' + c.ice.decision);
      if (c.outcome === 'connected') {
        connected++;
        if (c.path) {
          const relay = c.path.local === 'relay' || c.path.remote === 'relay';
          if (relay) relayUsed++;
          bump(route, relay ? 'relay' : 'direct');
        }
      }
      if ((c.restarts || 0) > 0) { restarted++; if (c.recovered) recovered++; }
      if (/network/.test(String(c.outcome) + ' ' + String(c.endReason || ''))) netFail++;
    });
    /* One call has two reports (one per phone). Rates use the caller's. */
    const callerConnected = callers.filter(function (r) { return r.call.outcome === 'connected'; }).length;
    const answered = callers.filter(function (r) { return r.call.answer || r.call.outcome === 'connected'; }).length;
    const answeredConnected = callers.filter(function (r) { return (r.call.answer || r.call.outcome === 'connected') && r.call.outcome === 'connected'; }).length;
    const st = function (list, a, b) { return median(list.map(function (r) { return gap(r.call.stages, a, b); })); };
    out.calls = {
      reports: calls.length, attempts: callers.length, answeringReports: callees.length,
      connected: callerConnected, answered: answered,
      connectRate: answered ? Math.round(answeredConnected * 100 / answered) : null,
      networkFailures: netFail, restarted: restarted, recovered: recovered,
      relayShare: connected ? Math.round(relayUsed * 100 / connected) : null,
      outcomes: topList(outcome, 20), endReasons: topList(endReason, 20), iceDecisions: topList(iceDec, 20), routes: topList(route, 5),
      stageMs: {
        dialToRecord: st(callers, 'dial', 'record'),
        recordToAlert: st(callers, 'record', 'alert'),
        ringToAnswer: st(callees, 'ring', 'answerTap'),
        answerToConnected: st(callees, 'answerTap', 'connected'),
        connectedToHeard: st(callees, 'connected', 'heard'),
      },
    };
    out.failedCalls = calls.filter(function (r) { return failed(r.call); })
      .sort(function (a, b) { return when(b) - when(a); }).slice(0, 40)
      .map(function (r) {
        const c = r.call;
        return {
          at: when(r), build: r.build || '', platform: r.platform || '', device: r.device || '', uid: String(r.uid || '').slice(0, 8),
          role: c.role, kind: c.kind, outcome: c.outcome, endReason: c.endReason || '', stage: c.stageReached || '',
          ice: c.ice ? (c.ice.decision || '') + (c.ice.waitMs != null ? ' (' + c.ice.waitMs + ' ms)' : '') : '',
          route: c.path ? (c.path.local + '/' + c.path.remote + (c.path.relayProto ? ' ' + c.path.relayProto : '')) : '',
          restarts: c.restarts || 0, restartWhy: (c.restartWhy || []).join(', '),
          states: (c.states || []).slice(-8).join(' '), error: c.error || '', bg: !!c.bg,
          media: c.media || {}, callId: String(c.callId || '').slice(0, 10),
        };
      });

    const prob = {};
    apps.forEach(function (r) {
      r.entries.forEach(function (e) {
        const key = (e.kind || '?') + '|' + (e.msg || '');
        const p = prob[key] || (prob[key] = { kind: e.kind || '?', msg: e.msg || '', count: 0, people: {}, builds: {}, platforms: {}, last: 0, detail: '' });
        p.count += Number(e.n) || 1;
        p.people[r.uid || '?'] = 1;
        bump(p.builds, e.build || r.build || '?');
        bump(p.platforms, r.platform || '?');
        const t = Number(e.last) || Number(e.at) || when(r);
        if (t > p.last) { p.last = t; if (e.detail) p.detail = e.detail; }
      });
    });
    out.problems = Object.keys(prob).map(function (k) {
      const p = prob[k];
      const link = (String(p.msg) + ' ' + String(p.detail)).match(/https:\/\/console\.firebase\.google\.com\/[^\s"'<>]+/);
      return { kind: p.kind, msg: p.msg, detail: p.detail, count: p.count, people: Object.keys(p.people).length,
        builds: topList(p.builds, 4).map(function (x) { return x[0]; }), platforms: topList(p.platforms, 3).map(function (x) { return x[0]; }),
        last: p.last, link: link ? link[0] : '' };
    }).sort(function (a, b) { return (b.people - a.people) || (b.count - a.count) || (b.last - a.last); });
    out.builds = topList(out.builds, 12);
    out.platforms = topList(out.platforms, 6);
    return out;
  }

  /* ---- the tab ---- */
  function render(el, H) {
    const esc = H.escapeHtml;
    const st = root.__nalunoDiagView || (root.__nalunoDiagView = { days: 7, build: '' });
    el.innerHTML = H.card('Diagnostics',
      '<p class="sub">What went wrong on people’s phones, sent here instead of being shown to them. Calls: every attempt, connected or not. App: problems the app met (refusals, errors, push and upload failures). Nothing personal is sent: no message text, no addresses, no SDP, no credentials.</p>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 12px;">'
      + [1, 7, 30].map(function (d) { return '<button type="button" class="ghost diag-days" data-days="' + d + '"' + (st.days === d ? ' style="border-color:var(--mint);color:var(--mint);"' : '') + '>' + (d === 1 ? 'Last 24 h' : 'Last ' + d + ' days') + '</button>'; }).join('')
      + '<select id="diagBuild" style="width:auto;background:#12141c;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;"><option value="">All builds</option></select>'
      + '<button type="button" class="ghost" id="diagReload">Reload</button>'
      + '</div><div id="diagOut"><p class="sub">Loading…</p></div>');
    el.querySelectorAll('.diag-days').forEach(function (b) {
      b.onclick = function () { st.days = Number(b.getAttribute('data-days')) || 7; render(el, H); };
    });
    const sel = el.querySelector('#diagBuild');
    if (sel) sel.onchange = function () { st.build = sel.value; paint(); };
    const rl = el.querySelector('#diagReload');
    if (rl) rl.onclick = function () { st.cache = null; render(el, H); };
    let reports = null;
    function paint() {
      const out = el.querySelector('#diagOut');
      if (!out || !reports) return;
      const s = summarize(reports, { since: Date.now() - st.days * DAY, build: st.build });
      if (sel && sel.options.length <= 1) {
        s.builds.forEach(function (b) { const o = document.createElement('option'); o.value = b[0]; o.textContent = b[0] + ' (' + b[1] + ')'; sel.appendChild(o); });
        sel.value = st.build;
      }
      const c = s.calls;
      const sec = function (v) { return v == null ? '—' : (v / 1000).toFixed(1) + ' s'; };
      const list = function (pairs) { return pairs.length ? pairs.map(function (p) { return '<div class="flag-row"><span>' + esc(p[0]) + '</span><span>' + esc(String(p[1])) + '</span></div>'; }).join('') : '<p class="sub">—</p>'; };
      const t = function (ms) { return ms ? new Date(ms).toLocaleString() : ''; };
      let html = H.kpis([
        ['Reports', s.reports],
        ['Calls placed', c.attempts],
        ['Connected', c.connected],
        ['Connected when answered', c.connectRate == null ? '—' : c.connectRate + '%'],
        ['Lost to the network', c.networkFailures],
        ['Restarted', c.restarted],
        ['Saved by a restart', c.recovered],
        ['Through the relay', c.relayShare == null ? '—' : c.relayShare + '%'],
      ]);
      html += H.card('Call stages (medians, this phone’s clock)', H.kpis([
        ['Dial → call written', sec(c.stageMs.dialToRecord)],
        ['Written → alert sent', sec(c.stageMs.recordToAlert)],
        ['Ring → Answer tapped', sec(c.stageMs.ringToAnswer)],
        ['Answer → connected', sec(c.stageMs.answerToConnected)],
        ['Connected → voice heard', sec(c.stageMs.connectedToHeard)],
      ]));
      html += H.card('How calls ended', list(c.outcomes));
      html += H.card('Relay (TURN) decision when the call started', '<p class="sub">turn-ready: kept on the phone · turn-fetched: fetched for this call · no-turn-failed: the service gave none · no-turn-timeout: it did not answer in time · cut-short: the caller had one.</p>' + list(c.iceDecisions));
      html += H.card('Calls that failed (newest first)', s.failedCalls.length ? s.failedCalls.map(function (f) {
        return '<details class="desk-row"><summary><span class="desk-row-title">' + esc(t(f.at) + ' · ' + f.role + ' · ' + (f.endReason || f.outcome)) + '</span>'
          + '<span class="desk-row-sub">' + esc('reached ' + (f.stage || '—') + ' · relay ' + (f.ice || '—') + ' · ' + f.platform + ' · ' + f.build) + '</span></summary>'
          + '<div class="desk-row-body">'
          + [['Phone', f.device + (f.bg ? ' (in the background)' : '')], ['Account', f.uid + '…'], ['Call', f.callId], ['Kind', f.kind], ['Outcome', f.outcome], ['Ended because', f.endReason],
            ['Stage reached', f.stage], ['Relay decision', f.ice], ['Route', f.route || 'never connected'], ['Restarts', f.restarts + (f.restartWhy ? ' (' + f.restartWhy + ')' : '')],
            ['States', f.states], ['Media', JSON.stringify(f.media)], ['Error', f.error]].map(function (kv) {
              return '<div class="desk-kv"><span>' + esc(kv[0]) + '</span><div>' + esc(String(kv[1] == null ? '' : kv[1])) + '</div></div>';
            }).join('')
          + '</div></details>';
      }).join('') : '<p class="sub">No failed calls in this range.</p>');
      html += H.card('App problems (most people first)', s.problems.length ? s.problems.slice(0, 60).map(function (p) {
        return '<details class="desk-row"><summary><span class="desk-row-title">' + esc(p.kind + ' · ' + p.msg.slice(0, 120)) + '</span>'
          + '<span class="desk-row-sub">' + esc(p.people + ' ' + (p.people === 1 ? 'person' : 'people') + ' · ' + p.count + '× · last ' + t(p.last)) + '</span></summary>'
          + '<div class="desk-row-body">'
          + '<div class="desk-kv"><span>Message</span><div>' + esc(p.msg) + '</div></div>'
          + (p.detail ? '<div class="desk-kv"><span>Detail</span><div>' + esc(p.detail) + '</div></div>' : '')
          + '<div class="desk-kv"><span>Builds</span><div>' + esc(p.builds.join(', ')) + '</div></div>'
          + '<div class="desk-kv"><span>Apps</span><div>' + esc(p.platforms.join(', ')) + '</div></div>'
          + (p.link ? '<div class="desk-kv"><span>Fix</span><div><a href="' + esc(p.link) + '" target="_blank" rel="noopener">Open the Firebase page that builds the missing index</a></div></div>' : '')
          + '</div></details>';
      }).join('') : '<p class="sub">No app problems in this range.</p>');
      html += H.card('Where the reports come from', list(s.platforms) + '<h3 style="margin:12px 0 6px;font-size:13px;">Builds</h3>' + list(s.builds));
      out.innerHTML = html;
    }
    if (st.cache && Date.now() - st.cache.at < 60000) { reports = st.cache.rows; paint(); return; }
    const db = H.adminDb && H.adminDb();
    if (!db) { el.querySelector('#diagOut').innerHTML = '<p class="sub">Database is not ready.</p>'; return; }
    db.collection('diagReports').orderBy('at', 'desc').limit(1500).get().then(function (snap) {
      reports = (snap.docs || []).map(function (d) { return Object.assign({ id: d.id }, d.data() || {}); });
      st.cache = { at: Date.now(), rows: reports };
      paint();
    }).catch(function (e) {
      const out = el.querySelector('#diagOut');
      if (out) out.innerHTML = '<p class="sub">Could not read the reports: ' + esc((e && (e.code || e.message)) || 'error') + '. If this says permission, publish the 15 Oct firestore.rules (diagReports).</p>';
    });
  }

  const api = { summarize: summarize, render: render, _failed: failed };
  root.NalunoDiagDesk = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

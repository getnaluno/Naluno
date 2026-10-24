/* ============================================================
   MODULE: js/admin-measures.js  (20 Oct c)
   Control Centre → Measures. What phones counted (js/measure.js), added up
   per day by the economy worker (measureDays/{YYYY-MM-DD}), plus Screen's
   own outcomes and the desk's reviews. Counts, times in bands, outcomes —
   never words, pictures, sound or places. Each list is closed until tapped
   (the console folds every list). Raw batches are kept 180 days.
   ============================================================ */
(function (root) {
  var LABEL = {
    lt1m: 'under 1 min', '1to5m': '1–5 min', '5to20m': '5–20 min', '20mplus': '20 min or more',
    lt5s: 'under 5 s', '5to15s': '5–15 s', '15to30s': '15–30 s', '30splus': '30 s or more', none: 'not answered',
    lt2s: 'under 2 s', '2to10s': '2–10 s', '10to60s': '10–60 s', '1to10m': '1–10 min', '10mplus': '10 min or more',
    '10to60m': '10–60 min', '1hplus': '1 hour or more',
    lt1h: 'under 1 hour', '1to24h': '1–24 hours', '1to7d': '1–7 days', '7dplus': '7 days or more',
    lt10s: 'under 10 s', '10to30s': '10–30 s', '30to60s': '30–60 s', '1to2m': '1–2 min', '2mplus': '2 min or more',
    '0': 'none', '1to2': '1–2', '3to9': '3–9', '10plus': '10 or more',
    '1': '1', '2': '2', '3to5': '3–5', '6to12': '6–12', '13to50': '13–50', '51plus': '51 or more',
    lt1s: 'under 1 s', '1to2s': '1–2 s', '2to4s': '2–4 s', '4to8s': '4–8 s', '8splus': '8 s or more',
    '30to120s': '30 s – 2 min', lt5m: 'under 5 min', '5to15m': '5–15 min', '15to60m': '15–60 min',
  };
  var YESNO = { '0': 'no', '1': 'yes' };
  /* key -> label of the value, when a plain yes/no reads better */
  var BOOL_KEYS = { videooff: 1, flip: 1, pip: 1, cap: 1, ok: 1, done: 1, found: 1, cold: 1, sfu: 1, answered: 1, recheck: 1 };

  function dayKeys(days, now) {
    var out = [];
    var t = now || Date.now();
    for (var i = 0; i < days; i++) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
    return out;
  }
  /* Adds the counters of several day documents. */
  function sumDays(docs) {
    var total = {};
    (docs || []).forEach(function (d) {
      if (!d) return;
      Object.keys(d).forEach(function (k) {
        if (!/^(n|p|c)__/.test(k)) return;
        var v = Number(d[k]) || 0;
        total[k] = (total[k] || 0) + v;
      });
    });
    return total;
  }
  function count(total, name) { return Number(total['n__' + name]) || 0; }
  /* The values of one property of one event, largest first. */
  function dist(total, name, key) {
    var pre = 'p__' + name + '__' + key + '__';
    var rows = [];
    Object.keys(total).forEach(function (k) {
      if (k.indexOf(pre) === 0) rows.push({ v: k.slice(pre.length), n: Number(total[k]) || 0 });
    });
    rows.sort(function (a, b) { return b.n - a.n; });
    return rows;
  }
  function byCountry(total, name) {
    var pre = 'c__' + name + '__';
    var rows = [];
    Object.keys(total).forEach(function (k) { if (k.indexOf(pre) === 0) rows.push({ v: k.slice(pre.length), n: Number(total[k]) || 0 }); });
    rows.sort(function (a, b) { return b.n - a.n; });
    return rows;
  }
  function label(key, v) {
    if (BOOL_KEYS[key] && YESNO[v]) return YESNO[v];
    return LABEL[v] || String(v).replace(/_/g, ' ');
  }
  function countryName(cc) {
    try { if (typeof Intl !== 'undefined' && Intl.DisplayNames) { var n = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); if (n) return n; } } catch (_) {}
    return cc;
  }
  function pct(n, of) { return of ? Math.round((n / of) * 100) + '%' : '—'; }

  /* What each area shows: [event, key, title] for a breakdown, or [event] for a count. */
  var AREAS = [
    { title: 'Calls', counts: [['call_end', 'Call attempts']], lists: [
      ['call_end', 'outcome', 'How calls ended (connected, missed, declined…)'], ['call_end', 'len', 'Length of connected calls'],
      ['call_end', 'ring', 'Time to answer'], ['call_end', 'end', 'How a connected call ended'], ['call_end', 'kind', 'Audio or video'],
      ['call_end', 'path', 'Route (direct or through the relay)'], ['call_end', 'net', 'Network'], ['call_end', 'freezes', 'Video freezes'],
      ['call_end', 'drops', 'Network drop-outs'], ['call_end', 'switched', 'Network switches'], ['call_end', 'videooff', 'Camera switched off'],
      ['call_end', 'flip', 'Lens flipped'], ['call_end', 'camlost', 'Camera lost mid-call (brought back or not)'], ['call_end', 'miclost', 'Mic lost mid-call (brought back or not)'], ['call_end', 'pip', 'Floating window used'], ['call_end', 'role', 'Reported by caller or callee']],
      countries: 'call_end' },
    { title: 'Wireline messages', counts: [['msg_sent', 'Messages sent'], ['msg_delivered', 'Messages arrived'], ['msg_read', 'Messages read'], ['voice_note', 'Voice notes'], ['translate_shown', 'Messages shown translated']], lists: [
      ['msg_sent', 'type', 'Kind of message'], ['msg_sent', 'route', 'Sent at once or from the queue'], ['msg_sent', 'wait', 'Time waiting in the queue'],
      ['msg_delivered', 'lag', 'Time to arrive'], ['msg_read', 'lag', 'Time until read'], ['voice_note', 'len', 'Voice note length'],
      ['voice_note', 'cap', 'Voice notes that hit the 2-minute limit'], ['translate_shown', 'from', 'Translated from'], ['translate_shown', 'to', 'Translated to']],
      countries: 'msg_sent' },
    { title: 'Band', counts: [['band_join', 'Tuned in'], ['band_send', 'Things said'], ['band_clip', 'Clips sent'], ['band_clip_fail', 'Clips that failed'], ['band_room_end', 'Gatherings ended']], lists: [
      ['band_room_end', 'said', 'Anything said before the room emptied'], ['band_room_end', 'people', 'People who spoke in a gathering'], ['band_room_end', 'life', 'How long a gathering lasted'],
      ['band_send', 'kind', 'Text, voice or video'], ['band_clip', 'len', 'Clip length'], ['band_clip', 'cap', 'Clips that ran to the limit (30 s video, 60 s voice)'],
      ['band_clip', 'kind', 'Clip kind'], ['band_clip_fail', 'reason', 'Why clips failed']] },
    { title: 'Broadcast and live', counts: [['publish', 'Published'], ['publish_fail', 'Failed to publish'], ['composer_abandon', 'Left without publishing'], ['watch_depth', 'Watch marks'], ['live_end', 'Lives ended'], ['strand_add', 'Added to a Strand'], ['pass_on', 'Passed on'], ['circle_join', 'Circle joins'], ['offline_save', 'Saved to watch offline'], ['replace_media', 'Photos or videos replaced']], lists: [
      ['watch_depth', 'q', 'How far people watch (25 / 50 / 75 / 100%)'], ['publish', 'kind', 'What was published'], ['publish', 'ms', 'Time to publish'],
      ['publish_fail', 'reason', 'Why publishing failed'], ['composer_abandon', 'stage', 'How far an abandoned post got'],
      ['live_end', 'peak', 'Live: most viewers at once'], ['live_end', 'avg', 'Live: viewers on average'], ['live_end', 'len', 'Live: length'],
      ['live_end', 'drops', 'Live: dropped and resumed'], ['live_end', 'sfu', 'Live: moved to the large-room relay'], ['replace_media', 'kind', 'What was replaced']],
      countries: 'publish' },
    { title: 'Screen (moderation)', counts: [['screen_outcome', 'Posts judged'], ['desk_screen_review', 'Holds the desk looked at']], lists: [
      ['screen_outcome', 'decision', 'Outcome (out, held, stopped, unread)'], ['screen_outcome', 'reason', 'Why held'],
      ['screen_outcome', 'engine', 'Read by'], ['screen_outcome', 'recheck', 'A replaced file re-checked'],
      ['desk_screen_review', 'result', 'Desk decision on a hold (let out = Screen was wrong)'], ['desk_screen_review', 'reason', 'Hold reason reviewed']] },
    { title: 'Signals', counts: [['signal_post', 'Signals posted'], ['signal_view', 'Signals watched'], ['signal_swipe', 'Skipped']], lists: [
      ['signal_post', 'aud', 'To everyone or connections'], ['signal_post', 'type', 'Kind'], ['signal_view', 'done', 'Watched to the end']],
      countries: 'signal_post' },
    { title: 'Getting connected', counts: [['spark', 'Spark'], ['find_search', 'Searches'], ['connect_request', 'Requests'], ['first_connection', 'First connections']], lists: [
      ['spark', 'stage', 'Spark started or completed'], ['find_search', 'found', 'Searches that found someone'],
      ['connect_request', 'stage', 'Requests sent, accepted, declined'], ['connect_request', 'wait', 'Time to accept'],
      ['first_connection', 'since', 'Time from sign-up to first connection']] },
    { title: 'Lifeline and offline', counts: [['lifeline', 'Lifeline messages'], ['offline', 'Times a phone went offline']], lists: [
      ['lifeline', 'route', 'Route (relay, mesh, SMS, waiting)'], ['lifeline', 'ok', 'Went through'], ['lifeline', 'wait', 'Time waiting'],
      ['offline', 'len', 'How long phones were offline']],
      countries: 'offline' },
    { title: 'Language', counts: [['listen', 'Listens'], ['listen_fallback', 'Voice fallbacks'], ['spark_translate', 'Spark translations']], lists: [
      ['app_open', 'lang', 'Language chosen'], ['listen', 'voice', 'Voice that spoke'], ['listen_fallback', 'from', 'Fell back from'],
      ['listen_fallback', 'to', 'Fell back to'], ['spark_translate', 'stage', 'Translation used or abandoned']] },
    { title: 'Welcome and the first week', still7: true, counts: [['onboard', 'Welcome steps'], ['notif_permission', 'Notification answers']], lists: [
      ['onboard', 'step', 'Steps reached (welcome → agreed → country → tour → sign up → Callsign → first message / first call)'], ['notif_permission', 'result', 'Notification permission']] },
    { title: 'App health', counts: [['app_open', 'App opens'], ['app_ready', 'Measured starts'], ['crash_reload', 'Restarts after a crash'], ['storage_full', 'Phone storage full']], lists: [
      ['app_open', 'platform', 'Android app, installed web app or browser'], ['app_open', 'build', 'Version (how fast an update reaches phones)'],
      ['app_open', 'cold', 'Fresh start'], ['app_ready', 'ms', 'Time until the first screen shows'], ['app_ready', 'first', 'First screen']],
      countries: 'app_open' },
    { title: 'Compass and Find Naluno', counts: [['compass_q', 'Compass questions'], ['find_map_open', 'Find Naluno opened'], ['find_on', 'Find Naluno switched'], ['compass_flag', 'Compass answers reported']], lists: [
      ['compass_q', 'topic', 'Topics asked about'], ['compass_q', 'answered', 'Answered'], ['find_on', 'state', 'Switched on or off'], ['compass_flag', 'reason', 'Why answers were reported']] },
    { title: 'Drop and block', counts: [['person_drop', 'People dropped'], ['person_block', 'Blocks changed']], lists: [
      ['person_drop', 'block', 'Dropped and also blocked'], ['person_block', 'state', 'Blocked or undone']] },
  ];

  function listHtml(h, total, ev, key, title) {
    var rows = dist(total, ev, key);
    var all = rows.reduce(function (s, r) { return s + r.n; }, 0);
    if (!rows.length) return '<p class="sub">' + h.escapeHtml(title) + ': nothing yet.</p>';
    return '<div data-measure="' + h.escapeHtml(ev + '.' + key) + '" data-fold-title="' + h.escapeHtml(title) + '">' + rows.map(function (r) {
        var w = all ? Math.max(2, Math.round((r.n / all) * 100)) : 0;
        return '<div class="flag-row" style="align-items:center;gap:10px;"><span style="flex:0 0 44%;">' + h.escapeHtml(label(key, r.v)) + '</span>'
          + '<span style="flex:1;height:8px;border-radius:6px;background:rgba(124,255,178,.12);overflow:hidden;"><i style="display:block;height:100%;width:' + w + '%;background:var(--mint,#7CFFB2);"></i></span>'
          + '<span style="flex:0 0 auto;font-variant-numeric:tabular-nums;">' + r.n + ' · ' + pct(r.n, all) + '</span></div>';
      }).join('') + '</div>';
  }
  function countriesHtml(h, total, ev) {
    var rows = byCountry(total, ev);
    if (!rows.length) return '';
    return '<div data-fold-title="Where (country of the network)">'
      + rows.map(function (r) { return '<div class="flag-row"><span>' + h.escapeHtml(countryName(r.v)) + '</span><span>' + r.n + '</span></div>'; }).join('') + '</div>';
  }
  function areaHtml(h, total, area) {
    var pairs = area.counts.map(function (c) { return [c[1], count(total, c[0])]; });
    if (area.still7 && h.still7) {
      var st = h.still7();
      if (st) pairs.push(['Still active on day 7', st.pct == null ? '—' : (st.pct + '% (' + st.n + ' of ' + st.of + ')')]);
    }
    var k = h.kpis(pairs);
    var lists = area.lists.map(function (l) { return listHtml(h, total, l[0], l[1], l[2]); }).join('');
    return h.card(area.title, k + lists + (area.countries ? countriesHtml(h, total, area.countries) : ''));
  }

  /* Offline by day and country: a day where a country's phones went offline
     at least twice as often as usual (and 3 times or more) is marked — what
     a shutdown looks like from here. */
  function offlineDays(h, keys, docs) {
    var perDay = [];
    var sums = {}, seen = {};
    keys.forEach(function (k, i) {
      var d = docs[i] || {};
      var row = {};
      Object.keys(d).forEach(function (f) {
        if (f.indexOf('c__offline__') === 0) { var cc = f.slice(12); row[cc] = Number(d[f]) || 0; sums[cc] = (sums[cc] || 0) + row[cc]; }
      });
      perDay.push({ day: k, row: row });
    });
    var n = Math.max(1, keys.length);
    var lines = perDay.filter(function (p) { return Object.keys(p.row).length; }).map(function (p) {
      var bits = Object.keys(p.row).sort(function (a, b) { return p.row[b] - p.row[a]; }).slice(0, 5).map(function (cc) {
        var avg = sums[cc] / n;
        var odd = p.row[cc] >= 3 && p.row[cc] >= 2 * avg && n > 1;
        return h.escapeHtml(countryName(cc)) + ' ' + p.row[cc] + (odd ? ' ⚠' : '');
      });
      return '<div class="flag-row"><span>' + h.escapeHtml(p.day) + '</span><span>' + bits.join(' · ') + '</span></div>';
    });
    return h.card('Offline by day and country', lines.length
      ? '<p class="sub">⚠ marks a day where a country\u2019s phones went offline at least twice as often as usual for this period.</p><div>' + lines.join('') + '</div>'
      : '<p class="sub">No offline periods counted in this period.</p>');
  }
  var state = { days: 7 };
  async function render(el, h) {
    if (!el) return;
    var db = h.adminDb && h.adminDb();
    var head = '<p class="sub">Counts, times and outcomes from phones. Never words, pictures, sound or a place: a time is a band (for example 1–5 min), and a country is the country of the network or the one a person chose. Each person’s raw batch is kept 180 days, then deleted; the day totals stay.</p>'
      + '<div class="row" style="gap:8px;flex-wrap:wrap;">'
      + [1, 7, 30, 90].map(function (d) { return '<button type="button" class="ghost ms-days' + (state.days === d ? ' on' : '') + '" data-d="' + d + '">' + (d === 1 ? 'Today' : 'Last ' + d + ' days') + '</button>'; }).join('')
      + '</div>';
    el.innerHTML = h.card('Measures', head + '<div id="msOut"><p class="sub">Reading…</p></div>');
    el.querySelectorAll('.ms-days').forEach(function (b) {
      b.onclick = function () { state.days = Number(b.getAttribute('data-d')) || 7; render(el, h); };
    });
    var out = el.querySelector('#msOut');
    if (!db) { out.innerHTML = '<p class="sub">Database is not ready.</p>'; return; }
    try {
      var keys = dayKeys(state.days);
      var docs = await Promise.all(keys.map(function (k) {
        return db.collection('measureDays').doc(k).get().then(function (s) { return s && s.exists ? (s.data() || {}) : null; }).catch(function () { return null; });
      }));
      var total = sumDays(docs);
      var chosen = {};
      try {
        var users = (h.users && h.users()) || [];
        users.forEach(function (u) { var c = String((u && u.country) || ''); if (/^[A-Z]{2}$/.test(c)) chosen[c] = (chosen[c] || 0) + 1; });
      } catch (_) {}
      var chosenRows = Object.keys(chosen).sort(function (a, b) { return chosen[b] - chosen[a]; });
      var people = h.card('Where people are (the country they chose)', chosenRows.length
        ? '<div>' + chosenRows.map(function (c) { return '<div class="flag-row"><span>' + h.escapeHtml(countryName(c)) + '</span><span>' + chosen[c] + '</span></div>'; }).join('') + '</div>'
        : '<p class="sub">No one has chosen a country yet. It is asked when someone joins, and can be set under Callsign.</p>');
      var any = Object.keys(total).length;
      out.innerHTML = (any ? '' : '<p class="sub">Nothing counted in this period yet. Phones send counts once this version is on them.</p>')
        + people + AREAS.map(function (a) { return areaHtml(h, total, a); }).join('')
        + offlineDays(h, keys, docs)
        + '<div id="msBatches"></div>';
      /* The latest raw batches, for a closer look (who, when, what was counted). */
      try {
        var snap = await db.collection('measureBatches').orderBy('at', 'desc').limit(60).get();
        var rows = (snap.docs || []).map(function (d) { return d.data() || {}; });
        var box = el.querySelector('#msBatches');
        if (box) box.innerHTML = h.card('Latest batches from phones', rows.length ? '<div>' + rows.map(function (b) {
          var names = {};
          (b.events || []).forEach(function (e) { names[e.n] = (names[e.n] || 0) + 1; });
          return '<div class="flag-row"><span>' + h.escapeHtml(new Date(Number(b.at) || 0).toLocaleString()) + ' · ' + h.escapeHtml(String(b.uid || 'before sign-in').slice(0, 10)) + (b.country ? ' · ' + h.escapeHtml(b.country) : '') + '</span>'
            + '<span>' + h.escapeHtml(Object.keys(names).map(function (n) { return n + (names[n] > 1 ? ' ×' + names[n] : ''); }).join(', ')) + '</span></div>';
        }).join('') + '</div>' : '<p class="sub">No batches yet.</p>');
      } catch (_) {}
    } catch (e) {
      out.innerHTML = '<p class="sub">Could not read the measures: ' + h.escapeHtml((e && e.message) || String(e)) + '. Publish firestore.rules so the desk can read them.</p>';
    }
  }

  root.NalunoMeasureDesk = { render: render, sumDays: sumDays, dist: dist, byCountry: byCountry, count: count, dayKeys: dayKeys, AREAS: AREAS, label: label };
  if (typeof module === 'object' && module.exports) module.exports = root.NalunoMeasureDesk;
})(typeof window !== 'undefined' ? window : globalThis);

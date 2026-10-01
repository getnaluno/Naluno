/* Call, video and message records. Counts and names only — never the words. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoTraffic = api;
  try { root.nalunoNoteTraffic = api.note; } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var KINDS = { call: 1, video: 1, message: 1 };
  function clip(s, n) {
    return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n || 80);
  }
  function record(input) {
    var src = input || {};
    var kind = String(src.kind || '');
    if (!KINDS[kind]) return null;
    var actorUid = clip(src.actorUid, 128);
    if (!actorUid) return null;
    var row = {
      kind: kind,
      ok: !!src.ok,
      actorUid: actorUid,
      peerUid: clip(src.peerUid, 128),
      actorName: clip(src.actorName, 60),
      peerName: clip(src.peerName, 60),
      seconds: Math.max(0, Math.round(Number(src.seconds) || 0)),
      at: (typeof src.at === 'number' && src.at > 0) ? src.at : Date.now(),
      status: clip(src.status, 24),
    };
    if (kind === 'video') row.title = clip(src.title, 120);
    return row;
  }
  function inRange(row, from, to) {
    var t = row && row.at;
    if (typeof t !== 'number') return false;
    if (typeof from === 'number' && t < from) return false;
    if (typeof to === 'number' && t >= to) return false;
    return true;
  }
  function summarize(rows, from, to) {
    var out = {
      calls: 0, callsOk: 0, callsFail: 0, talkSeconds: 0,
      videos: 0, videosOk: 0, videosFail: 0,
      messages: 0, messagesOk: 0, messagesFail: 0,
      pairs: [],
    };
    var pairMap = {};
    (rows || []).forEach(function (raw) {
      if (!inRange(raw, from, to)) return;
      if (raw.kind === 'call') {
        out.calls++;
        if (raw.ok) { out.callsOk++; out.talkSeconds += raw.seconds || 0; }
        else out.callsFail++;
        var key = (raw.actorName || raw.actorUid || 'Someone') + ' → ' + (raw.peerName || raw.peerUid || 'Someone');
        if (!pairMap[key]) pairMap[key] = { who: key, n: 0, ok: 0, seconds: 0 };
        pairMap[key].n++;
        if (raw.ok) { pairMap[key].ok++; pairMap[key].seconds += raw.seconds || 0; }
      } else if (raw.kind === 'video') {
        out.videos++;
        if (raw.ok) out.videosOk++; else out.videosFail++;
      } else if (raw.kind === 'message') {
        out.messages++;
        if (raw.ok) out.messagesOk++; else out.messagesFail++;
      }
    });
    out.pairs = Object.keys(pairMap).map(function (k) { return pairMap[k]; })
      .sort(function (a, b) { return b.n - a.n; });
    out.talkHours = Math.round((out.talkSeconds / 3600) * 100) / 100;
    return out;
  }
  function rangeFor(mode, anchor) {
    var d = new Date(anchor || Date.now());
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var from = start.getTime();
    var to;
    if (mode === 'week') {
      var monday = new Date(start);
      monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      from = monday.getTime();
      to = from + 7 * 86400000;
    } else if (mode === 'month') {
      from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    } else if (mode === 'year') {
      from = new Date(d.getFullYear(), 0, 1).getTime();
      to = new Date(d.getFullYear() + 1, 0, 1).getTime();
    } else {
      to = from + 86400000;
    }
    return { from: from, to: to };
  }
  function note(input) {
    var row = record(input);
    if (!row) return null;
    try {
      if (typeof fbDb !== 'undefined' && fbDb && typeof currentUser !== 'undefined' && currentUser) {
        fbDb.collection('traffic').add(row).catch(function () {});
      }
    } catch (_) {}
    return row;
  }
  return { record: record, summarize: summarize, rangeFor: rangeFor, note: note, inRange: inRange };
});

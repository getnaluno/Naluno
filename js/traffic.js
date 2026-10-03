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
  function msOf(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && isFinite(v)) return v > 0 && v < 1e11 ? Math.round(v * 1000) : v;
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch (_) { return 0; }
    }
    if (typeof v.seconds === 'number') return Math.round(v.seconds * 1000 + (v.nanoseconds || 0) / 1e6);
    return 0;
  }
  /* The call document is the record. Records used to read only the optional
     traffic note, and that note was skipped when the other person hung up. */
  function rowFromCall(doc) {
    if (!doc) return null;
    var status = String(doc.status || '');
    var terminal = status === 'ended' || status === 'missed' || status === 'declined' || status === 'busy';
    if (!terminal) return null;
    var created = msOf(doc.createdAt);
    var ended = msOf(doc.endedAt);
    var connected = msOf(doc.connectedAt);
    var seconds = Math.max(0, Math.round(Number(doc.durationSec) || 0));
    if (!seconds && connected && ended >= connected) seconds = Math.round((ended - connected) / 1000);
    if (!seconds && status === 'ended' && created && ended > created) seconds = Math.round((ended - created) / 1000);
    var at = ended || created;
    if (!at) return null;
    var caller = clip(doc.callerUid, 128);
    if (!caller) return null;
    return {
      kind: 'call',
      ok: status === 'ended' && seconds >= 1,
      actorUid: caller,
      peerUid: clip(doc.calleeUid, 128),
      actorName: clip(doc.callerName, 60),
      peerName: clip(doc.calleeName, 60),
      seconds: seconds,
      at: at,
      status: clip(status, 24),
    };
  }
  function samePeople(a, b) {
    return (a.actorUid === b.actorUid && a.peerUid === b.peerUid)
      || (a.actorUid === b.peerUid && a.peerUid === b.actorUid);
  }
  function mergeCalls(trafficRows, callDocs) {
    var rows = (trafficRows || []).slice();
    (callDocs || []).forEach(function (doc) {
      var row = rowFromCall(doc);
      if (!row) return;
      var dup = rows.some(function (t) {
        if (!t || t.kind !== 'call') return false;
        if (!samePeople(t, row)) return false;
        return Math.abs((t.at || 0) - row.at) < 3 * 60 * 1000;
      });
      if (!dup) rows.push(row);
    });
    return rows;
  }
  function note(input) {
    var row = record(input);
    if (!row) return null;
    try {
      if (typeof fbDb !== 'undefined' && fbDb && typeof currentUser !== 'undefined' && currentUser) {
        var callId = input && input.callId ? String(input.callId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) : '';
        if (row.kind === 'call' && callId) {
          /* One row per call. The other phone's write hits the same id and
             is refused (traffic rows are create-only), so the minutes are
             not counted twice. */
          fbDb.collection('traffic').doc('call_' + callId).set(row).catch(function () {});
        } else {
          fbDb.collection('traffic').add(row).catch(function () {});
        }
      }
    } catch (_) {}
    return row;
  }
  return {
    record: record, summarize: summarize, rangeFor: rangeFor, note: note, inRange: inRange,
    msOf: msOf, rowFromCall: rowFromCall, mergeCalls: mergeCalls,
  };
});

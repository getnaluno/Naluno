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
  /* A short reason the desk can store. The rules allow `status` and nothing
     else, and they do not allow the words of a message, so this never
     copies an error sentence — only a token. */
  function failStatus(code, message) {
    var c = String(code || '').toLowerCase();
    var m = String(message || '').toLowerCase();
    var token = 'error';
    if (c.indexOf('permission-denied') >= 0) token = 'denied';
    else if (c.indexOf('unauthenticated') >= 0) token = 'signed-out';
    else if (c.indexOf('unavailable') >= 0) token = 'unavailable';
    else if (c.indexOf('deadline') >= 0 || c.indexOf('timeout') >= 0 || m.indexOf('timeout') >= 0) token = 'timeout';
    else if (c.indexOf('resource-exhausted') >= 0 || m.indexOf('limit') >= 0 || m.indexOf('not accepted') >= 0) token = 'rejected';
    else if (c.indexOf('failed-precondition') >= 0) token = 'precondition';
    else if (c.indexOf('invalid-argument') >= 0) token = 'invalid';
    else if (c.indexOf('not-found') >= 0) token = 'missing';
    else if (m.indexOf('offline') >= 0 || m.indexOf('network') >= 0) token = 'offline';
    else if (m.indexOf('key') >= 0) token = 'nokey';
    return clip(token, 24);
  }
  /* The phone used to write a new "failed" row on every automatic retry
     (about every 12 seconds, and again whenever the app came forward).
     Five or more failures between the same two people, with a typical gap
     of 20 seconds or less, is that loop — one stuck send, not many. */
  function messageFacts(rows, from, to) {
    var ok = 0, fail = 0, byStatus = {}, pairMap = {};
    (rows || []).forEach(function (raw) {
      if (!raw || raw.kind !== 'message' || !inRange(raw, from, to)) return;
      if (raw.ok) ok++; else fail++;
      var st = clip(raw.status || (raw.ok ? 'sent' : 'failed'), 24) || (raw.ok ? 'sent' : 'failed');
      byStatus[st] = (byStatus[st] || 0) + 1;
      var key = String(raw.actorUid || '') + '\n' + String(raw.peerUid || '');
      if (!pairMap[key]) {
        pairMap[key] = {
          who: (raw.actorName || raw.actorUid || 'Someone') + ' → ' + (raw.peerName || raw.peerUid || 'Someone'),
          ok: 0, fail: 0, times: [],
        };
      }
      if (raw.ok) pairMap[key].ok++; else pairMap[key].fail++;
      if (!raw.ok && typeof raw.at === 'number') pairMap[key].times.push(raw.at);
    });
    var loopFails = 0, loops = 0;
    var pairs = Object.keys(pairMap).map(function (k) {
      var p = pairMap[k];
      p.times.sort(function (a, b) { return a - b; });
      var gaps = [];
      for (var i = 1; i < p.times.length; i++) gaps.push(p.times[i] - p.times[i - 1]);
      gaps.sort(function (a, b) { return a - b; });
      var med = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : null;
      var retryLoop = p.fail >= 5 && med != null && med <= 20000;
      if (retryLoop) { loopFails += p.fail; loops++; }
      return {
        who: p.who, ok: p.ok, fail: p.fail,
        first: p.times[0] || 0, last: p.times[p.times.length - 1] || 0,
        medianGapMs: med, retryLoop: retryLoop,
      };
    }).sort(function (a, b) { return (b.fail - a.fail) || (b.ok - a.ok); });
    return {
      sent: ok, failed: fail, byStatus: byStatus, pairs: pairs,
      retryLoopFailures: loopFails,
      likelyDistinctFailures: fail - loopFails + loops,
    };
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
    failStatus: failStatus, messageFacts: messageFacts,
  };
});

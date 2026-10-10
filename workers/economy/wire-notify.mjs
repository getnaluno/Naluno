/* Wireline message alerts (05 Oct).

   POST /v1/wire/notify  { to, clientMsgId }

   The phone that sent a Wireline message asks for the other person to be
   alerted. Everything in the alert comes from the server, not from the
   sender:
   - the two people must be connected both ways, and the conversation's
     last message must be this sender's, from the last 10 minutes (a
     stranger cannot use this to push anyone);
   - the title is the sender's name from their profile;
   - the body is only the kind ("New message", "Voice message", "Photo"…).
     Message text never goes to Google's push service: Wireline stays
     end-to-end.
   The push goes to every phone the person has registered (Android app and
   web/home-screen app), as a high-priority data message that the Android
   app and the service worker turn into the notification. */

export const WIRE_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const WINDOW_MS = 10 * 60 * 1000;
const PER_MINUTE = 40;
const PER_PAIR = 15;
const hits = new Map();
let fcmToken = { value: "", until: 0 };

export function resetWireNotify() {
  hits.clear();
  fcmToken = { value: "", until: 0 };
}

export function wireKindLabel(type) {
  const t = String(type || "text");
  if (t === "voice" || t === "audio") return "Voice message";
  if (t === "photo" || t === "image") return "Photo";
  if (t === "video") return "Video";
  if (t === "file") return "File";
  if (t === "mood") return "Mood";
  if (t === "missed_call" || t === "call") return "Missed call";
  return "New message";
}

function rateOk(uid, now, limit) {
  const minute = Math.floor(now / 60000);
  const k = uid + "|" + minute;
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5000) {
    for (const key of hits.keys()) {
      if (!(Number(String(key).split("|").pop()) >= minute - 1)) hits.delete(key);
    }
  }
  hits.set(k, n);
  return n <= limit;
}

const SILENT = { reaction: 1, receipt: 1, system: 1, typing: 1, read: 1 };

/* deps: { getDoc(path) -> object|null, accessToken(scope) -> string,
           fetch, projectId, now } */
export async function handleWireNotify(body, sender, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const to = String((body && body.to) || "");
  const mid = String((body && body.clientMsgId) || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(to)) return { status: 400, body: { ok: false, error: "bad recipient" } };
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(mid)) return { status: 400, body: { ok: false, error: "bad message id" } };
  if (!sender || !sender.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  if (to === sender.uid) return { status: 400, body: { ok: false, error: "cannot alert yourself" } };
  if (!rateOk(sender.uid, now, PER_MINUTE) || !rateOk(sender.uid + ">" + to, now, PER_PAIR)) return { status: 429, body: { ok: false, error: "slow down" } };

  /* Only people connected both ways, and only for a message this sender
     really just sent (the conversation's last message is theirs, from the
     last 10 minutes). */
  const tid = [sender.uid, to].sort().join("_");
  const [mine, theirs, thread, drop] = await Promise.all([
    deps.getDoc("/users/" + sender.uid + "/connections/" + to),
    deps.getDoc("/users/" + to + "/connections/" + sender.uid),
    deps.getDoc("/threads/" + tid),
    deps.getDoc("/wireDrop/" + to + "/inbox/" + encodeURIComponent(mid)),
  ]);
  if (!mine || !theirs) return { status: 403, body: { ok: false, error: "not connected" } };
  if (drop && (String(drop.from || "") !== sender.uid || (drop.to && String(drop.to) !== to))) {
    return { status: 403, body: { ok: false, error: "not your message" } };
  }
  const parts = (thread && Array.isArray(thread.participants)) ? thread.participants : [];
  const lastAt = Number((thread && thread.lastMessageAt) || 0);
  const fresh = (t) => t && t <= now + 60000 && now - t <= WINDOW_MS;
  const fromThread = parts.indexOf(sender.uid) >= 0 && parts.indexOf(to) >= 0
    && String(thread.lastMessageFrom || "") === sender.uid && fresh(lastAt);
  const fromDrop = !!drop && fresh(Number(drop.ts || 0));
  if (!fromThread && !fromDrop) return { status: 200, body: { ok: true, sent: 0, reason: "old" } };
  const type = String((drop && drop.type) || (thread && thread.lastKind) || "text");
  if (SILENT[type] || (drop && drop.system)) return { status: 200, body: { ok: true, sent: 0, reason: "silent" } };

  const [profile, them, vault] = await Promise.all([
    deps.getDoc("/users/" + sender.uid),
    deps.getDoc("/users/" + to),
    deps.getDoc("/users/" + to + "/vault/main"),
  ]);
  const name = String((profile && profile.name) || "").trim().slice(0, 60) || "Naluno";
  const tokens = tokensOf(vault, them);
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_token" } };
  const link = "/app/?wire=" + encodeURIComponent(sender.uid);
  const out = await sendAll(tokens, {
    type: "wireline",
    fromUid: sender.uid,
    senderName: name,
    title: name,
    body: wireKindLabel(type),
    clientMsgId: mid,
    url: link,
  }, link, deps, now);
  return out;
}

function tokensOf() {
  const tokens = [];
  const kinds = [];
  Array.prototype.slice.call(arguments).forEach(function (d) {
    if (!d) return;
    ["fcmTokenAndroid", "fcmTokenWeb", "fcmToken"].forEach(function (k) {
      const v = d[k];
      if (typeof v === "string" && v.length > 20 && v.length < 4096 && tokens.indexOf(v) < 0) {
        tokens.push(v);
        kinds.push(k === "fcmTokenAndroid" ? "android" : (k === "fcmTokenWeb" ? "web" : (String(d.fcmTokenPlatform || "") || "web")));
      }
    });
  });
  tokens.kinds = kinds;
  return tokens;
}

async function sendAll(tokens, data, link, deps, now) {
  let bearer = fcmToken.value && fcmToken.until > now ? fcmToken.value : "";
  if (!bearer) {
    bearer = await deps.accessToken(WIRE_FCM_SCOPE);
    if (!bearer) return { status: 503, body: { ok: false, sent: 0, error: "push not configured" } };
    fcmToken = { value: bearer, until: now + 50 * 60 * 1000 };
  }
  const endpoint = "https://fcm.googleapis.com/v1/projects/" + deps.projectId + "/messages:send";
  let sent = 0;
  const failures = [];
  const results = [];
  await Promise.all(tokens.map(async function (token, n) {
    const kind = (tokens.kinds && tokens.kinds[n]) || "";
    try {
      const res = await deps.fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: token,
            data: data,
            android: kind === "android"
              ? {
                  priority: "HIGH",
                  ttl: "86400s",
                  notification: {
                    title: String(data.title || "Wireline").slice(0, 80),
                    body: String(data.body || "New message").slice(0, 140),
                    channel_id: "naluno_wireline",
                    sound: "default",
                    tag: "naluno-wire:" + String(data.fromUid || "").slice(0, 40),
                    notification_priority: "PRIORITY_HIGH",
                    visibility: "PUBLIC",
                  },
                }
              : { priority: "HIGH", ttl: "86400s" },
            /* Web: a notification payload is what the lock screen shows when
               Chrome will not start the service worker (screen off). No
               fcm_options.link — a link that is not https is refused, and
               the service worker opens the chat from data.url.
               Android stays a data message plus the wireline channel, so
               the app can still build the tray item itself. */
            webpush: kind === "web"
              ? {
                  headers: { Urgency: "high", TTL: "86400" },
                  notification: {
                    title: String(data.title || "Wireline").slice(0, 80),
                    body: String(data.body || "New message").slice(0, 140),
                    icon: "https://getnaluno.com/icon-192.png",
                    tag: "naluno-wire:" + String(data.fromUid || "msg").slice(0, 40) + ":" + String(data.clientMsgId || "").slice(0, 48),
                    renotify: true,
                    silent: false,
                  },
                }
              : { headers: { Urgency: "high", TTL: "86400" } },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      });
      if (res.ok) { sent++; results.push({ phone: kind, ok: true }); return; }
      const t = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) fcmToken = { value: "", until: 0 };
      const why = /UNREGISTERED|NOT_FOUND/.test(t) ? "unregistered" : ("http_" + res.status);
      failures.push(why);
      results.push({ phone: kind, ok: false, why: why });
    } catch (_) {
      failures.push("network");
      results.push({ phone: kind, ok: false, why: "network" });
    }
  }));
  return { status: 200, body: { ok: true, sent: sent, tokens: tokens.length, failures: failures, phones: results } };
}

/* POST /v1/push/test { delay } — a Wireline-style alert to your OWN phones,
   after a short delay so you can leave Naluno first. The answer says what
   happened for each phone, in words the app can show. */
export async function handlePushTest(body, user, deps) {
  const now = deps.now ? deps.now() : Date.now();
  if (!user || !user.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  if (!rateOk("test:" + user.uid, now, 4)) return { status: 429, body: { ok: false, error: "slow down" } };
  const [me, vault] = await Promise.all([
    deps.getDoc("/users/" + user.uid),
    deps.getDoc("/users/" + user.uid + "/vault/main"),
  ]);
  const tokens = tokensOf(vault, me);
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_token" } };
  const wait = Math.max(0, Math.min(8000, Number((body && body.delay) || 0) || 0));
  if (wait && deps.sleep) await deps.sleep(wait);
  return sendAll(tokens, {
    type: "wireline",
    fromUid: user.uid,
    senderName: "Naluno",
    title: "Naluno",
    body: "Test alert: Wireline notifications reach this phone.",
    clientMsgId: "test-" + now,
    url: "/app/",
  }, "/app/", deps, deps.now ? deps.now() : Date.now());
}

/* POST /v1/push/lock — the alert a locked web app can show.
   The call itself is unchanged. This only paints the notification, and
   only after the database says the call is still ringing or the Broadcast
   is actually live. The words come from the profile, not from the phone. */
export async function handleLockPush(body, user, deps) {
  const now = deps.now ? deps.now() : Date.now();
  if (!user || !user.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  if (!rateOk("lock:" + user.uid, now, 30)) return { status: 429, body: { ok: false, error: "slow down" } };
  const to = String((body && body.to) || "").replace(/[^A-Za-z0-9_-]/g, "");
  const type = String((body && body.type) || "");
  if (!to || to === user.uid) return { status: 400, body: { ok: false, error: "to" } };
  const profile = await deps.getDoc("/users/" + user.uid);
  const name = String((profile && profile.name) || "").trim().slice(0, 60) || "Someone";
  let data = null;
  if (type === "incoming_call") {
    const callId = String((body && body.callId) || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
    if (!callId) return { status: 400, body: { ok: false, error: "call" } };
    const call = await deps.getDoc("/calls/" + callId);
    if (!call || String(call.callerUid || "") !== user.uid || String(call.calleeUid || "") !== to) {
      return { status: 403, body: { ok: false, error: "not your call" } };
    }
    if (String(call.status || "") !== "ringing") return { status: 200, body: { ok: true, sent: 0, reason: "not ringing" } };
    const voice = String(call.kind || call.callKind || "") === "audio";
    data = {
      type: "incoming_call",
      callId: callId,
      callerName: name,
      title: name + (voice ? " · voice call" : " is calling"),
      body: voice ? "Voice call — tap to answer on Naluno" : "Tap to answer on Naluno",
      url: "/app/",
    };
  } else if (type === "broadcast_live") {
    const broadcastId = String((body && body.broadcastId) || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
    if (!broadcastId) return { status: 400, body: { ok: false, error: "broadcast" } };
    const row = await deps.getDoc("/broadcasts/" + broadcastId);
    if (!row || String(row.creatorUid || "") !== user.uid || row.live !== true) {
      return { status: 403, body: { ok: false, error: "not live" } };
    }
    const circle = await deps.getDoc("/users/" + user.uid + "/circle/" + to);
    const conn = await deps.getDoc("/users/" + user.uid + "/connections/" + to);
    if (!circle && !conn) return { status: 403, body: { ok: false, error: "not connected" } };
    const title = String(row.title || "Broadcast").slice(0, 80);
    data = {
      type: "broadcast_live",
      broadcastId: broadcastId,
      fromUid: user.uid,
      fromName: name,
      title: name + " is live",
      body: title,
      url: "/app/?broadcast=" + encodeURIComponent(broadcastId),
    };
  } else {
    return { status: 400, body: { ok: false, error: "type" } };
  }
  const [them, vault] = await Promise.all([
    deps.getDoc("/users/" + to),
    deps.getDoc("/users/" + to + "/vault/main"),
  ]);
  const all = tokensOf(vault, them);
  const tokens = [];
  const kinds = [];
  all.forEach(function (token, n) {
    if ((all.kinds && all.kinds[n]) === "web") {
      tokens.push(token);
      kinds.push("web");
    }
  });
  tokens.kinds = kinds;
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_web_token" } };
  return sendAll(tokens, data, data.url, deps, now);
}

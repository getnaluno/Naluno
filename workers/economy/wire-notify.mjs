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
  const tokens = [];
  [vault, them].forEach(function (d) {
    if (!d) return;
    ["fcmTokenAndroid", "fcmTokenWeb", "fcmToken"].forEach(function (k) {
      const v = d[k];
      if (typeof v === "string" && v.length > 20 && v.length < 4096 && tokens.indexOf(v) < 0) tokens.push(v);
    });
  });
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_token" } };

  let bearer = fcmToken.value && fcmToken.until > now ? fcmToken.value : "";
  if (!bearer) {
    bearer = await deps.accessToken(WIRE_FCM_SCOPE);
    if (!bearer) return { status: 503, body: { ok: false, sent: 0, error: "push not configured" } };
    fcmToken = { value: bearer, until: now + 50 * 60 * 1000 };
  }
  const label = wireKindLabel(type);
  const link = "/app/?wire=" + encodeURIComponent(sender.uid);
  const data = {
    type: "wireline",
    fromUid: sender.uid,
    senderName: name,
    title: name,
    body: label,
    clientMsgId: mid,
    url: link,
  };
  const endpoint = "https://fcm.googleapis.com/v1/projects/" + deps.projectId + "/messages:send";
  let sent = 0;
  const failures = [];
  await Promise.all(tokens.map(async function (token) {
    try {
      const res = await deps.fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: token,
            data: data,
            android: { priority: "HIGH", ttl: "86400s" },
            webpush: { headers: { Urgency: "high", TTL: "86400" }, fcm_options: { link: link } },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      });
      if (res.ok) { sent++; return; }
      const t = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) fcmToken = { value: "", until: 0 };
      failures.push(/UNREGISTERED|NOT_FOUND/.test(t) ? "unregistered" : ("http_" + res.status));
    } catch (_) {
      failures.push("network");
    }
  }));
  return { status: 200, body: { ok: true, sent: sent, tokens: tokens.length, failures: failures } };
}

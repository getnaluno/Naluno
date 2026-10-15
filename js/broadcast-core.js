/* OWNERSHIP (broadcast-core.js): Broadcast VOD/live community only.
   MUST NOT touch: calls peerConnection, remoteCombinedStream, bandMeshPcs.
   ICE for live: getIceServers() from ice-core. Playback: <video src> only. */
/* ============================================================
   MODULE: js/broadcast-core.js
   Permanent Broadcasts — not Signals.
   A Broadcast is a lasting community around media (YouTube-like permanence).
   A Signal is a short ephemeral clip (separate module: signal-*).
   OWNERSHIP: CRUD, search, share links, delete, list cache.
   ============================================================ */

let myBroadcasts = [];          // permanent docs I created
let feedBroadcasts = [];        // from connections + mine for tab
let broadcastSearchResults = [];
let composerMode = 'signal';    // 'signal' | 'broadcast'
let signalTtlChoice = 24;       // hours: 24 | 72 | 168

const SIGNAL_TTL_OPTIONS = {
  24:  24 * 60 * 60 * 1000,
  72:  72 * 60 * 60 * 1000,
  168: 168 * 60 * 60 * 1000,
};

/* The naluno-signal R2 bucket deletes every object after 25 hours (a bucket
   lifecycle rule — confirmed against signal-worker/index.js, which sets no
   expiry of its own, so the bucket is the only thing controlling this).
   Promising a longer life than storage actually keeps is what caused the
   "Signal stops working before the set days" bug: Firestore honoured 3/7
   days correctly while the video file itself was already gone at ~25h.
   Capping here (not just hiding the chips in index.html) so a stale cached
   page, an old saved preference, or any other path that still carries 72
   or 168 can't reintroduce it. Raise this to 168 the moment that bucket's
   lifecycle rule is extended — that single change plus restoring the two
   chips is the whole fix; SIGNAL_TTL_OPTIONS already supports both. */
const SIGNAL_TTL_MAX_HOURS = 24;

function signalTtlMs(){
  const hours = Math.min(Number(signalTtlChoice) || 24, SIGNAL_TTL_MAX_HOURS);
  return SIGNAL_TTL_OPTIONS[hours] || SIGNAL_TTL_OPTIONS[24];
}

/* Share links stay on getnaluno.com. A workers.dev URL in a chat is the
   worker's address, not the product, and it is what people were sending.
   A static page cannot unfurl a different picture per Broadcast (crawlers
   do not run the app). The share therefore attaches a real card image —
   the Broadcast's picture and title — and the link only opens the app.
   The worker still serves /b/<id> for links already sent. */
function broadcastLinkSlug(title){
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
function broadcastShareUrl(id, title){
  const slug = broadcastLinkSlug(title);
  const base = 'https://getnaluno.com/app/?broadcast=' + encodeURIComponent(id || '');
  return slug ? (base + '&t=' + encodeURIComponent(slug)) : base;
}

/** Share a whole Strand (a creator's ordered set of Broadcasts), not just one item in it. */
function strandShareUrl(id){
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?strand=' + encodeURIComponent(id);
}

function broadcastIsWriting(b){
  return !!(b && (b.mediaType === 'writing' || b.kind === 'writing'));
}
function broadcastCoverUrl(b){
  if(window.NalunoPass && typeof NalunoPass.coverUrl === 'function') return NalunoPass.coverUrl(b);
  if(!broadcastIsWriting(b)) return '';
  const url = (b.thumbUrl || b.mediaUrl || '');
  if(!url) return '';
  if(/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url)) return '';
  return url;
}
function broadcastFeedText(b){
  if(!b) return { text: '', more: false, lines: 4 };
  const writing = broadcastIsWriting(b);
  const bare = writing && !broadcastCoverUrl(b);
  const raw = writing ? (b.body || b.description || '') : (b.description || '');
  const lines = bare ? 8 : 4;
  if(window.NalunoRoomThreads && typeof NalunoRoomThreads.feedCopy === 'function'){
    return NalunoRoomThreads.feedCopy(raw, lines);
  }
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return { text: text, more: text.length > lines * 34, lines: lines };
}

/** Unique Naluno thumbnail: diagonal “frequency plate” with mint edge + title band */
function broadcastThumbHtml(b){
  const title = escapeHtml((b.title || 'Broadcast').slice(0, 80));
  const creator = escapeHtml((b.creatorName || 'Someone').split(' ')[0]);
  const writing = broadcastIsWriting(b);
  const cover = broadcastCoverUrl(b);
  const thumb = (b.thumbUrl && !(typeof nalunoThumbLooksDead === 'function' && nalunoThumbLooksDead(b.thumbUrl))) ? b.thumbUrl : '';
  const photo = writing ? cover : (thumb || ((b.mediaType === 'photo') ? (b.mediaUrl || '') : ''));
  const preview = (!writing && !b.live && b.mediaType !== 'photo')
    ? (b.mediaUrl || b.videoUrl || '')
    : '';
  const rescue = preview ? ` data-media="${escapeHtml(preview)}" data-bcast-id="${escapeHtml(b.id || '')}" onerror="nalunoRescueThumb(this)"` : '';
  const copy = broadcastFeedText(b);
  const excerptHtml = copy.text
    ? `<div class="bcast-plate-copy"><p class="bcast-plate-excerpt">${escapeHtml(copy.text)}</p>${copy.more ? '<span class="bcast-plate-more">See more</span>' : ''}</div>`
    : '';
  let mins = 0;
  if(writing){
    const words = Number(b.words) || (copy.text ? copy.text.split(' ').length : 0);
    mins = Math.max(1, Math.round((Number(b.durationSec) || (words / 3.3)) / 60));
  }
  let inner;
  if(preview){
    inner = (photo ? `<img src="${escapeHtml(photo)}" alt="" class="strand-poster"${rescue} />` : `<img alt="" class="strand-poster" data-need-thumb="1"${rescue} style="display:none" />`)
      + `<video class="strand-preview" muted playsinline webkit-playsinline loop preload="none" poster="${escapeHtml(photo)}" data-preview-src="${escapeHtml(preview)}" data-naluno-preview="1"></video>`;
  } else if(photo && writing){
    inner = `<img src="${escapeHtml(photo)}" alt="" class="bcast-plate-media" />`;
  } else if(photo){
    inner = `<img src="${escapeHtml(photo)}" alt="" class="bcast-plate-media" loading="lazy"${rescue} />`;
  } else if(writing){
    inner = `<div class="bcast-plate-read"><div class="bcast-plate-kicker">Writing${mins ? ' · ' + mins + ' min' : ''}</div>${excerptHtml || '<p class="bcast-plate-excerpt">Writing</p>'}</div>`;
  } else {
    inner = `<div class="bcast-plate-fallback">${escapeHtml((b.creatorName || '?').slice(0,1).toUpperCase())}</div>`;
  }
  const live = b.live ? `<span class="bcast-plate-live"><i class="bcast-live-dot"></i>LIVE</span>${photo ? '' : '<span class="bcast-live-wait">Live now · tap to join</span>'}` : '';
  const privMark = (b.visibility === 'private')
    ? '<span class="bcast-plate-priv" style="position:absolute;top:8px;right:8px;z-index:3;font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;background:rgba(124,77,255,.22);color:#d7ccff;padding:3px 8px;border-radius:999px;">Private</span>'
    : '';
  const schedMark = (!privMark && typeof broadcastIsScheduled === 'function' && broadcastIsScheduled(b))
    ? '<span class="bcast-plate-priv" style="position:absolute;top:8px;right:8px;z-index:3;font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;background:rgba(255,194,102,.2);color:#ffc266;padding:3px 8px;border-radius:999px;">Scheduled</span>'
    : '';
  /* Your own Broadcast that the public feed does not list. The app used to
     show it to you as public (an older post missing the listing fields, or
     one waiting for a first look), while nobody else could see it. */
  let waitMark = '';
  try{
    const mine = typeof currentUser !== 'undefined' && currentUser && b.creatorUid === currentUser.uid;
    if(mine && !privMark && !schedMark && !b.live && typeof nalunoPublicListable === 'function' && !nalunoPublicListable(b)){
      const why = b.hidden ? 'Taken down' : (b.held ? 'Waiting for a first look' : 'Not on the public feed');
      waitMark = '<span class="bcast-plate-priv bcast-plate-wait" title="' + escapeHtml(why) + '" style="position:absolute;top:8px;right:8px;z-index:3;font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;background:rgba(139,144,168,.22);color:#c9cde0;padding:3px 8px;border-radius:999px;">' + escapeHtml(why) + '</span>';
    }
  }catch(_){}
  const writeMark = writing && cover && !b.live && typeof nalunoPlateGlance !== 'function' ? `<span class="bcast-plate-live" style="background:rgba(124,255,178,.16);color:var(--mint);border-color:rgba(124,255,178,.4);">Writing</span>` : '';
  const hold = (!b.live && b.held) ? `<span class="bcast-plate-live" style="background:rgba(255,194,102,.2);color:#ffc266;border-color:rgba(255,194,102,.4);">Waiting</span>` : '';
  const down = (!b.live && b.hidden) ? `<span class="bcast-plate-live" style="background:rgba(255,84,112,.18);color:#ff8a9a;border-color:rgba(255,84,112,.4);">Taken down</span>` : '';
  const viewsBit = (typeof formatNalunoViews === 'function' && (b.shareViews !== false) && typeof nalunoPlateGlance !== 'function')
    ? `<span class="bcast-plate-views">${escapeHtml(formatNalunoViews(b.views || 0))}</span>`
    : '';
  const writingBand = (writing && cover && excerptHtml)
    ? `<div class="bcast-plate-kicker">Writing${mins ? ' · ' + mins + ' min' : ''}</div>${excerptHtml}`
    : '';
  const credit = (window.NalunoPass && typeof NalunoPass.lockedCredit === 'function') ? NalunoPass.lockedCredit(b) : null;
  const byline = (credit && window.NalunoPass.byline) ? `<div class="bcast-plate-by">${escapeHtml(NalunoPass.byline(credit))}</div>` : '';
  const metaExcerpt = writing ? writingBand : excerptHtml;
  /* 07b: readable at first sight. What it is (Watch / Read / Live, and
     Luganda), who made it, how many have seen it and when — before anyone
     taps. A written Broadcast can be heard from the feed (Listen). */
  const glance = (typeof nalunoPlateGlance === 'function') ? nalunoPlateGlance(b, { writing: writing, mins: mins, cover: cover }) : null;
  const metaTop = glance ? glance.kicker : '';
  const metaStats = glance ? glance.stats : '';
  const metaListen = glance ? glance.listen : '';
  const metaMore = glance ? glance.more : '';
  const bareRead = writing && !cover && !b.live;
  if(glance && bareRead){
    inner = `<div class="bcast-plate-read bcast-read-card"><div class="bcast-read-title">${title}</div>${copy.text ? `<p class="bcast-plate-excerpt">${escapeHtml(copy.text)}</p>` : ''}</div>`;
  }
  return `<article class="bcast-plate${writing ? ' is-writing' : ''}${writing && cover ? ' has-photo' : ''}${b.live ? ' is-live' : ''}${glance ? ' has-glance' : ''}${bareRead && glance ? ' is-read-card' : ''}" data-broadcast-id="${escapeHtml(b.id)}"${glance ? ` data-kind="${glance.kind}"${glance.lg ? ' data-lg="1"' : ''}` : ''}${b.live ? ` data-live="1" data-creator-uid="${escapeHtml(b.creatorUid || '')}" data-live-room="${b.liveRoom === true ? '1' : (b.liveRoom === false ? '0' : '')}"` : ''} role="button" tabindex="0">
    <div class="bcast-plate-frame">
      ${inner}
      ${live}
      ${privMark}${waitMark}
      ${schedMark}
      ${writeMark}
      ${hold}
      ${down}
      ${viewsBit}
      ${preview && !b.live ? '<span class="bcast-tap-play" aria-hidden="true">tap to play</span>' : ''}
      <div class="bcast-plate-scan"></div>
    </div>
    <div class="bcast-plate-meta">
      ${metaTop}
      ${bareRead && glance ? '' : `<div class="bcast-plate-title">${title}</div>`}
      ${glance ? (writing && cover ? excerptHtml : (writing ? '' : excerptHtml)) : metaExcerpt}
      ${metaListen}
      <div class="bcast-plate-sub"><span class="bcast-plate-who" data-known-uid="${escapeHtml(b.creatorUid || '')}">${creator}</span>${glance ? '' : (mins && cover ? ' · ' + mins + ' min' : '')}${b.strandName ? ' · ' + escapeHtml(b.strandName) : (b.tags && b.tags[0] ? ' · ' + escapeHtml(b.tags[0]) : '')}</div>
      ${metaStats}
      ${byline}
      ${metaMore}
    </div>
  </article>`;
}

/* 12c: everyone is a trusted publisher until a report is filed about them;
   then a person on the desk decides (trustedPublisher true or false).
   Same rule as the economy worker's publisherTrusted (screen.mjs). */
function nalunoPublisherTrusted(){
  try{
    const p = (typeof currentProfile !== 'undefined' && currentProfile) || {};
    if(p.restricted || p.suspended) return false;
    if(p.trustedPublisher === false) return false;
    if(p.publisherReview === 'pending') return false;
    return true;
  }catch(_){ return false; }
}

/** Reach: how long a video Broadcast may be, and how many in a day.
 *  A new Callsign is short. Work that stays up opens the length.
 *  The desk can open the full room. This is not a phone check. */
function nalunoReachTier(profile, now){
  const p = profile || {};
  const set = String(p.reach || '');
  if(set === 'full' || set === 'kept' || set === 'open') return set;
  const at = Number(now) || Date.now();
  const created = Number(p.createdAt) || at;
  const age = Math.max(0, at - created);
  const placed = Number(p.reachPlaced) || 0;
  const day = 24 * 60 * 60 * 1000;
  if(age >= 60 * day && placed >= 10) return 'full';
  if(age >= 14 * day && placed >= 4) return 'kept';
  return 'open';
}
function nalunoReachMaxSec(profile, now){
  return nalunoReachTier(profile, now) === 'open' ? 40 * 60 : 3 * 60 * 60;
}
async function nalunoReachClaim(seconds){
  const user = (typeof currentUser !== 'undefined') ? currentUser : null;
  const tok = user && user.getIdToken ? await user.getIdToken() : '';
  if(!tok) return { blocked: true, error: 'Sign in first' };
  const base = (typeof nalunoEconomyUrlBroadcast === 'function')
    ? nalunoEconomyUrlBroadcast()
    : 'https://naluno-economy.naluno.workers.dev';
  /* 14 Oct: a video goes out only with a pass. Any failure other than "too
     long" used to return an empty pass and the video went out unchecked.
     A busy worker (503) or a dropped connection gets one more try. */
  let r = null, data = {};
  for(let attempt = 0; attempt < 2; attempt++){
    try{
      r = await fetch(base + '/v1/reach/claim', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: Math.max(1, Math.round(Number(seconds) || 0)) }),
      });
      data = await r.json().catch(function(){ return {}; });
    }catch(_){ r = null; data = {}; }
    if(r && (r.ok || r.status === 403 || r.status < 500)) break;
    if(attempt === 0) await new Promise(function(res){ setTimeout(res, 1500); });
  }
  if(r && r.status === 403){
    return { blocked: true, limit: true, error: (data && data.error) || 'This video is past your Reach.' };
  }
  if(!r || !r.ok || !data.ok || !data.passId){
    return { blocked: true, error: 'Could not check this video\u2019s Reach just now. Nothing was posted. Try again in a minute.' };
  }
  return { blocked: false, passId: data.passId, tier: data.tier };
}
window.nalunoReachTier = nalunoReachTier;
window.nalunoReachMaxSec = nalunoReachMaxSec;
window.nalunoReachClaim = nalunoReachClaim;
function nalunoBroadcastListingFields(screen, opts){
  opts = opts || {};
  let decision = (screen && screen.decision) || '';
  /* 29h: a picture that was never read by Screen is not published unseen,
     whoever posts it. (A Pass-on of a public Broadcast inherits its check.) */
  if(opts.hasPicture && !opts.inherited && (!decision || decision === 'unread')) decision = 'hold';
  if(decision === 'block'){
    return { listed: false, held: true, heldReason: 'screen', hidden: false };
  }
  /* A content HOLD applies to everyone, trusted or not. Trust used to be
     checked first, so a trusted publisher's held upload went public anyway
     ("held but accepted"). Trust only skips the new-publisher hold below. */
  if(decision === 'hold'){
    return { listed: false, held: true, heldReason: 'screen', hidden: false };
  }
  if(nalunoPublisherTrusted()){
    return { listed: true, held: false, heldReason: '', hidden: false };
  }
  if(decision === 'allow'){
    return { listed: true, held: false, heldReason: '', hidden: false };
  }
  let why = 'new-publisher';
  try{
    const p = (typeof currentProfile !== 'undefined' && currentProfile) || {};
    why = (p.restricted || p.suspended) ? 'restricted' : (p.trustedPublisher === false ? 'not-trusted' : (p.publisherReview === 'pending' ? 'under-review' : 'new-publisher'));
  }catch(_){}
  return { listed: false, held: true, heldReason: why, hidden: false };
}
/** On the public feed. Legacy docs without listed stay visible until hidden/held. */
/* Scheduled: not public until its moment arrives.
   Private: never public — only the person who made it.
   Both are also enforced in firestore.rules; this is what the app shows. */
function broadcastIsScheduled(b){
  const at = Number(b && b.publishAt) || 0;
  /* 15 Oct: "not yet due" by the server's clock, not this phone's. A phone
     running slow treated every post made in its last hour (by its clock,
     still "in the future") as scheduled and left it off the feed. */
  return at > nalunoServerNow();
}
function nalunoServerNow(){
  let skew = 0;
  try{
    if(typeof nalunoServerSkew === 'number' && isFinite(nalunoServerSkew)) skew = nalunoServerSkew;
    else if(typeof window !== 'undefined' && typeof window.nalunoStoredSkew === 'number' && isFinite(window.nalunoStoredSkew)) skew = window.nalunoStoredSkew;
  }catch(_){}
  return Date.now() + skew;
}
try{ window.nalunoServerNow = nalunoServerNow; }catch(_){}
function broadcastIsPrivate(b){
  return !!(b && b.visibility === 'private');
}
function broadcastIsPublic(b){
  if(!b || b.deleted) return false;
  if(b.hidden) return false;
  if(b.held) return false;
  if(b.listed === false) return false;
  if(broadcastIsPrivate(b)) return false;
  if(broadcastIsScheduled(b)) return false;
  return true;
}
/* Exactly what firestore.rules let anyone list (and the public queries ask
   for): the five listing fields set, and a numeric publishAt that has
   passed. broadcastIsPublic() above is more lenient (an older post with no
   listing fields counts), which is right for reading one you already have,
   but not for saying it is on the public feed. */
function nalunoPublicListable(b, now){
  if(!b || b.deleted) return false;
  if(b.listed !== true || b.hidden !== false || b.held !== false) return false;
  if(b.visibility !== 'public') return false;
  const at = b.publishAt;
  return typeof at === 'number' && at > 0 && at <= (now || Date.now());
}
window.nalunoPublicListable = nalunoPublicListable;
function broadcastVisibleTo(b, uid){
  if(!b || b.deleted) return false;
  if(uid && b.creatorUid === uid) return true;
  return broadcastIsPublic(b);
}
function nalunoEconomyUrlBroadcast(){
  return 'https://naluno-economy.naluno.workers.dev';
}
async function nalunoPlaceBroadcast(id, screen){
  if(!id) return null;
  try{
    const user = (typeof currentUser !== 'undefined') ? currentUser : null;
    const tok = user && user.getIdToken ? await user.getIdToken() : '';
    if(!tok) return null;
    let packed = null;
    try{
      if(screen && typeof nalunoScreenPack === 'function') packed = nalunoScreenPack(screen);
      else if(screen && screen.packed) packed = screen.packed;
    }catch(_){}
    const r = await fetch(nalunoEconomyUrlBroadcast() + '/v1/broadcast/place', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcast_id: id, screen: packed }),
      cache: 'no-store',
    });
    return await r.json().catch(function(){ return null; });
  }catch(_){ return null; }
}

async function broadcastWritingCredit(text){
  if(!text || !window.NalunoPass || typeof NalunoPass.findCredit !== 'function') return null;
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : '';
  const rows = [];
  const seen = {};
  function add(row){
    if(!row || !row.id || seen[row.id]) return;
    seen[row.id] = 1;
    rows.push(row);
  }
  try{ (feedBroadcasts || []).forEach(add); }catch(_){}
  try{ (typeof myBroadcasts !== 'undefined' && myBroadcasts || []).forEach(add); }catch(_){}
  if(typeof fbDb !== 'undefined' && fbDb){
    try{
      const key = NalunoPass.textKey(text);
      if(key){
        const exact = await fbDb.collection('broadcasts').where('textKey', '==', key).limit(8).get();
        exact.docs.forEach(function(d){ add(Object.assign({ id: d.id }, d.data() || {})); });
      }
    }catch(_){}
    try{
      const snap = await fbDb.collection('broadcasts')
        .where('listed', '==', true)
        .where('hidden', '==', false)
        .where('held', '==', false)
        .where('visibility', '==', 'public')
        .where('publishAt', '<=', nalunoCatalogueNow())
        .orderBy('publishAt', 'desc')
        .limit(80).get();
      snap.docs.forEach(function(d){ add(Object.assign({ id: d.id }, d.data() || {})); });
    }catch(_){}
  }
  return NalunoPass.findCredit(text, rows, uid);
}
function broadcastCreditFromOrigin(origin){
  if(!origin || !origin.matchBroadcastId || !origin.matchCreatorUid) return null;
  const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : '';
  if(origin.matchCreatorUid === uid) return null;
  /* Close titles, stills and sound can hold a Broadcast for a look.
     They must not stamp "Original Broadcast by" on someone else's film.
     Same file, or the same pictures in the same order, can. */
  const allowed = (window.NalunoPass && typeof NalunoPass.originCreditAllowed === 'function')
    ? NalunoPass.originCreditAllowed(origin)
    : false;
  if(!allowed) return null;
  const file = Number((origin.channels && origin.channels.file) || 0);
  return {
    broadcastId: String(origin.matchBroadcastId),
    creatorUid: String(origin.matchCreatorUid),
    creatorName: String(origin.matchCreatorName || 'Someone').slice(0, 80),
    title: String(origin.matchTitle || '').slice(0, 120),
    basis: file >= 99 ? 'file' : 'paste',
    locked: true,
  };
}

async function createPermanentBroadcast({ title, description, tags, mediaType, mediaUrl, thumbUrl, filterCss, chapters, breathers, strandId, strandName, origin, screen, publishAt, visibility, body, words, durationSec, originCredit, repostOf, lang, reachPass }){
  if(!currentUser || !fbDb) throw new Error('Sign in required');
  { const no = window.NalunoLaunch && NalunoLaunch.blocked('broadcasts'); if(no) throw new Error(no); }
  const now = Date.now();
  const ref = fbDb.collection('broadcasts').doc();
  // chapters: [{ index, mediaUrl, duration, title?, bytes? }]
  // breathers: [{ afterChapterIndex, durationMs, adSlot: { enabled, inventoryId, status } }]
  const chapterList = Array.isArray(chapters) ? chapters : null;
  const primaryUrl = mediaUrl || (chapterList && chapterList[0] && chapterList[0].mediaUrl) || null;
  /* 29h: only this post's own verdict counts. A post with a picture and no
     verdict waits for a person (see nalunoBroadcastListingFields). */
  const screenReport = screen || null;
  const hasPicture = !!(mediaUrl || thumbUrl || (chapterList && chapterList.some(function(c){ return c && c.mediaUrl; })));
  const doc = {
    creatorUid: currentUser.uid,
    creatorName: (currentProfile && currentProfile.name) || currentUser.displayName || 'Someone',
    title: (title || 'Broadcast').slice(0, 120),
    description: (description || '').slice(0, 2000),
    tags: (tags || []).slice(0, 12).map(t => String(t).toLowerCase().slice(0, 32)),
    mediaType: mediaType || 'photo',
    mediaUrl: primaryUrl,
    body: mediaType === 'writing' ? String(body || '').slice(0, 80000) : null,
    words: mediaType === 'writing' ? (Number(words) || 0) : null,
    durationSec: mediaType === 'writing' ? (Number(durationSec) || 0) : (mediaType === 'video' && Number(durationSec) > 0 ? Math.round(Number(durationSec)) : null),
    /* 07c: the writer said it is Luganda (Write → Luganda): it shows under
       Luganda and Listen reads it in the Luganda voice. */
    lang: lang === 'lg' ? 'lg' : null,
    kind: mediaType === 'writing' ? 'writing' : (mediaType || 'photo'),
    mediaId: (typeof nalunoMediaIdFromUrl === 'function' ? nalunoMediaIdFromUrl(primaryUrl) : null) || null,
    thumbUrl: thumbUrl || null,
    filterCss: filterCss || '',
    chapters: chapterList,
    breathers: Array.isArray(breathers) ? breathers : null,
    createdAt: now,
    updatedAt: now,
    /* publishAt in the future = scheduled; visibility 'private' = only you.
       Both default to "public now" so nothing changes for an ordinary post. */
    publishAt: Number(publishAt) || now,
    visibility: visibility === 'private' ? 'private' : 'public',
    views: 0,
    uniqueViews: 0,
    strandId: strandId || null,
    strandName: strandName || null,
    originStatus: (origin && origin.status) || 'clear',
    originScore: (origin && origin.score) || 0,
    originPhotoHash: (origin && origin.photoHash) || '',
    originAudioHash: (origin && origin.audioHash) || '',
    originFrameHashes: (origin && origin.frameHashes) || [],
    originIdentity: (origin && origin.identity) || '',
    originDna: (origin && origin.dna) || '',
    originMatchTitle: (origin && origin.matchTitle) || '',
    originHold: !!(origin && origin.hold),
    repostOf: repostOf ? String(repostOf) : null,
    reachPass: (mediaType === 'video' && reachPass) ? String(reachPass).slice(0, 48) : null,
    memberUids: [currentUser.uid],
    live: false,
    liveAt: null,
    liveBy: null,
    searchText: [
      title || '',
      description || '',
      mediaType === 'writing' ? String(body || '').slice(0, 4000) : '',
      (currentProfile && currentProfile.name) || '',
      ...(tags || []),
    ].join(' ').toLowerCase(),
  };
  if(mediaType === 'writing' && window.NalunoPass && typeof NalunoPass.textKey === 'function'){
    const key = NalunoPass.textKey(body || '');
    if(key) doc.textKey = key;
  }
  if(originCredit && originCredit.creatorUid && originCredit.creatorUid !== currentUser.uid && originCredit.creatorName){
    /* 15 Oct: only a Pass-on, or writing pasted word for word. A photo or
       video is never marked as someone else's from a file match. */
    let basis = '';
    if(repostOf) basis = 'repost';
    else if(mediaType === 'writing' && String(originCredit.basis || 'paste') === 'paste') basis = 'paste';
    if(basis){
      doc.originCredit = {
        broadcastId: String(originCredit.broadcastId || ''),
        creatorUid: String(originCredit.creatorUid),
        creatorName: String(originCredit.creatorName).slice(0, 80),
        title: String(originCredit.title || '').slice(0, 120),
        basis: basis,
        locked: true,
      };
    }
  }
  let safetyHold = null;
  try{
    if(window.NalunoSafety && typeof window.NalunoSafety.scorePublicText === 'function'){
      safetyHold = window.NalunoSafety.scorePublicText([title, description].filter(Boolean).join('\n'), { surface: 'broadcast' });
    }
  }catch(_){}
  const safetyStop = !!(safetyHold && typeof nalunoSafetyStopped === 'function' && nalunoSafetyStopped(safetyHold));
  Object.assign(doc, nalunoBroadcastListingFields(screenReport, { hasPicture: hasPicture, inherited: !!repostOf && screenReport && screenReport.decision === 'allow' }));
  /* The phone may not list itself. The economy worker, which holds the
     service account, is what puts a Broadcast on the feed after Screen. */
  doc.listed = false;
  doc.held = true;
  doc.hidden = false;
  if(!doc.heldReason) doc.heldReason = 'review';
  if(safetyStop){
    doc.listed = false;
    doc.held = true;
    doc.hidden = false;
    doc.heldReason = safetyHold.decision === 'AGE_RESTRICT' ? 'age-review' : (safetyHold.urgent ? 'safety-urgent' : 'safety-review');
  }
  if(doc.reachPass && doc.mediaUrl){
    await fbDb.collection('users').doc(currentUser.uid).collection('reachPasses').doc(doc.reachPass).update({
      used: true,
      broadcastId: ref.id,
    });
  }
  await ref.set(doc);
  /* Pin a private or scheduled Broadcast before any later wait. A snapshot
     that arrives while Screen is still placing it must not be able to drop
     it, and a later public-feed snapshot must not be able to either. */
  try{
    const early = { id: ref.id };
    Object.keys(doc).forEach(function(k){ early[k] = doc[k]; });
    if(early.visibility === 'private' || (Number(early.publishAt) > Date.now())){
      const pins = nalunoPrivatePinRead().filter(function(b){ return b && b.id !== early.id; });
      pins.unshift(early);
      nalunoPrivatePinWrite(pins);
      myBroadcasts = [early, ...myBroadcasts.filter(function(x){ return x.id !== early.id; })];
    }
  }catch(_){}
  try{
    await ref.collection('journey').add({
      type: 'created',
      text: doc.held ? 'Broadcast waiting to go out' : 'Broadcast published',
      ts: now,
      by: currentUser.uid,
    });
  }catch(_){}
  try{
    if(typeof saveOriginMark === 'function' && origin) await saveOriginMark(ref.id, origin, title);
  }catch(_){}
  let placed = null;
  try{ placed = await nalunoPlaceBroadcast(ref.id, screenReport); }catch(_){ placed = null; }
  if(placed && placed.wrote){
    doc.listed = !!placed.listed;
    doc.held = !!placed.held;
    doc.hidden = !!placed.hidden;
    doc.heldReason = placed.heldReason || '';
    if(placed.hidden) doc.hiddenReason = 'screen';
  } else if(placed && (placed.heldReason === 'safety-review' || placed.heldReason === 'safety-urgent' || placed.heldReason === 'age-review' || placed.heldReason === 'screen' || placed.heldReason === 'unscreened')){
    doc.listed = false;
    doc.held = true;
    doc.hidden = false;
    doc.heldReason = placed.heldReason;
  }
  if(placed && (placed.hidden || placed.screen === 'block')){
    doc.listed = false;
    doc.held = false;
    doc.hidden = true;
    doc.hiddenReason = 'screen';
    doc.heldReason = '';
  }
  const full = { id: ref.id, ...doc };
  myBroadcasts = [full, ...myBroadcasts.filter(x => x.id !== ref.id)];
  // Optimistic plate update — don't wait for onSnapshot (avoids "must refresh")
  if(nalunoPublicListable(full)){
    feedTailById[full.id] = Object.assign({}, feedTailById[full.id] || {}, full);
    caughtUpIds[full.id] = 1;
    try{ publishPublicCatalogue(); }catch(_){}
  }
  if((full.visibility === 'private') || (typeof broadcastIsScheduled === 'function' && broadcastIsScheduled(full))){
    try{
      if(typeof nalunoSetBcastView === 'function') nalunoSetBcastView('mine', false);
      const box = document.getElementById('bcastPrivateDrawer');
      if(box && box.hasAttribute('hidden')) box.removeAttribute('hidden');
      if(typeof nalunoRenderPrivateDrawer === 'function') nalunoRenderPrivateDrawer();
    }catch(_){}
  }
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  if(full.hidden && placed && placed.screen === 'block'){
    try{ toast('This cannot go out.'); }catch(_){}
  } else if(safetyStop || (placed && (placed.heldReason === 'safety-review' || placed.heldReason === 'safety-urgent' || placed.heldReason === 'age-review'))){
    try{ toast(typeof nalunoSafetyStatement === 'function' && safetyHold ? nalunoSafetyStatement(safetyHold) : 'Held for a safety review. This is not a ban.'); }catch(_){}
    if(placed && placed.safety_case && typeof openSafetyAppeal === 'function'){
      openSafetyAppeal(placed.safety_case, placed.statement || '');
    }
  } else if(full.held){
    try{ toast('Saved on your list. It goes out after a first look.'); }catch(_){}
  } else if(typeof nalunoSafetyEvent === 'function'){
    nalunoSafetyEvent('BROADCAST_PUBLISHED', {
      surface: 'broadcast',
      content_id: ref.id,
      public_text: [title, description].filter(Boolean).join('\n'),
    });
  }
  return full;
}

async function deletePermanentBroadcast(id){
  if(!currentUser || !fbDb || !id) return;
  const ref = fbDb.collection('broadcasts').doc(id);
  const snap = await ref.get();
  if(!snap.exists) return;
  const data = snap.data() || {};
  if(data.creatorUid !== currentUser.uid) throw new Error('Only the creator can delete');
  // Soft-delete community content is heavy; mark deleted and hide from feeds
  await ref.set({ deleted: true, deletedAt: Date.now(), live: false }, { merge: true });
  // FIX ("This Broadcast views don't add up to All of yours"): confirmed real.
  // "This Broadcast" reads each Broadcast's own views field; "All of yours"
  // reads toga/{creator}.viewsTotal, a cumulative counter incremented once
  // per view and never decremented. Deleting a Broadcast removed its own
  // views from anything summing the surviving Broadcasts, but left those
  // same views permanently baked into viewsTotal — so after any deletion,
  // "All of yours" stayed permanently higher than the individual numbers
  // could account for, with no way to ever reconcile. Subtracting the
  // deleted Broadcast's views keeps the two numbers describing the same
  // set of content. Clamped at zero server-side is not possible with
  // increment(), so a floor is applied on read (see paintBspaceViews) —
  // and this only ever runs for the creator deleting their own Broadcast,
  // which the check above already guarantees.
  try{
    const lostViews = Number(data.views) || 0;
    if(lostViews > 0){
      await fbDb.collection('toga').doc(currentUser.uid).set({
        viewsTotal: firebase.firestore.FieldValue.increment(-lostViews),
        updatedAt: Date.now(),
      }, { merge: true });
    }
  }catch(e){ console.warn('[broadcast] toga total adjust on delete', e); }
  myBroadcasts = myBroadcasts.filter(b => b.id !== id);
  feedBroadcasts = feedBroadcasts.filter(b => b.id !== id);
  try{
    nalunoPrivatePinWrite(nalunoPrivatePinRead().filter(function(b){ return b && b.id !== id; }));
  }catch(_){}
}

/* "Private Broadcasts appear, then disappear."
   This used to read the newest 40 of your Broadcasts (ordered by createdAt)
   and REPLACE the whole list with them. It runs at sign-in a moment after
   the live listener below has already filled the list with every Broadcast
   of yours and the private pins, so anything older than your newest 40 (or
   whose createdAt was missing or stored as a timestamp) vanished from
   Private until some unrelated change made the listener fire again.
   The live listener is the one source of this list. This only makes sure
   it is running, and paints the saved copy, merged with the pins, while
   the first snapshot is on its way. */
async function loadMyBroadcasts(){
  if(!currentUser || !fbDb) return;
  if(!myBroadcastsUnsub && (!myBroadcasts || !myBroadcasts.length)){
    try{
      const cached = nalunoCacheRead('myBroadcasts');
      const uid = currentUser.uid;
      const merged = nalunoMergeOwnerBroadcasts((cached || []).filter(function(b){ return b && (!b.creatorUid || b.creatorUid === uid); }),
        nalunoPrivatePinRead(), Date.now(), [], uid);
      if(merged.list.length) myBroadcasts = merged.list;
    }catch(_){}
  }
  startMyBroadcastsListener();
}

let feedBroadcastsUnsub = null;
let myBroadcastsUnsub = null;

function broadcastStableMediaId(b){
  if(!b) return '';
  if(b.mediaId) return b.mediaId;
  const raw = b.mediaUrl || b.videoUrl || '';
  if(typeof nalunoMediaIdFromUrl === 'function') return nalunoMediaIdFromUrl(raw);
  try{
    const m = String(raw).match(/u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+/);
    return m ? m[0] : '';
  }catch(_){ return ''; }
}

/* A scheduled Broadcast's document does not change when its time comes,
   so nothing re-ran this and it stayed off the feed until something else
   happened to change. Remember the latest snapshot and run again when the
   next scheduled one is due. */
let __feedLastDocs = null;
let __feedDueTimer = null;
/* The live listener owns the newest page and stays attached. Rebuilding it
   on a timer would bill those documents again. Older pages are read once,
   then again only while this phone is on screen and 15 minutes have passed.
   A catalogue that fits on the first page is not read a second time.
   PUBLIC_MAX_PAGES is a ceiling, not a quota: the walk stops when a page
   comes back short. Firestore bills the documents returned, not the limit. */
const PUBLIC_PAGE = 80;
const PUBLIC_MAX_PAGES = 50;
const CATALOGUE_RECONCILE_MS = 15 * 60 * 1000;
const NEW_PUBLIC_CATCHUP_MS = 30 * 1000;
let feedTailById = {};
let caughtUpIds = {};
let catalogueWalkTimer = null;
let catalogueWalkGen = 0;
let catalogueWalkPromise = null;
let catalogueWalkedAt = 0;
let catalogueWalkFailAt = 0;
let catalogueHeadFull = false;
let __feedCursorDoc = null;
let feedBoundAt = 0;
let newPublicTimer = null;
let newPublicArmed = false;
let caughtRecheckAt = Date.now();
let catchUpBusy = false;
let removedConfirm = {};
function feedActivityAt(b){
  return Math.max(Number(b.updatedAt) || 0, Number(b.createdAt) || 0, Number(b.publishAt) || 0);
}
/* Anyone may list a Broadcast whose publishAt has passed by the SERVER's
   clock (firestore.rules). A query bounded by this phone's clock is refused
   as a whole when the phone runs fast: the rules cannot prove every result
   is already due, and the public feed came back empty for that phone.
   Every public query is bounded by the server's clock, a little in the
   past. Posts newer than that margin are picked up by the catch-up read
   a moment later. */
/* 15 Oct: set after the database refuses the public list (see
   nalunoAfterFeedRefusal): how much further back to ask. */
let nalunoClockBackoff = 0;
let nalunoFeedRefusals = 0;
let nalunoBackoffWithSkew = false;
function nalunoMeasuredSkew(){
  try{ if(typeof nalunoServerSkew === 'number' && isFinite(nalunoServerSkew)) return nalunoServerSkew; }catch(_){}
  return null;
}
function nalunoCatalogueNow(){
  const skew = nalunoMeasuredSkew();
  /* 12 Oct b: a minute (five without a measured clock) kept every new post,
     a live one too, off other people's feeds for that long. The server's
     clock is known to about a second from its Date header; 15 s covers
     that. Without it, two minutes.
     15 Oct: without it, the last difference this phone measured (kept on
     the phone) is used, so a fast phone is not refused the whole list. */
  /* A step back taken while the server clock was unknown is dropped once
     it is known: the catch-up read then fills the gap. */
  if(skew !== null) return Date.now() + skew - 15 * 1000 - (nalunoBackoffWithSkew ? Math.min(nalunoClockBackoff, 10 * 60 * 1000) : 0);
  let known = null;
  try{ if(typeof window.nalunoStoredSkew === 'number' && isFinite(window.nalunoStoredSkew)) known = window.nalunoStoredSkew; }catch(_){}
  return Date.now() + (known || 0) - 2 * 60 * 1000 - nalunoClockBackoff;
}
window.nalunoCatalogueNow = nalunoCatalogueNow;
/* The database refused the public list. The usual cause is a phone clock
   ahead of the server's, so the question asks about posts "not yet due".
   Measure the server clock again; if that works, ask with it. If not, ask
   further back each time (10 min, 1 h, 1 day, 1 week). Posts newer than
   that are picked up by the catch-up read once the clock is known.
   Returns false when there is nothing more to try. */
const NALUNO_REFUSAL_LADDER = [10 * 60000, 60 * 60000, 24 * 3600000, 7 * 24 * 3600000];
async function nalunoAfterFeedRefusal(){
  if(nalunoFeedRefusals >= NALUNO_REFUSAL_LADDER.length + 1) return false;
  nalunoFeedRefusals++;
  const before = nalunoMeasuredSkew();
  try{
    if(typeof window.nalunoMeasureSkew === 'function'){
      await Promise.race([window.nalunoMeasureSkew(), new Promise(function(r){ setTimeout(r, 3000); })]);
    }
  }catch(_){}
  const after = nalunoMeasuredSkew();
  nalunoBackoffWithSkew = after !== null;
  if(after !== null && (before === null || Math.abs(after - before) > 5000) && nalunoFeedRefusals === 1){
    nalunoClockBackoff = 0;
  }else{
    nalunoClockBackoff = NALUNO_REFUSAL_LADDER[Math.min(nalunoFeedRefusals - 1, NALUNO_REFUSAL_LADDER.length - 1)];
  }
  try{ console.warn('[bcast] public list refused; asking again ' + Math.round(nalunoClockBackoff / 60000) + ' min further back'); }catch(_){}
  return true;
}
window.nalunoAfterFeedRefusal = nalunoAfterFeedRefusal;
function publicBroadcastQuery(){
  return fbDb.collection('broadcasts')
    .where('listed', '==', true)
    .where('hidden', '==', false)
    .where('held', '==', false)
    .where('visibility', '==', 'public')
    .where('publishAt', '<=', nalunoCatalogueNow())
    .orderBy('publishAt', 'desc');
}
function rowFromBroadcastDoc(d, prev){
  const data = (d && typeof d.data === 'function') ? (d.data() || {}) : (d || {});
  if(data.deleted || !broadcastIsPublic(data)) return null;
  const id = (d && d.id) || data.id;
  if(!id) return null;
  const row = Object.assign({}, prev || {}, data, { id: id });
  row.mediaId = broadcastStableMediaId(row) || row.mediaId || null;
  return row;
}
function publishPublicCatalogue(){
  const list = [];
  Object.keys(feedTailById).forEach(function(id){
    const b = feedTailById[id];
    if(b && b.id && broadcastIsPublic(b)) list.push(b);
  });
  list.sort(function(a,b){
    return (b.live ? 1 : 0) - (a.live ? 1 : 0) || feedActivityAt(b) - feedActivityAt(a);
  });
  feedBroadcasts = list;
  try{ nalunoCacheWrite('feedBroadcasts', feedBroadcasts.map(nalunoSlimMedia)); }catch(_){}
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
}
function scheduleCataloguePages(){
  if(catalogueWalkTimer || catalogueWalkPromise) return;
  if(catalogueWalkedAt && Date.now() - catalogueWalkedAt < CATALOGUE_RECONCILE_MS) return;
  catalogueWalkTimer = setTimeout(function(){
    catalogueWalkTimer = null;
    if(!catalogueHeadFull || !__feedCursorDoc) return;
    walkPublicCatalogue({ afterHead: true });
  }, 400);
}
async function walkPublicCatalogue(opts){
  opts = opts || {};
  if(!fbDb || !currentUser) return;
  if(catalogueWalkPromise) return catalogueWalkPromise;
  const afterHead = !!(opts.afterHead && __feedCursorDoc);
  if(afterHead && catalogueWalkedAt && !opts.force && Date.now() - catalogueWalkedAt < CATALOGUE_RECONCILE_MS) return;
  if(catalogueWalkFailAt && !opts.force && Date.now() - catalogueWalkFailAt < 120000) return;
  const gen = ++catalogueWalkGen;
  catalogueWalkPromise = walkCatalogueBody(gen, afterHead).finally(function(){
    catalogueWalkPromise = null;
  });
  return catalogueWalkPromise;
}
async function walkCatalogueBody(gen, afterHead){
  const headIds = {};
  (__feedLastDocs || []).forEach(function(d){ if(d && d.id) headIds[d.id] = 1; });
  const seen = {};
  let pageQuery = null;
  try{
    pageQuery = publicBroadcastQuery().limit(PUBLIC_PAGE);
    if(afterHead) pageQuery = publicBroadcastQuery().startAfter(__feedCursorDoc).limit(PUBLIC_PAGE);
  }catch(e){
    console.warn('[bcast] catalogue query', e && e.message);
    catalogueWalkFailAt = Date.now();
    return;
  }
  let complete = false;
  let pages = 0;
  while(pages < PUBLIC_MAX_PAGES){
    let snap;
    try{ snap = await pageQuery.get(); }
    catch(e){
      console.warn('[bcast] catalogue page', pages, e && e.message);
      catalogueWalkFailAt = Date.now();
      return;
    }
    if(gen !== catalogueWalkGen) return;
    const docs = snap.docs || [];
    docs.forEach(function(d){
      const row = rowFromBroadcastDoc(d, feedTailById[d.id]);
      if(!row) return;
      seen[row.id] = row;
    });
    pages++;
    if(docs.length < PUBLIC_PAGE){ complete = true; break; }
    try{ pageQuery = publicBroadcastQuery().startAfter(docs[docs.length - 1]).limit(PUBLIC_PAGE); }
    catch(e){ console.warn('[bcast] catalogue cursor', e && e.message); catalogueWalkFailAt = Date.now(); return; }
  }
  if(gen !== catalogueWalkGen) return;
  if(complete){
    catalogueWalkedAt = Date.now();
    catalogueWalkFailAt = 0;
    Object.keys(feedTailById).forEach(function(id){
      if(seen[id]) return;
      if(afterHead && (headIds[id] || caughtUpIds[id])) return;
      delete feedTailById[id];
    });
  } else {
    console.warn('[bcast] public catalogue stopped after', pages, 'pages');
  }
  Object.keys(seen).forEach(function(id){ feedTailById[id] = seen[id]; });
  publishPublicCatalogue();
}
window.walkPublicCatalogue = walkPublicCatalogue;
function armScheduledFeedTimer(docs){
  try{
    if(__feedDueTimer){ clearTimeout(__feedDueTimer); __feedDueTimer = null; }
    const now = Date.now();
    let next = 0;
    (docs || []).forEach(function(d){
      const data = (d && typeof d.data === 'function') ? (d.data() || {}) : {};
      const at = Number(data.publishAt) || 0;
      if(at > now && !data.deleted && (!next || at < next)) next = at;
    });
    if(!next) return;
    const wait = Math.min(Math.max(next - now + 1000, 1000), 6 * 60 * 60 * 1000);
    __feedDueTimer = setTimeout(function(){
      __feedDueTimer = null;
      if(__feedLastDocs) applyBroadcastDocsToFeed(__feedLastDocs);
    }, wait);
  }catch(_){}
}
function confirmStillOnCatalogue(id){
  if(!id || !fbDb || removedConfirm[id]) return;
  removedConfirm[id] = 1;
  fbDb.collection('broadcasts').doc(id).get().then(function(snap){
    delete removedConfirm[id];
    if(!snap || !snap.exists){
      delete feedTailById[id];
      delete caughtUpIds[id];
      publishPublicCatalogue();
      return;
    }
    const row = rowFromBroadcastDoc(snap, feedTailById[id]);
    if(!row){
      delete feedTailById[id];
      delete caughtUpIds[id];
      publishPublicCatalogue();
      return;
    }
    feedTailById[id] = row;
  }).catch(function(err){
    delete removedConfirm[id];
    const code = String((err && (err.code || err.message)) || '');
    if(code.indexOf('permission') >= 0){
      delete feedTailById[id];
      delete caughtUpIds[id];
      publishPublicCatalogue();
    }
  });
}
function applyBroadcastDocsToFeed(docs, removedIds){
  __feedLastDocs = docs;
  armScheduledFeedTimer(docs);
  const inSnap = {};
  (docs || []).forEach(function(d){
    const id = d && d.id;
    if(!id) return;
    inSnap[id] = 1;
    const row = rowFromBroadcastDoc(d, feedTailById[id]);
    if(!row){
      delete feedTailById[id];
      delete caughtUpIds[id];
      return;
    }
    feedTailById[id] = row;
  });
  const n = (docs || []).length;
  const fellBack = !!(startFeedBroadcastsListener && startFeedBroadcastsListener._fellBack);
  if(!fellBack && n < PUBLIC_PAGE){
    catalogueHeadFull = false;
    __feedCursorDoc = null;
  } else if(n >= PUBLIC_PAGE){
    catalogueHeadFull = true;
    __feedCursorDoc = docs[n - 1];
    if(!catalogueWalkedAt) scheduleCataloguePages();
  }
  /* Removed from a limited page is not the same as gone. One document read
     tells them apart. Falling off the page stays. Unpublished or deleted goes. */
  (removedIds || []).forEach(function(id){
    if(!id || inSnap[id]) return;
    confirmStillOnCatalogue(id);
  });
  publishPublicCatalogue();
}
window.broadcastStableMediaId = broadcastStableMediaId;
window.broadcastIsPublic = broadcastIsPublic;
window.broadcastVisibleTo = broadcastVisibleTo;

/** Creator edits a Broadcast that is not on the public feed yet:
 *  the time it goes out, the title, or whether it stays private. */
async function saveBroadcastEdits(id, patch){
  if(!id || !fbDb || !currentUser) throw new Error('Sign in required');
  const next = { updatedAt: Date.now() };
  if(patch && patch.title != null) next.title = String(patch.title).slice(0, 120);
  if(patch && patch.description != null) next.description = String(patch.description).slice(0, 2000);
  if(patch && patch.visibility) next.visibility = patch.visibility === 'private' ? 'private' : 'public';
  if(patch && patch.publishAt != null){
    const at = Number(patch.publishAt) || 0;
    next.publishAt = at > 0 ? at : Date.now();
  }
  await fbDb.collection('broadcasts').doc(id).set(next, { merge: true });
  const apply = function(list){
    if(!list) return;
    const row = list.find(function(b){ return b && b.id === id; });
    if(row) Object.assign(row, next);
  };
  try{ apply(typeof myBroadcasts !== 'undefined' ? myBroadcasts : null); }catch(_){}
  try{ apply(typeof feedBroadcasts !== 'undefined' ? feedBroadcasts : null); }catch(_){}
  try{
    const row = (typeof myBroadcasts !== 'undefined' && myBroadcasts) ? myBroadcasts.find(function(b){ return b && b.id === id; }) : null;
    const merged = Object.assign({}, row || {}, next, { id: id });
    const keep = merged.visibility === 'private' || (Number(merged.publishAt) > Date.now());
    const pins = nalunoPrivatePinRead().filter(function(b){ return b && b.id !== id; });
    if(keep && !merged.deleted){
      pins.unshift(merged);
    }
    nalunoPrivatePinWrite(pins);
    if(!keep && typeof feedBroadcasts !== 'undefined' && feedBroadcasts){
      feedBroadcasts = feedBroadcasts.filter(function(b){ return !b || b.id !== id || (typeof broadcastIsPublic === 'function' && broadcastIsPublic(b)); });
    }
  }catch(_){}
  /* Private → public ("Publish now", or unticking Private). A Broadcast is
     created held, and a private one is never listed, so changing only its
     visibility left it on nobody's feed: gone from Private, missing from
     the public catalogue. Only the worker can list it, after the same
     check a new post gets. */
  try{
    const row = (typeof myBroadcasts !== 'undefined' && myBroadcasts) ? myBroadcasts.find(function(b){ return b && b.id === id; }) : null;
    const nowPublic = next.visibility === 'public' || (!next.visibility && row && row.visibility !== 'private');
    if(nowPublic && row && row.listed !== true && row.hidden !== true){
      const placed = await nalunoPlaceBroadcast(id, null);
      if(placed && placed.ok !== false){
        next.placed = { listed: !!placed.listed, held: !!placed.held, hidden: !!placed.hidden, heldReason: placed.heldReason || '' };
        if(placed.wrote){
          Object.assign(row, { listed: !!placed.listed, held: !!placed.held, hidden: !!placed.hidden, heldReason: placed.heldReason || '' });
        }
      }
      /* Not listed (held for a look, or the worker could not be reached):
         say so instead of "it's on the public feed". */
      next.waiting = !(next.placed && next.placed.listed);
    }
  }catch(e){ console.warn('[bcast] place after edit', e && e.message); }
  return next;
}
window.saveBroadcastEdits = saveBroadcastEdits;

/* Owner-only pin. A public-feed snapshot cannot delete these, and a My
   Broadcasts snapshot that simply omits one cannot either. A pin leaves
   only when this phone deletes it, or the server copy is present and is
   no longer private or scheduled. */
function nalunoPrivatePinKey(){
  try{
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
    return uid ? ('nalunoPrivatePins:' + uid) : '';
  }catch(_){ return ''; }
}
function nalunoPrivatePinRead(){
  const k = nalunoPrivatePinKey();
  if(!k) return [];
  try{
    const raw = localStorage.getItem(k);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function(b){ return b && b.id; }) : [];
  }catch(_){ return []; }
}
function nalunoPrivatePinWrite(rows){
  const k = nalunoPrivatePinKey();
  if(!k) return;
  try{
    const slim = (rows || []).slice(0, 40).map(function(b){
      return (typeof nalunoSlimMedia === 'function') ? nalunoSlimMedia(b) : b;
    });
    localStorage.setItem(k, JSON.stringify(slim));
  }catch(_){}
}
function nalunoMergeOwnerBroadcasts(serverRows, pins, now, deletedIds, uid){
  const nowMs = now || Date.now();
  const gone = {};
  (deletedIds || []).forEach(function(id){ if(id) gone[id] = 1; });
  const byId = {};
  (serverRows || []).forEach(function(b){
    if(!b || !b.id) return;
    if(b.deleted){ gone[b.id] = 1; return; }
    byId[b.id] = b;
  });
  const nextPins = [];
  (pins || []).forEach(function(b){
    if(!b || !b.id || gone[b.id] || b.deleted) return;
    if(uid && b.creatorUid && b.creatorUid !== uid) return;
    const server = byId[b.id];
    if(server){
      const still = server.visibility === 'private' || (Number(server.publishAt) > nowMs);
      if(still){
        const kept = Object.assign({}, b, server);
        nextPins.push(kept);
        byId[b.id] = kept;
      }
      return;
    }
    if(b.visibility === 'private' || (Number(b.publishAt) > nowMs)){
      byId[b.id] = b;
      nextPins.push(b);
    }
  });
  const list = Object.keys(byId).map(function(k){ return byId[k]; })
    .sort(function(a, b){ return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); });
  return { list: list, pins: nextPins };
}
function nalunoRepairOwnPublicFields(rows){
  if(!fbDb || !currentUser) return;
  if(!nalunoRepairOwnPublicFields._done) nalunoRepairOwnPublicFields._done = {};
  (rows || []).forEach(function(b){
    if(!b || !b.id || b.deleted || b.hidden === true || b.held === true || b.listed === false) return;
    if(b.visibility === 'private') return;
    const patch = {};
    if(!b.visibility) patch.visibility = 'public';
    if(!(Number(b.publishAt) > 0)){
      const at = Number(b.createdAt) || Number(b.updatedAt) || 0;
      if(at > 0 && at <= Date.now()) patch.publishAt = at;
    }
    if(!Object.keys(patch).length) return;
    if(nalunoRepairOwnPublicFields._done[b.id]) return;
    nalunoRepairOwnPublicFields._done[b.id] = 1;
    /* listed / hidden / held stay with the desk. Only the fields a creator
       is allowed to fill, and only when they were never set. */
    fbDb.collection('broadcasts').doc(b.id).set(patch, { merge: true }).catch(function(e){
      console.warn('[bcast] restore public fields', b.id, e && e.message);
      delete nalunoRepairOwnPublicFields._done[b.id];
    });
  });
}
window.nalunoRepairOwnPublicFields = nalunoRepairOwnPublicFields;
window.nalunoPrivatePinRead = nalunoPrivatePinRead;
window.nalunoPrivatePinWrite = nalunoPrivatePinWrite;
window.nalunoMergeOwnerBroadcasts = nalunoMergeOwnerBroadcasts;

/** Realtime plate list — no refresh required for new Broadcasts. */
function startFeedBroadcastsListener(){
  if(!fbDb || !currentUser) return;
  if(feedBroadcastsUnsub) return;
  /* Let the server-clock measurement land first (it is one small request
     made at start-up), so the feed is not bounded two minutes back. */
  try{
    if((typeof nalunoServerSkew === 'undefined' || nalunoServerSkew === null) && window.__nalunoSkewReady && !startFeedBroadcastsListener._waited){
      startFeedBroadcastsListener._waited = true;
      Promise.race([window.__nalunoSkewReady, new Promise(function(r){ setTimeout(r, 1500); })])
        .then(function(){ startFeedBroadcastsListener(); }, function(){ startFeedBroadcastsListener(); });
      return;
    }
  }catch(_){}
  function attach(query){
    return query.onSnapshot(
      snap => {
        const removed = [];
        try{
          snap.docChanges().forEach(function(ch){
            if(ch && ch.type === 'removed' && ch.doc) removed.push(ch.doc.id);
          });
        }catch(_){}
        applyBroadcastDocsToFeed(snap.docs, removed);
      },
      err => {
        console.warn('[bcast] feed listener', err && err.message);
        // Missing index or rules — fall back once
        if(feedBroadcastsUnsub){
          try{ feedBroadcastsUnsub(); }catch(_){}
          feedBroadcastsUnsub = null;
        }
        /* 15 Oct: a refusal is almost always a fast phone clock. Ask again
           by the server's clock (or further back), not the same question. */
        if(err && err.code === 'permission-denied'){
          nalunoAfterFeedRefusal().then(function(again){
            if(again && !feedBroadcastsUnsub) startFeedBroadcastsListener();
          });
          return;
        }
        if(!startFeedBroadcastsListener._fellBack){
          startFeedBroadcastsListener._fellBack = true;
          try{
            feedBroadcastsUnsub = attach(
              fbDb.collection('broadcasts')
                .where('listed', '==', true)
                .where('hidden', '==', false)
                .where('held', '==', false)
                .where('visibility', '==', 'public')
                .where('publishAt', '<=', nalunoCatalogueNow())
                .limit(80)
            );
          }catch(e2){ console.warn('[bcast] feed fallback failed', e2); }
        }
      }
    );
  }
  const bound = nalunoCatalogueNow();
  feedBoundAt = bound;
  try{
    feedBroadcastsUnsub = attach(
      fbDb.collection('broadcasts')
        .where('listed', '==', true)
        .where('hidden', '==', false)
        .where('held', '==', false)
        .where('visibility', '==', 'public')
        .where('publishAt', '<=', bound)
        .orderBy('publishAt', 'desc')
        .limit(PUBLIC_PAGE)
    );
  }catch(e){
    console.warn('[bcast] start feed listener', e);
    try{
      startFeedBroadcastsListener._fellBack = true;
      feedBroadcastsUnsub = attach(
        fbDb.collection('broadcasts')
          .where('listed', '==', true)
          .where('hidden', '==', false)
          .where('held', '==', false)
          .where('visibility', '==', 'public')
          .where('publishAt', '<=', bound)
          .limit(PUBLIC_PAGE)
      );
    }catch(_){}
  }
  armNewPublicCatchUp();
}

function recheckCaughtUp(){
  Object.keys(caughtUpIds).forEach(confirmStillOnCatalogue);
}
let nalunoSkewRetryAt = 0;
function onFeedVisible(){
  if(typeof document !== 'undefined' && document.hidden) return;
  /* 15 Oct: the server clock could not be read at start (weak signal).
     Try again now and then; once it is known, the catch-up read below
     fills in the posts the cautious bound left out. */
  if(nalunoMeasuredSkew() === null && typeof window.nalunoMeasureSkew === 'function' && Date.now() - nalunoSkewRetryAt > 60000){
    nalunoSkewRetryAt = Date.now();
    let m = null;
    try{ m = window.nalunoMeasureSkew(); }catch(_){}
    Promise.race([Promise.resolve(m).catch(function(){}), new Promise(function(r){ setTimeout(r, 4000); })])
      .then(function(){ catchUpNewlyPublic(); });
  }else{
    catchUpNewlyPublic();
  }
  if(Date.now() - caughtRecheckAt < CATALOGUE_RECONCILE_MS) return;
  caughtRecheckAt = Date.now();
  recheckCaughtUp();
  if(catalogueHeadFull) walkPublicCatalogue({ afterHead: true });
}
function armNewPublicCatchUp(){
  if(newPublicArmed) return;
  newPublicArmed = true;
  try{
    newPublicTimer = setInterval(function(){
      if(typeof document !== 'undefined' && document.hidden) return;
      onFeedVisible();
    }, NEW_PUBLIC_CATCHUP_MS);
  }catch(_){}
  try{
    if(typeof document !== 'undefined' && document.addEventListener){
      document.addEventListener('visibilitychange', onFeedVisible);
    }
  }catch(_){}
}
/* Posts made after the listener attached have a later publishAt, so they
   miss a bound that was frozen at subscribe time. This reads only that
   gap. An empty gap is one read, not another copy of the catalogue. */
async function catchUpNewlyPublic(){
  if(catchUpBusy || !fbDb || !currentUser || !feedBoundAt) return;
  if(typeof document !== 'undefined' && document.hidden) return;
  const now = nalunoCatalogueNow();
  if(now <= feedBoundAt) return;
  catchUpBusy = true;
  const bound = feedBoundAt;
  try{
    let cursor = null;
    let pages = 0;
    let found = 0;
    while(pages < 3){
      let q = fbDb.collection('broadcasts')
        .where('listed', '==', true)
        .where('hidden', '==', false)
        .where('held', '==', false)
        .where('visibility', '==', 'public')
        .where('publishAt', '>', bound)
        .where('publishAt', '<=', now)
        .orderBy('publishAt', 'desc')
        .limit(PUBLIC_PAGE);
      if(cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      const docs = snap.docs || [];
      docs.forEach(function(d){
        const row = rowFromBroadcastDoc(d, feedTailById[d.id]);
        if(!row) return;
        feedTailById[row.id] = row;
        caughtUpIds[row.id] = 1;
        found++;
      });
      pages++;
      if(docs.length < PUBLIC_PAGE) break;
      cursor = docs[docs.length - 1];
      if(!cursor) break;
    }
    feedBoundAt = now;
    if(found) publishPublicCatalogue();
  }catch(e){
    console.warn('[bcast] new public', e && e.message);
  }finally{
    catchUpBusy = false;
  }
}

function startMyBroadcastsListener(){
  if(!fbDb || !currentUser) return;
  if(myBroadcastsUnsub) return;
  try{
    myBroadcastsUnsub = fbDb.collection('broadcasts')
      .where('creatorUid', '==', currentUser.uid)
      .onSnapshot(snap => {
        const raw = snap.docs.map(function(d){ return { id: d.id, ...(d.data() || {}) }; });
        const incoming = raw.filter(function(b){ return b && !b.deleted; });
        const deletedIds = raw.filter(function(b){ return b && b.deleted; }).map(function(b){ return b.id; });
        const uid = currentUser && currentUser.uid;
        const merged = nalunoMergeOwnerBroadcasts(incoming, nalunoPrivatePinRead(), Date.now(), deletedIds, uid);
        myBroadcasts = merged.list;
        nalunoPrivatePinWrite(merged.pins);
        try{ nalunoRepairOwnPublicFields(myBroadcasts); }catch(_){}
        try{ nalunoCacheWrite('myBroadcasts', (myBroadcasts || []).map(nalunoSlimMedia)); }catch(_){}
        try{ if(typeof nalunoListenOk === 'function') nalunoListenOk('myBroadcasts'); }catch(_){}
        if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
      }, err => {
        console.warn('[bcast] my listener', err && err.message);
        try{ if(myBroadcastsUnsub) myBroadcastsUnsub(); }catch(_){}
        myBroadcastsUnsub = null;
        try{
          if(typeof nalunoRelisten === 'function') nalunoRelisten('myBroadcasts', startMyBroadcastsListener, 8);
        }catch(_){}
      });
  }catch(e){ console.warn('[bcast] my listener start', e); }
}

async function loadFeedBroadcasts(){
  if(!currentUser || !fbDb) return;
  // Prefer live listener; still do one get for instant first paint
  startFeedBroadcastsListener();
  startMyBroadcastsListener();
  /* Only your own. A read of someone else's Broadcasts by creator alone is
     refused by the rules (it could include their private ones), so every
     chunk with a connection in it failed on every start. Their public
     Broadcasts come in with the public catalogue, which walks every page. */
  const uids = new Set([currentUser.uid]);
  const list = [];
  const arr = Array.from(uids);
  for(let i = 0; i < arr.length; i += 10){
    const chunk = arr.slice(i, i + 10);
    try{
      const snap = await fbDb.collection('broadcasts').where('creatorUid', 'in', chunk).limit(30).get();
      snap.docs.forEach(d => {
        const data = d.data();
        /* Your own posts join For You only if everyone else can see them too. */
        if(!data.deleted && nalunoPublicListable(data)) list.push({ id: d.id, ...data });
      });
    }catch(e){ console.warn('[bcast] contact catalogue', e && e.message); }
  }
  list.forEach(function(b){
    if(b && b.id && nalunoPublicListable(b)) feedTailById[b.id] = Object.assign({}, feedTailById[b.id] || {}, b);
  });
  publishPublicCatalogue();
}

async function searchBroadcasts(query){
  const q = (query || '').trim().toLowerCase();
  if(!q){ broadcastSearchResults = []; return []; }
  // Client-side search over a recent public slice + feed (no full-text index required)
  let pool = (feedBroadcasts || []).slice();
  try{
    if(typeof myBroadcasts !== 'undefined' && myBroadcasts && myBroadcasts.length){
      myBroadcasts.forEach(function(b){ if(b && !pool.find(function(x){ return x.id === b.id; })) pool.push(b); });
    }
  }catch(_){}
  try{
    if(fbDb){
      const snap = await fbDb.collection('broadcasts')
        .where('listed', '==', true)
        .where('hidden', '==', false)
        .where('held', '==', false)
        .where('visibility', '==', 'public')
        .where('publishAt', '<=', nalunoCatalogueNow())
        .orderBy('publishAt', 'desc')
        .limit(80).get();
      snap.docs.forEach(d => {
        const data = d.data();
        if(data.deleted) return;
        if(!broadcastIsPublic(data)) return;
        if(!pool.find(x => x.id === d.id)) pool.push({ id: d.id, ...data });
      });
    }
  }catch(_){}
  function hayOf(b){
    if(!b) return '';
    if(b.searchText) return String(b.searchText).toLowerCase();
    return [b.title, b.description, b.creatorName, b.strandName, b.strandId, ...(b.tags||[])].join(' ').toLowerCase();
  }
  const scored = pool.map(b => {
    const hay = hayOf(b);
    let score = 0;
    if(hay.includes(q)) score += 5;
    q.split(/\s+/).forEach(w => { if(w.length > 1 && hay.includes(w)) score += 2; });
    if((b.title||'').toLowerCase().startsWith(q)) score += 3;
    if((b.strandName||'').toLowerCase().includes(q)) score += 4;
    if(b.live) score += 4;
    return { b, score };
  }).filter(x => x.score > 0).sort((a,c) => c.score - a.score || (c.b.createdAt||0)-(a.b.createdAt||0));
  broadcastSearchResults = scored.map(x => x.b);
  return broadcastSearchResults;
}

/** Push a live alert to one person's device via the call-notify Worker (FCM). */
async function sendPushToContact(contactOrUid, msg){
  try{
    const uid = typeof contactOrUid === 'string'
      ? contactOrUid
      : (contactOrUid && (contactOrUid.firebaseUid || contactOrUid.uid));
    if(!uid || !currentUser) return;
    const workerUrl = (typeof CALL_NOTIFY_WORKER_URL === 'string' && CALL_NOTIFY_WORKER_URL)
      ? CALL_NOTIFY_WORKER_URL
      : 'https://naluno-call-notify.naluno.workers.dev';
    let tokens = { android: null, web: null, primary: null, platform: null };
    try{
      const snap = await fbDb.collection('users').doc(uid).get();
      if(snap.exists){
        const d = snap.data() || {};
        tokens.android = d.fcmTokenAndroid || null;
        tokens.web = d.fcmTokenWeb || null;
        tokens.primary = d.fcmToken || null;
        tokens.platform = d.fcmTokenPlatform || null;
      }
    }catch(_){}
    /* 14 Oct: push addresses now live in each person's private vault, which
       the worker reads itself; an empty public profile no longer means
       "nobody to tell". */
    const idToken = await currentUser.getIdToken(false);
    const pingId = (typeof nalunoPushId === 'function') ? nalunoPushId() : '';
    const webTok = tokens.web || ((tokens.platform === 'web') ? tokens.primary : null);
    const primaryTok = (tokens.primary && tokens.primary !== webTok) ? tokens.primary : null;
    if(typeof nalunoLockPush === 'function' && msg && msg.broadcastId){
      nalunoLockPush({ to: uid, type: 'broadcast_live', broadcastId: msg.broadcastId });
    }
    const body = {
      calleeUid: uid,
      callerName: (msg && msg.fromName) || (currentProfile && currentProfile.name) || 'Someone',
      title: (msg && msg.title) || 'Live on Naluno',
      body: (msg && msg.body) || 'Someone is live',
      type: 'broadcast_live',
      broadcastId: (msg && msg.broadcastId) || null,
      pingId: pingId,
      fcmTokenAndroid: tokens.android,
      fcmTokenWeb: null,
      fcmToken: primaryTok,
      fcmTokenPlatform: tokens.platform === 'web' ? (tokens.android ? 'android' : null) : tokens.platform,
    };
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).catch(function(){ return null; });
    let data = {};
    try { if (res) data = await res.json(); } catch (_) {}
    if(pingId && typeof nalunoNotePush === 'function'){
      nalunoNotePush({
        pingId: pingId, toUid: uid, type: 'broadcast_live',
        httpStatus: res ? res.status : 0, sent: data.sent, reason: data.reason || data.error || '',
      });
    }
  }catch(e){ console.warn('[live] push', e); }
}
window.sendPushToContact = sendPushToContact;

/** Drop a real Wireline message (not just a notification/push) into every
 *  community member's thread with the creator when they go live — so people
 *  who follow via Wireline see it as a normal message, not just a badge. */
/* 14 Oct: going live no longer writes "X is live now: <title>" into
   Wireline as an open message. Chat is sealed; that line was not, and any
   participant could read it. The push and the in-app notice already say who
   is live and open the Broadcast. */

/* 14 Oct: the worker tells the audience (members, connections, the whole
   Circle, no cap of 120), a batch per request, with one notification per
   person per live. The phone only asks. If the worker cannot do it (not
   deployed yet, offline), the phone falls back to the old list, with the
   same fixed notification id, so nobody is told twice either way. */
async function nalunoAlertLiveViaWorker(broadcastId){
  const tok = await currentUser.getIdToken();
  for(let i = 0; i < 60; i++){
    const r = await fetch(nalunoEconomyUrlBroadcast() + '/v1/live/alert', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastId: broadcastId }),
    });
    if(!r.ok) return i > 0;   // the first batch failing means: do it here
    const b = await r.json().catch(function(){ return {}; });
    if(!b || b.ok !== true) return i > 0;
    if(b.done) return true;
  }
  return true;   // the cron finishes the rest
}
async function notifyFrequenciesLive(broadcastId, title){
  if(!currentUser || !fbDb || !broadcastId) return;
  try{ if(await nalunoAlertLiveViaWorker(broadcastId)) return; }catch(_){}
  const fromName = (currentProfile && currentProfile.name) || 'Someone';
  const liveTitle = title || 'Broadcast';
  const pushBody = fromName + ' is live: ' + liveTitle;
  const payload = {
    type: 'broadcast_live',
    fromUid: currentUser.uid,
    fromName: fromName,
    broadcastId,
    title: liveTitle,
    createdAt: Date.now(),
    read: false,
  };
  const real = (contacts || []).filter(c => c.isReal && c.firebaseUid);
  const uids = new Set(real.map(c => c.firebaseUid));
  try{
    const circleSnap = await fbDb.collection('users').doc(currentUser.uid).collection('circle').limit(80).get();
    circleSnap.docs.forEach(function(d){ if(d.id) uids.add(d.id); });
  }catch(_){}
  let liveKey = '';
  try{
    const bsnap = await fbDb.collection('broadcasts').doc(broadcastId).get();
    if(bsnap.exists){
      const bd = bsnap.data() || {};
      (bd.memberUids || []).forEach(function(uid){ if(uid) uids.add(uid); });
      liveKey = String(Math.round(Number(bd.liveAt) || 0) || '');
    }
  }catch(_){}
  uids.delete(currentUser.uid);
  const list = Array.from(uids).slice(0, 120);
  const nid = liveKey ? ('live_' + broadcastId + '_' + liveKey) : '';
  await Promise.all(list.map(function(uid){
    const col = fbDb.collection('users').doc(uid).collection('notifications');
    return (nid ? col.doc(nid).set(payload) : col.add(payload)).catch(function(){});
  }));
  list.forEach(function(uid){
    sendPushToContact(uid, {
      title: 'Live on Naluno',
      body: pushBody,
      fromName: fromName,
      broadcastId: broadcastId,
    });
  });
}
window.notifyFrequenciesLive = notifyFrequenciesLive;

function openBroadcastById(id){
  if(!id) return;
  try{ if(typeof nalunoPauseLeavingMedia === 'function') nalunoPauseLeavingMedia(); }catch(_){}
  try{ if(typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews(); }catch(_){}
  if(typeof openBroadcastSpaceById === 'function') openBroadcastSpaceById(id);
  else toast('Opening Broadcast…');
}

/** Deep link ?broadcast= */
(function broadcastDeepLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const id = params.get('broadcast');
    if(!id) return;
    /* Go to Broadcast IMMEDIATELY, before waiting for sign-in. This used to
       wait for auth first, so a shared link landed on Frequencies and sat
       there for a second before jumping — the link looked like it had opened
       the wrong thing. Switching the tab first means the person only ever
       sees where they were going. */
    const goBroadcastTab = function(){
      try{
        const nav = document.querySelector('.navbtn[data-tab="broadcast"]');
        if(nav){ nav.click(); return true; }
      }catch(_){}
      return false;
    };
    if(!goBroadcastTab()){
      document.addEventListener('DOMContentLoaded', goBroadcastTab, { once: true });
    }
    let n = 0;
    const iv = setInterval(()=>{
      n++;
      if(currentUser && fbDb){
        clearInterval(iv);
        openBroadcastById(id);
      }
      if(n > 50) clearInterval(iv);
    }, 200);
  }catch(_){}
})();

/** Deep link ?strand= — open the whole shared Strand (folder), not one item. */
(function strandDeepLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const id = params.get('strand');
    if(!id) return;
    let n = 0;
    const iv = setInterval(()=>{
      n++;
      if(currentUser && fbDb){
        clearInterval(iv);
        const nav = document.querySelector('.navbtn[data-tab="broadcast"]');
        if(nav) nav.click();
        // The Strand's own items load into feedBroadcasts asynchronously —
        // retry briefly instead of opening to an empty folder on a cold start.
        let tries = 0;
        const open = function(){
          tries++;
          const found = (feedBroadcasts || []).some(function(b){ return b && b.strandId === id; });
          if(found || tries > 15){
            if(typeof openStrandFolder === 'function') openStrandFolder(id);
            return;
          }
          setTimeout(open, 300);
        };
        open();
      }
      if(n > 50) clearInterval(iv);
    }, 200);
  }catch(_){}
})();

function broadcastChannelUrl(handle){
  const h = String(handle || '').replace(/^@+/, '').trim();
  return 'https://getnaluno.com/app/?air=' + encodeURIComponent(h || 'broadcast');
}
function airHandle(){
  const n = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.number) || '';
  return String(n).replace(/^@+/, '').trim();
}
async function airShare(handle, title){
  const link = broadcastChannelUrl(handle);
  const text = (title || 'Naluno Broadcast') + '\n' + link;
  try{
    if(navigator.share) await navigator.share({ title: title || 'Naluno Broadcast', text: text, url: link });
    else if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      if(typeof toast === 'function') toast('Broadcast link copied');
    } else if(typeof toast === 'function') toast(link);
  }catch(e){
    if(e && e.name === 'AbortError') return;
    try{
      if(navigator.clipboard) await navigator.clipboard.writeText(link);
      if(typeof toast === 'function') toast('Broadcast link copied');
    }catch(_){ if(typeof toast === 'function') toast(link); }
  }
}
function airPaintMine(){
  const box = document.getElementById('airAbout');
  const shown = document.getElementById('airShown');
  const editor = document.getElementById('airEditor');
  const about = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.broadcastAbout) || '';
  const editing = !!(editor && !editor.hidden);
  if(box && box.dataset.touched !== '1' && document.activeElement !== box) box.value = about;
  if(shown){
    const text = String(about || '').trim();
    shown.textContent = text;
    shown.hidden = editing || !text;
  }
}
function airEditorOpen(open){
  const editor = document.getElementById('airEditor');
  const edit = document.getElementById('airEditBtn');
  const shown = document.getElementById('airShown');
  if(editor) editor.hidden = !open;
  if(edit){
    edit.hidden = !!open;
    edit.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if(open && shown) shown.hidden = true;
  if(!open) airPaintMine();
}
async function openBroadcastChannel(key){
  const raw = String(key || '').replace(/^@+/, '').trim();
  if(!raw || typeof fbDb === 'undefined' || !fbDb) return;
  const home = document.getElementById('airHome');
  const title = document.getElementById('airHomeTitle');
  const aboutEl = document.getElementById('airHomeAbout');
  if(home) home.hidden = false;
  if(title) title.textContent = 'Broadcast';
  if(aboutEl) aboutEl.textContent = '';
  let uid = raw;
  try{
    if(!/^[A-Za-z0-9]{20,}$/.test(raw)){
      const h = await fbDb.collection('handles').doc(raw.toLowerCase()).get();
      if(!h.exists){ if(typeof toast === 'function') toast('No Broadcast by that name'); return; }
      uid = (h.data() && h.data().uid) || '';
    }
    if(!uid) return;
    const user = await fbDb.collection('users').doc(uid).get();
    const data = user.exists ? (user.data() || {}) : {};
    const name = data.name || ('@' + raw);
    const handle = String(data.number || raw).replace(/^@+/, '');
    if(title) title.textContent = name + ' · Broadcast';
    if(aboutEl) aboutEl.textContent = data.broadcastAbout || 'No description yet.';
    const mine = document.getElementById('airMine');
    if(mine) mine.hidden = true;
    if(home) home.hidden = false;
    const share = document.getElementById('airHomeShare');
    if(share) share.onclick = function(){ airShare(handle, name + ' on Naluno'); };
    window.__airChannelUid = uid;
    try{
      /* Someone else's channel: only their public Broadcasts can be listed
         (the rules refuse a read by creator alone, which used to leave this
         page empty). Without the index for this read yet, the public
         catalogue already holds their Broadcasts: walk it. */
      const own = !!(currentUser && uid === currentUser.uid);
      let q = fbDb.collection('broadcasts').where('creatorUid', '==', uid);
      if(!own){
        q = q.where('listed', '==', true)
          .where('hidden', '==', false)
          .where('held', '==', false)
          .where('visibility', '==', 'public')
          .where('publishAt', '<=', nalunoCatalogueNow())
          .orderBy('publishAt', 'desc');
      }
      let snap;
      try{ snap = await q.limit(60).get(); }
      catch(e){
        console.warn('[bcast] channel', e && e.message);
        try{ if(typeof walkPublicCatalogue === 'function') await walkPublicCatalogue({ force: true }); }catch(_){}
        snap = { docs: [] };
      }
      snap.docs.forEach(function(doc){
        const row = Object.assign({ id: doc.id }, doc.data());
        if(row.deleted) return;
        if(typeof broadcastIsPublic === 'function' && !broadcastIsPublic(row)) return;
        if(typeof feedBroadcasts !== 'undefined' && feedBroadcasts && !feedBroadcasts.some(function(b){ return b.id === row.id; })){
          feedBroadcasts.push(row);
        }
      });
    }catch(_){}
    if(typeof renderBroadcastTab === 'function'){ try{ renderBroadcastTab(); }catch(_){} }
    else if(typeof renderBroadcastFeed === 'function'){ try{ renderBroadcastFeed(); }catch(_){} }
  }catch(_){
    if(typeof toast === 'function') toast('Could not open that Broadcast');
  }
}
(function airWire(){
  function go(){
    const save = document.getElementById('airSaveBtn');
    const share = document.getElementById('airShareBtn');
    const edit = document.getElementById('airEditBtn');
    const box = document.getElementById('airAbout');
    if(box && !box.dataset.wired){
      box.dataset.wired = '1';
      box.addEventListener('input', function(){ box.dataset.touched = '1'; });
    }
    if(edit && !edit.dataset.wired){
      edit.dataset.wired = '1';
      edit.onclick = function(){
        const editor = document.getElementById('airEditor');
        const opening = !editor || editor.hidden;
        if(!opening && box) box.dataset.touched = '0';
        airPaintMine();
        airEditorOpen(opening);
        if(opening && box){ try{ box.focus(); }catch(_){} }
      };
    }
    if(save && !save.dataset.wired){
      save.dataset.wired = '1';
      save.onclick = async function(){
        if(typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb){
          if(typeof toast === 'function') toast('Sign in first');
          return;
        }
        const text = String((box && box.value) || '').trim().slice(0, 600);
        try{
          await fbDb.collection('users').doc(currentUser.uid).set({ broadcastAbout: text }, { merge: true });
          if(typeof currentProfile !== 'undefined' && currentProfile) currentProfile.broadcastAbout = text;
          if(box) box.dataset.touched = '0';
          airEditorOpen(false);
          airPaintMine();
          if(typeof toast === 'function') toast('Broadcast description saved');
        }catch(_){ if(typeof toast === 'function') toast('Could not save that'); }
      };
    }
    if(share && !share.dataset.wired){
      share.dataset.wired = '1';
      share.onclick = function(){
        const handle = airHandle();
        if(!handle){ if(typeof toast === 'function') toast('Save your callsign first'); return; }
        const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || handle;
        airShare(handle, name + ' on Naluno');
      };
    }
    airPaintMine();
  }
  const leave = document.getElementById('airHomeLeave');
  if(leave && !leave.dataset.wired){
    leave.dataset.wired = '1';
    leave.onclick = function(){
      window.__airChannelUid = '';
      const home = document.getElementById('airHome');
      const mine = document.getElementById('airMine');
      if(home) home.hidden = true;
      if(mine) mine.hidden = false;
      if(typeof renderBroadcastTab === 'function'){ try{ renderBroadcastTab(); }catch(_){} }
    };
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
  try{
    const params = new URLSearchParams(location.search || '');
    const air = params.get('air');
    if(!air) return;
    let n = 0;
    const iv = setInterval(function(){
      n++;
      if(typeof currentUser !== 'undefined' && currentUser && typeof fbDb !== 'undefined' && fbDb){
        clearInterval(iv);
        const nav = document.querySelector('.navbtn[data-tab="broadcast"]');
        if(nav) nav.click();
        openBroadcastChannel(air);
      }
      if(n > 50) clearInterval(iv);
    }, 200);
  }catch(_){}
})();

/** Plan chapter breaks.
 * Visible chapters ONLY when duration > 4 minutes (product rule).
 * Large-but-short files use silent upload slices (no chapter UI) or a single compress.
 */
function planBroadcastChapters(fileSize, durationSec){
  const maxBytes = (typeof UPLOAD_MAX_BYTES === 'number') ? UPLOAD_MAX_BYTES : (95 * 1024 * 1024);
  const targetBytes = (typeof CHAPTER_TARGET_BYTES === 'number') ? CHAPTER_TARGET_BYTES : (45 * 1024 * 1024);
  const targetSec = (typeof CHAPTER_TARGET_SECONDS === 'number') ? CHAPTER_TARGET_SECONDS : 240;
  const dur = Math.max(0.5, durationSec || 0);
  const size = Math.max(1, fileSize || 0);
  const wantVisibleChapters = dur > targetSec; // strictly longer than 4 minutes
  // Files larger than one Worker request MUST split — even under 4 minutes

  // Build ~4 min chapter time marks (UI + breathers) regardless of upload strategy
  function chapterMarks(){
    const parts = [];
    let i = 0;
    for(let start = 0; start < dur - 0.5; start += targetSec){
      parts.push({ start, end: Math.min(dur, start + targetSec), index: i++ });
      if(i >= 45) break;
    }
    return parts;
  }

  if(!wantVisibleChapters){
    if(size <= maxBytes){
      return { mode: 'single', parts: [{ start: 0, end: dur, index: 0 }], midrolls: [], showChapterUI: false };
    }
    // oversized short video → silent multipart (upload slices)
    // Over worker max but short: silent byte-oriented time slices for upload only
    const bytesPerSec = size / dur;
    const sliceSec = Math.max(20, Math.min(dur, Math.floor(targetBytes / Math.max(1, bytesPerSec))));
    const parts = [];
    let i = 0;
    for(let start = 0; start < dur - 0.25; start += sliceSec){
      parts.push({ start, end: Math.min(dur, start + sliceSec), index: i++ });
      if(i >= 45) break;
    }
    return { mode: 'silent_multipart', parts, midrolls: [], showChapterUI: false };
  }

  // Long video (>4 min)
  // If the whole file fits under the worker max, upload ONCE and use seek-based chapters
  // (no browser re-encode — that is what was failing on phones).
  if(size <= maxBytes){
    const marks = chapterMarks();
    return {
      mode: 'single_with_markers',
      parts: marks,
      midrolls: [],
      showChapterUI: marks.length > 1,
    };
  }

  // File too large for one upload → must split/re-encode slices
  const bytesPerSec = size / dur;
  const maxSecByBytes = Math.max(45, Math.floor(targetBytes / Math.max(1, bytesPerSec)));
  const sliceSec = Math.min(targetSec, maxSecByBytes);
  const parts = [];
  let i = 0;
  for(let start = 0; start < dur - 0.5; start += sliceSec){
    parts.push({ start, end: Math.min(dur, start + sliceSec), index: i++ });
    if(i >= 45) break;
  }
  return { mode: 'multipart', parts, midrolls: [], showChapterUI: parts.length > 1 };
}

function chapterIsActive(ch){
  if(!ch) return false;
  if(ch.silent) return false;
  if(ch.status === 'removed' && !ch.replacementUrl) return false;
  return true;
}

function nextActiveChapterIndex(list, fromIndex){
  const rows = list || [];
  for(let i = (fromIndex || 0) + 1; i < rows.length; i++){
    if(chapterIsActive(rows[i])) return i;
  }
  return -1;
}

function firstActiveChapterIndex(list){
  const rows = list || [];
  for(let i = 0; i < rows.length; i++){
    if(chapterIsActive(rows[i])) return i;
  }
  return 0;
}

/** Default breathers between real chapters — ad architecture lives here. */
function buildBreathersForChapters(chapterCount){
  const list = [];
  for(let i = 0; i < chapterCount - 1; i++){
    list.push({
      afterChapterIndex: i,
      durationMs: 1200,
      label: 'Chapter break',
      // Future ads: fill this slot without changing player structure
      adSlot: {
        enabled: true,
        inventoryId: null,   // e.g. 'naluno-midroll-v1'
        status: 'reserved',  // reserved | ready | playing | completed | skipped
        maxDurationMs: 15000,
      },
    });
  }
  return list;
}

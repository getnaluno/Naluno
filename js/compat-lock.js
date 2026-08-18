/* ============================================================
   MODULE: js/compat-lock.js
   MANDATORY — do not delete, do not "simplify away".

   COMPAT LOCK (catalog safety)
   Whenever you add a feature or upgrade ANY module:
     1. Existing records MUST keep working. New code is additive.
     2. Never rename, drop, or require a field that old Firestore docs omit.
     3. Never change a stored media URL's meaning. Playback must try the
        original URL first, then a resolved/proxy URL.
     4. Prefer the document's mediaUrl / videoUrl over derived chapter URLs.
     5. Do not infer a new type in a way that hides old photos or videos.
     6. If a test catalog item from before the change would break, the change
        is not shippable.

   This file is the project memory for that rule. It is loaded on every page.
   ============================================================ */

const COMPAT_LOCK = {
  rule: 'Upgrades must not break existing Broadcasts, Signals, calls, or auth.',
  playbackOrder: ['mediaUrl', 'videoUrl', 'chapters[0].mediaUrl', 'dataUrl'],
};

/** First playable URL from a Broadcast doc or space segment — old and new shapes. */
function legacyBroadcastPlayUrl(d){
  if(!d || typeof d !== 'object') return '';
  const ch = Array.isArray(d.chapters) ? d.chapters : (d.segment && d.segment.chapters);
  const fromChapter = ch && ch[0] && (ch[0].mediaUrl || ch[0].videoUrl);
  const candidates = [
    d.mediaUrl,
    d.videoUrl,
    d.segment && d.segment.videoUrl,
    d.segment && d.segment.mediaUrl,
    fromChapter,
    d.dataUrl,
    d.segment && d.segment.dataUrl,
  ];
  for(let i = 0; i < candidates.length; i++){
    const u = candidates[i];
    if(u && typeof u === 'string' && u !== 'null') return u;
  }
  return '';
}

function looksLikeVideoUrl(u){
  if(!u || typeof u !== 'string') return false;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u) || /\/o\/u\//.test(u);
}

/** Resolve for playback: try proxy, but never lose the original string. */
function playbackUrlPair(raw){
  const original = raw || '';
  let resolved = original;
  try{
    if(typeof resolveMediaUrl === 'function') resolved = resolveMediaUrl(original) || original;
  }catch(_){}
  return { original, resolved };
}

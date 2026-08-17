/* ============================================================
   MODULE: js/data.js
   Contacts + signal strength derivation
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- DATA ---------------- */
/* Signal strength is DERIVED, not assigned: it decays with time since lastActivityTs, which
   only moves when this contact does something that actually proves reachability — they reply
   in Wireline, or a call with them connects. Sending them a message doesn't move it; only
   hearing back does. This is also what "Keep ringing" is really testing on a retried call.
   Starts empty — real connections (via Find People) populate this at sign-in, each one
   marked isReal:true with a real firebaseUid. Nothing fake seeds it anymore. */
const contacts = [];
const signalMeta = {
  strong: { label:'Strong signal', color:'#7CFFB2' },
  fading: { label:'Fading',        color:'#FFB86B' },
  off:    { label:'Off the grid',  color:'#3A3F55' },
};
/* Bars step down as evidence of reachability ages. Under 5 min: full strength. Past 8 hours
   with nothing since: off the grid. Nothing here is hand-set per contact — it's one function
   applied to a timestamp, which is the whole point. */
const SIGNAL_DECAY = [
  { underMin:5,   tier:'strong', bars:4 },
  { underMin:20,  tier:'strong', bars:3 },
  { underMin:120, tier:'fading', bars:2 },
  { underMin:480, tier:'fading', bars:1 },
];
function computeSignal(c){
  if(c.lastActivityTs == null) return { tier:'off', bars:0 };
  const elapsedMin = (Date.now() - c.lastActivityTs) / 60000;
  for(const step of SIGNAL_DECAY){ if(elapsedMin < step.underMin) return { tier:step.tier, bars:step.bars }; }
  return { tier:'off', bars:0 };
}

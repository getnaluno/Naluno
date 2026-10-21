/* The parts of firestore.rules the two-phone flows depend on, written out
   for the in-memory database. Keep in step with firestore.rules
   (tests/gate/flows/rules-mirror.cjs checks that these protections are
   still in the real rules text). */
function blocked(docs, owner, who) {
  return !!(owner && who && docs && docs.get && docs.get('users/' + owner + '/blocked/' + who));
}
let DOCS = null;
function bindDocs(d) { DOCS = d; }
function deny(uid, kind, p, data) {
  if (typeof p !== 'string') return null;
  const seg = p.split('/');
  const write = kind === 'set' || kind === 'update' || kind === 'delete';
  /* users/<owner>/blocked/<x>: only the owner */
  if (seg[0] === 'users' && seg[2] === 'blocked' && uid !== seg[1] && uid !== 'op') return 'Missing or insufficient permissions.';
  /* users/<owner>/vault: only the owner */
  if (seg[0] === 'users' && seg[2] === 'vault' && uid !== seg[1] && uid !== 'op') return 'Missing or insufficient permissions.';
  if (!write || kind === 'delete') return null;
  /* a Frequency request to someone who blocked you */
  if (seg[0] === 'users' && seg[2] === 'connectionRequests' && blocked(DOCS, seg[1], uid)) return 'Missing or insufficient permissions.';
  /* a Wireline message to someone who blocked you */
  if (seg[0] === 'wireDrop' && seg[2] === 'inbox' && blocked(DOCS, seg[1], uid)) return 'Missing or insufficient permissions.';
  /* the chat line between you and someone who blocked you */
  if (seg[0] === 'threads' && seg.length === 2) {
    const parts = String(seg[1]).split('_');
    if (parts.some((x) => blocked(DOCS, x, uid))) return 'Missing or insufficient permissions.';
  }
  /* a call to someone who blocked you */
  if (seg[0] === 'calls' && seg.length === 2 && kind === 'set' && data && data.calleeUid && data.status === 'ringing' && blocked(DOCS, data.calleeUid, uid)) return 'Missing or insufficient permissions.';
  return null;
}
module.exports = { deny, bindDocs };

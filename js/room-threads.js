/* Threads on a Broadcast. A reply stays under the comment it answers,
   including a reply to a reply, and nothing in the thread is shown
   until that comment is opened. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NalunoRoomThreads = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COMMENT_REACTS = ['👍', '👎', '❤️', '🔥', '👏', '💡'];

  function rowOf(d) {
    const m = d && d.data ? d.data() : (d || {});
    const id = (d && d.id) || m.id || '';
    return { id: String(id), m: m || {} };
  }

  function group(docs) {
    const rows = (docs || []).map(rowOf).filter(function (r) { return r.id; });
    const byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    function rootOf(r) {
      let cur = r;
      const seen = {};
      while (cur) {
        if (seen[cur.id]) break;
        seen[cur.id] = 1;
        const p = (cur.m && (cur.m.parent_id || cur.m.parentId)) || '';
        if (!p || !byId[p]) break;
        cur = byId[p];
      }
      return cur;
    }
    const tops = [];
    const replies = {};
    rows.forEach(function (r) {
      const rootRow = rootOf(r);
      if (!rootRow || rootRow.id === r.id) tops.push(r);
      else (replies[rootRow.id] || (replies[rootRow.id] = [])).push(r);
    });
    Object.keys(replies).forEach(function (k) {
      replies[k].sort(function (a, b) { return (a.m.ts || 0) - (b.m.ts || 0); });
    });
    return { tops: tops, replies: replies };
  }

  return { group: group, COMMENT_REACTS: COMMENT_REACTS };
});

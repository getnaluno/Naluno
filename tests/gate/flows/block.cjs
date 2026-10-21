/* Drop with "Also stop them reaching me", from the chat's ⋮. Afterwards the
   other person's messages and calls are refused, and undo lets them back. */
const { pair, sleep, waitFor, state, dial } = require('../lib/phones.cjs');
module.exports = {
  name: 'block',
  async run(G) {
    const out = [];
    const S = await pair(G, { net: 'wifi', cached: true }, { net: 'wifi', cached: true });
    try {
      /* Bob opens his chat with Alice and uses ⋮ */
      await S.B.p.evaluate(() => { const c = contacts.find((x) => x.id === 'c-alice'); openThread(c.id); });
      await sleep(800);
      const menu = await S.B.p.evaluate(() => {
        document.getElementById('threadMoreBtn').click();
        const m = document.querySelector('.nl-menu');
        return m ? Array.from(m.querySelectorAll('.nl-menu-item')).map((b) => b.textContent) : null;
      });
      out.push({ check: 'chat ⋮ shows Clear chat, Drop, Report', ok: !!menu && menu.join('|') === 'Clear chat on my side|Drop|Report', detail: menu ? menu.join(' | ') : 'no menu' });
      await S.B.p.evaluate(() => { Array.from(document.querySelectorAll('.nl-menu-item')).find((b) => b.textContent === 'Drop').click(); });
      await sleep(400);
      const sheet = await S.B.p.evaluate(() => { const s = document.querySelector('.nl-sheet'); return s ? s.innerText.replace(/\s+/g, ' ') : null; });
      out.push({ check: 'Drop sheet offers "Also stop … from reaching me"', ok: !!sheet && /Also stop Alice from reaching me/.test(sheet), detail: sheet ? sheet.slice(0, 120) : 'no sheet' });
      await S.B.p.evaluate(() => { document.getElementById('nlAlsoBlock').checked = true; document.getElementById('nlGo').click(); });
      await sleep(1500);
      out.push({ check: 'block saved on Bob’s own list', ok: !!S.store.docs.get('users/bob/blocked/alice'), detail: '' });
      out.push({ check: 'both Frequencies entries removed', ok: !S.store.docs.get('users/bob/connections/alice') && !S.store.docs.get('users/alice/connections/bob'), detail: '' });
      const listed = await S.B.p.evaluate(() => (document.getElementById('blockedPeopleList') || {}).innerText || '');
      out.push({ check: 'Callsign lists Alice under "Stopped from reaching you"', ok: /Alice/.test(listed), detail: listed.replace(/\s+/g, ' ').slice(0, 60) });
      /* Alice still has Bob on her phone (an old list): her message and call are refused */
      await S.A.p.evaluate(() => { if (!contacts.find((x) => x.id === 'c-bob')) contacts.push({ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob', isReal: true, initials: 'B', color: '#7CFFB2' }); });
      const before = [...S.store.docs.keys()].filter((k) => /^wireDrop\/bob\/inbox\//.test(k)).length;
      await S.A.p.evaluate(() => { const c = contacts.find((x) => x.id === 'c-bob'); openThread(c.id); });
      await sleep(600);
      await S.A.p.evaluate(() => { document.getElementById('threadInput').value = 'are you there'; sendThreadMessage(); });
      await sleep(3000);
      const after = [...S.store.docs.keys()].filter((k) => /^wireDrop\/bob\/inbox\//.test(k)).length;
      out.push({ check: 'a blocked person’s message is refused', ok: after === before, detail: before + ' → ' + after });
      await dial(S.A, false);
      const rang = await waitFor(async () => (await state(S.B.p)).ring, 6000);
      out.push({ check: 'a blocked person’s call does not ring', ok: rang == null, detail: rang == null ? '' : 'rang after ' + rang + ' ms' });
      await S.A.p.evaluate(() => { try { document.getElementById('cancelCall').click(); } catch (_) {} });
      await sleep(1000);
      /* Undo */
      await S.B.p.evaluate(() => { const b = document.querySelector('[data-nl-unblock="alice"]'); b && b.click(); });
      await sleep(1500);
      out.push({ check: 'Undo removes the block', ok: !S.store.docs.get('users/bob/blocked/alice'), detail: '' });
      /* Frequencies row ⋮ */
      const rowMenu = await S.A.p.evaluate(() => { renderContacts(); const d = document.querySelector('[data-drop-freq]'); if (!d) return null; d.click(); const m = document.querySelector('.nl-menu'); return m ? Array.from(m.querySelectorAll('.nl-menu-item')).map((b) => b.textContent).join('|') : ''; });
      out.push({ check: 'Frequencies row ⋮ shows Drop and Report', ok: rowMenu === 'Drop|Report', detail: String(rowMenu) });
      const errs = S.A.log.concat(S.B.log).filter((l) => /PAGEERROR/.test(l));
      out.push({ check: 'no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
    } finally { await S.close(); }
    return out;
  },
};

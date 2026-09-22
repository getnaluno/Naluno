/* ============================================================
   MODULE: js/wireline-translate.js
   Spark, but for a conversation between distant frequencies.

   Spark translates between two people standing together. This does the same
   for a Wireline thread across countries: incoming messages are shown in
   your language, under the original.

   It translates on the READING side, not the sending side, so it works even
   if the other person's Naluno is older, and the message is stored exactly
   as it was written — a translation is never mistaken for someone's words.

   Uses the same engine as Spark (sparkEngineTranslate), which tries the
   offline Luganda book first, then the phrasebook cache, then the network.
   So common Luganda <-> English still works with no internet.
   ============================================================ */
(function (root) {
  'use strict';
  var PREFS = 'nalunoWireTxPrefs', CACHE = 'nalunoWireTxCache', MAX = 600;

  function load(k, d) { try { var v = JSON.parse(root.localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } }
  function save(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function prefs() { return load(PREFS, {}); }
  function prefFor(contactId) { return prefs()[String(contactId)] || null; }
  function setPref(contactId, p) { var all = prefs(); all[String(contactId)] = p; save(PREFS, all); }

  function myLang() {
    try { if (typeof root.sparkGuessLang === 'function') return root.sparkGuessLang(); } catch (_) {}
    return 'en';
  }
  function langName(id) {
    try { if (typeof root.sparkLangName === 'function') return root.sparkLangName(id); } catch (_) {}
    return id;
  }
  function langList() {
    try { return (root.SPARK_LANGS || []).slice(); } catch (_) { return [{ id: 'en', name: 'English' }]; }
  }

  /* ---- cache: keyed by the message id and target language ---- */
  function cacheKey(m, to) { return (m.clientMsgId || m.id) + '|' + to; }
  function cacheGet(m, to) { var c = load(CACHE, {}); return c[cacheKey(m, to)] || null; }
  function cachePut(m, to, text) {
    var c = load(CACHE, {}), keys;
    c[cacheKey(m, to)] = text;
    keys = Object.keys(c);
    if (keys.length > MAX) keys.slice(0, keys.length - MAX).forEach(function (k) { delete c[k]; });
    save(CACHE, c);
  }

  /* ---- what the bubble shows ---- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  /* Called from wireline.js while building a text bubble. Returns '' when
     translation is off, when the message is mine, or when there is nothing
     translated yet — never a placeholder that looks like a failure. */
  function translationHtml(m) {
    try {
      if (!m || m.from === 'me' || !m.text) return '';
      var p = prefFor(root.activeThreadContactId);
      if (!p || !p.on || !p.from || p.from === p.to) return '';
      var t = cacheGet(m, p.to);
      if (!t || t === m.text) return '';
      return '<div class="msg-tx"><span class="msg-tx-tag">' + esc(langName(p.from)) + ' \u2192 ' + esc(langName(p.to))
        + '</span>' + esc(t) + '</div>';
    } catch (_) { return ''; }
  }

  /* ---- translate what is on screen ---- */
  var busy = false;
  async function translateVisible() {
    if (busy) return;
    var p = prefFor(root.activeThreadContactId);
    if (!p || !p.on || !p.from || p.from === p.to) return;
    if (typeof root.sparkEngineTranslate !== 'function') return;
    var list = (root.wirelineThreads && root.wirelineThreads[root.activeThreadContactId]) || [];
    var todo = list.filter(function (m) {
      return m && m.from !== 'me' && m.type === 'text' && m.text && !cacheGet(m, p.to);
    }).slice(-25);                                  // only what a person is actually reading
    if (!todo.length) return;
    busy = true;
    var changed = false;
    try {
      for (var i = 0; i < todo.length; i++) {
        var out = null;
        try { out = await root.sparkEngineTranslate(todo[i].text, p.from, p.to); } catch (_) { out = null; }
        if (out && out !== todo[i].text) { cachePut(todo[i], p.to, out); changed = true; }
      }
    } finally { busy = false; }
    if (changed && typeof root.renderThreadMessages === 'function') root.renderThreadMessages();
  }

  /* ---- the bar above the composer ---- */
  function renderBar() {
    var bar = root.document && root.document.getElementById('translateBar');
    if (!bar) return;
    var cid = root.activeThreadContactId;
    if (cid == null) { bar.style.display = 'none'; return; }
    var p = prefFor(cid) || { on: false, from: '', to: myLang() };
    var opts = langList().map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === p.from ? ' selected' : '') + '>' + esc(l.name) + '</option>';
    }).join('');
    bar.style.display = 'flex';
    if (!p.on) {
      bar.innerHTML = '<button type="button" class="tx-btn" id="txOn">Translate this chat</button>';
      var on = root.document.getElementById('txOn');
      if (on) on.onclick = function () {
        setPref(cid, { on: true, from: p.from || '', to: myLang() });
        renderBar();
      };
      return;
    }
    bar.innerHTML = '<span class="tx-label">They write in</span>'
      + '<select class="tx-sel" id="txFrom"><option value="">choose\u2026</option>' + opts + '</select>'
      + '<span class="tx-label">\u2192 ' + esc(langName(p.to)) + '</span>'
      + '<button type="button" class="tx-off" id="txOff">Off</button>';
    var sel = root.document.getElementById('txFrom');
    if (sel) sel.onchange = function () {
      setPref(cid, { on: true, from: sel.value, to: p.to || myLang() });
      renderBar();
      translateVisible();
    };
    var off = root.document.getElementById('txOff');
    if (off) off.onclick = function () {
      setPref(cid, { on: false, from: p.from, to: p.to });
      renderBar();
      if (typeof root.renderThreadMessages === 'function') root.renderThreadMessages();
    };
  }

  /* Called at the end of each thread render. */
  function afterRender() { renderBar(); translateVisible(); }

  root.wireTranslationHtml = translationHtml;
  root.wireTranslateAfterRender = afterRender;
  root.wireTranslatePref = prefFor;
  root.wireTranslateSetPref = setPref;
  root.__wireTx = { cacheGet: cacheGet, cachePut: cachePut, translateVisible: translateVisible, renderBar: renderBar };
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================
   MODULE: js/linkify.js   (30a)
   Links in Writing and in Broadcast comments.

   - Anything shared as https://… (or www.…) in a Writing piece, a
     Broadcast description, a comment, a question or a reply is shown as a
     link people can tap. [label](https://…) shows the label as the link.
   - Links are built as page elements from plain text, never from HTML the
     writer typed, so a link can only ever be a link.
   - Only http(s). Adult and gambling sites are not shared: they stay plain
     text, and a post carrying one is refused.
   - A "Link" button in the Writing composer and next to the comment and
     question boxes adds a link (address + optional label) where you are typing.
   ============================================================ */
(function (root) {
  const BAD = /(porn|xxx|xvideo|xnxx|xhamster|redtube|youporn|onlyfans|fansly|chaturbate|stripchat|camsoda|nsfw|hentai|bet365|1xbet|casino)/i;
  const TOKEN = /\[([^\]\n]{1,90})\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  const SELECTOR = '.bspace-read-clamp, #bspaceDesc, #bspaceConversation .body, #bspaceQuestions .body, .bspace-talk-plate .body, .bspace-reply .body, [data-linkify]';

  function normalise(raw) {
    let u = String(raw || '').replace(/[),.;:!?'"]+$/, '');
    if (/^www\./i.test(u)) u = 'https://' + u;
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      if (BAD.test(url.hostname)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function shortLabel(href) {
    try {
      const u = new URL(href);
      let s = u.hostname.replace(/^www\./, '') + (u.pathname && u.pathname !== '/' ? u.pathname : '');
      if (s.length > 48) s = s.slice(0, 45) + '…';
      return s;
    } catch (_) { return href; }
  }
  /* A label that looks like a different web address is not trusted:
     [bank.com](https://elsewhere.com) shows elsewhere.com. */
  function honestLabel(href, label) {
    if (!label) return '';
    const m = String(label).match(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\/\s:?#]|$)/i);
    if (!m) return label;
    let host = '';
    try { host = new URL(href).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) {}
    const named = m[1].replace(/^www\./, '').toLowerCase();
    return (host === named || host.endsWith('.' + named)) ? label : '';
  }
  function anchor(href, label) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label || shortLabel(href);
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow ugc';
    a.className = 'naluno-link';
    return a;
  }
  /* Turn the links in one text node into real links. */
  function linkNode(node) {
    const text = node.nodeValue || '';
    TOKEN.lastIndex = 0;
    if (!TOKEN.test(text)) return false;
    TOKEN.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m, made = 0;
    while ((m = TOKEN.exec(text))) {
      const whole = m[0];
      const label = m[1] || '';
      const raw = m[2] || m[3] || '';
      const trail = m[3] ? (raw.match(/[),.;:!?'"]+$/) || [''])[0] : '';
      const href = normalise(raw);
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (href) {
        frag.appendChild(anchor(href, honestLabel(href, label)));
        if (trail) frag.appendChild(document.createTextNode(trail));
        made++;
      } else {
        frag.appendChild(document.createTextNode(label ? label : whole));
      }
      last = m.index + whole.length;
    }
    if (!made && last === 0) return false;
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
    return made > 0;
  }
  function render(el) {
    if (!el || !el.isConnected) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        const p = n.parentNode;
        if (!p || (p.closest && p.closest('a, button, textarea, input, select, script, style'))) return NodeFilter.FILTER_REJECT;
        return /https?:\/\/|www\./i.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    list.forEach(linkNode);
  }
  function renderAll(scope) {
    const s = scope && scope.querySelectorAll ? scope : document;
    if (s.matches && s.matches(SELECTOR)) render(s);
    s.querySelectorAll(SELECTOR).forEach(render);
  }
  /* Redrawn text (a translation, a new comment) gets its links back. */
  function watch() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    let queue = [], timer = null;
    const flush = function () {
      timer = null;
      const q = queue; queue = [];
      q.forEach(function (n) {
        if (!n || !n.isConnected) return;
        const host = n.closest ? n.closest(SELECTOR) : null;
        if (host) render(host);
        else if (n.querySelectorAll) renderAll(n);
      });
    };
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        let t = m.target;
        if (t && t.nodeType === 3) t = t.parentNode;
        if (t && t.nodeType === 1 && !(t.closest && t.closest('a.naluno-link'))) queue.push(t);
        if (m.addedNodes) m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue.push(n); });
      });
      if (queue.length && !timer) timer = setTimeout(flush, 40);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    renderAll(document);
    /* A link inside a tappable card opens the link, not the card. */
    document.addEventListener('click', function (e) {
      const a = e.target && e.target.closest && e.target.closest('a.naluno-link');
      if (!a) return;
      e.stopPropagation();
    }, true);
  }

  /* ---------------- adding a link while writing ---------------- */
  function hasBlockedLink(text) {
    const s = String(text || '');
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      const raw = m[2] || m[3] || '';
      let u = raw.replace(/[),.;:!?'"]+$/, '');
      if (/^www\./i.test(u)) u = 'https://' + u;
      try { if (BAD.test(new URL(u).hostname)) return true; } catch (_) {}
    }
    return false;
  }
  function insertAt(field, text) {
    if (!field) return;
    const v = field.value || '';
    const max = Number(field.getAttribute('maxlength')) || Infinity;
    const start = typeof field.selectionStart === 'number' ? field.selectionStart : v.length;
    const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : v.length;
    const before = v.slice(0, start), after = v.slice(end);
    const pad = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '');
    if ((before + pad + after).length > max) { if (typeof toast === 'function') toast('That link does not fit in the space left'); return; }
    field.value = before + pad + after;
    const pos = (before + pad).length;
    try { field.focus(); field.setSelectionRange(pos, pos); } catch (_) {}
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  let sheet = null, target = null;
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'linkAttachSheet';
    sheet.className = 'link-attach-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.innerHTML = '<div class="link-attach-card">'
      + '<div class="link-attach-title">Add a link</div>'
      + '<input id="linkAttachUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…" />'
      + '<input id="linkAttachLabel" maxlength="80" autocomplete="off" placeholder="What it says (optional)" />'
      + '<p id="linkAttachMsg" class="link-attach-msg"></p>'
      + '<div class="link-attach-row"><button type="button" id="linkAttachCancel">Cancel</button><button type="button" id="linkAttachAdd" class="primary">Add link</button></div>'
      + '</div>';
    document.body.appendChild(sheet);
    const close = function () { sheet.classList.remove('open'); target = null; };
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    sheet.querySelector('#linkAttachCancel').onclick = close;
    sheet.querySelector('#linkAttachAdd').onclick = function () {
      const msg = sheet.querySelector('#linkAttachMsg');
      let raw = String(sheet.querySelector('#linkAttachUrl').value || '').trim();
      if (raw && !/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
      const href = normalise(raw);
      if (!href || !/\.[a-z]{2,}/i.test(href.replace(/^https?:\/\//, '').split('/')[0])) {
        msg.textContent = hasBlockedLink(raw) ? 'This link cannot be shared on Naluno.' : 'That does not look like a web address.';
        return;
      }
      const label = String(sheet.querySelector('#linkAttachLabel').value || '').replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim();
      const field = target;
      close();
      insertAt(field, label ? '[' + label + '](' + href + ')' : href);
    };
    return sheet;
  }
  function openFor(field) {
    ensureSheet();
    target = field;
    sheet.querySelector('#linkAttachUrl').value = '';
    sheet.querySelector('#linkAttachLabel').value = '';
    sheet.querySelector('#linkAttachMsg').textContent = '';
    sheet.classList.add('open');
    setTimeout(function () { try { sheet.querySelector('#linkAttachUrl').focus(); } catch (_) {} }, 60);
  }
  /* A "Link" button beside a text box. `pick` chooses the box at tap time
     (the Writing sheet has one box per chapter). */
  function addButton(after, pick, cls, place) {
    if (!after || after.__linkBtn) return null;
    after.__linkBtn = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'bspace-mini link-attach-btn';
    b.textContent = 'Link';
    b.setAttribute('aria-label', 'Add a link');
    let lastField = null;
    b.addEventListener('pointerdown', function () { lastField = document.activeElement; });
    b.onclick = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const f = pick(lastField);
      if (f) openFor(f);
    };
    (place || after).insertAdjacentElement('afterend', b);
    return b;
  }
  function wireButtons() {
    const conv = document.getElementById('bspaceConvInput');
    /* Last in the row, so Send stays next to the box. */
    const lastIn = function (el) { return el.parentNode && el.parentNode.lastElementChild || el; };
    if (conv) addButton(conv, function () { return conv; }, null, lastIn(conv));
    const q = document.getElementById('bspaceQInput');
    if (q) addButton(q, function () { return q; }, null, lastIn(q));
    const body = document.getElementById('bwriteBody');
    if (body) {
      const btn = addButton(body, function (last) {
        const sheetEl = document.getElementById('bwriteSheet') || body.parentNode;
        if (last && (last.tagName === 'TEXTAREA') && sheetEl && sheetEl.contains(last)) return last;
        return body;
      }, 'join-btn link-attach-write');
      if (btn) btn.textContent = 'Add a link';
    }
  }

  const api = { honestLabel: honestLabel, render: render, renderAll: renderAll, hasBlockedLink: hasBlockedLink, normalise: normalise, openFor: openFor, BAD: BAD };
  root.NalunoLinks = api;
  if (typeof document !== 'undefined') {
    const boot = function () { watch(); wireButtons(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

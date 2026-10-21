/* ============================================================
   MODULE: js/admin-deploy.js
   Health → "Is everything uploaded?" (21 Oct e).
   OWNERSHIP: this file.

   Each release comes with RELEASE.json: the build and a fingerprint
   (SHA-256) of every file the website and app serve. This fetches every
   one of those files from getnaluno.com as it is served right now, takes
   its fingerprint, and names any file that is missing or is still an older
   copy. A forgotten or half-finished upload is the commonest way an update
   "breaks something that worked": the new half of the app calls something
   the old half does not have. It also asks both workers which version they
   run.
   ============================================================ */
(function (root) {
  let last = null;
  let running = false;
  const WORKERS = [
    ['economy', 'https://naluno-economy.naluno.workers.dev/health'],
    ['callNotify', 'https://naluno-call-notify.naluno.workers.dev/health'],
    ['compass', 'https://naluno-compass.naluno.workers.dev/health'],
  ];

  function hex(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  async function fingerprint(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { status: res.status, sha: '' };
    const buf = await res.arrayBuffer();
    return { status: res.status, sha: hex(await crypto.subtle.digest('SHA-256', buf)) };
  }

  async function run() {
    if (running) return last;
    running = true;
    const t = Date.now();
    const out = { at: t, build: '', total: 0, ok: 0, missing: [], old: [], workers: {}, error: '' };
    try {
      const res = await fetch('/RELEASE.json?check=' + t, { cache: 'no-store' });
      if (!res.ok) throw new Error('RELEASE.json is not on the site (' + res.status + '). Upload it with the build.');
      const rel = await res.json();
      out.build = rel.build || '';
      const files = Object.keys(rel.files || {});
      out.total = files.length;
      let i = 0;
      const next = async function () {
        while (i < files.length) {
          const f = files[i++];
          try {
            const got = await fingerprint('/' + f + '?check=' + t);
            if (!got.sha) out.missing.push(f + ' (' + got.status + ')');
            else if (got.sha !== rel.files[f]) out.old.push(f);
            else out.ok++;
          } catch (e) { out.missing.push(f + ' (could not load)'); }
        }
      };
      await Promise.all([next(), next(), next(), next(), next(), next()]);
      for (const [k, url] of WORKERS) {
        const want = (rel.workers && rel.workers[k]) || '';
        try {
          const r = await fetch(url, { cache: 'no-store' });
          const b = await r.json().catch(function () { return {}; });
          out.workers[k] = { want: want, have: String(b.version || (r.status === 405 ? 'older than 1.2.0 (no health check)' : 'no answer')), ok: !!want && b.version === want };
        } catch (e) { out.workers[k] = { want: want, have: 'unreachable', ok: false }; }
      }
    } catch (e) { out.error = (e && e.message) || String(e); }
    last = out;
    running = false;
    return out;
  }

  function html(h) {
    const esc = h.escapeHtml;
    let body;
    if (running) body = '<p class="sub">Checking every file on getnaluno.com…</p>';
    else if (!last) body = '<p class="sub">Compares every file on getnaluno.com, and both workers, with the build that was uploaded (RELEASE.json). Run it after every upload.</p>';
    else if (last.error) body = '<p class="sub" style="color:#FF8A9A;">' + esc(last.error) + '</p>';
    else {
      const allOk = !last.missing.length && !last.old.length;
      const wk = Object.keys(last.workers).map(function (k) {
        const w = last.workers[k];
        return '<div class="flag-row"><span>' + esc(k === 'economy' ? 'Economy worker' : (k === 'compass' ? 'Compass worker' : 'Call alert worker')) + '</span><span style="color:' + (w.ok ? 'var(--mint)' : '#FF8A9A') + ';">' + esc(w.have) + (w.ok ? '' : ' · expected ' + esc(w.want)) + '</span></div>';
      }).join('');
      body = '<p class="sub" style="color:' + (allOk ? 'var(--mint)' : '#FF8A9A') + ';">'
        + (allOk ? 'All ' + last.total + ' files match build ' + esc(last.build) + '.' : (last.missing.length + last.old.length) + ' of ' + last.total + ' files do not match build ' + esc(last.build) + '. Upload them again, then check again.')
        + '</p>'
        + (last.old.length ? '<div class="desk-list" data-fold-title="Still an older copy (' + last.old.length + ')">' + last.old.map(function (f) { return '<div class="flag-row"><span>' + esc(f) + '</span></div>'; }).join('') + '</div>' : '')
        + (last.missing.length ? '<div class="desk-list" data-fold-title="Missing (' + last.missing.length + ')">' + last.missing.map(function (f) { return '<div class="flag-row"><span>' + esc(f) + '</span></div>'; }).join('') + '</div>' : '')
        + '<div style="margin-top:8px;">' + wk + '</div>'
        + '<p class="sub">Checked ' + esc(new Date(last.at).toLocaleString()) + '. A file can take up to 10 minutes to appear after an upload.</p>';
    }
    return h.card('Is everything uploaded?', body + '<div class="row"><button type="button" class="ghost" id="deployCheckBtn"' + (running ? ' disabled' : '') + '>' + (last ? 'Check again' : 'Check now') + '</button></div>');
  }

  /* Bound by delegation, so a redrawn Health tab keeps working. */
  function bind(repaint) {
    if (root.__nalunoDeployBound) return;
    root.__nalunoDeployBound = true;
    document.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('#deployCheckBtn') : null;
      if (!b || running) return;
      b.disabled = true;
      const p = run();
      try { if (typeof repaint === 'function') repaint(); } catch (_) {}
      p.then(function () { try { if (typeof repaint === 'function') repaint(); } catch (_) {} });
    });
  }

  root.NalunoDeployCheck = { run: run, html: html, bind: bind, get last() { return last; } };
})(typeof window !== 'undefined' ? window : globalThis);

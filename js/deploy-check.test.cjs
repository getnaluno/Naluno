/* 21 Oct e: the console's "Is everything uploaded?" and the release check.
   Run: node js/deploy-check.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
(async () => {
  const src = fs.readFileSync(path.join(root, 'js/admin-deploy.js'), 'utf8');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const site = { '/js/a.js': 'A2', '/js/b.js': 'B1', '/RELEASE.json': JSON.stringify({ build: '2026.10.21e', workers: { economy: '2.16.0-20261021e', callNotify: '1.2.0-20261021e' }, files: { 'js/a.js': sha('A2'), 'js/b.js': sha('B2'), 'js/c.js': sha('C') } }) };
  const ctx = {
    console, Promise, Date, Uint8Array, JSON, String, Object,
    crypto: require('crypto').webcrypto,
    fetch: async (url) => {
      const u = String(url);
      if (/economy/.test(u)) return { ok: true, status: 200, json: async () => ({ version: '2.16.0-20261021e' }) };
      if (/call-notify/.test(u)) return { ok: false, status: 405, json: async () => ({}) };
      const p = u.split('?')[0];
      if (!(p in site)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
      const body = site[p];
      return { ok: true, status: 200, json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    },
    TextEncoder,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const r = await ctx.NalunoDeployCheck.run();
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.ok, 1);
  assert.deepStrictEqual(Array.from(r.old), ['js/b.js'], 'an older copy is named');
  assert.ok(/^js\/c\.js \(404\)$/.test(r.missing[0]), 'a missing file is named');
  assert.strictEqual(r.workers.economy.ok, true);
  assert.strictEqual(r.workers.callNotify.ok, false);
  assert.ok(/no health check/.test(r.workers.callNotify.have), 'an old call worker is recognised');
  const html = ctx.NalunoDeployCheck.html({ card: (t, b) => '<h>' + t + '</h>' + b, escapeHtml: (s) => String(s).replace(/</g, '&lt;') });
  assert.ok(/2 of 3 files do not match build 2026\.10\.21e/.test(html));
  /* the release check runs clean on this tree */
  const R = require(path.join(root, 'tests/gate/release.cjs'));
  assert.deepStrictEqual(R.check(), []);
  const served = R.servedFiles();
  assert.ok(served.includes('js/people-safety.js') && served.includes('sw.js') && served.includes('child-safety/index.html'));
  assert.ok(!served.some((f) => /\.test\./.test(f) || f.startsWith('tests/') || f.startsWith('workers/')));
  console.log('deploy-check: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* Release manifest and stamp check (21 Oct e).

   node tests/gate/release.cjs --check   (part of the gate)
     Every file the app loads with ?v=<stamp> whose content changed since the
     last commit must carry a new stamp. Otherwise phones keep the old copy
     from their cache while the rest of the app moves on — one half of the
     app talking to the other half from a different version, which is how
     "an update broke something that worked" can happen with no code bug.
     Also: the service worker's build, the app's build and both workers'
     versions must all name the same build.

   node tests/gate/release.cjs --write   (when packaging)
     Writes RELEASE.json: the build, and a fingerprint (SHA-256) of every
     file the website and app serve. Upload it with the rest. The console's
     Health → "Is everything uploaded?" compares each file on getnaluno.com
     with this list and names any that are missing or old. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const SERVED_DIRS = ['app', 'admin', 'js', 'css', 'privacy', 'terms', 'contact', 'child-safety', 'invest', 'investment'];
const SERVED_FILES = ['index.html', 'sw.js', 'pwa.js', 'manifest.json', 'firebase-config.js', 'privacy.html', 'terms.html', 'child-safety.html', 'invest.html', 'website.html'];
function servedFiles() {
  const out = [];
  const walk = (d) => {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) return;
    fs.readdirSync(full, { withFileTypes: true }).forEach((e) => {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (!/\.test\.(c|m)?js$/.test(e.name) && /\.(js|css|html|json|mjs)$/.test(e.name)) out.push(rel);
    });
  };
  SERVED_DIRS.forEach(walk);
  SERVED_FILES.forEach((f) => { if (fs.existsSync(path.join(ROOT, f))) out.push(f); });
  return out.sort();
}
function buildOf() { return (read('app/index.html').match(/<meta name="app-version" content="([^"]+)"/) || [])[1] || ''; }
function stampOf(build) { return build.replace(/\./g, ''); }   // 2026.10.21e -> 20261021e

function check() {
  const problems = [];
  const build = buildOf();
  const stamp = stampOf(build);
  const sw = read('sw.js');
  if (!sw.includes("APP_BUILD = '" + stamp + "'")) problems.push('sw.js APP_BUILD is not ' + stamp);
  if (!new RegExp('<meta name="naluno-build" content="' + build.replace(/\./g, '\\.') + '"').test(read('app/index.html'))) problems.push('app naluno-build meta is not ' + build);
  const adminBuild = (read('admin/index.html').match(/<meta name="app-version" content="([^"]+)"/) || [])[1];
  if (adminBuild !== build) problems.push('admin/index.html is on ' + adminBuild + ', the app on ' + build);
  if (!read('js/admin-console.js').includes("BUILD = '" + stamp + "'")) problems.push('admin-console.js BUILD is not ' + stamp);
  ['pwa.js', 'js/pwa.js'].forEach((f) => { if (!read(f).includes('sw.js?v=' + stamp)) problems.push(f + ' registers an sw.js stamp other than ' + stamp); });
  const ev = (read('workers/economy/handler.mjs').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  const cv = (read('workers/call-notify/handler.mjs').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  /* A worker's version names the build it last changed in; it must not be
     ahead of this build, and the bundle must match its source. */
  const mv = (read('workers/compass/index.js').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  [['economy worker', ev], ['call-notify worker', cv], ['compass worker', mv]].forEach(([n, v]) => {
    const m = v.match(/(\d{8}[a-z])$/);
    if (!m) problems.push(n + ' version "' + v + '" does not name a build');
    else if (m[1] > stamp) problems.push(n + ' version names a later build than ' + stamp);
  });
  const bundle = read('naluno-economy-worker.js');
  if (!bundle.includes('"' + ev + '"')) problems.push('naluno-economy-worker.js was not rebuilt (its version is not ' + ev + ')');
  /* changed since the last commit, but the same ?v= */
  let head = null;
  try { execSync('git rev-parse HEAD', { cwd: ROOT, stdio: 'ignore' }); head = 'HEAD'; } catch (_) {}
  if (head) {
    const pages = ['app/index.html', 'admin/index.html', 'privacy.html', 'privacy/index.html', 'terms.html', 'terms/index.html', 'index.html', 'contact/index.html'];
    pages.forEach((page) => {
      if (!fs.existsSync(path.join(ROOT, page))) return;
      let before = '';
      try { before = execSync('git show HEAD:' + page, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (_) { return; }
      const now = read(page);
      const re = /(?:src|href)="\/([^"?#]+)\?v=([^"&#]+)"/g;
      let m;
      while ((m = re.exec(now))) {
        const file = m[1];
        const v = m[2];
        if (!fs.existsSync(path.join(ROOT, file))) { problems.push(page + ' loads ' + file + ', which is not in the build'); continue; }
        let old = null;
        try { old = execSync('git show HEAD:' + file, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { continue; }
        const changed = sha(old) !== sha(fs.readFileSync(path.join(ROOT, file)));
        const oldV = (before.match(new RegExp('/' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([^"&#]+)')) || [])[1];
        if (changed && oldV === v) problems.push(file + ' changed but ' + page + ' still loads it as ?v=' + v + ' (phones would keep the old copy)');
      }
    });
  }
  return problems;
}

function write() {
  const build = buildOf();
  const files = {};
  servedFiles().forEach((f) => { files[f] = sha(fs.readFileSync(path.join(ROOT, f))); });
  const ev = (read('workers/economy/handler.mjs').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  const cv = (read('workers/call-notify/handler.mjs').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  const mv = (read('workers/compass/index.js').match(/export const VERSION = "([^"]+)"/) || [])[1] || '';
  const rel = { build, at: new Date().toISOString(), workers: { economy: ev, callNotify: cv, compass: mv }, files };
  fs.writeFileSync(path.join(ROOT, 'RELEASE.json'), JSON.stringify(rel, null, 1) + '\n');
  return rel;
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('--write')) { const r = write(); console.log('RELEASE.json: build ' + r.build + ', ' + Object.keys(r.files).length + ' files'); }
  const problems = check();
  if (problems.length) { problems.forEach((p) => console.log('not ok - ' + p)); process.exit(1); }
  console.log('release check: ok (build ' + buildOf() + ')');
}
module.exports = { check, write, servedFiles };

#!/usr/bin/env node
/* Naluno release gate (21 Oct e).

   Nothing ships unless this passes:   node tests/gate/run.cjs

   1. Every unit test file (js/*.test.cjs, workers/<name>/*.test.mjs).
   2. Real browsers doing what people do: open every tab and tap its buttons,
      send Wireline both ways, call on Wi-Fi and on mobile networks (relay),
      video, decline, cancel, drop and block, report a Compass answer, the
      console (password, every tab, Legal, keep marks, reports, Measures), a
      new phone's welcome, and updates reaching a phone.
   3. A summary. Anything that failed, or could not be run, fails the gate.

   Options:  --only=calls,wireline   run only these flows
             --skip-unit             flows only
             --allow-not-run         a flow that cannot run here (no relay
                                     address) does not fail the gate
   The report is written to tests/gate/last-run.json. */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');
const { serve } = require('./lib/serve.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x === '--' + k || x.startsWith('--' + k + '=')); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const only = opt('only') ? String(opt('only')).split(',') : null;
const TMP = path.join(require('os').tmpdir(), 'naluno-gate');
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const t0 = Date.now();
const add = (group, check, ok, detail) => { results.push({ group, check, ok, detail: detail || '' }); };

function buildOf() {
  const s = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  return (s.match(/<meta name="app-version" content="([^"]+)"/) || [])[1] || '';
}

/* The relay address: Chrome leaves loopback out of calls, so the relay
   listens on 192.0.2.2 (a documentation address) added to this machine. */
function haveRelayAddress() {
  try { if (fs.readFileSync('/proc/net/fib_trie', 'utf8').includes('192.0.2.2')) return true; } catch (_) {}
  try { execSync('ip addr add 192.0.2.2/32 dev lo', { stdio: 'ignore' }); return true; } catch (_) {}
  try {
    execSync(`python3 -c "
import socket, fcntl, struct
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ifr = struct.pack('16sH2s4s8s', b'lo:9', socket.AF_INET, b'\\x00'*2, socket.inet_aton('192.0.2.2'), b'\\x00'*8)
fcntl.ioctl(s.fileno(), 0x8916, ifr)
"`, { stdio: 'ignore' });
    return fs.readFileSync('/proc/net/fib_trie', 'utf8').includes('192.0.2.2');
  } catch (_) { return false; }
}

function unitTests() {
  const files = [];
  fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.test.cjs')).forEach((f) => files.push('js/' + f));
  fs.readdirSync(path.join(ROOT, 'workers'), { withFileTypes: true }).filter((d) => d.isDirectory()).forEach((d) => {
    fs.readdirSync(path.join(ROOT, 'workers', d.name)).filter((f) => f.endsWith('.test.mjs')).forEach((f) => files.push('workers/' + d.name + '/' + f));
  });
  let failed = 0;
  for (const f of files.sort()) {
    const r = spawnSync(process.execPath, [path.join(ROOT, f)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const text = (r.stdout || '') + (r.stderr || '');
    const ok = r.status === 0 && !/^not ok|AssertionError|^FAIL/m.test(text);
    if (!ok) failed++;
    add('unit', f, ok, ok ? '' : text.split('\n').filter((l) => /not ok|Error|assert/i.test(l)).slice(0, 3).join(' | ').slice(0, 300));
  }
  /* stamps and versions (release.cjs) */
  const rc = spawnSync(process.execPath, [path.join(__dirname, 'release.cjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  const rok = rc.status === 0;
  if (!rok) failed++;
  add('unit', 'stamps and versions agree (release.cjs)', rok, rok ? '' : (rc.stdout || '').trim().split('\n').slice(0, 4).join(' | '));
  return { files: files.length + 1, failed };
}

(async () => {
  const G = { root: ROOT, tmp: TMP, build: buildOf(), relay: false, turnPort: 3479 };
  console.log('Naluno release gate · build ' + G.build);
  if (!opt('skip-unit')) {
    const u = unitTests();
    console.log('unit: ' + (u.files - u.failed) + '/' + u.files + ' files pass');
  }
  const flowsDir = path.join(__dirname, 'flows');
  const ORDER = ['smoke', 'buttons', 'photo', 'wireline', 'calls', 'call-speed', 'call-mixed', 'block', 'compass', 'console', 'console-speed', 'console-update', 'console-lock', 'opening', 'update', 'no-fallback', 'dial'];
  const flows = ORDER.filter((n) => fs.existsSync(path.join(flowsDir, n + '.cjs'))).filter((n) => !only || only.includes(n));
  if (flows.length) {
    let pwOk = true;
    try { require('./lib/pw.cjs').pw(); } catch (e) { pwOk = false; flows.forEach((n) => add(n, 'flow', null, e.message)); }
    if (pwOk) {
      G.relay = haveRelayAddress();
      const turns = [];
      if (G.relay) {
        try {
          require.resolve('node-turn', { paths: [__dirname, path.join(__dirname, 'node_modules')] });
          const t = spawn(process.execPath, [path.join(__dirname, 'lib', 'turn.cjs'), String(G.turnPort)], { stdio: 'ignore', env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname, 'node_modules') }) });
          turns.push(t);
          await new Promise((r) => setTimeout(r, 900));
        } catch (_) { G.relay = false; }
      }
      const site = await serve(ROOT);
      G.base = site.base;
      for (const n of flows) {
        const started = Date.now();
        process.stdout.write('flow ' + n + ' … ');
        try {
          const checks = await require(path.join(flowsDir, n + '.cjs')).run(G);
          checks.forEach((c) => add(n, c.check, c.ok, c.detail));
          const bad = checks.filter((c) => c.ok === false).length;
          const skipped = checks.filter((c) => c.ok == null).length;
          console.log((bad ? bad + ' FAILED' : 'ok') + (skipped ? ', ' + skipped + ' not run' : '') + ' (' + Math.round((Date.now() - started) / 1000) + ' s)');
        } catch (e) {
          add(n, 'flow ran to the end', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
          console.log('CRASHED: ' + (e && e.message));
        }
      }
      site.close();
      turns.forEach((t) => { try { t.kill('SIGKILL'); } catch (_) {} });
    }
  }
  const failed = results.filter((r) => r.ok === false);
  const notRun = results.filter((r) => r.ok == null);
  console.log('');
  failed.forEach((r) => console.log('FAIL  [' + r.group + '] ' + r.check + (r.detail ? '  — ' + r.detail : '')));
  notRun.forEach((r) => console.log('NOT RUN  [' + r.group + '] ' + r.check + (r.detail ? '  — ' + r.detail : '')));
  const pass = !failed.length && (opt('allow-not-run') || !notRun.length);
  const summary = { build: G.build, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), passed: results.filter((r) => r.ok === true).length, failed: failed.length, notRun: notRun.length, gate: pass ? 'PASS' : 'FAIL', results };
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(summary, null, 1));
  console.log('\n' + summary.passed + ' passed, ' + summary.failed + ' failed, ' + summary.notRun + ' not run · gate ' + summary.gate + ' (' + summary.seconds + ' s)');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('GATE CRASHED', e); process.exit(2); });

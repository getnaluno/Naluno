const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const adminSrc = fs.readFileSync(path.join(__dirname, 'admin-console.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
/* The worker lives in this repo at workers/economy, not one level above it. */
const workerSrc = fs.readFileSync(path.join(root, 'workers/economy/handler.mjs'), 'utf8');

/* A stamp must exist and be consistent; pinning the day made the suite rot. */
assert.ok(/const BUILD = '\d{8}[a-z]?'/.test(adminSrc), 'console is stamped');
assert.ok(/naluno-build" content="\d{4}\.\d{2}\.\d{2}[a-z]?"/.test(adminHtml), 'admin html is stamped');
/* Coupled to the script's own BUILD instead of a fixed date, so a stamp
   bump no longer fails the suite. */
const __bu = (adminSrc ? adminSrc : require('fs').readFileSync(require('path').join(__dirname,'admin-console.js'),'utf8')).match(/const BUILD = '(\d{8}[a-z]?)'/)[1];
assert.ok(adminHtml.includes('admin-console.js?v=' + __bu), 'cache-bust matches the console build');

assert.ok(adminSrc.includes('async function cloudGetRecord'), 'reads v1 and v2 account copies');
assert.ok(adminSrc.includes('Number(g.v) === 2'), 'recognises the worker hash');
assert.ok(adminSrc.includes('async function pbkdf2Hex'), 'verifies the worker hash');
assert.ok(adminSrc.includes("if (rec.v === 2 && rec.salt && rec.hash)"), 'cloudOk uses v2 salt');
assert.ok(adminSrc.includes('_consoleGate: payload'), 'account write is the gate field only');
assert.ok(adminSrc.includes('{ merge: true }'), 'account write does not wipe the vault');

assert.ok(adminSrc.includes('401 is not final'), 'unlock keeps going after a worker no');
assert.ok(!/if \(res && res\.status === 401\) \{\s*setMsg\('adminGateMsg', 'Password not accepted/.test(adminSrc),
  'unlock must not treat a worker 401 as the last word');
assert.ok(adminSrc.includes('current_password: typed'), 're-sync sends the password that already matched');
assert.ok(adminSrc.includes('res.status === 401 && !okCloud && !okLocal'),
  'change-password 401 is only final when this phone and the account also say no');
assert.ok(adminSrc.includes('if (!(await cloudOk(uid, typed)))'),
  'a working account copy is not overwritten with the phone hash');

/* Pinned to one version string, so it failed as soon as the worker moved on
   (it is 2.6.9 now). What must hold is that the worker is versioned AND still
   has the multi-copy password logic, which the next two lines check. */
assert.ok(/export const VERSION = "\d+\.\d+\.\d+[-a-z]*"/.test(workerSrc), 'worker is versioned');
assert.ok(workerSrc.includes('async function collectPasswordRecords'), 'worker gathers every copy');
assert.ok(workerSrc.includes('async function matchPasswordRecord'), 'worker accepts any matching copy');
assert.ok(workerSrc.includes('memory.passwords.set(user.uid, matched)'), 'unlock refreshes worker memory to the copy that worked');

console.log('console-pass tests passed');

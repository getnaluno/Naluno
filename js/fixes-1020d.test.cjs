/* 20 Oct d: call and message records kept 12 months; keep marks in Legal;
   every opening of the records logged; the privacy policy says so.
   Run: node js/fixes-1020d.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* 1. Rules: only the desk reads and writes keep marks. */
{
  const r = read('firestore.rules');
  assert.ok(/match \/legalHolds\/\{uid\} \{\s*allow read, write: if isOperator\(\);\s*\}/.test(r));
}
/* 2. The console: keep and lift write the audit first; nothing changes if the audit fails. */
{
  const adm = read('js/admin-console.js');
  const fn = adm.slice(adm.indexOf('function paintLegalHolds(host)'), adm.indexOf('function paintRecordsInto(el)'));
  assert.ok(fn.length > 500);
  const add = fn.indexOf("writeAudit('legal-hold-add'"), set = fn.indexOf("collection('legalHolds').doc(uid).set(");
  assert.ok(add > 0 && set > add && /if \(!ok\) throw/.test(fn.slice(add, set)), 'keep: audit first');
  const lift = fn.indexOf("writeAudit('legal-hold-lift'"), del = fn.indexOf("collection('legalHolds').doc(uid).delete()");
  assert.ok(lift > 0 && del > lift && /if \(!ok\) throw/.test(fn.slice(lift, del)), 'lift: audit first');
  assert.ok(/if \(!why\)/.test(fn), 'a reason is required');
  assert.ok(/escapeHtml\(r\.uid\)/.test(fn) && /escapeHtml\(String\(r\.why/.test(fn), 'what is shown is escaped');
  const rec = adm.slice(adm.indexOf('function paintRecordsInto(el) {'), adm.indexOf('function paintRecordsInto(el) {') + 600);
  assert.ok(/writeAudit\('legal-records-open'/.test(rec), 'opening the records is logged');
  const legal = adm.slice(adm.indexOf("if (tab === 'legal') {"), adm.indexOf("if (tab === 'legal') {") + 12000);
  assert.ok(legal.indexOf('if (!__legalOpen) {') < legal.indexOf("paintLegalHolds(el.querySelector('#legalHoldsHost'))"), 'keep marks only behind the Legal password');
}
/* 2b. Measures is not redrawn off-screen after the first paint (its batches stayed empty). */
{
  const adm = read('js/admin-console.js');
  assert.ok(/if \(tab !== 'diagnostics' && tab !== 'measures'\) renderTabInPlace\(tab, d\);/.test(adm));
  assert.ok(/const live = host\.isConnected \? host : \(document\.getElementById\('legalHoldsHost'\) \|\| host\);/.test(adm));
}
/* 3. The privacy policy, the same in the app and on both website pages. */
{
  const want = [
    /These records are kept for 12 months so Naluno can look into reports of abuse, fraud or threats and answer lawful requests, and are then deleted automatically\./,
    /kept longer only while an open report, investigation or legal request needs it/,
    /every time they are opened it is logged/,
    /<h3>11a\. Requests from authorities<\/h3>/,
    /only when the law requires it, such as a valid court order, or when we believe in good faith that it is needed to prevent imminent harm/,
    /we may refuse or challenge one/,
    /Call and message records — 12 months, and longer only while an open report, investigation or legal request needs them\./,
  ];
  const app = read('js/legal-privacy.js');
  const body = app.slice(app.indexOf('`') + 1, app.lastIndexOf('`')).trim();
  for (const f of ['js/legal-privacy.js', 'privacy.html', 'privacy/index.html']) {
    const s = read(f);
    want.forEach((re) => assert.ok(re.test(s), f + ' ' + re));
    assert.ok(!/It is kept for safety and legal requests, and only people Naluno authorises can open it\./.test(s), f + ': the old sentence is gone');
    if (f !== 'js/legal-privacy.js') assert.ok(s.replace(/\s+/g, ' ').indexOf(body.replace(/\s+/g, ' ')) >= 0, f + ' matches the app word for word');
    if (f !== 'js/legal-privacy.js') assert.ok(/legal-privacy\.js\?v=20261020d/.test(s));
  }
  assert.ok(/legal-privacy\.js\?v=20261020d/.test(read('app/index.html')));
}
/* 4. The worker bundle carries the sweep. */
{
  const b = read('naluno-economy-worker.js');
  assert.ok(/RECORDS_KEEP_DAYS = 365/.test(b) && /legalHolds\?pageSize=1000/.test(b), 'rebuild the bundle');
}
console.log('fixes-1020d: all checks passed');

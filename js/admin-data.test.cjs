const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/admin-data.js', 'utf8');
const ctx = { window: {}, globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const D = ctx.window.NalunoAdminData || ctx.NalunoAdminData;
assert.ok(D, 'NalunoAdminData missing');

const clock = D.formatAdminClock(new Date('2026-09-10T08:30:00Z'), 'Asia/Dubai');
assert.strictEqual(clock.time, '12:30:00', 'Dubai local time from 08:30Z should be 12:30');
assert.ok(!/Z$/.test(clock.full), 'clock must not end with Z');
assert.ok(clock.full.indexOf('Z') === -1 || clock.tzName !== 'Z', 'must not display Zulu');
assert.ok(clock.zone === 'Asia/Dubai');

const kampala = D.formatAdminClock(new Date('2026-09-10T08:30:00Z'), 'Africa/Kampala');
assert.strictEqual(kampala.time, '11:30:00', 'Kampala local time from 08:30Z should be 11:30');
assert.ok(kampala.zone === 'Africa/Kampala');

const utcClockExplicit = D.formatAdminClock(new Date('2026-09-10T04:30:23Z'), 'UTC');
assert.strictEqual(utcClockExplicit.time, '04:30:23');
assert.ok(utcClockExplicit.full.indexOf('04:30:23Z') === -1, 'must not append Z to the time');

assert.ok(typeof D.setAdminZone === 'function', 'setAdminZone exported');
const previous = D.adminZone();
D.setAdminZone('Africa/Nairobi');
assert.strictEqual(D.adminZone(), 'Africa/Nairobi');
D.setAdminZone(previous);

/* Device timezone is used as-is. UTC hosts stay UTC — never forced to Al Ain / Dubai. */
const deviceZone = D.localZone();
if (deviceZone === 'UTC' || deviceZone === 'Etc/UTC' || deviceZone === 'Etc/GMT') {
  D.setAdminZone('');
  /* Override empty string still keeps previous; force-clear by setting UTC. */
  D.setAdminZone('UTC');
  assert.notStrictEqual(D.adminZone(), 'Asia/Dubai', 'UTC must not be remapped to Dubai/Al Ain');
}
D.setAdminZone(previous);

const day0 = D.startOfLocalDay(Date.parse('2026-09-10T08:30:00Z'), 'Asia/Dubai');
const ymd = D.localYmd(day0, 'Asia/Dubai');
assert.strictEqual(ymd, '2026-09-10');
assert.strictEqual(D.localYmd(day0 - 1000, 'Asia/Dubai'), '2026-09-09');

const beforeMidnightGst = Date.parse('2026-09-09T19:30:00Z'); // 23:30 GST Sept 9
assert.strictEqual(D.localYmd(beforeMidnightGst, 'Asia/Dubai'), '2026-09-09');
const afterMidnightGst = Date.parse('2026-09-09T20:30:00Z'); // 00:30 GST Sept 10
assert.strictEqual(D.localYmd(afterMidnightGst, 'Asia/Dubai'), '2026-09-10');

const snap = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [
    { id: 'a', name: 'A', createdAt: Date.parse('2026-09-10T01:00:00Z'), lastSeen: Date.parse('2026-09-10T08:25:00Z'), lastPlatform: 'android-native' },
    { id: 'b', name: 'B', createdAt: Date.parse('2026-08-01T00:00:00Z'), lastSeen: Date.parse('2026-09-10T08:20:00Z'), lastPlatform: 'pwa' },
    { id: 'c', name: 'C', createdAt: Date.parse('2026-08-01T00:00:00Z'), lastSeen: Date.parse('2026-09-01T00:00:00Z'), lastPlatform: 'web-desktop', suspended: true },
  ],
  broadcasts: [
    { id: 'b1', title: 'One', creatorUid: 'a', creatorName: 'A', views: 12, live: true, createdAt: Date.parse('2026-09-10T02:00:00Z') },
    { id: 'b2', title: 'Two', creatorUid: 'b', creatorName: 'B', views: 5, deleted: true },
    { id: 'b3', title: 'Held', creatorUid: 'a', held: true, listed: false, createdAt: Date.parse('2026-09-10T03:00:00Z') },
    { id: 'b4', title: 'Down', creatorUid: 'a', hidden: true, listed: false, hiddenReason: 'sexual', createdAt: Date.parse('2026-09-10T04:00:00Z') },
  ],
  signals: [{ id: 's1', uid: 'a', createdAt: Date.parse('2026-09-10T03:00:00Z') }],
  beacons: [{ id: 'phone', uid: 'a', lat: 0.3476, lng: 32.5825, ts: Date.parse('2026-09-10T08:20:00Z'), placeName: 'Kampala', accuracy: 12 }],
  originMarks: [{ id: 'o1', status: 'hold', createdAt: Date.parse('2026-09-10T04:00:00Z') }],
  worker: { ok: true, degraded: true, ms: 40, version: '2.0.0-admin-password' },
  sw: { connected: true, version: 'v155' },
  flags: { broadcast_enabled: true },
});

assert.strictEqual(snap.users.total, 3);
assert.strictEqual(snap.users.active_now, 2);
assert.strictEqual(snap.users.new_today, 1);
assert.strictEqual(snap.users.returning_today, 1);
assert.strictEqual(snap.users.suspended.length, 1);
assert.strictEqual(snap.content.broadcasts_total, 3);
assert.strictEqual(snap.content.broadcasts_live, 1);
assert.strictEqual(snap.content.broadcasts_deleted, 1);
assert.strictEqual(snap.content.broadcasts_held, 1);
assert.strictEqual(snap.content.broadcasts_hidden, 1);
assert.strictEqual(snap.healthLabel, 'OPERATIONAL', 'a Trust queue is not a down platform');
assert.ok(snap.alerts.some(function (a) { return /waiting to go out/i.test(a.text); }), 'held still needs a look');
assert.ok(!snap.alerts.some(function (a) { return /taken down/i.test(a.text); }), 'taken-down is done, not an alert');
assert.ok(snap.attention.some(function (a) { return /waiting to go out/i.test(a.text); }));
assert.ok(!snap.attention.some(function (a) { return /taken down/i.test(a.text); }));

const down = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [],
  worker: { ok: false, error: 'unreachable', ms: 0 },
  sw: { connected: true },
});
assert.strictEqual(down.healthLabel, 'DEGRADED', 'worker silence is the only degraded state');

const adRev = D.estimateAdRevenue({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [{ id: 'a', lastSeen: Date.parse('2026-09-10T08:25:00Z') }],
  adRates: { ecpmAed: 10, cpcAed: 1, cpvAed: 2, viewCompleteSec: 15 },
  deskAds: [
    { id: 'ad1', status: 'live', billModel: 'cpm', impressions: 1000, clicks: 10, viewCompletes: 5, paidAed: 8 },
    { id: 'ad2', status: 'live', billModel: 'cpc', impressions: 20, clicks: 4, viewCompletes: 2, paidAed: 10 },
  ],
});
assert.strictEqual(adRev.units[0].impressions, 1000, 'ad1 keeps its own views');
assert.strictEqual(adRev.units[1].impressions, 20, 'ad2 keeps its own views');
assert.strictEqual(adRev.impressions, 1020, 'journal is the sum, not mixed into a unit');
assert.strictEqual(adRev.units[0].clicks, 10);
assert.strictEqual(adRev.units[1].clicks, 4);
assert.notStrictEqual(adRev.units[0].clicks, adRev.clicks, 'a unit must not carry the house total');
assert.ok(Math.abs(adRev.units[0].ctr - 1) < 1e-9);
assert.ok(Math.abs(adRev.units[1].ctr - 20) < 1e-9);
assert.strictEqual(D.adUnitStats(adRev.units[0], { ecpmAed: 10, cpcAed: 1, cpvAed: 2 }).id, 'ad1');
const onlyAd2 = D.adUnitStats(
  { id: 'ad2', billModel: 'cpc', impressions: 20, clicks: 4, viewCompletes: 2, paidAed: 10 },
  { ecpmAed: 10, cpcAed: 1, cpvAed: 2 }
);
assert.strictEqual(onlyAd2.bookedAed, 4);
assert.strictEqual(onlyAd2.impressions, 20);
assert.notStrictEqual(onlyAd2.impressions, adRev.impressions);
assert.strictEqual(adRev.units[0].paidAed, 8);
assert.strictEqual(adRev.units[0].remainingAed, 0);
assert.ok(adRev.units[0].spent, 'prepaid 8 against booked 10 is spent');
assert.strictEqual(adRev.units[1].bookedAed, 4);
assert.strictEqual(adRev.units[1].remainingAed, 6);
assert.ok(!adRev.units[1].spent);
assert.strictEqual(adRev.paidAed, 18);
assert.strictEqual(adRev.spentCount, 1);
assert.ok(adRev.assumptions.some(function (t) { return /prepaid/i.test(t); }));
assert.ok(adRev.assumptions.some(function (t) { return /pauses itself/i.test(t); }));

const mailSnap = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [],
  deskMail: [
    { id: 'm1', kind: 'invest', interest: 'investment', status: 'new', ts: Date.parse('2026-09-10T08:00:00Z'), text: 'Hello' },
    { id: 'm2', kind: 'contact', status: 'new', ts: Date.parse('2026-09-10T07:00:00Z'), text: 'Hi' },
  ],
});
assert.strictEqual(mailSnap.mail.invest, 1);
assert.strictEqual(mailSnap.mail.unread, 2);
assert.strictEqual(mailSnap.healthLabel, 'NEEDS ATTENTION');

const sitePulse = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  siteSessions: [
    { id: 'w1', kind: 'web', vid: 'v1', fresh: true, startedAt: Date.parse('2026-09-10T07:00:00Z'), lastAt: Date.parse('2026-09-10T08:20:00Z'), ms: 40000, path: '/', land: '/', source: 'Google', device: 'phone', os: 'Android', engaged: true, five: true, trail: '/ → /invest' },
    { id: 'w2', kind: 'web', vid: 'v2', fresh: false, startedAt: Date.parse('2026-09-05T07:00:00Z'), lastAt: Date.parse('2026-09-05T07:10:00Z'), ms: 10000 },
    { id: 'w3', kind: 'web', vid: 'v3', fresh: false, startedAt: Date.parse('2026-08-20T07:00:00Z'), lastAt: Date.parse('2026-08-20T07:10:00Z'), ms: 9000 },
    { id: 'w4', kind: 'web', vid: 'v4', fresh: false, startedAt: Date.parse('2026-07-01T07:00:00Z'), lastAt: Date.parse('2026-07-01T07:10:00Z'), ms: 8000 },
    { id: 'bot1', kind: 'web', vid: 'vb', bot: true, startedAt: Date.parse('2026-09-10T07:30:00Z'), lastAt: Date.parse('2026-09-10T07:31:00Z'), ms: 800, ua: 'Googlebot' },
    { id: 'self1', kind: 'web', vid: 'vs', self: true, startedAt: Date.parse('2026-09-10T07:40:00Z'), lastAt: Date.parse('2026-09-10T07:41:00Z'), ms: 12000, path: '/' },
    { id: 'wa1', kind: 'web', vid: 'vw', fresh: true, startedAt: Date.parse('2026-09-10T07:50:00Z'), lastAt: Date.parse('2026-09-10T07:55:00Z'), ms: 8000, path: '/invest', ref: 'direct', ua: 'Mozilla/5.0 WhatsApp/2.24' },
  ],
  siteDays: [
    { id: '2026-09-10', visits: 5, appOpens: 1, ms: 1000 },
    { id: '2026-08-20', visits: 3, appOpens: 0, ms: 500 },
    { id: '2026-07-01', visits: 99, appOpens: 9, ms: 9000 },
  ],
});
assert.strictEqual(sitePulse.site.today, 2, 'visits today exclude bot and self');
assert.strictEqual(sitePulse.site.week, 3, 'visits in rolling 7d');
assert.strictEqual(sitePulse.site.month, 4, 'visits in rolling 30d — July session is out');
assert.strictEqual(sitePulse.site.uniques_today, 2);
assert.strictEqual(sitePulse.site.uniques_30d, 4);
assert.strictEqual(sitePulse.site.new_today, 2);
assert.strictEqual(sitePulse.site.returning_30d, 2);
assert.strictEqual(sitePulse.site.day_visits, 8, '30d rollup excludes July');
assert.strictEqual(sitePulse.site.day_app, 1);
assert.ok(sitePulse.site.days.every(function (d) { return d.id >= '2026-08-11'; }), 'day files are the last 30 days');
assert.strictEqual(sitePulse.site.days.length, 2);
assert.strictEqual(sitePulse.site.bots_today, 1);
assert.strictEqual(sitePulse.site.self_today, 1);
assert.ok(sitePulse.site.sources.some(function (x) { return x.label === 'Google'; }), 'Google source');
assert.ok(sitePulse.site.sources.some(function (x) { return x.label === 'WhatsApp'; }), 'WhatsApp from UA');
assert.ok(sitePulse.site.land.some(function (x) { return x.label === 'Home'; }), 'landing pretty-label');
assert.ok(sitePulse.site.five_working === true, '5s measurement seen');
assert.strictEqual(D.classifySiteSource('direct', '', 'Mozilla/5.0 WhatsApp/2'), 'WhatsApp');
assert.strictEqual(D.classifySiteSource('l.facebook.com', '', ''), 'Facebook');
assert.strictEqual(D.pageLabel('/invest'), 'Invest');

assert.ok(D.DEFAULT_FLAGS.creator_support_enabled === false, 'Creator Support defaults off');
assert.ok(D.FLAG_META.creator_support_enabled, 'Creator Support flag meta');
const snapSupport = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [],
  flags: { creator_support_enabled: true },
  creatorSupport: [{ id: 't1', amount_minor: 1000, currency: 'AED', supporter_user_id: 'a', creator_user_id: 'b' }],
});
assert.strictEqual(snapSupport.economy.support_transactions, 1);
assert.strictEqual(snapSupport.economy.support_list.length, 1);

assert.ok(snap.locations.with_coords >= 1, 'beacon coords must roll up onto the user');
assert.strictEqual(snap.origin.held, 1);
assert.ok(snap.users.list.filter(function (u) { return u.id === 'a' && u.lastLat; }).length === 1);
assert.strictEqual(D.money(12345, 'AED'), '123.45 AED');

const utcClock = D.formatAdminClock(new Date('2026-09-10T04:30:23Z'), 'UTC');
assert.strictEqual(utcClock.time, '04:30:23');
assert.ok(utcClock.full.indexOf('04:30:23Z') === -1, 'must not append Z to the time');

const ident = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  reservedHandles: [
    { handle: 'naluno', category: 'official', reason: 'Brand', holderUid: 'ibMOMY6Q3sVTCxIrwO2FGk43zw93', createdAt: 1 },
    { handle: 'nalunosupport', category: 'support', reason: 'Support', createdAt: 1 },
    { handle: 'nalunosupport', aliasOf: 'nalunosupport', category: 'support' },
  ],
  handleFlags: [
    { id: 'f_nalun0_user', handle: 'nalun0', uid: 'u1', reserved: 'naluno', reason: 'lookalike characters', status: 'open', createdAt: 2 },
  ],
});
assert.ok(ident.identity);
assert.strictEqual(ident.identity.total, 2, 'aliases are not counted twice');
assert.strictEqual(ident.identity.by_category.official, 1);
assert.strictEqual(ident.identity.by_category.support, 1);
assert.strictEqual(ident.identity.open_flags.length, 1);
assert.strictEqual(ident.identity.official_holder, 'ibMOMY6Q3sVTCxIrwO2FGk43zw93');
assert.ok(ident.alerts.some(function (a) { return a.tab === 'identity'; }));
assert.ok(typeof D.deriveIdentity === 'function');
assert.ok(typeof D.reportIsOpen === 'function');

assert.strictEqual(D.reportIsOpen({ status: 'OPEN' }), true);
assert.strictEqual(D.reportIsOpen({ status: 'NEW' }), true);
assert.strictEqual(D.reportIsOpen({ status: 'UNDER REVIEW' }), true);
assert.strictEqual(D.reportIsOpen({}), true, 'missing status is still waiting');
assert.strictEqual(D.reportIsOpen({ status: 'ACTIONED' }), false);
assert.strictEqual(D.reportIsOpen({ status: 'DISMISSED' }), false);
assert.strictEqual(D.reportIsOpen({ status: 'OPEN', resolvedAt: 1 }), false, 'resolved clock closes it');
assert.strictEqual(D.reportIsOpen({ status: 'OPEN', decided_at: 1 }), false, 'worker decided_at closes it');
assert.strictEqual(D.reportIsOpen({ status: 'closed' }), false);

const waitingReport = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [{ id: 'b1', listed: true }],
  reports: [{ id: 'rep_1', status: 'OPEN', broadcast_id: 'b1', reason: 'sexual content here' }],
  worker: { ok: true },
  sw: { connected: true },
});
assert.strictEqual(waitingReport.safety.open_reports, 1);
assert.strictEqual(waitingReport.healthLabel, 'NEEDS ATTENTION');
assert.ok(waitingReport.attention.some(function (a) { return /report/.test(a.text); }));

const actionedStaysGone = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [{ id: 'b1', listed: true }],
  reports: [{ id: 'rep_1', status: 'ACTIONED', broadcast_id: 'b1', resolvedAt: 9 }],
  worker: { ok: true },
  sw: { connected: true },
});
assert.strictEqual(actionedStaysGone.safety.open_reports, 0, 'Actioned report does not return on a new sign-in');
assert.strictEqual(actionedStaysGone.healthLabel, 'OPERATIONAL');
assert.ok(!actionedStaysGone.attention.some(function (a) { return /report/.test(a.text); }));

const takenDownClosesReport = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [{ id: 'b1', hidden: true, listed: false, hiddenBy: 'ibMOMY6Q3sVTCxIrwO2FGk43zw93', hiddenReason: 'sexual' }],
  reports: [{ id: 'rep_1', status: 'OPEN', broadcast_id: 'b1' }],
  worker: { ok: true },
  sw: { connected: true },
});
assert.strictEqual(takenDownClosesReport.safety.open_reports, 0, 'take-down is the decision');
assert.ok(!takenDownClosesReport.attention.some(function (a) { return /report/.test(a.text); }));

const sexualHideStillWaits = D.deriveSnapshot({
  now: Date.parse('2026-09-10T08:30:00Z'),
  zone: 'Asia/Dubai',
  users: [],
  broadcasts: [{ id: 'b1', hidden: true, listed: false, hiddenBy: 'report', hiddenReason: 'sexual' }],
  reports: [{ id: 'rep_1', status: 'OPEN', broadcast_id: 'b1' }],
  worker: { ok: true },
  sw: { connected: true },
});
assert.strictEqual(sexualHideStillWaits.safety.open_reports, 1, 'auto-hide still needs a person');
assert.ok(sexualHideStillWaits.attention.some(function (a) { return /report/.test(a.text); }));

console.log('admin-data tests passed', {
  dubai: clock.full,
  day0: new Date(day0).toISOString(),
  health: snap.healthLabel,
});

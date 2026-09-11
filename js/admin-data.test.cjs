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
assert.strictEqual(snap.content.broadcasts_total, 1);
assert.strictEqual(snap.content.broadcasts_live, 1);
assert.strictEqual(snap.content.broadcasts_deleted, 1);
assert.strictEqual(snap.signals.today, 1);
assert.ok(snap.locations.with_coords >= 1, 'beacon coords must roll up onto the user');
assert.strictEqual(snap.origin.held, 1);
assert.ok(snap.users.list.filter(function (u) { return u.id === 'a' && u.lastLat; }).length === 1);
assert.strictEqual(D.money(12345, 'AED'), '123.45 AED');

const utcClock = D.formatAdminClock(new Date('2026-09-10T04:30:23Z'), 'UTC');
assert.strictEqual(utcClock.time, '04:30:23');
assert.ok(utcClock.full.indexOf('04:30:23Z') === -1, 'must not append Z to the time');

console.log('admin-data tests passed', {
  dubai: clock.full,
  day0: new Date(day0).toISOString(),
  health: snap.healthLabel,
});

/* ============================================================
   MODULE: js/admin-data.js
   Pure Control Centre maths. No DOM, no Firebase.

   Day boundaries and the live clock use the ADMIN DEVICE timezone —
   the physical place the phone/laptop thinks it is standing — never UTC.
   ============================================================ */
(function (root) {
  const DEFAULT_FLAGS = {
    broadcast_enabled: true,
    signals_enabled: true,
    toga_enabled: true,
    contribution_enabled: true,
    community_value_enabled: true,
    creator_support_enabled: false,
    community_rewards_enabled: false,
    real_payouts_enabled: false,
    content_hub_enabled: false,
    sports_enabled: false,
    movies_enabled: false,
  };

  const FLAG_META = {
    broadcast_enabled: { label: 'Broadcast', group: 'Product', note: 'Long-form rooms and live.' },
    signals_enabled: { label: 'Signals', group: 'Product', note: 'Short clips that lead into Broadcast.' },
    toga_enabled: { label: 'Toga', group: 'Product', note: 'Wall of Fame ranking.' },
    contribution_enabled: { label: 'Contribution tracking', group: 'Community', note: 'Count comments, replies, shares.' },
    community_value_enabled: { label: 'Community value', group: 'Community', note: 'A measurement, never money.' },
    creator_support_enabled: { label: 'Creator Support', group: 'Money', note: 'Donate to a creator. Off until a payment provider is connected.' },
    community_rewards_enabled: { label: 'Community Rewards', group: 'Money', note: 'Pool split. Off until switched on.' },
    real_payouts_enabled: { label: 'Real payouts', group: 'Money', note: 'Locked. Requires a signed off-console decision.' },
    content_hub_enabled: { label: 'Content Hub', group: 'Hub', note: 'Sports / movies / channels. Not built yet.' },
    sports_enabled: { label: 'Sports', group: 'Hub', note: 'Requires Content Hub.' },
    movies_enabled: { label: 'Movies', group: 'Hub', note: 'Requires Content Hub.' },
  };

  const TERMS = [
    { abbr: 'AED', name: 'United Arab Emirates dirham', note: 'Naluno’s operating currency. Shown next to USD at a peg of 3.6725.' },
    { abbr: 'USD', name: 'United States dollar', note: 'Shown next to dirham amounts for comparison.' },
    { abbr: 'DAU', name: 'Daily active users', note: 'Accounts with a heartbeat during the operator device’s local day.' },
    { abbr: 'WAU', name: 'Weekly active users', note: 'Accounts with a heartbeat in the last 7 days.' },
    { abbr: 'MAU', name: 'Monthly active users', note: 'Accounts with a heartbeat in the last 30 days.' },
    { abbr: 'R2', name: 'Cloudflare R2', note: 'Object storage for Broadcast and Signal media. Download bandwidth (egress) is not billed.' },
    { abbr: 'FCM', name: 'Firebase Cloud Messaging', note: 'Device push notifications. Not billed.' },
    { abbr: 'TURN', name: 'Traversal Using Relays around NAT', note: 'Relays a call when a direct connection fails. Cost is per gigabyte of relayed media.' },
    { abbr: 'Spark', name: 'Firebase Spark', note: 'The free Firebase plan: 50,000 reads per day, 20,000 writes per day, 1 GB of document storage.' },
    { abbr: 'Blaze', name: 'Firebase Blaze', note: 'Pay-as-you-go Firebase, after Spark limits.' },
    { abbr: 'GPS', name: 'Global Positioning System', note: 'Last device pin from Find Naluno.' },
    { abbr: 'UTC', name: 'Coordinated Universal Time', note: 'Day boundaries follow the operator device timezone, not UTC.' },
    { abbr: 'SW', name: 'Service worker', note: 'Caches the app shell and handles background events on the device.' },
    { abbr: 'UID', name: 'User identifier', note: 'The account id in Firebase Auth and Firestore.' },
    { abbr: 'GB', name: 'Gigabyte', note: '1,000,000,000 bytes in this model.' },
    { abbr: 'AI', name: 'Artificial intelligence', note: 'Compass and related billed usage, recorded as a cash amount.' },
    { abbr: 'CAC', name: 'Customer acquisition cost', note: 'Not known. Not estimated on this console.' },
    { abbr: 'LTV', name: 'Lifetime value', note: 'Not known. Not estimated on this console.' },
    { abbr: 'D1 / D7', name: 'Day-1 / day-7 retention', note: 'Share of a signup cohort still active N days later. Needs a session log. Still-here is used instead.' },
    { abbr: 'CPU / RAM', name: 'Processor / memory', note: 'Instance utilisation. Cloudflare and Firebase do not expose this to the console.' },
    { abbr: 'PWA', name: 'Progressive web app', note: 'The installable Naluno website.' },
  ];

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  let __adminZoneOverride = '';

  function isUtcName(z) {
    const s = String(z || '');
    return s === 'UTC' || s === 'Etc/UTC' || s === 'Etc/GMT' || s === 'Etc/GMT+0' || s === 'Etc/GMT-0';
  }

  function readStoredZone() {
    try {
      const z = sessionStorage.getItem('nalunoAdminZone') || localStorage.getItem('nalunoAdminZone') || '';
      if (z && !isUtcName(z)) return z;
    } catch (_) {}
    return '';
  }

  /* The desk clock follows the device that opened it.
     Never remap UTC → Asia/Dubai / Al Ain. If the host reports UTC, GPS
     reverse-geocode (setAdminZone) is what names the real place. */
  function adminZone() {
    if (__adminZoneOverride) return __adminZoneOverride;
    const stored = readStoredZone();
    if (stored) return stored;
    return localZone();
  }

  function setAdminZone(zone) {
    const z = String(zone || '').trim();
    if (!z) return adminZone();
    __adminZoneOverride = z;
    try {
      sessionStorage.setItem('nalunoAdminZone', z);
      if (!isUtcName(z)) localStorage.setItem('nalunoAdminZone', z);
    } catch (_) {}
    return z;
  }

  function zoneFriendly(zone) {
    const z = zone || adminZone();
    if (z === 'Asia/Dubai' || z === 'Asia/Muscat') return 'Gulf Standard Time';
    if (z === 'Africa/Kampala' || z === 'Africa/Nairobi') return 'East Africa Time';
    if (isUtcName(z)) return 'UTC';
    return String(z).replace(/_/g, ' ');
  }

  function formatAdminClock(date, zone) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const tz = zone || adminZone();
    let time = '';
    let tzName = '';
    let day = '';
    try {
      const tf = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      time = tf.format(d);
      const df = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      day = df.format(d);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        timeZoneName: 'short',
        hour: '2-digit',
      }).formatToParts(d);
      const p = parts.filter(function (x) { return x.type === 'timeZoneName'; })[0];
      tzName = (p && p.value) || tz;
    } catch (_) {
      time = d.toTimeString().slice(0, 8);
      tzName = tz;
    }
    if (/Z$/i.test(time)) time = time.replace(/Z$/i, '');
    if (!tzName || tzName === 'Z' || /Z$/i.test(tzName)) tzName = tz === 'UTC' ? 'UTC' : zoneFriendly(tz);
    if (tzName === 'GMT+4' || tzName === 'UTC+4' || tzName === 'GMT+04:00') tzName = 'GST';
    return {
      time: time,
      zone: tz,
      tzName: tzName,
      day: day,
      label: time + ' ' + tzName,
      full: day + ' · ' + time + ' ' + tzName,
    };
  }

  function localYmd(ms, zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone || adminZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  function startOfLocalDay(ms, zone) {
    const tz = zone || adminZone();
    const ymd = localYmd(ms || Date.now(), tz);
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      let lo = Date.parse(ymd + 'T00:00:00Z') - 36 * 3600000;
      let hi = Date.parse(ymd + 'T00:00:00Z') + 36 * 3600000;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (fmt.format(new Date(mid)) >= ymd) hi = mid;
        else lo = mid;
      }
      return hi;
    } catch (_) {
      const x = new Date(ms || Date.now());
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    }
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function seenOf(u) {
    return num(u && (u.lastSeen || u.lastActive || u.lastPresence || 0));
  }
  function createdOf(u) {
    return num(u && (u.createdAt || u.created_at || 0));
  }
  function money(minor, ccy) {
    return (num(minor) / 100).toFixed(2) + (ccy ? ' ' + ccy : '');
  }

  /* Published list prices, September 2026. AED is pegged to USD.
     Spark + Cloudflare free currently invoice nothing. This is the
     math for when usage (or a typed bill) starts to cost Naluno. */
  const COST_RATES = {
    as_of: '2026-09',
    currency: 'AED',
    usd_to_aed: 3.6725,
    r2_storage_gb_month_usd: 0.015,
    r2_class_a_million_usd: 4.50,
    r2_class_b_million_usd: 0.36,
    firestore_storage_gb_month_usd: 0.18,
    firestore_read_100k_usd: 0.06,
    firestore_write_100k_usd: 0.18,
    workers_million_usd: 0.30,
    turn_gb_usd: 0.05,
    signal_hours: 25,
    hours_month: 720,
    spark_firestore_storage_gb: 1,
    spark_reads_per_day: 50000,
    spark_writes_per_day: 20000,
    r2_free_storage_gb: 10,
    r2_free_class_a: 1000000,
    workers_free_per_day: 100000,
    video_bytes_per_sec: 125000,
    audio_bytes_per_sec: 16000,
    photo_bytes: 400000,
    unknown_video_bytes: 8000000,
    user_doc_bytes: 3000,
    broadcast_doc_bytes: 4000,
    signal_doc_bytes: 2500,
    mau_reads_per_day: 150,
    mau_writes_per_day: 24,
    dau_worker_reqs: 20,
  };

  function usdAed(usd) {
    return num(usd) * COST_RATES.usd_to_aed;
  }

  function formatAed(n) {
    const x = num(n);
    if (!isFinite(x)) return '—';
    if (x === 0) return 'AED 0.00';
    if (Math.abs(x) < 0.005) return '< AED 0.01';
    if (Math.abs(x) < 1) return 'AED ' + x.toFixed(3);
    return 'AED ' + x.toFixed(2);
  }

  function formatBytes(n) {
    const x = num(n);
    if (x <= 0) return '0 B';
    if (x < 1000) return Math.round(x) + ' B';
    if (x < 1e6) return (x / 1000).toFixed(1) + ' KB';
    if (x < 1e9) return (x / 1e6).toFixed(1) + ' MB';
    return (x / 1e9).toFixed(2) + ' GB';
  }

  function formatUsd(n) {
    const x = num(n);
    if (!isFinite(x)) return '—';
    if (x === 0) return '$0.00';
    if (Math.abs(x) < 0.005) return '< $0.01';
    if (Math.abs(x) < 1) return '$' + x.toFixed(3);
    return '$' + x.toFixed(2);
  }

  function moneyPair(aedVal) {
    const a = num(aedVal);
    return formatAed(a) + ' · ' + formatUsd(a / COST_RATES.usd_to_aed);
  }

  function roundMau(n) {
    if (n == null || !isFinite(n)) return null;
    const x = Number(n);
    if (x < 10) return Math.max(1, Math.round(x));
    if (x < 100) return Math.round(x / 5) * 5;
    if (x < 1000) return Math.round(x / 10) * 10;
    if (x < 10000) return Math.round(x / 50) * 50;
    return Math.round(x / 100) * 100;
  }

  function mauUntilCap(currentQty, freeQty, scaleN, perUserFallback) {
    if (currentQty > 0 && scaleN > 0) return scaleN * (freeQty / currentQty);
    if (perUserFallback > 0) return freeQty / perUserFallback;
    return null;
  }

  function mediaBytesOf(row) {
    if (!row || typeof row !== 'object') return 0;
    const direct = num(row.bytes || row.size || row.fileSize || row.contentLength || row.sizeBytes);
    if (direct > 0) return direct;
    if (Array.isArray(row.chapters) && row.chapters.length) {
      let sum = 0;
      for (let i = 0; i < row.chapters.length; i++) sum += mediaBytesOf(row.chapters[i]);
      if (sum > 0) return sum;
    }
    const durSec = num(row.duration || row.durationSec || row.duration_s);
    const durMs = num(row.durationMs);
    const seconds = durSec > 0 ? durSec : (durMs > 0 ? durMs / 1000 : 0);
    const kind = String(row.mediaType || row.type || row.kind || '').toLowerCase();
    const audio = /audio|voice|mic/.test(kind);
    const photo = /image|photo|jpg|png/.test(kind);
    if (seconds > 0) {
      return seconds * (audio ? COST_RATES.audio_bytes_per_sec : COST_RATES.video_bytes_per_sec);
    }
    const hasMedia = !!(row.mediaUrl || row.videoUrl || row.url || row.thumb || row.src);
    if (!hasMedia && !kind) return 0;
    if (photo) return COST_RATES.photo_bytes;
    if (audio) return 30 * COST_RATES.audio_bytes_per_sec;
    if (hasMedia || /video|broadcast|signal/.test(kind)) return COST_RATES.unknown_video_bytes;
    return 0;
  }

  function estimateCosts(raw) {
    raw = raw || {};
    const users = raw.users || [];
    const broadcasts = (raw.broadcasts || []).filter(function (b) { return !b.deleted; });
    const signals = raw.signals || [];
    const ledger = raw.ledger || [];
    const now = num(raw.now) || Date.now();
    const zone = raw.zone || adminZone();
    const day0 = startOfLocalDay(now, zone);
    const day30 = now - 30 * 86400000;
    const mauUsers = users.filter(function (u) { return seenOf(u) >= day30; });
    const dauUsers = users.filter(function (u) { return seenOf(u) >= day0; });
    const mauN = mauUsers.length;
    const dauN = dauUsers.length;
    const registered = users.length;

    const inputs = raw.costInputs || {};
    const invoiceAed = num(inputs.invoiceAed);
    const fixedAed = num(inputs.fixedAed);
    const turnMinutes = Math.max(0, num(inputs.turnMinutes));
    const compassAed = num(inputs.compassAed);

    const byUid = {};
    function slot(uid) {
      const id = String(uid || '');
      if (!id) return null;
      if (!byUid[id]) {
        byUid[id] = {
          uid: id,
          broadcast_bytes: 0,
          signal_bytes: 0,
          uploads: 0,
          r2_gb_month: 0,
          variable_aed: 0,
          share_aed: 0,
          monthly_aed: 0,
        };
      }
      return byUid[id];
    }

    let broadcastBytes = 0;
    let signalBytes = 0;
    let viewsStored = 0;
    broadcasts.forEach(function (b) {
      const bytes = mediaBytesOf(b);
      broadcastBytes += bytes;
      viewsStored += num(b.views || b.uniqueViews);
      const s = slot(b.creatorUid || b.creator_uid || b.uid);
      if (!s) return;
      s.broadcast_bytes += bytes;
      s.uploads += 1;
      s.r2_gb_month += bytes / 1e9;
    });
    const signalFrac = COST_RATES.signal_hours / COST_RATES.hours_month;
    signals.forEach(function (row) {
      const bytes = mediaBytesOf(row);
      signalBytes += bytes;
      const s = slot(row.uid || row.creatorUid || row.from);
      if (!s) return;
      s.signal_bytes += bytes;
      s.uploads += 1;
      s.r2_gb_month += (bytes / 1e9) * signalFrac;
    });

    const r2Gb = Object.keys(byUid).reduce(function (a, k) { return a + byUid[k].r2_gb_month; }, 0);
    const classA = Object.keys(byUid).reduce(function (a, k) { return a + byUid[k].uploads; }, 0);
    const firestoreBytes =
      registered * COST_RATES.user_doc_bytes
      + broadcasts.length * COST_RATES.broadcast_doc_bytes
      + signals.length * COST_RATES.signal_doc_bytes;
    const readsMonth = mauN * COST_RATES.mau_reads_per_day * 30 + broadcasts.length * 20;
    const writesMonth = mauN * COST_RATES.mau_writes_per_day * 30
      + broadcasts.length * 8
      + signals.length * 8
      + ledger.length * 2;
    const workerReqs = dauN * COST_RATES.dau_worker_reqs * 30;
    const turnGb = turnMinutes * 0.002;

    const r2StorageUsd = r2Gb * COST_RATES.r2_storage_gb_month_usd;
    const r2ClassAUsd = (classA / 1e6) * COST_RATES.r2_class_a_million_usd;
    const fsStorageUsd = (firestoreBytes / 1e9) * COST_RATES.firestore_storage_gb_month_usd;
    const fsReadUsd = (readsMonth / 1e5) * COST_RATES.firestore_read_100k_usd;
    const fsWriteUsd = (writesMonth / 1e5) * COST_RATES.firestore_write_100k_usd;
    const workersUsd = (workerReqs / 1e6) * COST_RATES.workers_million_usd;
    const turnUsd = turnGb * COST_RATES.turn_gb_usd;

    function line(key, label, usd, qty, unit, aedExtra) {
      return {
        key: key,
        label: label,
        usd: usd,
        aed: usdAed(usd) + num(aedExtra),
        qty: qty,
        unit: unit || '',
      };
    }
    const lines = [
      line('r2_storage', 'R2 media (Broadcast stays, Signal 25h)', r2StorageUsd, r2Gb, 'GB-month'),
      line('r2_class_a', 'R2 uploads', r2ClassAUsd, classA, 'objects'),
      line('fs_storage', 'Firestore documents', fsStorageUsd, firestoreBytes / 1e9, 'GB'),
      line('fs_reads', 'Firestore reads (model)', fsReadUsd, readsMonth, 'reads/mo'),
      line('fs_writes', 'Firestore writes (model)', fsWriteUsd, writesMonth, 'writes/mo'),
      line('workers', 'Workers requests (model)', workersUsd, workerReqs, 'reqs/mo'),
      line('turn', 'Call relay (TURN)', turnUsd, turnMinutes, 'minutes'),
      line('r2_egress', 'R2 bandwidth (egress not billed)', 0, viewsStored, 'stored views'),
      line('fcm', 'Push notifications (FCM, not billed)', 0, dauN, 'DAU'),
      line('compass', 'Compass / AI (recorded bill)', 0, compassAed, 'AED', compassAed),
      line('fixed', 'Fixed (domain, store, typed)', 0, fixedAed, 'AED', fixedAed),
    ];
    const meteredAed = lines.reduce(function (a, L) { return a + L.aed; }, 0);

    const r2BillGb = Math.max(0, r2Gb - COST_RATES.r2_free_storage_gb);
    const classABill = Math.max(0, classA - COST_RATES.r2_free_class_a);
    const fsStorBillGb = Math.max(0, firestoreBytes / 1e9 - COST_RATES.spark_firestore_storage_gb);
    const readsDay = readsMonth / 30;
    const writesDay = writesMonth / 30;
    const workerDay = workerReqs / 30;
    const fsReadBill = Math.max(0, readsDay - COST_RATES.spark_reads_per_day) * 30;
    const fsWriteBill = Math.max(0, writesDay - COST_RATES.spark_writes_per_day) * 30;
    const workerBill = Math.max(0, workerDay - COST_RATES.workers_free_per_day) * 30;
    const billableUsd =
      r2BillGb * COST_RATES.r2_storage_gb_month_usd
      + (classABill / 1e6) * COST_RATES.r2_class_a_million_usd
      + fsStorBillGb * COST_RATES.firestore_storage_gb_month_usd
      + (fsReadBill / 1e5) * COST_RATES.firestore_read_100k_usd
      + (fsWriteBill / 1e5) * COST_RATES.firestore_write_100k_usd
      + (workerBill / 1e6) * COST_RATES.workers_million_usd
      + turnUsd;
    const billableAed = usdAed(billableUsd) + compassAed + (turnMinutes ? 0 : 0) + fixedAed;
    /* Fixed and Compass are always cash, even on Spark. TURN is list-priced (no free tier here). */

    Object.keys(byUid).forEach(function (k) {
      const s = byUid[k];
      s.variable_aed = usdAed(
        s.r2_gb_month * COST_RATES.r2_storage_gb_month_usd
        + (s.uploads / 1e6) * COST_RATES.r2_class_a_million_usd
      );
    });
    const variableTotal = Object.keys(byUid).reduce(function (a, k) { return a + byUid[k].variable_aed; }, 0);
    const unattributed = Math.max(0, meteredAed - variableTotal);
    const shareBase = Math.max(mauN, 1);
    const shareAed = unattributed / shareBase;
    const nameOf = {};
    users.forEach(function (u) {
      nameOf[u.id] = u.name || u.handle || u.email || String(u.id || '').slice(0, 10);
    });
    const mauSet = {};
    mauUsers.forEach(function (u) { mauSet[u.id] = 1; });

    const people = users.map(function (u) {
      const s = slot(u.id) || {
        uid: u.id,
        broadcast_bytes: 0,
        signal_bytes: 0,
        uploads: 0,
        r2_gb_month: 0,
        variable_aed: 0,
      };
      const share = mauSet[u.id] ? shareAed : 0;
      const monthly = s.variable_aed + share;
      return {
        uid: u.id,
        name: nameOf[u.id] || String(u.id || '').slice(0, 10),
        handle: u.handle || '',
        mau: !!mauSet[u.id],
        broadcast_bytes: s.broadcast_bytes,
        signal_bytes: s.signal_bytes,
        uploads: s.uploads,
        r2_gb_month: s.r2_gb_month,
        variable_aed: s.variable_aed,
        share_aed: share,
        monthly_aed: monthly,
      };
    });
    people.sort(function (a, b) { return b.monthly_aed - a.monthly_aed; });

    const perRegistered = registered ? meteredAed / registered : 0;
    const perMau = mauN ? meteredAed / mauN : 0;
    const perDau = dauN ? meteredAed / dauN : 0;

    function project(nMau) {
      const mixN = Math.max(mauN, registered, 1);
      const f = nMau / mixN;
      const pR2 = r2Gb * f;
      const pClassA = classA * f;
      const pFsBytes = firestoreBytes * f;
      const pReads = readsMonth * f;
      const pWrites = writesMonth * f;
      const pWorkers = workerReqs * f;
      const pTurn = turnMinutes * f;
      const pTurnGb = pTurn * 0.002;
      const grossUsd =
        pR2 * COST_RATES.r2_storage_gb_month_usd
        + (pClassA / 1e6) * COST_RATES.r2_class_a_million_usd
        + (pFsBytes / 1e9) * COST_RATES.firestore_storage_gb_month_usd
        + (pReads / 1e5) * COST_RATES.firestore_read_100k_usd
        + (pWrites / 1e5) * COST_RATES.firestore_write_100k_usd
        + (pWorkers / 1e6) * COST_RATES.workers_million_usd
        + pTurnGb * COST_RATES.turn_gb_usd;
      const pR2Bill = Math.max(0, pR2 - COST_RATES.r2_free_storage_gb);
      const pClassBill = Math.max(0, pClassA - COST_RATES.r2_free_class_a);
      const pFsStorBill = Math.max(0, pFsBytes / 1e9 - COST_RATES.spark_firestore_storage_gb);
      const pReadBill = Math.max(0, pReads / 30 - COST_RATES.spark_reads_per_day) * 30;
      const pWriteBill = Math.max(0, pWrites / 30 - COST_RATES.spark_writes_per_day) * 30;
      const pWorkerBill = Math.max(0, pWorkers / 30 - COST_RATES.workers_free_per_day) * 30;
      const billUsd =
        pR2Bill * COST_RATES.r2_storage_gb_month_usd
        + (pClassBill / 1e6) * COST_RATES.r2_class_a_million_usd
        + pFsStorBill * COST_RATES.firestore_storage_gb_month_usd
        + (pReadBill / 1e5) * COST_RATES.firestore_read_100k_usd
        + (pWriteBill / 1e5) * COST_RATES.firestore_write_100k_usd
        + (pWorkerBill / 1e6) * COST_RATES.workers_million_usd
        + pTurnGb * COST_RATES.turn_gb_usd;
      return {
        n: nMau,
        gross_aed: usdAed(grossUsd) + fixedAed + compassAed,
        billable_aed: usdAed(billUsd) + fixedAed + compassAed,
        per_mau_aed: nMau ? (usdAed(grossUsd) + fixedAed + compassAed) / nMau : 0,
      };
    }

    const serving = invoiceAed > 0 ? invoiceAed : billableAed;
    const servePerMau = mauN ? serving / mauN : 0;
    const servePerReg = registered ? serving / registered : 0;

    const mixN = Math.max(mauN, registered, 1);
    const stick = mauN ? (dauN / mauN) : 0.25;
    const gates = [
      {
        key: 'fs_reads',
        label: 'Firestore reads',
        free: '50,000 / day (Spark)',
        mau: mauUntilCap(readsMonth / 30, COST_RATES.spark_reads_per_day, mixN, COST_RATES.mau_reads_per_day),
      },
      {
        key: 'fs_writes',
        label: 'Firestore writes',
        free: '20,000 / day (Spark)',
        mau: mauUntilCap(writesMonth / 30, COST_RATES.spark_writes_per_day, mixN, COST_RATES.mau_writes_per_day),
      },
      {
        key: 'workers',
        label: 'Workers requests',
        free: '100,000 / day (Cloudflare)',
        mau: mauUntilCap(workerReqs / 30, COST_RATES.workers_free_per_day, mixN, COST_RATES.dau_worker_reqs * stick),
      },
      {
        key: 'r2_storage',
        label: 'R2 media storage',
        free: '10 GB (Cloudflare)',
        mau: r2Gb > 0 ? mixN * (COST_RATES.r2_free_storage_gb / r2Gb) : null,
      },
      {
        key: 'fs_storage',
        label: 'Firestore documents',
        free: '1 GB (Spark)',
        mau: mauUntilCap(firestoreBytes / 1e9, COST_RATES.spark_firestore_storage_gb, mixN, COST_RATES.user_doc_bytes / 1e9),
      },
    ].map(function (g) {
      return {
        key: g.key,
        label: g.label,
        free: g.free,
        mau: g.mau,
        mau_display: roundMau(g.mau),
        already: g.mau != null && g.mau <= mixN && (mauN > 0 || registered > 0) && (
          (g.key === 'r2_storage' && r2Gb > COST_RATES.r2_free_storage_gb)
          || (g.key === 'fs_reads' && readsMonth / 30 > COST_RATES.spark_reads_per_day)
          || (g.key === 'fs_writes' && writesMonth / 30 > COST_RATES.spark_writes_per_day)
          || (g.key === 'workers' && workerReqs / 30 > COST_RATES.workers_free_per_day)
          || (g.key === 'fs_storage' && firestoreBytes / 1e9 > COST_RATES.spark_firestore_storage_gb)
        ),
      };
    });
    gates.sort(function (a, b) {
      const am = a.mau == null ? 1e15 : a.mau;
      const bm = b.mau == null ? 1e15 : b.mau;
      return am - bm;
    });
    const firstGate = gates.filter(function (g) { return g.mau != null; })[0] || null;
    const alreadyOver = gates.filter(function (g) { return g.already; });
    let headline = 'Usage is within free allowances. Firebase Spark and Cloudflare currently invoice AED 0.00.';
    if (invoiceAed > 0) {
      headline = 'Serving from the recorded invoice: ' + moneyPair(invoiceAed) + '.';
    } else if (alreadyOver.length) {
      headline = 'Usage is past a free allowance on '
        + alreadyOver.map(function (g) { return g.label; }).join(', ')
        + '. After-free-tier estimate is ' + moneyPair(billableAed) + '.';
    } else if (firstGate && firstGate.mau_display) {
      headline = 'Usage is within free allowances. At the current mix, the first list-price bill is '
        + firstGate.label + ' around ' + firstGate.mau_display.toLocaleString('en-GB')
        + ' monthly active users (MAU).';
    }

    return {
      rates: COST_RATES,
      invoice_aed: invoiceAed,
      fixed_aed: fixedAed,
      compass_aed: compassAed,
      turn_minutes: turnMinutes,
      metered_aed: meteredAed,
      billable_aed: billableAed,
      serving_aed: serving,
      on_free_tier: billableAed - fixedAed - compassAed <= 0.0001 && invoiceAed === 0,
      per_registered_aed: perRegistered,
      per_mau_aed: perMau,
      per_dau_aed: perDau,
      serve_per_mau_aed: servePerMau,
      serve_per_registered_aed: servePerReg,
      metered_usd: meteredAed / COST_RATES.usd_to_aed,
      billable_usd: billableAed / COST_RATES.usd_to_aed,
      per_mau_usd: perMau / COST_RATES.usd_to_aed,
      people: people,
      top: people.slice(0, 20),
      lines: lines,
      storage: {
        r2_gb: r2Gb,
        firestore_gb: firestoreBytes / 1e9,
        broadcast_bytes: broadcastBytes,
        signal_bytes: signalBytes,
        uploads: classA,
        views: viewsStored,
      },
      scale: [1000, 10000, 100000].map(project),
      gates: gates,
      first_gate: firstGate,
      headline: headline,
      assumptions: [
        'Broadcast media remains on Cloudflare R2 for a full gigabyte-month. Signals last 25 hours, then they fall off.',
        'Cloudflare R2 has no egress fee. Watching a Broadcast does not bill bandwidth.',
        'When a file has no stored size, video is counted at about 1 Mbps, a photo at 400 KB, unknown video at 8 MB.',
        'Firestore reads and writes are a model (150 reads and 24 writes per monthly active user per day), not a Google invoice.',
        'Firebase Spark and Cloudflare free plans currently bill AED 0.00 on usage. Invoiced spend is the amount recorded under Bills.',
        'Call relay (TURN) is zero until minutes are recorded. Compass / artificial intelligence (AI) is zero until that bill is recorded. Push (FCM) is not billed.',
        'Platform share (presence, workers, domain) is split across monthly active users, not dormant accounts.',
        'The first bill is the first free allowance that usage exceeds. Firestore reads usually go first (about 330 monthly active users at 150 reads per person per day).',
      ],
    };
  }

  function deriveSnapshot(raw) {
    raw = raw || {};
    const now = num(raw.now) || Date.now();
    const zone = raw.zone || adminZone();
    const users = raw.users || [];
    const broadcasts = raw.broadcasts || [];
    const signals = raw.signals || [];
    const toga = raw.toga || [];
    const strands = raw.strands || [];
    const bands = raw.bands || [];
    const reports = raw.reports || [];
    const ledger = raw.ledger || [];
    const metrics = raw.metrics || [];
    const audit = raw.audit || [];
    const beacons = raw.beacons || [];
    const originMarks = raw.originMarks || [];
    const deskMail = raw.deskMail || raw.mail || [];
    const flags = Object.assign({}, DEFAULT_FLAGS, raw.flags || {});
    const worker = raw.worker || {};
    const sw = raw.sw || {};

    const day0 = startOfLocalDay(now, zone);
    const day7 = now - 7 * 86400000;
    const day30 = now - 30 * 86400000;
    const activeCut = now - 10 * 60 * 1000;

    const beaconByUid = {};
    beacons.forEach(function (b) {
      const uid = String(b.uid || b.userId || '');
      if (!uid) return;
      if (!beaconByUid[uid] || num(b.ts) > num(beaconByUid[uid].ts)) beaconByUid[uid] = b;
    });
    users.forEach(function (u) {
      const lat = u.lastLat != null ? Number(u.lastLat) : (u.lat != null ? Number(u.lat) : NaN);
      const lng = u.lastLng != null ? Number(u.lastLng) : Number(u.lastLng === 0 ? 0 : (u.lng != null ? u.lng : u.lon));
      if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
        u.lastLat = lat;
        u.lastLng = lng;
        return;
      }
      const b = beaconByUid[u.id];
      if (!b || b.lat == null || (b.lng == null && b.lon == null)) return;
      u.lastLat = Number(b.lat);
      u.lastLng = Number(b.lng != null ? b.lng : b.lon);
      u.lastAccuracy = b.accuracy;
      u.lastPlace = b.placeName || b.place || u.lastPlace || '';
      u.lastLocationAt = num(b.ts);
      u.lastLocationSource = b.source || 'beacon';
      u.lastDeviceId = b.deviceId || b.id || '';
      u.lastDeviceLabel = b.label || '';
    });

    const liveUsers = users.filter(function (u) { return seenOf(u) >= activeCut; });
    const dauUsers = users.filter(function (u) { return seenOf(u) >= day0; });
    const wauUsers = users.filter(function (u) { return seenOf(u) >= day7; });
    const mauUsers = users.filter(function (u) { return seenOf(u) >= day30; });
    const newToday = users.filter(function (u) { return createdOf(u) >= day0; });
    const new7 = users.filter(function (u) { return createdOf(u) >= day7; });
    const new30 = users.filter(function (u) { return createdOf(u) >= day30; });
    const returningToday = users.filter(function (u) {
      return seenOf(u) >= day0 && createdOf(u) && createdOf(u) < day0;
    });
    const suspended = users.filter(function (u) { return !!(u.suspended || u.status === 'SUSPENDED'); });
    const restricted = users.filter(function (u) { return !!(u.restricted || u.status === 'RESTRICTED'); });

    const byPlatform = {};
    users.forEach(function (u) {
      const p = String(u.lastPlatform || u.platform || 'unknown');
      byPlatform[p] = (byPlatform[p] || 0) + 1;
    });

    const activeB = broadcasts.filter(function (b) { return !b.deleted; });
    const deletedB = broadcasts.filter(function (b) { return !!b.deleted; });
    const liveB = activeB.filter(function (b) { return !!b.live; });
    const bToday = activeB.filter(function (b) { return num(b.createdAt) >= day0; });
    let viewsTotal = 0;
    let comments = 0;
    let replies = 0;
    let shares = 0;
    activeB.forEach(function (b) {
      viewsTotal += num(b.views || b.uniqueViews);
      comments += num(b.comments || b.commentCount);
      replies += num(b.replies || b.replyCount);
      shares += num(b.shares || b.shareCount);
    });
    const ledgerComments = ledger.filter(function (r) {
      return String(r.event_type || '') === 'BROADCAST_COMMENT';
    }).length;
    const ledgerReplies = ledger.filter(function (r) {
      return String(r.event_type || '') === 'COMMENT_REPLY';
    }).length;
    if (ledgerComments > comments) comments = ledgerComments;
    if (ledgerReplies > replies) replies = ledgerReplies;

    const creatorMap = {};
    activeB.forEach(function (b) {
      const id = String(b.creatorUid || b.creator_uid || '');
      if (!id) return;
      if (!creatorMap[id]) {
        creatorMap[id] = {
          uid: id,
          name: b.creatorName || '',
          broadcasts: 0,
          views: 0,
          live: 0,
          signals: 0,
        };
      }
      creatorMap[id].broadcasts += 1;
      creatorMap[id].views += num(b.views);
      if (b.live) creatorMap[id].live += 1;
      if (!creatorMap[id].name && b.creatorName) creatorMap[id].name = b.creatorName;
    });
    signals.forEach(function (s) {
      const id = String(s.uid || s.creatorUid || s.from || '');
      if (!id) return;
      if (!creatorMap[id]) creatorMap[id] = { uid: id, name: s.name || '', broadcasts: 0, views: 0, live: 0, signals: 0 };
      creatorMap[id].signals += 1;
    });
    const creatorList = Object.keys(creatorMap).map(function (k) { return creatorMap[k]; });
    creatorList.sort(function (a, b) { return b.views - a.views; });

    const sigActive = signals.filter(function (s) {
      const exp = num(s.expiresAt || s.ttlAt || 0);
      return !exp || exp > now;
    });
    const sigExpired = signals.length - sigActive.length;
    const sigToday = signals.filter(function (s) { return num(s.createdAt) >= day0; });

    const togaSorted = toga.slice().sort(function (a, b) {
      return num(b.scoreMonth || b.score || 0) - num(a.scoreMonth || a.score || 0);
    });

    const openReports = reports.filter(function (r) {
      const st = String(r.status || 'OPEN').toUpperCase();
      return st === 'OPEN' || st === 'NEW' || st === 'UNDER REVIEW';
    });
    const ledgerPending = ledger.filter(function (r) {
      return String(r.status || '').toUpperCase() === 'PENDING_REVIEW' || r.pending_review;
    });
    const ledgerPoints = ledger.reduce(function (a, r) { return a + num(r.points); }, 0);
    const ledgerEligible = ledger.reduce(function (a, r) { return a + num(r.eligible_points); }, 0);

    const failMetrics = metrics.filter(function (m) {
      const n = String(m.name || '');
      return n.indexOf('fail') >= 0 || n.indexOf('error') >= 0;
    });

    const mailList = deskMail.slice().sort(function (a, b) {
      return num(b.ts || b.createdAt) - num(a.ts || a.createdAt);
    });
    const mailNew = mailList.filter(function (m) {
      return String(m.status || 'new').toLowerCase() === 'new';
    });
    const mailDeletes = mailList.filter(function (m) {
      return String(m.kind || '') === 'delete-account' && String(m.status || 'new').toLowerCase() !== 'done';
    });

    const alerts = [];
    if (worker && worker.degraded && !worker.ok) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'The economy worker cannot use Google Firestore (its service account was rejected). The console reads Naluno itself, so the numbers still work. Flags are saved on this account.',
      });
    }
    if (worker && worker.error && !worker.ok) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'Economy worker did not answer. Broadcast and this console still run.',
      });
    }
    if (openReports.length) {
      alerts.push({
        level: 'critical',
        tab: 'trust',
        text: openReports.length + ' report' + (openReports.length === 1 ? '' : 's') + ' waiting for a decision.',
      });
    }
    if (suspended.length) {
      alerts.push({
        level: 'warning',
        tab: 'users',
        text: suspended.length + ' account' + (suspended.length === 1 ? '' : 's') + ' currently suspended.',
      });
    }
    if (mailDeletes.length) {
      alerts.push({
        level: 'critical',
        tab: 'mail',
        text: mailDeletes.length + ' account-deletion request' + (mailDeletes.length === 1 ? '' : 's') + ' waiting.',
      });
    }
    if (mailNew.length) {
      alerts.push({
        level: mailDeletes.length ? 'warning' : 'critical',
        tab: 'mail',
        text: mailNew.length + ' new message' + (mailNew.length === 1 ? '' : 's') + ' from the contact page or Compass.',
      });
    }
    if (sw && sw.connected === false) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'This console is not connected to the service worker yet. Reload once so background ringing and cache stay in step.',
      });
    }
    if (!alerts.length) {
      alerts.push({ level: 'ok', tab: '', text: 'Nothing needs a decision right now.' });
    }

    const crit = alerts.filter(function (a) { return a.level === 'critical'; }).length;
    const warn = alerts.filter(function (a) { return a.level === 'warning'; }).length;
    const healthLabel = crit ? 'NEEDS ATTENTION' : (warn ? 'DEGRADED' : 'OPERATIONAL');
    const healthTone = crit ? 'critical' : (warn ? 'warning' : 'ok');

    const stickiness = mauUsers.length ? Math.round((dauUsers.length / mauUsers.length) * 100) : null;

    const aged7 = users.filter(function (u) { return createdOf(u) && createdOf(u) <= now - 7 * 86400000; });
    const still7 = aged7.filter(function (u) { return seenOf(u) >= now - 7 * 86400000; });
    const aged30 = users.filter(function (u) { return createdOf(u) && createdOf(u) <= now - 30 * 86400000; });
    const still30 = aged30.filter(function (u) { return seenOf(u) >= now - 30 * 86400000; });
    const still7Pct = aged7.length ? Math.round((still7.length / aged7.length) * 100) : null;
    const still30Pct = aged30.length ? Math.round((still30.length / aged30.length) * 100) : null;

    const costs = estimateCosts(raw);

    const withCoords = users.filter(function (u) {
      return u.lastLat != null && u.lastLng != null && isFinite(Number(u.lastLat)) && isFinite(Number(u.lastLng));
    });
    const originHeld = originMarks.filter(function (m) {
      const st = String(m.status || '').toLowerCase();
      return !!m.hold || st === 'hold' || st === 'match';
    });

    return {
      now: now,
      zone: zone,
      clock: formatAdminClock(now, zone),
      flags: flags,
      worker: worker,
      sw: sw,
      alerts: alerts,
      healthLabel: healthLabel,
      healthTone: healthTone,
      users: {
        total: users.length,
        list: users,
        active_now: liveUsers.length,
        active_now_list: liveUsers,
        dau: dauUsers.length,
        wau: wauUsers.length,
        mau: mauUsers.length,
        new_today: newToday.length,
        new_7d: new7.length,
        new_30d: new30.length,
        returning_today: returningToday.length,
        stickiness: stickiness,
        still_7: still7.length,
        still_7_of: aged7.length,
        still_7_pct: still7Pct,
        still_30: still30.length,
        still_30_of: aged30.length,
        still_30_pct: still30Pct,
        suspended: suspended,
        restricted: restricted,
        by_platform: byPlatform,
      },
      content: {
        broadcasts_total: activeB.length,
        broadcasts_today: bToday.length,
        broadcasts_deleted: deletedB.length,
        broadcasts_live: liveB.length,
        broadcasts: activeB,
        recent: activeB.slice().sort(function (a, b) {
          return num(b.createdAt || b.updatedAt) - num(a.createdAt || a.updatedAt);
        }).slice(0, 40),
        views: viewsTotal,
        comments: comments,
        replies: replies,
        shares: shares,
        total_engagement_today: bToday.reduce(function (a, b) {
          return a + num(b.comments) + num(b.replies) + num(b.shares);
        }, 0),
        strands: strands.length,
        bands: bands.length,
      },
      signals: {
        total: signals.length,
        active: sigActive.length,
        expired: sigExpired,
        today: sigToday.length,
        list: signals.slice().sort(function (a, b) {
          return num(b.createdAt || b.ts) - num(a.createdAt || a.ts);
        }),
      },
      locations: {
        with_coords: withCoords.length,
        devices: beacons.length,
        recent: beacons.slice().sort(function (a, b) { return num(b.ts) - num(a.ts); }).slice(0, 40),
        list: withCoords,
        beacons: beacons,
      },
      origin: {
        total: originMarks.length,
        held: originHeld.length,
        list: originMarks.slice().sort(function (a, b) {
          return num(b.createdAt) - num(a.createdAt);
        }).slice(0, 40),
      },
      creators: {
        total: creatorList.length,
        active_30d: creatorList.filter(function (c) { return c.broadcasts > 0; }).length,
        list: creatorList,
        top: creatorList.slice(0, 12),
      },
      toga: {
        list: togaSorted,
        top: togaSorted.slice(0, 10),
      },
      safety: {
        open_reports: openReports.length,
        reports: reports,
        open: openReports,
        suspended: suspended.length,
        restricted: restricted.length,
        flagged: users.filter(function (u) { return num(u.riskFlags || u.risk_flags) > 0; }).length,
        pending_review: ledgerPending.length,
      },
      mail: {
        total: mailList.length,
        unread: mailNew.length,
        deletes: mailDeletes.length,
        compass: mailList.filter(function (m) { return String(m.source || '') === 'compass'; }).length,
        web: mailList.filter(function (m) { return String(m.source || '') === 'web'; }).length,
        list: mailList,
      },
      economy: {
        contributors: (function () {
          const s = {};
          ledger.forEach(function (r) { if (r.user_id) s[r.user_id] = 1; });
          return Object.keys(s).length;
        })(),
        contribution_points: ledgerPoints,
        eligible_points: ledgerEligible,
        reward_liability_minor: 0,
        support_transactions: 0,
        ledger: ledger,
        pending_review: ledgerPending,
      },
      metrics: {
        total: metrics.length,
        failures: failMetrics.length,
        list: metrics,
      },
      costs: costs,
      audit: audit,
      gaps: {
        notifications: 'Delivery receipts live on the device. There is no central sent/delivered ledger yet.',
        search: 'Search queries are not stored, so trending and zero-result reports are not available.',
        payments: 'No payment provider is connected. Ledgers exist so the shape is auditable before money moves.',
        content_hub: 'Sports, movies and channels are not in the product yet.',
        cpu_memory: 'Cloudflare and Firebase do not expose instance processor (CPU) or memory (RAM) to this console.',
        unit_econ: 'Invoices are not connected. Metered figures are list-price maths from usage. Firebase Spark and Cloudflare free plans currently invoice AED 0.00 until usage exceeds those allowances or an invoice is recorded.',
        retention: 'Day-1 / day-7 (D1 / D7) retention needs a session log. Still-here is people who signed up at least N days ago and had a heartbeat in the last N days.',
        cac: 'Customer acquisition cost (CAC) and lifetime value (LTV) are not known and are not estimated here.',
        store: 'App-store download counts are not in Firestore. Registration is the first number on record.',
        native: 'Closed-tab ringtone requires a native shell and Unrestricted battery. Lock-screen ring is not available.',
      },
    };
  }

  root.NalunoAdminData = {
    DEFAULT_FLAGS: DEFAULT_FLAGS,
    FLAG_META: FLAG_META,
    TERMS: TERMS,
    localZone: localZone,
    adminZone: adminZone,
    setAdminZone: setAdminZone,
    zoneFriendly: zoneFriendly,
    localYmd: localYmd,
    formatAdminClock: formatAdminClock,
    startOfLocalDay: startOfLocalDay,
    deriveSnapshot: deriveSnapshot,
    money: money,
    COST_RATES: COST_RATES,
    estimateCosts: estimateCosts,
    mediaBytesOf: mediaBytesOf,
    formatAed: formatAed,
    formatUsd: formatUsd,
    formatBytes: formatBytes,
    moneyPair: moneyPair,
    roundMau: roundMau,
    usdAed: usdAed,
  };
})(typeof window !== 'undefined' ? window : globalThis);

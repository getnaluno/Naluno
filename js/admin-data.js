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
    community_rewards_enabled: { label: 'Community Rewards', group: 'Money', note: 'Pool split. Off until you turn it on.' },
    real_payouts_enabled: { label: 'Real payouts', group: 'Money', note: 'Locked. Requires a signed off-console decision.' },
    content_hub_enabled: { label: 'Content Hub', group: 'Hub', note: 'Sports / movies / channels. Not built yet.' },
    sports_enabled: { label: 'Sports', group: 'Hub', note: 'Requires Content Hub.' },
    movies_enabled: { label: 'Movies', group: 'Hub', note: 'Requires Content Hub.' },
  };

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  function formatAdminClock(date, zone) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const tz = zone || localZone();
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
        timeZone: zone || localZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  function startOfLocalDay(ms, zone) {
    const tz = zone || localZone();
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

  function deriveSnapshot(raw) {
    raw = raw || {};
    const now = num(raw.now) || Date.now();
    const zone = raw.zone || localZone();
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
    const flags = Object.assign({}, DEFAULT_FLAGS, raw.flags || {});
    const worker = raw.worker || {};
    const sw = raw.sw || {};

    const day0 = startOfLocalDay(now, zone);
    const day7 = now - 7 * 86400000;
    const day30 = now - 30 * 86400000;
    const activeCut = now - 10 * 60 * 1000;

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

    const alerts = [];
    if (worker && worker.degraded) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'The economy worker cannot use Google Firestore (its service account was rejected). The desk reads Naluno itself, so the numbers still work. Flags are saved on this account.',
      });
    }
    if (worker && worker.error && !worker.ok) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'Economy worker did not answer. Broadcast and this desk still run.',
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
    if (sw && sw.connected === false) {
      alerts.push({
        level: 'warning',
        tab: 'health',
        text: 'This desk is not connected to the service worker yet. Reload once so background ringing and cache stay in step.',
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
        list: signals,
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
      audit: audit,
      gaps: {
        notifications: 'Delivery receipts live on the device. There is no central sent/delivered ledger yet.',
        search: 'Search queries are not stored, so trending and zero-result reports cannot be honest yet.',
        payments: 'No payment provider is connected. Ledgers exist so the shape is auditable before money moves.',
        content_hub: 'Sports, movies and channels are not in the product yet.',
        cpu_memory: 'Cloudflare and Firebase do not expose instance CPU/RAM to this desk.',
      },
    };
  }

  root.NalunoAdminData = {
    DEFAULT_FLAGS: DEFAULT_FLAGS,
    FLAG_META: FLAG_META,
    localZone: localZone,
    localYmd: localYmd,
    formatAdminClock: formatAdminClock,
    startOfLocalDay: startOfLocalDay,
    deriveSnapshot: deriveSnapshot,
    money: money,
  };
})(typeof window !== 'undefined' ? window : globalThis);

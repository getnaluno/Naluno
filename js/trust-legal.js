/* Trust, Safety & Legal — the records, not the screen.
   Assembles what Naluno already stored. Does not invent a login,
   an IP address, a country, or a private conversation.
   A disclosure package can include only the sections asked for. */
(function (root) {
  const PRIVATE_KEYS = {
    ciphertext: 1, plaintext: 1, wire_text: 1, transcript: 1, chat: 1,
    password: 1, privateJwk: 1, wireBody: 1, messageBody: 1, recoveryEmail: 1,
  };
  /* Public Broadcast text can be long. The evidence copy keeps a short
     note that it existed, not a second copy of the writing. */
  const DROP_FROM_SNAPSHOT = {
    body: 1, searchText: 1, thumbDataUrl: 1, chapters: 1, breathers: 1,
    originFrameHashes: 1, originDna: 1,
  };
  const RETAIN_DAYS = {
    securityEvent: 180,
    incident: 2555,
    legalRequest: 2555,
    emergency: 2555,
    securityIncident: 1095,
    evidence: 365,
    disclosure: 2555,
    enforcement: 2555,
  };
  const SECURITY_KINDS = {
    login: 1, logout: 1, new_device: 1, session_start: 1, session_end: 1,
    password_reset: 1, recovery: 1,
  };
  const LEGAL_TYPES = { preservation: 1, disclosure: 1, removal: 1, other: 1 };
  const WITHHELD_ALWAYS = [
    'Private Wireline and Band conversations are not collected.',
    'A network address is not stored by the app.',
    'A password, recovery email, and private key are not included.',
  ];

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function text(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
  }
  function dayStamp(at) {
    const t = num(at) || Date.now();
    try { return new Date(t).toISOString(); } catch (_) { return ''; }
  }
  function retainUntil(kind, at) {
    const days = RETAIN_DAYS[kind] || 365;
    return num(at) + days * 86400000;
  }
  function hashText(s) {
    /* FNV-1a 32-bit, so a test and a phone agree without a crypto API.
       It marks the copy. It is not a legal seal by itself. */
    let h = 0x811c9dc5;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function stable(obj) {
    if (obj == null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(stable).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stable(obj[k]); }).join(',') + '}';
  }
  function stripPrivate(src) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    Object.keys(src).forEach(function (k) {
      if (PRIVATE_KEYS[k] || DROP_FROM_SNAPSHOT[k]) return;
      const v = src[k];
      if (v === undefined) return;
      if (v && typeof v === 'object') return;
      out[k] = v;
    });
    return out;
  }
  function clipPublic(src) {
    const row = stripPrivate(src);
    if (row.description) row.description = text(row.description, 500);
    if (row.caption) row.caption = text(row.caption, 180);
    if (row.title) row.title = text(row.title, 140);
    return row;
  }
  function blank(label) {
    return label || 'Not collected';
  }

  function accountReport(user, bag) {
    const u = user || {};
    const id = u.id || u.uid || '';
    const events = (bag && bag.securityEvents) || [];
    const accounts = (bag && bag.accountEvents) || [];
    const reports = (bag && bag.reports) || [];
    const cases = (bag && bag.cases) || [];
    const devices = [];
    const seen = {};
    events.forEach(function (e) {
      const k = e && e.deviceKey;
      if (!k || seen[k]) return;
      seen[k] = 1;
      devices.push({ deviceKey: k, label: e.deviceLabel || '', firstAt: num(e.at) });
    });
    const country = text(u.country || u.region || '', 80);
    return {
      accountId: id,
      handle: text(u.handle || u.number || '', 40),
      name: text(u.name || '', 80),
      createdAt: num(u.createdAt || u.created_at),
      status: u.accountState === 'closed' || u.deleted ? 'closed' : (u.suspended ? 'suspended' : (u.restricted ? 'restricted' : 'active')),
      verification: u.trustedPublisher ? 'trusted publisher' : 'not verified',
      country: country || blank('Not collected'),
      recoveryEvents: accounts.filter(function (a) { return a && (a.action === 'close' || a.action === 'restore'); }),
      logins: events.filter(function (e) { return e && e.kind === 'login'; }),
      devices: devices,
      network: 'Not collected by the app. A phone cannot honestly record its own network address here.',
      reports: reports,
      enforcement: enforcementFrom(u, cases, accounts),
      appeals: (bag && bag.appeals) || [],
      publicContent: {
        broadcasts: (bag && bag.broadcasts) || [],
        signals: (bag && bag.signals) || [],
      },
    };
  }

  function enforcementFrom(u, cases, accounts) {
    const rows = [];
    if (u && u.suspended) {
      rows.push({
        action: 'suspension',
        reason: text(u.suspendedReason || u.suspended_reason || '', 300),
        at: num(u.suspendedAt || u.updatedAt),
        policy: text(u.suspendedReason || '', 120),
      });
    }
    if (u && u.restricted) {
      rows.push({
        action: 'restriction',
        reason: text(u.restrictedReason || '', 300),
        at: num(u.restrictedAt),
        policy: text(u.restrictedReason || '', 120),
      });
    }
    if (u && (u.accountState === 'closed' || u.deleted)) {
      rows.push({
        action: u.closedKind === 'violation' ? 'termination' : 'closed by owner',
        reason: text(u.closedReason || u.closedPublic || '', 300),
        at: num(u.closedAt || u.deletedAt),
        policy: text(u.closedKind || '', 40),
      });
    }
    (cases || []).forEach(function (c) {
      if (!c || !c.decision) return;
      rows.push({
        action: text(c.decision, 40),
        reason: text(c.decision_reason || c.statement || '', 300),
        at: num(c.decided_at || c.updated_at || c.created_at),
        reviewer: text(c.reviewer, 80),
        caseId: c.case_id || '',
        appeal: c.appeal_status || 'none',
      });
    });
    (accounts || []).forEach(function (a) {
      if (!a) return;
      rows.push({ action: text(a.action, 40), reason: text(a.reason, 300), at: num(a.ts || a.at), kind: a.kind || '' });
    });
    return rows;
  }

  function broadcastReport(b, bag) {
    const row = b || {};
    const id = row.id || '';
    const audits = ((bag && bag.audits) || []).filter(function (a) {
      return a && (a.target === id || a.content_id === id || a.case_id && (bag.caseIds || {})[a.case_id]);
    });
    return {
      broadcastId: id,
      creatorId: row.creatorUid || '',
      createdAt: num(row.createdAt),
      publishedAt: num(row.publishAt || row.createdAt),
      updatedAt: num(row.updatedAt),
      title: text(row.title, 140),
      description: text(row.description, 500),
      strand: text(row.strandName || row.strandId || '', 80),
      mediaId: text(row.mediaId || '', 120),
      mediaType: text(row.mediaType || row.kind || '', 40),
      visibility: row.visibility || (row.hidden ? 'removed' : (row.held ? 'held' : (row.listed === false ? 'unlisted' : 'public'))),
      views: num(row.views),
      uniqueViews: num(row.uniqueViews),
      held: !!row.held,
      heldReason: text(row.heldReason || '', 80),
      hidden: !!row.hidden,
      hiddenReason: text(row.hiddenReason || '', 80),
      screen: row.screenDecision || row.screen || null,
      reports: (bag && bag.reports) || [],
      moderation: audits,
      appeals: (bag && bag.appeals) || [],
      signals: (bag && bag.signals) || [],
    };
  }

  function signalReport(s) {
    const row = s || {};
    return {
      signalId: row.id || '',
      creatorId: row.uid || row.creatorUid || '',
      createdAt: num(row.createdAt),
      publishedAt: num(row.createdAt),
      expiresAt: num(row.expiresAt),
      audience: 'connections',
      mediaType: text(row.mediaType || row.type || '', 40),
      caption: text(row.caption || '', 180),
      held: !!row.held,
      heldReason: text(row.heldReason || '', 80),
      expired: !!(row.expiresAt && num(row.expiresAt) < Date.now()),
      note: 'Expiry removes the Signal from the app. This desk row is the audit record and is kept on its own clock.',
    };
  }

  function moderationReport(content, audits) {
    const c = content || {};
    const machine = c.screen || c.automated || null;
    const human = (audits || []).filter(function (a) { return a && a.human_reviewed; });
    return {
      contentId: c.id || c.broadcastId || c.signalId || c.content_id || '',
      model: machine && (machine.model || machine.version) ? text(machine.model || machine.version, 40) : (machine ? 'on-device screen' : 'No automated record stored'),
      detection: machine ? text(machine.decision || machine.reason || '', 80) : '',
      confidence: machine && machine.score != null ? num(machine.score) : null,
      policy: text((machine && machine.reason) || c.heldReason || c.hiddenReason || '', 80),
      automatedAction: c.held ? 'held' : (c.hidden ? 'removed' : (machine ? text(machine.decision || '', 40) : 'none recorded')),
      humanReview: human.length ? human : [],
      finalOutcome: c.hidden ? 'removed' : (c.held ? 'held' : 'still public or unlisted'),
    };
  }

  function buildTimeline(pack) {
    const rows = [];
    function add(at, label, source, ref) {
      const t = num(at);
      if (!t || !label) return;
      rows.push({ at: t, label: text(label, 180), source: source || '', ref: text(ref || '', 80) });
    }
    const p = pack || {};
    const user = p.user || {};
    add(user.createdAt || user.created_at, 'Account created', 'users', user.id || user.uid);
    (p.securityEvents || []).forEach(function (e) {
      if (!e) return;
      add(e.at, (e.kind || 'security') + (e.deviceLabel ? (' · ' + e.deviceLabel) : ''), 'securityEvents', e.deviceKey);
    });
    (p.accountEvents || []).forEach(function (e) {
      if (!e) return;
      add(e.ts || e.at, 'Account ' + (e.action || 'event') + (e.kind ? (' · ' + e.kind) : ''), 'accountEvents', e.action);
    });
    (p.broadcasts || []).forEach(function (b) {
      if (!b) return;
      add(b.createdAt, 'Broadcast created' + (b.title ? (': ' + text(b.title, 60)) : ''), 'broadcasts', b.id);
      if (b.held) add(b.updatedAt || b.createdAt, 'Broadcast held' + (b.heldReason ? (' · ' + b.heldReason) : ''), 'broadcasts', b.id);
      if (b.hidden) add(b.updatedAt || b.createdAt, 'Broadcast removed' + (b.hiddenReason ? (' · ' + b.hiddenReason) : ''), 'broadcasts', b.id);
    });
    (p.signals || []).forEach(function (s) {
      if (!s) return;
      add(s.createdAt, 'Signal published', 'signals', s.id);
      if (s.expiresAt) add(s.expiresAt, 'Signal expiry', 'signals', s.id);
    });
    (p.reports || []).forEach(function (r) {
      if (!r) return;
      add(r.ts || r.created_at, 'Report ' + (r.reason_code || r.status || ''), 'reports', r.report_id || r.id);
    });
    (p.cases || []).forEach(function (c) {
      if (!c) return;
      add(c.created_at, 'Safety case ' + (c.case_id || '') + (c.priority ? (' · ' + c.priority) : ''), 'safetyCases', c.case_id);
      if (c.decision) add(c.decided_at || c.updated_at || c.created_at, 'Case decision ' + c.decision, 'safetyCases', c.case_id);
    });
    (p.audits || []).forEach(function (a) {
      if (!a) return;
      add(a.when || a.created_at, (a.what || a.action || 'Audit') + (a.why ? (' · ' + text(a.why, 80)) : ''), a.audit_id ? 'safetyAudit' : 'adminAudit', a.audit_id || a.action);
    });
    (p.notes || []).forEach(function (n) {
      if (!n) return;
      add(n.at, 'Note · ' + text(n.text, 120), 'incidentNotes', n.by);
    });
    (p.evidence || []).forEach(function (e) {
      if (!e) return;
      add(e.at, 'Evidence preserved ' + (e.holdId || ''), 'evidenceHolds', e.holdId);
    });
    rows.sort(function (a, b) { return a.at - b.at; });
    return rows;
  }

  function securityEventInput(row, uid) {
    const src = row || {};
    const kind = String(src.kind || '');
    if (!SECURITY_KINDS[kind]) throw new Error('unknown security event');
    if (!uid || String(src.uid || uid) !== String(uid)) throw new Error('event must be your own');
    if (PRIVATE_KEYS[kind]) throw new Error('forbidden');
    const detail = text(src.detail, 120);
    Object.keys(PRIVATE_KEYS).forEach(function (k) {
      if (src[k]) throw new Error('forbidden field');
    });
    return {
      uid: String(uid),
      kind: kind,
      at: num(src.at) || Date.now(),
      deviceKey: text(src.deviceKey, 64),
      deviceLabel: text(src.deviceLabel, 78),
      sessionKey: text(src.sessionKey, 40),
      ok: src.ok !== false,
      detail: detail,
      retainUntil: retainUntil('securityEvent', num(src.at) || Date.now()),
    };
  }

  function evidenceSnapshot(path, doc) {
    const snap = clipPublic(doc || {});
    snap._original = text(path, 160);
    snap._copiedAt = Date.now();
    if (doc && doc.body) snap.bodyOmitted = true;
    const hash = hashText(stable(snap));
    return { path: text(path, 160), snapshot: snap, hash: hash };
  }

  function evidenceHoldInput(row) {
    const src = row || {};
    if (!src.originalPath) throw new Error('original location required');
    if (!src.hash || String(src.hash).length < 8) throw new Error('hash required');
    if (!src.initiatedBy) throw new Error('who preserved it is required');
    const at = num(src.at) || Date.now();
    let until = num(src.retainUntil);
    const min = at + 90 * 86400000;
    if (!until || until < min) until = at + RETAIN_DAYS.evidence * 86400000;
    return {
      holdId: text(src.holdId, 40),
      incidentId: text(src.incidentId, 40),
      subjectUid: text(src.subjectUid, 128),
      originalPath: text(src.originalPath, 160),
      snapshot: clipPublic(src.snapshot || {}),
      hash: text(src.hash, 64),
      initiatedBy: text(src.initiatedBy, 128),
      at: at,
      retainUntil: until,
      status: 'held',
      releasedAt: 0,
      releasedBy: '',
      releaseNote: '',
    };
  }

  function legalRequestInput(row) {
    const src = row || {};
    const authority = text(src.authority, 160);
    const jurisdiction = text(src.jurisdiction, 80);
    const instrument = text(src.instrument, 200);
    if (authority.length < 2) throw new Error('Name the authority');
    if (jurisdiction.length < 2) throw new Error('Name the jurisdiction');
    if (instrument.length < 2) throw new Error('A legal reference is required');
    const type = LEGAL_TYPES[src.requestType] ? src.requestType : 'other';
    const at = num(src.receivedAt) || Date.now();
    return {
      requestId: text(src.requestId, 40),
      authority: authority,
      jurisdiction: jurisdiction,
      requestType: type,
      receivedAt: at,
      instrument: instrument,
      subjectUid: text(src.subjectUid, 128),
      contentIds: (Array.isArray(src.contentIds) ? src.contentIds : []).map(function (id) { return text(id, 80); }).filter(Boolean).slice(0, 20),
      scope: text(src.scope, 500),
      disclosed: text(src.disclosed, 2000),
      unavailable: text(src.unavailable, 500),
      withheld: text(src.withheld, 500),
      withholdReason: text(src.withholdReason, 500),
      reviewer: text(src.reviewer, 128),
      approvedBy: text(src.approvedBy, 128),
      respondedAt: num(src.respondedAt),
      status: text(src.status || 'received', 24),
      incidentId: text(src.incidentId, 40),
      openedBy: text(src.openedBy, 128),
      retainUntil: retainUntil('legalRequest', at),
    };
  }

  function emergencyInput(row) {
    const src = row || {};
    const why = text(src.whyUrgent, 500);
    if (why.length < 12) throw new Error('Say why this is urgent');
    const at = num(src.detectedAt) || Date.now();
    return {
      emergencyId: text(src.emergencyId, 40),
      detectedAt: at,
      detectedHow: text(src.detectedHow, 160),
      whyUrgent: why,
      subjectUid: text(src.subjectUid, 128),
      contentIds: (Array.isArray(src.contentIds) ? src.contentIds : []).map(function (id) { return text(id, 80); }).filter(Boolean).slice(0, 20),
      preservedId: text(src.preservedId, 40),
      authority: text(src.authority, 160),
      contactedAt: num(src.contactedAt),
      authorisedBy: text(src.authorisedBy, 128),
      disclosed: text(src.disclosed, 2000),
      followUp: text(src.followUp, 500),
      status: text(src.status || 'open', 24),
      incidentId: text(src.incidentId, 40),
      openedBy: text(src.openedBy, 128),
      retainUntil: retainUntil('emergency', at),
    };
  }

  function securityIncidentInput(row) {
    const src = row || {};
    if (text(src.service, 80).length < 2) throw new Error('Name the service');
    const at = num(src.detectedAt) || Date.now();
    return {
      securityId: text(src.securityId, 40),
      detectedAt: at,
      service: text(src.service, 80),
      systems: text(src.systems, 200),
      accounts: text(src.accounts, 300),
      vector: text(src.vector, 200),
      indicators: text(src.indicators, 500),
      actions: text(src.actions, 500),
      isolated: text(src.isolated, 200),
      credentialsRotated: src.credentialsRotated === true,
      logsPreserved: src.logsPreserved === true,
      recovery: text(src.recovery, 400),
      rootCause: text(src.rootCause, 400),
      remediation: text(src.remediation, 400),
      notifications: text(src.notifications, 300),
      status: text(src.status || 'open', 24),
      openedBy: text(src.openedBy, 128),
      retainUntil: retainUntil('securityIncident', at),
    };
  }

  function disclosurePackage(opts) {
    const o = opts || {};
    const want = {};
    (o.sections || []).forEach(function (s) { want[s] = 1; });
    const pack = { generatedAt: dayStamp(o.at || Date.now()), sections: [], withheld: WITHHELD_ALWAYS.slice(), chain: [] };
    function put(name, value) {
      if (!want[name]) {
        pack.withheld.push(name + ' was not requested.');
        return;
      }
      pack.sections.push({ name: name, value: value });
    }
    put('summary', o.summary || null);
    put('account', o.account || null);
    put('broadcasts', o.broadcasts || []);
    put('signals', o.signals || []);
    put('reports', o.reports || []);
    put('moderation', o.moderation || []);
    put('timeline', o.timeline || []);
    put('evidence', o.evidence || []);
    put('actions', o.actions || []);
    pack.chain.push({ at: dayStamp(o.at || Date.now()), by: text(o.by, 128), requestId: text(o.requestId, 40), authorised: text(o.authorisedBy, 128) });
    pack.hash = hashText(stable(pack.sections));
    return pack;
  }

  function formatId(prefix, year, n) {
    return prefix + '-' + year + '-' + String(n).padStart(6, '0');
  }

  root.NalunoTrust = {
    RETAIN_DAYS: RETAIN_DAYS,
    WITHHELD_ALWAYS: WITHHELD_ALWAYS,
    SECURITY_KINDS: SECURITY_KINDS,
    retainUntil: retainUntil,
    hashText: hashText,
    accountReport: accountReport,
    broadcastReport: broadcastReport,
    signalReport: signalReport,
    moderationReport: moderationReport,
    buildTimeline: buildTimeline,
    securityEventInput: securityEventInput,
    evidenceSnapshot: evidenceSnapshot,
    evidenceHoldInput: evidenceHoldInput,
    legalRequestInput: legalRequestInput,
    emergencyInput: emergencyInput,
    securityIncidentInput: securityIncidentInput,
    disclosurePackage: disclosurePackage,
    formatId: formatId,
    dayStamp: dayStamp,
  };
})(typeof window !== 'undefined' ? window : globalThis);

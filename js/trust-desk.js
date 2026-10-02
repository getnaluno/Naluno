/* Control Centre — Trust, Safety & Legal.
   Reads the account, Broadcast, Signal, report and safety records
   already in the database. Writes only the incident, legal, emergency,
   security and evidence files. Nothing here is sample data. */
(function (root) {
  const T = function () { return root.NalunoTrust; };

  function esc(api, s) {
    if (api && api.escapeHtml) return api.escapeHtml(s);
    return String(s == null ? '' : s);
  }
  function when(api, ms) {
    if (!ms) return '—';
    if (api && api.when) return api.when(ms);
    try { return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; } catch (_) { return '—'; }
  }
  function rows(api, heads, body) {
    if (!body || !body.length) return '<p class="sub">Nothing stored for this.</p>';
    return '<div style="overflow:auto"><table><thead><tr>'
      + heads.map(function (h) { return '<th>' + esc(api, h) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + body.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }
  function field(id, label, value, placeholder) {
    return '<label class="sub" style="display:block;margin:8px 0 2px;">' + label + '</label>'
      + '<input id="' + id + '" value="' + String(value || '').replace(/"/g, '"') + '" placeholder="' + (placeholder || '') + '" style="width:100%;padding:8px 10px;">';
  }
  function area(id, label, placeholder) {
    return '<label class="sub" style="display:block;margin:8px 0 2px;">' + label + '</label>'
      + '<textarea id="' + id + '" placeholder="' + (placeholder || '') + '" style="width:100%;min-height:64px;padding:8px 10px;"></textarea>';
  }
  function val(el, id) {
    const n = el.querySelector('#' + id);
    return n ? String(n.value || '').trim() : '';
  }

  async function docsWhere(db, col, fieldName, value, limitN) {
    if (!db || !value) return [];
    try {
      const snap = await db.collection(col).where(fieldName, '==', value).limit(limitN || 40).get();
      const out = [];
      snap.forEach(function (doc) {
        const row = doc.data() || {};
        row.id = doc.id;
        out.push(row);
      });
      return out;
    } catch (_) { return []; }
  }
  async function docGet(db, col, id) {
    if (!db || !id) return null;
    try {
      const snap = await db.collection(col).doc(id).get();
      if (!snap.exists) return null;
      const row = snap.data() || {};
      row.id = snap.id;
      return row;
    } catch (_) { return null; }
  }
  async function recent(db, col, limitN) {
    if (!db) return [];
    try {
      const snap = await db.collection(col).limit(limitN || 80).get();
      const out = [];
      snap.forEach(function (doc) {
        const row = doc.data() || {};
        row.id = doc.id;
        out.push(row);
      });
      return out;
    } catch (_) { return []; }
  }

  async function nextId(db, prefix) {
    const year = new Date().getUTCFullYear();
    const ref = db.collection('complianceSeq').doc(prefix + '-' + year);
    const n = await db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        const cur = snap.exists ? Number((snap.data() || {}).n) || 0 : 0;
        const next = cur + 1;
        tx.set(ref, { n: next, prefix: prefix, year: year }, { merge: true });
        return next;
      });
    });
    return T().formatId(prefix, year, n);
  }

  async function audit(api, action, target, reason) {
    try { if (api.audit) await api.audit(action, target, reason); } catch (_) {}
  }

  async function resolveQuery(db, q) {
    const query = String(q || '').trim().replace(/^@/, '');
    if (!query) return { error: 'Type a handle, account id, Broadcast id, Signal id, or report id.' };
    let user = null;
    const handle = await docGet(db, 'handles', query.toLowerCase());
    if (handle && handle.uid) user = await docGet(db, 'users', handle.uid);
    if (!user) user = await docGet(db, 'users', query);
    const broadcast = await docGet(db, 'broadcasts', query);
    const signal = await docGet(db, 'signals', query);
    let report = await docGet(db, 'reports', query);
    if (!report) {
      const byReport = await docsWhere(db, 'reports', 'report_id', query, 4);
      report = byReport[0] || null;
    }
    const uid = (user && user.id) || (broadcast && broadcast.creatorUid) || (signal && signal.uid) || (report && (report.target_user_id || report.reporter_uid)) || '';
    if (!user && uid) user = await docGet(db, 'users', uid);
    if (!user && !broadcast && !signal && !report) {
      return { error: 'No account, Broadcast, Signal, or report under that id.' };
    }
    const subject = (user && user.id) || uid;
    const broadcasts = subject ? await docsWhere(db, 'broadcasts', 'creatorUid', subject, 30) : (broadcast ? [broadcast] : []);
    const signals = subject ? await docsWhere(db, 'signals', 'uid', subject, 30) : (signal ? [signal] : []);
    const reportsOn = subject ? await docsWhere(db, 'reports', 'target_user_id', subject, 40) : [];
    const reportsBy = subject ? await docsWhere(db, 'reports', 'reporter_uid', subject, 20) : [];
    const reportMap = {};
    reportsOn.concat(reportsBy).forEach(function (r) { if (r && (r.report_id || r.id)) reportMap[r.report_id || r.id] = r; });
    if (report) reportMap[report.report_id || report.id] = report;
    if (broadcast) {
      const onB = await docsWhere(db, 'reports', 'broadcast_id', broadcast.id, 20);
      onB.forEach(function (r) { reportMap[r.report_id || r.id] = r; });
    }
    const reports = Object.keys(reportMap).map(function (k) { return reportMap[k]; });
    const securityEvents = subject ? await docsWhere(db, 'securityEvents', 'uid', subject, 40) : [];
    const accountEvents = subject ? await docsWhere(db, 'accountEvents', 'uid', subject, 20) : [];
    const allCases = await recent(db, 'safetyCases', 80);
    const cases = allCases.filter(function (c) {
      if (!c) return false;
      if (subject && (c.reported_user_id === subject || c.reporter_id === subject)) return true;
      if (broadcast && c.content_id === broadcast.id) return true;
      if (report && c.report_id && (c.report_id === report.report_id || c.report_id === report.id)) return true;
      return false;
    });
    const appeals = (await recent(db, 'safetyAppeals', 40)).filter(function (a) {
      return a && ((subject && a.appellant_uid === subject) || cases.some(function (c) { return c.case_id === a.case_id; }));
    });
    const safetyAudit = (await recent(db, 'safetyAudit', 40)).filter(function (a) {
      return a && cases.some(function (c) { return c.case_id === a.case_id; });
    });
    const adminAudit = (await recent(db, 'adminAudit', 80)).filter(function (a) {
      const target = String((a && a.target) || '');
      if (subject && target.indexOf(subject) >= 0) return true;
      if (broadcast && target.indexOf(broadcast.id) >= 0) return true;
      return false;
    });
    const incidents = subject ? await docsWhere(db, 'incidents', 'subjectUid', subject, 20) : [];
    const evidence = subject ? await docsWhere(db, 'evidenceHolds', 'subjectUid', subject, 20) : [];
    const legal = subject ? await docsWhere(db, 'legalRequests', 'subjectUid', subject, 20) : [];
    const emergency = subject ? await docsWhere(db, 'emergencyCases', 'subjectUid', subject, 20) : [];
    return {
      query: query,
      user: user,
      broadcast: broadcast,
      signal: signal,
      report: report,
      broadcasts: broadcasts,
      signals: signals,
      reports: reports,
      securityEvents: securityEvents,
      accountEvents: accountEvents,
      cases: cases,
      appeals: appeals,
      safetyAudit: safetyAudit,
      adminAudit: adminAudit,
      incidents: incidents,
      evidence: evidence,
      legal: legal,
      emergency: emergency,
    };
  }

  function paint(api, el, found) {
    const Trust = T();
    const user = found.user;
    const account = user ? Trust.accountReport(user, {
      securityEvents: found.securityEvents,
      accountEvents: found.accountEvents,
      reports: found.reports.filter(function (r) { return r.target_user_id === user.id; }),
      cases: found.cases,
      appeals: found.appeals,
      broadcasts: found.broadcasts.map(function (b) { return { id: b.id, title: b.title, createdAt: b.createdAt }; }),
      signals: found.signals.map(function (s) { return { id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt }; }),
    }) : null;
    const timeline = Trust.buildTimeline({
      user: user,
      securityEvents: found.securityEvents,
      accountEvents: found.accountEvents,
      broadcasts: found.broadcast ? [found.broadcast].concat(found.broadcasts.filter(function (b) { return b.id !== found.broadcast.id; })) : found.broadcasts,
      signals: found.signal ? [found.signal].concat(found.signals.filter(function (s) { return s.id !== found.signal.id; })) : found.signals,
      reports: found.reports,
      cases: found.cases,
      audits: found.safetyAudit.concat(found.adminAudit),
      evidence: found.evidence,
    });
    const bRep = found.broadcast ? Trust.broadcastReport(found.broadcast, { reports: found.reports, audits: found.safetyAudit, appeals: found.appeals }) : null;
    const sRep = found.signal ? Trust.signalReport(found.signal) : null;
    const mod = Trust.moderationReport(found.broadcast || found.signal || {}, found.safetyAudit);

    const accountHtml = account
      ? rows(api, ['Field', 'Record'], [
        ['Account', esc(api, account.accountId)],
        ['Handle', esc(api, account.handle)],
        ['Created', when(api, account.createdAt)],
        ['Status', esc(api, account.status)],
        ['Verification', esc(api, account.verification)],
        ['Country / region', esc(api, account.country)],
        ['Network', esc(api, account.network)],
        ['Devices', String(account.devices.length)],
        ['Sign-ins on file', String(account.logins.length)],
        ['Reports against', String(account.reports.length)],
        ['Enforcement rows', String(account.enforcement.length)],
      ])
      : '<p class="sub">No account document for this search. Content can still be opened by its own id.</p>';

    const out = el.querySelector('#legalOut');
    if (!out) return;
    out.dataset.uid = (user && user.id) || '';
    out.dataset.broadcast = (found.broadcast && found.broadcast.id) || '';
    out.dataset.signal = (found.signal && found.signal.id) || '';
    out.innerHTML =
      '<div class="card"><div class="who">Account</div>' + accountHtml + '</div>'
      + (bRep ? '<div class="card"><div class="who">Broadcast</div>' + rows(api, ['Field', 'Record'], [
        ['Id', esc(api, bRep.broadcastId)],
        ['Creator', esc(api, bRep.creatorId)],
        ['Created', when(api, bRep.createdAt)],
        ['Published', when(api, bRep.publishedAt)],
        ['Updated', when(api, bRep.updatedAt)],
        ['Title', esc(api, bRep.title)],
        ['Strand', esc(api, bRep.strand)],
        ['Media id', esc(api, bRep.mediaId || '—')],
        ['Visibility', esc(api, bRep.visibility)],
        ['Views', String(bRep.views) + ' / ' + String(bRep.uniqueViews) + ' unique'],
        ['Reports', String((bRep.reports || []).length)],
      ]) + '</div>' : '')
      + (sRep ? '<div class="card"><div class="who">Signal</div>' + rows(api, ['Field', 'Record'], [
        ['Id', esc(api, sRep.signalId)],
        ['Creator', esc(api, sRep.creatorId)],
        ['Created', when(api, sRep.createdAt)],
        ['Expires', when(api, sRep.expiresAt)],
        ['Held', sRep.held ? esc(api, sRep.heldReason || 'yes') : 'no'],
        ['Note', esc(api, sRep.note)],
      ]) + '</div>' : '')
      + '<div class="card"><div class="who">Moderation — machine and person stay separate</div>'
      + rows(api, ['Field', 'Record'], [
        ['Content', esc(api, mod.contentId || '—')],
        ['Automated', esc(api, mod.model)],
        ['Detection', esc(api, mod.detection || '—')],
        ['Automated action', esc(api, mod.automatedAction)],
        ['Human reviews', String((mod.humanReview || []).length)],
        ['Outcome now', esc(api, mod.finalOutcome)],
      ]) + '</div>'
      + '<div class="card"><div class="who">Enforcement</div>'
      + (account && account.enforcement.length
        ? rows(api, ['When', 'Action', 'Reason', 'Case'], account.enforcement.map(function (r) {
          return [when(api, r.at), esc(api, r.action), esc(api, r.reason || '—'), esc(api, r.caseId || '—')];
        }))
        : '<p class="sub">No suspension, restriction, close, or case decision on this account.</p>')
      + '</div>'
      + '<div class="card"><div class="who">Incident timeline</div><p class="sub">Built from the records above. Private conversations are not a line in this list.</p>'
      + (timeline.length
        ? rows(api, ['When', 'What', 'Source'], timeline.slice(-40).map(function (r) {
          return [when(api, r.at), esc(api, r.label), esc(api, r.source)];
        }))
        : '<p class="sub">No timestamps yet.</p>')
      + '</div>'
      + '<div class="card"><div class="who">Already filed</div>'
      + rows(api, ['Kind', 'Id', 'Status'], []
        .concat(found.incidents.map(function (r) { return ['Incident', esc(api, r.incidentId || r.id), esc(api, r.status || '')]; }))
        .concat(found.cases.map(function (r) { return ['Safety case', esc(api, r.case_id), esc(api, r.decision || r.review_status || 'open')]; }))
        .concat(found.legal.map(function (r) { return ['Legal request', esc(api, r.requestId || r.id), esc(api, r.status || '')]; }))
        .concat(found.emergency.map(function (r) { return ['Emergency', esc(api, r.emergencyId || r.id), esc(api, r.status || '')]; }))
        .concat(found.evidence.map(function (r) { return ['Evidence', esc(api, r.holdId || r.id), esc(api, r.status || '') + ' · ' + esc(api, r.hash || '')]; })))
      + '</div>'
      + '<div class="card"><div class="who">Open an incident</div>'
      + '<p class="sub">This links the records. It does not copy private messages, and it does not change the Broadcast or the account.</p>'
      + area('incSummary', 'What this incident is', 'Short factual summary')
      + '<button type="button" class="ghost" id="incOpen">Open incident</button></div>'
      + '<div class="card"><div class="who">Preserve evidence</div>'
      + '<p class="sub">A copy of the identifiers, times, and decisions. The original document is not edited. The writing itself is not copied into this file.</p>'
      + '<button type="button" class="ghost" id="evUser">Preserve the account record</button> '
      + '<button type="button" class="ghost" id="evBroad">Preserve this Broadcast</button> '
      + '<button type="button" class="ghost" id="evSignal">Preserve this Signal</button></div>'
      + '<div class="card"><div class="who">Legal request</div>'
      + '<p class="sub">A separate register. Opening an account above is not a disclosure.</p>'
      + field('lgAuth', 'Authority', '')
      + field('lgJur', 'Jurisdiction', '')
      + field('lgInst', 'Legal instrument / reference', '')
      + '<label class="sub" style="display:block;margin:8px 0 2px;">Type</label><select id="lgType" style="padding:8px;"><option value="preservation">Preservation</option><option value="disclosure">Disclosure</option><option value="removal">Removal</option><option value="other">Other</option></select>'
      + area('lgScope', 'Scope requested', '')
      + '<button type="button" class="ghost" id="lgSave">File the request</button></div>'
      + '<div class="card"><div class="who">Emergency — threat to life or serious harm</div>'
      + area('emWhy', 'Why this is urgent', 'What was seen, and why it cannot wait')
      + field('emHow', 'How it was detected', 'Report, automated hold, human review')
      + field('emAuth', 'Authority to contact', '')
      + '<button type="button" class="ghost" id="emSave">Open emergency case</button></div>'
      + '<div class="card"><div class="who">Security incident — the platform, not a post</div>'
      + field('secSvc', 'Affected service', '')
      + area('secWhat', 'What happened', 'Indicators, accounts, what was isolated')
      + '<button type="button" class="ghost" id="secSave">Open security incident</button></div>'
      + '<div class="card"><div class="who">Disclosure package</div>'
      + '<p class="sub">Only the boxes you tick are included. The rest is listed as withheld. This is not the person\'s whole history.</p>'
      + '<label><input type="checkbox" id="dxSummary" checked> Summary and timeline</label><br>'
      + '<label><input type="checkbox" id="dxAccount"> Account record</label><br>'
      + '<label><input type="checkbox" id="dxContent"> Broadcasts and Signals named above</label><br>'
      + '<label><input type="checkbox" id="dxReports"> Reports and moderation</label><br>'
      + '<label><input type="checkbox" id="dxEvidence"> Preserved evidence</label><br>'
      + field('dxReq', 'Legal request id this answers', '')
      + field('dxBy', 'Who authorised disclosure', '')
      + '<button type="button" class="ghost" id="dxBuild">Build the package</button>'
      + '<pre id="dxOut" class="sub" style="white-space:pre-wrap;"></pre></div>';

    out._found = found;
    out._timeline = timeline;
    out._account = account;

    function uid() { return (found.user && found.user.id) || ''; }
    el.querySelector('#incOpen').onclick = async function () {
      const summary = val(el, 'incSummary');
      if (summary.length < 8) { api.toast('Write a short factual summary'); return; }
      try {
        const id = await nextId(api.db, 'NL-INC');
        const now = Date.now();
        const row = {
          incidentId: id,
          subjectUid: uid(),
          broadcastId: (found.broadcast && found.broadcast.id) || '',
          signalId: (found.signal && found.signal.id) || '',
          reportId: (found.report && (found.report.report_id || found.report.id)) || '',
          caseIds: found.cases.map(function (c) { return c.case_id; }).slice(0, 20),
          status: 'open',
          summary: summary.slice(0, 1000),
          openedAt: now,
          openedBy: api.uid || '',
          retainUntil: Trust.retainUntil('incident', now),
        };
        await api.db.collection('incidents').doc(id).set(row);
        await api.db.collection('incidentNotes').add({
          incidentId: id, at: now, by: api.uid || '', text: summary.slice(0, 500), kind: 'open',
        });
        await audit(api, 'incident-open', id, summary.slice(0, 180));
        api.toast('Incident ' + id);
      } catch (e) { api.toast((e && e.message) || 'Could not open the incident'); }
    };
    async function preserve(path, doc) {
      if (!doc) { api.toast('That record is not in this search'); return; }
      const TrustNow = T();
      const shot = TrustNow.evidenceSnapshot(path, doc);
      const id = await nextId(api.db, 'NL-EVD');
      const row = TrustNow.evidenceHoldInput({
        holdId: id,
        incidentId: '',
        subjectUid: uid() || doc.creatorUid || doc.uid || doc.id,
        originalPath: path,
        snapshot: shot.snapshot,
        hash: shot.hash,
        initiatedBy: api.uid || '',
        at: Date.now(),
      });
      await api.db.collection('evidenceHolds').doc(id).set(row);
      await api.db.collection('evidenceAccess').add({ holdId: id, at: Date.now(), by: api.uid || '', why: 'preserved' });
      await audit(api, 'evidence-preserve', id, path);
      api.toast('Preserved ' + id + ' · ' + shot.hash);
    }
    el.querySelector('#evUser').onclick = function () {
      if (!found.user) { api.toast('No account in this search'); return; }
      preserve('users/' + found.user.id, found.user).catch(function (e) { api.toast(e.message || 'Could not preserve'); });
    };
    el.querySelector('#evBroad').onclick = function () {
      if (!found.broadcast) { api.toast('Search a Broadcast id first'); return; }
      preserve('broadcasts/' + found.broadcast.id, found.broadcast).catch(function (e) { api.toast(e.message || 'Could not preserve'); });
    };
    el.querySelector('#evSignal').onclick = function () {
      if (!found.signal) { api.toast('Search a Signal id first'); return; }
      preserve('signals/' + found.signal.id, found.signal).catch(function (e) { api.toast(e.message || 'Could not preserve'); });
    };
    el.querySelector('#lgSave').onclick = async function () {
      try {
        const id = await nextId(api.db, 'NL-LEG');
        const row = T().legalRequestInput({
          requestId: id,
          authority: val(el, 'lgAuth'),
          jurisdiction: val(el, 'lgJur'),
          instrument: val(el, 'lgInst'),
          requestType: val(el, 'lgType'),
          scope: val(el, 'lgScope'),
          subjectUid: uid(),
          contentIds: [found.broadcast && found.broadcast.id, found.signal && found.signal.id].filter(Boolean),
          openedBy: api.uid || '',
          reviewer: api.uid || '',
          status: 'received',
        });
        await api.db.collection('legalRequests').doc(id).set(row);
        await audit(api, 'legal-request', id, row.authority + ' · ' + row.jurisdiction);
        api.toast('Request ' + id);
      } catch (e) { api.toast(e.message || 'Could not file that'); }
    };
    el.querySelector('#emSave').onclick = async function () {
      try {
        const id = await nextId(api.db, 'NL-EMG');
        const row = T().emergencyInput({
          emergencyId: id,
          whyUrgent: val(el, 'emWhy'),
          detectedHow: val(el, 'emHow'),
          authority: val(el, 'emAuth'),
          subjectUid: uid(),
          contentIds: [found.broadcast && found.broadcast.id, found.signal && found.signal.id].filter(Boolean),
          openedBy: api.uid || '',
          status: 'open',
        });
        await api.db.collection('emergencyCases').doc(id).set(row);
        await audit(api, 'emergency-open', id, row.whyUrgent.slice(0, 180));
        api.toast('Emergency ' + id);
      } catch (e) { api.toast(e.message || 'Could not open that'); }
    };
    el.querySelector('#secSave').onclick = async function () {
      try {
        const id = await nextId(api.db, 'NL-SEC');
        const row = T().securityIncidentInput({
          securityId: id,
          service: val(el, 'secSvc'),
          indicators: val(el, 'secWhat'),
          actions: val(el, 'secWhat'),
          openedBy: api.uid || '',
          status: 'open',
        });
        await api.db.collection('securityIncidents').doc(id).set(row);
        await audit(api, 'security-incident', id, row.service);
        api.toast('Security incident ' + id);
      } catch (e) { api.toast(e.message || 'Could not open that'); }
    };
    el.querySelector('#dxBuild').onclick = async function () {
      const sections = [];
      if (el.querySelector('#dxSummary').checked) sections.push('summary', 'timeline');
      if (el.querySelector('#dxAccount').checked) sections.push('account');
      if (el.querySelector('#dxContent').checked) sections.push('broadcasts', 'signals');
      if (el.querySelector('#dxReports').checked) sections.push('reports', 'moderation', 'actions');
      if (el.querySelector('#dxEvidence').checked) sections.push('evidence');
      const pack = T().disclosurePackage({
        at: Date.now(),
        by: api.uid || '',
        requestId: val(el, 'dxReq'),
        authorisedBy: val(el, 'dxBy'),
        sections: sections,
        summary: { query: found.query, subjectUid: uid() },
        account: el.querySelector('#dxAccount').checked ? account : null,
        broadcasts: (found.broadcasts || []).map(function (b) { return T().broadcastReport(b, { reports: [], audits: [] }); }),
        signals: (found.signals || []).map(function (s) { return T().signalReport(s); }),
        reports: found.reports,
        moderation: [mod],
        timeline: timeline,
        evidence: found.evidence,
        actions: account ? account.enforcement : [],
      });
      const pre = el.querySelector('#dxOut');
      const json = JSON.stringify(pack, null, 2);
      if (pre) pre.textContent = json;
      try {
        const id = await nextId(api.db, 'NL-DIS');
        await api.db.collection('disclosures').doc(id).set({
          disclosureId: id,
          requestId: val(el, 'dxReq'),
          subjectUid: uid(),
          at: Date.now(),
          by: api.uid || '',
          authorisedBy: val(el, 'dxBy'),
          sections: sections,
          withheld: pack.withheld,
          hash: pack.hash,
          retainUntil: T().retainUntil('disclosure', Date.now()),
        });
        await audit(api, 'disclosure-built', id, sections.join(','));
        api.toast('Package ' + id + ' · ' + pack.hash);
      } catch (e) { api.toast(e.message || 'Package built on screen, not saved'); }
    };
  }

  function mount(el, api) {
    if (!el) return;
    if (el.querySelector('#legalRoot') && api.drafting && api.drafting()) return;
    const days = T().RETAIN_DAYS;
    el.innerHTML =
      '<div id="legalRoot" data-open="1">'
      + '<div class="alert">This desk reconstructs an incident from records Naluno already keeps, plus the files you open here. It does not read Wireline or Band. It does not invent a country, a network address, or a login that was not stored. Safety decisions stay on the Safety tab. This page is the case file around them.</div>'
      + '<div class="card"><div class="who">How long each file is kept</div>'
      + '<p class="sub">Sign-in events 180 days. Evidence 365 days unless a longer hold is set, and never under 90. Incidents, legal requests, emergencies and disclosure logs about 7 years. Security incidents about 3 years. None of these files can be deleted from the desk, including by the person who wrote them. A release marks the evidence file; it does not erase it.</p>'
      + '<p class="sub">Days on the policy: sign-in ' + days.securityEvent + ', incident ' + days.incident + ', legal ' + days.legalRequest + ', emergency ' + days.emergency + ', security ' + days.securityIncident + ', evidence ' + days.evidence + '.</p></div>'
      + '<div class="card"><div class="who">Look up</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      + '<input id="legalQ" placeholder="Handle, account id, Broadcast id, Signal id, or report id" style="flex:1;min-width:200px;padding:8px 10px;">'
      + '<button type="button" class="ghost" id="legalGo">Open the record</button></div>'
      + '<p class="sub" id="legalErr"></p></div>'
      + '<div id="legalOut"></div></div>';
    const go = el.querySelector('#legalGo');
    go.onclick = async function () {
      const err = el.querySelector('#legalErr');
      const q = val(el, 'legalQ');
      if (err) err.textContent = 'Looking up the stored records…';
      if (!api.db) { if (err) err.textContent = 'Database is not ready.'; return; }
      const found = await resolveQuery(api.db, q);
      if (found.error) { if (err) err.textContent = found.error; return; }
      if (err) err.textContent = '';
      await audit(api, 'legal-lookup', q.slice(0, 80), 'opened a trust record');
      paint(api, el, found);
    };
  }

  root.NalunoTrustDesk = { mount: mount, resolveQuery: resolveQuery };
})(typeof window !== 'undefined' ? window : globalThis);

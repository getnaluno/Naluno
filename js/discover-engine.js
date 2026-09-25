/* Naluno discovery.
   A Broadcast is one living object: the film, its chapters, its Strand,
   and the conversation on it. The feed is not trying to keep someone
   scrolling. It is trying to put a Broadcast in front of them that is
   worth the time, including work they would not have found alone.

   Four stages, in this order, always:
     candidates → eligibility → ranking → assembly
   Follower count is not a feature. A previous crowd is not a feature.
   Weights live on a named model so a later model can replace them. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NalunoDiscoverEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VALUE = {
    like: 1,
    kept_line: 6,
    share: 4,
    save: 5,
    returned_later: 6,
    watch_completed: 5,
    meaningful_comment: 6,
    question: 6,
    answer: 6,
    join_strand: 8,
    follow_creator: 8,
    join_band: 8,
  };
  const NEGATIVE = {
    not_interested: 12,
    dislike: 8,
    hide_topic: 10,
    hide_creator: 20,
    block_creator: 40,
    report: 30,
    skip_fast: 3,
  };

  function defaultAssembly() {
    return {
      discoveryShare: 0.22,
      maxConsecutiveCreator: 1,
      maxCreatorShare: 0.34,
      maxTopicStreak: 2,
    };
  }

  function modelV1() {
    return {
      id: 'ranker_v1',
      candidate: 'candidate_v1',
      safety: 'safety_v1',
      weights: {
        relevance: 1,
        satisfaction: 1.35,
        community: 0.7,
        discovery: 0.85,
        freshness: 0.45,
        relationship: 0.9,
        quality: 0.8,
        negative: 1.7,
        manipulation: 1.4,
      },
      assembly: defaultAssembly(),
    };
  }

  function modelV2() {
    return {
      id: 'ranker_v2',
      candidate: 'candidate_v1',
      safety: 'safety_v1',
      weights: {
        relevance: 0.85,
        satisfaction: 1.7,
        community: 0.95,
        discovery: 0.55,
        freshness: 0.25,
        relationship: 0.7,
        quality: 1.05,
        negative: 1.9,
        manipulation: 1.6,
      },
      assembly: defaultAssembly(),
    };
  }

  function models() {
    return { ranker_v1: modelV1(), ranker_v2: modelV2() };
  }

  function blankViewer() {
    return {
      topics: {},
      creators: {},
      followed: {},
      hiddenCreators: {},
      notInterested: {},
      blocked: {},
      strands: {},
      bands: {},
      connected: {},
      region: '',
    };
  }

  function topicsOf(b) {
    const out = [];
    if (!b) return out;
    if (b.strandId) out.push('strand:' + b.strandId);
    if (b.strandName) out.push('topic:' + String(b.strandName).toLowerCase().slice(0, 40));
    const tags = Array.isArray(b.tags) ? b.tags : [];
    for (let i = 0; i < tags.length && i < 6; i++) {
      if (tags[i]) out.push('topic:' + String(tags[i]).toLowerCase().slice(0, 40));
    }
    if (b.live) out.push('live');
    return out;
  }

  function safetyOf(b) {
    const f = (b && b.features) || {};
    return String(f.safetyStatus || b.safetyStatus || b.safetyDecision || 'clear');
  }

  function eligible(b, viewer) {
    const v = viewer || {};
    if (!b || !b.id || b.deleted) return false;
    if (b.hidden || b.held) return false;
    if (b.listed === false) return false;
    if (b.visibility === 'private') return false;
    if (Number(b.publishAt) > Date.now()) return false;
    const safety = safetyOf(b);
    if (safety === 'blocked' || safety === 'block' || safety === 'held') return false;
    const uid = b.creatorUid || '';
    if (uid && v.blocked && v.blocked[uid]) return false;
    if (uid && v.hiddenCreators && v.hiddenCreators[uid]) return false;
    if (v.notInterested && v.notInterested[b.id]) return false;
    const topics = topicsOf(b);
    const hiddenTopic = v.hiddenTopics || {};
    for (let i = 0; i < topics.length; i++) {
      if (hiddenTopic[topics[i]]) return false;
    }
    return true;
  }

  function fitOf(b) {
    const f = (b && b.features) || {};
    const imp = Math.max(0, Number(f.impressions) || 0);
    const evidence = (Number(f.meaningfulWatches) || 0)
      + (Number(f.completions) || 0) * 1.2
      + (Number(f.shares) || 0) * 3
      + (Number(f.saves) || 0) * 2.5
      + (Number(f.follows) || 0) * 4
      + (Number(f.returns) || 0) * 2
      + (Number(f.likes) || 0) * 2
      + (Number(f.keptLines) || 0) * 4;
    return {
      impressions: imp,
      rate: imp ? evidence / imp : 0,
      confidence: Math.min(1, imp / 80),
    };
  }

  function watchQuality(b) {
    const f = (b && b.features) || {};
    const duration = Number(f.durationSec || b.durationSec || 0);
    const avg = Number(f.avgWatchSec || 0);
    const depth = duration > 0 ? Math.min(1, avg / duration) : Number(f.completionRate || 0);
    const minutes = Math.min(1, avg / 720);
    const completion = Math.min(1, Number(f.completionRate || 0));
    const returns = Math.min(1, Number(f.returnRate || 0));
    return depth * 0.45 + minutes * 0.25 + completion * 0.2 + returns * 0.1;
  }

  function manipulation(b) {
    const f = (b && b.features) || {};
    const comments = Number(f.comments != null ? f.comments : b.commentCount) || 0;
    const meaningful = Number(f.meaningfulComments) || 0;
    if (comments < 8) return 0;
    const thin = Math.max(0, comments - meaningful);
    if (thin / comments < 0.85) return 0;
    return Math.min(1, thin / 40);
  }

  function personal(b, viewer) {
    const v = viewer || {};
    const topics = topicsOf(b);
    let rel = 0;
    for (let i = 0; i < topics.length; i++) rel += Number((v.topics || {})[topics[i]] || 0);
    let relationship = 0;
    const uid = b.creatorUid || '';
    if (uid && v.followed && v.followed[uid]) relationship += 1;
    if (uid && v.connected && v.connected[uid]) relationship += 0.55;
    if (b.bandId && v.bands && v.bands[b.bandId]) relationship += 0.45;
    if (b.strandId && v.strands && v.strands[b.strandId]) relationship += 0.35;
    return {
      relevance: Math.max(0, Math.tanh(rel / 6)),
      relationship: Math.min(1, relationship),
      negativeTaste: rel < 0 ? Math.min(1, -rel / 6) : 0,
    };
  }

  function pocket(b, viewer) {
    const pockets = (b.features && b.features.pockets) || {};
    const topics = (viewer && viewer.topics) || {};
    let best = 0;
    Object.keys(topics).forEach(function (k) {
      if (Number(topics[k]) <= 0) return;
      const p = Number(pockets[k] || 0);
      if (p > best) best = p;
    });
    return Math.min(1, best);
  }

  function negativePressure(b, viewer, fit) {
    const taste = personal(b, viewer);
    let n = taste.negativeTaste;
    const uid = b.creatorUid || '';
    const c = Number(((viewer && viewer.creators) || {})[uid] || 0);
    if (c < 0) n += Math.min(1, -c / 6);
    const f = b.features || {};
    const imp = Math.max(1, fit.impressions || 1);
    n += Math.min(1, (Number(f.negativeEvents) || 0) / imp * 4);
    n += Math.min(1, (Number(f.dislikes) || 0) / imp * 4);
    n += Math.min(1, (Number(f.reports) || 0) / 3);
    return Math.min(1, n);
  }

  function sourcesFor(b, viewer, fit, rel, now) {
    const sources = [];
    if (rel.relevance > 0.15) sources.push('interest');
    if (rel.relationship > 0) sources.push('creator');
    if (b.strandId && ((viewer.strands || {})[b.strandId] || (viewer.topics || {})['strand:' + b.strandId] > 0)) {
      sources.push('strand');
    }
    if (b.bandId && viewer.bands && viewer.bands[b.bandId]) sources.push('community');
    if (pocket(b, viewer) > 0.35) sources.push('similar');
    if (fit.impressions > 0 && fit.impressions < 800 && fit.rate > 0.12 && fit.confidence > 0.2) {
      sources.push('emerging');
    }
    const ageH = Math.max(0, ((now || Date.now()) - Number(b.createdAt || now || Date.now())) / 3600000);
    if (ageH < 48 && fit.impressions < 400) sources.push('new');
    if (viewer.region && b.region && viewer.region === b.region && rel.relevance < 0.2 && rel.relationship === 0) {
      sources.push('regional');
    }
    if (fit.confidence > 0.45 && fit.rate > 0.2) sources.push('trend');
    if (rel.relevance < 0.08 && rel.relationship === 0) sources.push('discovery');
    if (!sources.length) sources.push('open');
    return sources;
  }

  function whyText(sources) {
    if (sources.indexOf('creator') >= 0) return 'You are already with this creator.';
    if (sources.indexOf('strand') >= 0) return 'This sits on a Strand you have opened.';
    if (sources.indexOf('community') >= 0) return 'A Band you are in has this on.';
    if (sources.indexOf('similar') >= 0) return 'People who stay with Broadcasts like yours have stayed with this one.';
    if (sources.indexOf('emerging') >= 0) return 'A smaller creator. The people who have seen it have stayed.';
    if (sources.indexOf('new') >= 0) return 'New, and still being tried with a small audience.';
    if (sources.indexOf('regional') >= 0) return 'From the place you set, outside what you usually open.';
    if (sources.indexOf('interest') >= 0) return 'Close to Broadcasts you have stayed with.';
    if (sources.indexOf('trend') >= 0) return 'People who watch the way you do have been staying with this.';
    if (sources.indexOf('discovery') >= 0) return 'Outside what you usually open. Part of this feed is kept for that.';
    return 'Eligible, and still being learned.';
  }

  function scoreOne(b, viewer, model, now) {
    const w = model.weights;
    const fit = fitOf(b);
    const rel = personal(b, viewer);
    const quality = watchQuality(b);
    const sat = Math.min(1, quality * 0.72 + Math.min(1, fit.rate) * 0.28);
    const f = b.features || {};
    const talk = (Number(f.meaningfulComments) || 0) * 2
      + (Number(f.questions) || 0) * 2
      + (Number(f.answers) || 0)
      + (Number(f.commentReacts) || 0);
    const fromPoints = Math.min(0.2, (Number(f.contributionPoints) || 0) / 500);
    const community = Math.min(1, talk / 24 + fromPoints);
    const ageH = Math.max(0, (now - Number(b.createdAt || now)) / 3600000);
    const fresh = Math.exp(-ageH / 72);
    const explore = fit.impressions < 120 ? 0.32 : 0;
    const parts = {
      relevance: rel.relevance,
      satisfaction: sat,
      community: community,
      discovery: Math.max(explore, pocket(b, viewer) * 0.45),
      freshness: fresh,
      relationship: rel.relationship,
      quality: quality,
      negative: negativePressure(b, viewer, fit),
      manipulation: manipulation(b),
    };
    let score = 0;
    score += w.relevance * parts.relevance;
    score += w.satisfaction * parts.satisfaction;
    score += w.community * parts.community;
    score += w.discovery * parts.discovery;
    score += w.freshness * parts.freshness;
    score += w.relationship * parts.relationship;
    score += w.quality * parts.quality;
    score -= w.negative * parts.negative;
    score -= w.manipulation * parts.manipulation;
    const likes = Number(f.likes) || 0;
    const dislikes = Number(f.dislikes) || 0;
    const votes = likes + dislikes;
    if (votes) score += ((likes / votes) - 0.5) * 0.9;
    const kept = Number(f.keptLines) || 0;
    if (kept) score += Math.min(0.35, kept / 12);
    const sources = sourcesFor(b, viewer, fit, rel, now);
    return {
      id: b.id,
      score: score,
      parts: parts,
      sources: sources,
      why: whyText(sources),
      fit: fit,
    };
  }

  function isExploreSource(item) {
    const src = (item && item.sources) || [];
    const personal = src.indexOf('interest') >= 0 || src.indexOf('creator') >= 0
      || src.indexOf('strand') >= 0 || src.indexOf('community') >= 0 || src.indexOf('similar') >= 0;
    if (personal) return false;
    return src.indexOf('discovery') >= 0 || src.indexOf('new') >= 0
      || src.indexOf('emerging') >= 0 || src.indexOf('regional') >= 0;
  }

  function assemble(ranked, model) {
    const base = defaultAssembly();
    const a = Object.assign({}, base, (model && model.assembly) || {});
    const n = ranked.length;
    const exploreCut = n ? Math.max(1, Math.round(n * Number(a.discoveryShare))) : 0;
    const explore = [];
    const familiar = [];
    ranked.forEach(function (item) {
      (isExploreSource(item) ? explore : familiar).push(item);
    });
    const out = [];
    const used = {};
    const creatorCount = {};
    let lastCreator = '';
    let lastTopic = '';
    let topicStreak = 0;
    function topicOf(item) {
      return (item.topics && item.topics[0]) || '';
    }
    function allowed(item) {
      const c = item.creatorUid || '';
      if (c && lastCreator && c === lastCreator && Number(a.maxConsecutiveCreator) <= 1) return false;
      const cap = Math.max(2, Math.ceil(n * Number(a.maxCreatorShare)));
      if (c && (creatorCount[c] || 0) >= cap) return false;
      const t = topicOf(item);
      if (t && t === lastTopic && topicStreak >= Number(a.maxTopicStreak)) return false;
      return true;
    }
    function mark(item) {
      used[item.id] = 1;
      out.push(item);
      const c = item.creatorUid || '';
      if (c) creatorCount[c] = (creatorCount[c] || 0) + 1;
      const t = topicOf(item);
      if (t && t === lastTopic) topicStreak += 1;
      else { lastTopic = t; topicStreak = t ? 1 : 0; }
      lastCreator = c;
    }
    function nextFrom(list, loose) {
      let fallback = null;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (used[item.id]) continue;
        if (!fallback) fallback = item;
        if (loose) {
          if ((item.creatorUid || '') !== lastCreator) return item;
        } else if (allowed(item)) return item;
      }
      return loose ? fallback : null;
    }
    let exploreLeft = Math.min(explore.length, exploreCut || explore.length);
    let guard = 0;
    while (out.length < n && guard < n * 5) {
      guard += 1;
      const period = Math.max(2, Math.round(1 / Math.max(0.05, Number(a.discoveryShare) || 0.22)));
      const wantExplore = exploreLeft > 0 && ((out.length + 1) % period === 0);
      let item = null;
      if (wantExplore) item = nextFrom(explore, false);
      if (!item) item = nextFrom(familiar, false);
      if (!item) item = nextFrom(explore, false);
      if (!item) item = nextFrom(familiar, true) || nextFrom(explore, true);
      if (!item) break;
      if (isExploreSource(item) && exploreLeft > 0) exploreLeft -= 1;
      mark(item);
    }
    return out;
  }

  function withConfig(model, config) {
    const m = model || modelV1();
    const next = {
      id: m.id,
      candidate: m.candidate,
      safety: m.safety,
      weights: Object.assign({}, m.weights),
      assembly: Object.assign({}, defaultAssembly(), m.assembly || {}),
    };
    if (!config) return next;
    if (config.discoveryShare != null) next.assembly.discoveryShare = Number(config.discoveryShare);
    if (config.maxCreatorShare != null) next.assembly.maxCreatorShare = Number(config.maxCreatorShare);
    if (config.maxTopicStreak != null) next.assembly.maxTopicStreak = Number(config.maxTopicStreak);
    return next;
  }

  function run(broadcasts, viewer, model, now) {
    const m = withConfig(model || modelV1(), null);
    const clock = now || Date.now();
    const v = viewer || blankViewer();
    const dropped = [];
    const ranked = [];
    (broadcasts || []).forEach(function (b) {
      if (!eligible(b, v)) {
        if (b && b.id) dropped.push(b.id);
        return;
      }
      const row = scoreOne(b, v, m, clock);
      row.creatorUid = b.creatorUid || '';
      row.topics = topicsOf(b);
      row.broadcast = b;
      ranked.push(row);
    });
    ranked.sort(function (a, b) { return b.score - a.score; });
    const feed = assemble(ranked, m);
    feed.forEach(function (item, i) { item.place = i; });
    return {
      model: m.id,
      candidateModel: m.candidate,
      safetyModel: m.safety,
      feed: feed,
      dropped: dropped,
    };
  }

  function bump(map, key, delta) {
    if (!key) return;
    const next = (Number(map[key]) || 0) + delta;
    map[key] = Math.max(-8, Math.min(8, Math.round(next * 100) / 100));
  }

  function applyTaste(viewer, event) {
    const v = Object.assign(blankViewer(), viewer || {});
    v.topics = Object.assign({}, (viewer && viewer.topics) || {});
    v.creators = Object.assign({}, (viewer && viewer.creators) || {});
    v.followed = Object.assign({}, (viewer && viewer.followed) || {});
    v.hiddenCreators = Object.assign({}, (viewer && viewer.hiddenCreators) || {});
    v.notInterested = Object.assign({}, (viewer && viewer.notInterested) || {});
    v.blocked = Object.assign({}, (viewer && viewer.blocked) || {});
    v.strands = Object.assign({}, (viewer && viewer.strands) || {});
    v.bands = Object.assign({}, (viewer && viewer.bands) || {});
    v.connected = Object.assign({}, (viewer && viewer.connected) || {});
    v.hiddenTopics = Object.assign({}, (viewer && viewer.hiddenTopics) || {});
    const ev = event || {};
    const type = ev.type || '';
    const topics = Array.isArray(ev.topics) ? ev.topics : [];
    const uid = ev.creatorUid || '';
    function lift(n) {
      topics.forEach(function (t) { bump(v.topics, t, n); });
      if (uid) bump(v.creators, uid, n);
    }
    if (type === 'watch_50_percent' || type === 'watch_75_percent' || type === 'watch_90_percent' || type === 'watch_completed') lift(1);
    if (type === 'save' || type === 'share' || type === 'returned_later') lift(1.5);
    if (type === 'meaningful_comment' || type === 'question' || type === 'answer') lift(1.2);
    if (type === 'like') lift(1.4);
    if (type === 'unlike') lift(-1.4);
    if (type === 'kept_line') lift(2);
    if (type === 'comment_react') lift(0.4);
    if (type === 'dislike') lift(-2);
    if (type === 'undislike') lift(2);
    if (type === 'comment_down') lift(-0.3);
    if (type === 'more') lift(2);
    if (type === 'less' || type === 'skip_fast') lift(-1.5);
    if (type === 'not_interested') {
      if (ev.broadcastId) v.notInterested[ev.broadcastId] = 1;
      lift(-2);
    }
    if (type === 'hide_topic') {
      topics.forEach(function (t) { v.hiddenTopics[t] = 1; bump(v.topics, t, -4); });
    }
    if (type === 'hide_creator' || type === 'block_creator') {
      if (uid) v.hiddenCreators[uid] = 1;
      if (type === 'block_creator' && uid) v.blocked[uid] = 1;
    }
    if (type === 'follow_creator' && uid) {
      v.followed[uid] = 1;
      bump(v.creators, uid, 2);
    }
    if (type === 'join_strand' && ev.strandId) v.strands[ev.strandId] = 1;
    if (type === 'join_band' && ev.bandId) v.bands[ev.bandId] = 1;
    if (type === 'reset') return blankViewer();
    return v;
  }

  function blankFeature(id) {
    return {
      broadcastId: id,
      impressions: 0,
      meaningfulWatches: 0,
      completions: 0,
      shares: 0,
      saves: 0,
      returns: 0,
      follows: 0,
      meaningfulComments: 0,
      questions: 0,
      answers: 0,
      comments: 0,
      likes: 0,
      dislikes: 0,
      keptLines: 0,
      commentReacts: 0,
      negativeEvents: 0,
      reports: 0,
      watchSecSum: 0,
      watchSamples: 0,
      durationSec: 0,
      pockets: {},
      contributionPoints: 0,
    };
  }

  function rollup(events) {
    const by = {};
    (events || []).forEach(function (ev) {
      if (!ev || !ev.broadcastId) return;
      const id = String(ev.broadcastId);
      const f = by[id] || (by[id] = blankFeature(id));
      const type = ev.type || '';
      if (type === 'broadcast_impression') f.impressions += 1;
      if (type === 'watch_50_percent' || type === 'watch_75_percent' || type === 'watch_90_percent' || type === 'watch_completed') {
        f.meaningfulWatches += 1;
      }
      if (type === 'watch_completed') f.completions += 1;
      if (type === 'share') f.shares += 1;
      if (type === 'save') f.saves += 1;
      if (type === 'returned_later') f.returns += 1;
      if (type === 'follow_creator') f.follows += 1;
      if (type === 'meaningful_comment') f.meaningfulComments += 1;
      if (type === 'comment') f.comments += 1;
      if (type === 'question') { f.questions += 1; f.meaningfulComments += 1; }
      if (type === 'answer') { f.answers += 1; f.meaningfulComments += 1; }
      if (type === 'like') f.likes += 1;
      if (type === 'unlike') f.likes = Math.max(0, f.likes - 1);
      if (type === 'dislike') { f.dislikes += 1; f.negativeEvents += 1; }
      if (type === 'undislike') {
        f.dislikes = Math.max(0, f.dislikes - 1);
        f.negativeEvents = Math.max(0, f.negativeEvents - 1);
      }
      if (type === 'kept_line') f.keptLines += 1;
      if (type === 'comment_react') f.commentReacts += 1;
      if (type === 'comment_down') f.commentReacts += 1;
      if (type === 'not_interested' || type === 'hide_creator' || type === 'skip_fast' || type === 'report') {
        f.negativeEvents += 1;
      }
      if (type === 'report') f.reports += 1;
      if (ev.watchSec) {
        f.watchSecSum += Number(ev.watchSec) || 0;
        f.watchSamples += 1;
      }
      if (ev.durationSec) f.durationSec = Math.max(f.durationSec, Number(ev.durationSec) || 0);
      if (ev.topic) f.pockets[ev.topic] = (f.pockets[ev.topic] || 0) + 1;
      if (ev.contributionPoints) f.contributionPoints += Number(ev.contributionPoints) || 0;
    });
    const features = {};
    Object.keys(by).forEach(function (id) {
      const f = by[id];
      const pockets = {};
      let peak = 0;
      Object.keys(f.pockets).forEach(function (k) { if (f.pockets[k] > peak) peak = f.pockets[k]; });
      Object.keys(f.pockets).forEach(function (k) {
        pockets[k] = peak ? Math.round((f.pockets[k] / peak) * 100) / 100 : 0;
      });
      features[id] = {
        broadcastId: id,
        impressions: f.impressions,
        meaningfulWatches: f.meaningfulWatches,
        completions: f.completions,
        shares: f.shares,
        saves: f.saves,
        returns: f.returns,
        follows: f.follows,
        meaningfulComments: f.meaningfulComments,
        questions: f.questions,
        answers: f.answers,
        comments: f.comments,
        likes: f.likes,
        dislikes: f.dislikes,
        keptLines: f.keptLines,
        commentReacts: f.commentReacts,
        negativeEvents: f.negativeEvents,
        reports: f.reports,
        avgWatchSec: f.watchSamples ? Math.round(f.watchSecSum / f.watchSamples) : 0,
        durationSec: f.durationSec,
        completionRate: f.impressions ? Math.min(1, f.completions / f.impressions) : 0,
        returnRate: f.impressions ? Math.min(1, f.returns / f.impressions) : 0,
        pockets: pockets,
        contributionPoints: f.contributionPoints,
        safetyStatus: 'clear',
      };
    });
    return { features: features };
  }

  return {
    VALUE: VALUE,
    NEGATIVE: NEGATIVE,
    models: models,
    modelV1: modelV1,
    modelV2: modelV2,
    blankViewer: blankViewer,
    withConfig: withConfig,
    eligible: eligible,
    topicsOf: topicsOf,
    run: run,
    applyTaste: applyTaste,
    rollup: rollup,
    scoreOne: scoreOne,
  };
});

/* OWNERSHIP (origin.js): Origin similarity engine for Broadcast publish.
   MUST NOT touch calls / WebRTC. */
(function(){
  const KNOWN = [
    'bohemian rhapsody','let it be','hey jude','thriller','billie jean','shape of you',
    'blinding lights','baby shark','despacito','star wars','frozen let it go',
    'happy birthday to you','super mario','game of thrones','the beatles','taylor swift',
    'smells like teen spirit','hotel california','imagine','rolling in the deep',
    'someone like you','old town road','as it was','anti-hero','espresso',
    'the lion king','inception','avatar','titanic','harry potter','stranger things'
  ];

  function titleKey(s){
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function trigramScore(a, b){
    const x = titleKey(a), y = titleKey(b);
    if(!x || !y) return 0;
    if(x === y) return 1;
    if(x.indexOf(y) >= 0 || y.indexOf(x) >= 0) return 0.86;
    function grams(s){
      const g = {};
      const t = '  ' + s + ' ';
      for(let i = 0; i < t.length - 2; i++) g[t.slice(i, i + 3)] = 1;
      return g;
    }
    const A = grams(x), B = grams(y);
    let inter = 0, ua = 0, ub = 0;
    Object.keys(A).forEach(function(k){ ua++; if(B[k]) inter++; });
    Object.keys(B).forEach(function(){ ub++; });
    const union = ua + ub - inter;
    return union ? inter / union : 0;
  }
  function hamming(a, b){
    const n = Math.max(a.length, b.length);
    if(!n) return 64;
    let d = Math.abs(a.length - b.length);
    const m = Math.min(a.length, b.length);
    for(let i = 0; i < m; i++) if(a[i] !== b[i]) d++;
    return d;
  }
  function frameOverlap(a, b){
    if(!a || !a.length || !b || !b.length) return 0;
    let sum = 0;
    a.forEach(function(ha){
      let best = 64;
      b.forEach(function(hb){ best = Math.min(best, hamming(ha, hb)); });
      sum += 1 - Math.min(1, best / 24);
    });
    return sum / a.length;
  }
  function hex(buf){
    return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  }
  async function fileIdentity(file){
    const head = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
    const tailStart = Math.max(0, file.size - 65536);
    const tail = await file.slice(tailStart).arrayBuffer();
    const joined = new Uint8Array(head.byteLength + tail.byteLength + 16);
    joined.set(new Uint8Array(head), 0);
    joined.set(new Uint8Array(tail), head.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', joined);
    return hex(digest);
  }
  function dHashFromCanvas(canvas){
    const w = 9, h = 8;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if(!ctx) return '';
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let bits = '';
    for(let y = 0; y < h; y++){
      for(let x = 0; x < w - 1; x++){
        const i = (y * w + x) * 4;
        const j = (y * w + x + 1) * 4;
        const A = data[i] * 0.3 + data[i+1] * 0.59 + data[i+2] * 0.11;
        const B = data[j] * 0.3 + data[j+1] * 0.59 + data[j+2] * 0.11;
        bits += A > B ? '1' : '0';
      }
    }
    return bits;
  }
  function hashStillImage(file){
    return new Promise(function(resolve){
      try{
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function(){
          try{
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 64, 64);
            const h = dHashFromCanvas(c);
            try{ URL.revokeObjectURL(url); }catch(_){}
            resolve(h || '');
          }catch(_){
            try{ URL.revokeObjectURL(url); }catch(_2){}
            resolve('');
          }
        };
        img.onerror = function(){ try{ URL.revokeObjectURL(url); }catch(_){} resolve(''); };
        img.src = url;
        setTimeout(function(){ resolve(''); }, 5000);
      }catch(_){ resolve(''); }
    });
  }
  function photoLikeness(a, b){
    if(!a || !b) return 0;
    const n = Math.max(a.length, b.length);
    if(!n) return 0;
    const d = hamming(a, b);
    return 1 - (d / n);
  }
  function titleIsGeneric(s){
    const t = titleKey(s);
    if(!t || t.length < 8) return true;
    return /^(sweet|delicious|photo|video|image|pic|clip|untitled|broadcast|test|new|untitled broadcast)$/i.test(t);
  }
  function sampleFrameHashes(file, durationHint){
    const isVideo = (file.type || '').startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|3gp)$/i.test(file.name || '');
    const isImage = (file.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || '');
    if(isImage && !isVideo){
      return hashStillImage(file).then(function(h){
        return { duration: 0, hashes: h ? [h] : [], photoHash: h, audioHash: '' };
      });
    }
    if(!isVideo){
      return Promise.resolve({ duration: 0, hashes: [], photoHash: '', audioHash: '' });
    }
    return new Promise(function(resolve){
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const url = URL.createObjectURL(file);
      const hashes = [];
      let settled = false;
      const finish = function(duration){
        if(settled) return;
        settled = true;
        try{ URL.revokeObjectURL(url); }catch(_){}
        resolve({ duration: duration || 0, hashes: hashes, photoHash: hashes[0] || '', audioHash: '' });
      };
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const grab = function(){
        try{
          const ctx = canvas.getContext('2d');
          if(ctx){
            ctx.drawImage(v, 0, 0, 64, 64);
            const h = dHashFromCanvas(canvas);
            if(h) hashes.push(h);
          }
        }catch(_){}
      };
      v.onloadedmetadata = async function(){
        const d = isFinite(v.duration) ? v.duration : (durationHint || 0);
        const spots = d > 2 ? [0.12, 0.32, 0.5, 0.68, 0.88] : [0.2];
        for(let i = 0; i < spots.length; i++){
          try{
            v.currentTime = Math.max(0.05, spots[i] * (d || 1));
            await new Promise(function(ok){
              const t = setTimeout(ok, 700);
              v.onseeked = function(){ clearTimeout(t); ok(); };
            });
            grab();
          }catch(_){}
        }
        finish(d);
      };
      v.onerror = function(){ finish(durationHint || 0); };
      setTimeout(function(){ finish(durationHint || 0); }, 8000);
      v.src = url;
    });
  }
  async function scanOpenWeb(title, description){
    const q = titleKey(title);
    if(q.length < 3) return [];
    const matches = [];
    function pushHit(name, source, detail, s, boost){
      if(!name || s < 0.38) return;
      matches.push({
        title: name,
        source: source,
        detail: String(detail || source).replace(/<[^>]+>/g, ' ').slice(0, 160),
        score: Math.round(Math.min(0.97, s + (boost || 0)) * 100),
      });
    }
    async function getJson(url, ms){
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = setTimeout(function(){ try{ if(ctl) ctl.abort(); }catch(_){} }, ms || 4500);
      try{
        const res = await fetch(url, ctl ? { signal: ctl.signal } : {});
        clearTimeout(t);
        if(!res.ok) return null;
        return await res.json();
      }catch(_){
        clearTimeout(t);
        return null;
      }
    }
    try{
      const body = await getJson('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=5&format=json&origin=*');
      const hits = (body && body.query && body.query.search) || [];
      hits.forEach(function(hit){
        const s = Math.max(trigramScore(title, hit.title), trigramScore(description || '', hit.title) * 0.7);
        pushHit(hit.title, 'wikipedia', hit.snippet || 'Wikipedia', s, 0.08);
      });
    }catch(_){}
    try{
      const body = await getJson('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song,musicVideo,movie,tvSeason&limit=6');
      (body && body.results || []).forEach(function(r){
        const name = r.trackName || r.collectionName || '';
        const s = trigramScore(title, name);
        pushHit(name + (r.artistName ? ' — ' + r.artistName : ''), 'itunes', 'Public iTunes / Apple catalog', s, 0.1);
      });
    }catch(_){}
    try{
      const body = await getJson('https://musicbrainz.org/ws/2/recording/?query=' + encodeURIComponent(q) + '&fmt=json&limit=5');
      (body && body.recordings || []).forEach(function(r){
        const artist = (r['artist-credit'] && r['artist-credit'][0] && r['artist-credit'][0].name) || '';
        const s = trigramScore(title, r.title || '');
        pushHit((r.title || '') + (artist ? ' — ' + artist : ''), 'musicbrainz', 'MusicBrainz recording', s, 0.08);
      });
    }catch(_){}
    try{
      const body = await getJson('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=5');
      (body && body.data || []).forEach(function(r){
        const name = r.title || '';
        const artist = (r.artist && r.artist.name) || '';
        const s = trigramScore(title, name);
        pushHit(name + (artist ? ' — ' + artist : ''), 'deezer', 'Deezer catalog', s, 0.08);
      });
    }catch(_){}
    try{
      const body = await getJson('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q));
      (body || []).slice(0, 5).forEach(function(row){
        const show = row && row.show;
        if(!show) return;
        const s = trigramScore(title, show.name || '');
        pushHit(show.name, 'tvmaze', (show.premiered ? 'First aired ' + show.premiered : 'TV catalog'), s, 0.08);
      });
    }catch(_){}
    try{
      const body = await getJson('https://openlibrary.org/search.json?q=' + encodeURIComponent(q) + '&limit=5');
      (body && body.docs || []).slice(0, 5).forEach(function(d){
        const name = d.title || '';
        const s = trigramScore(title, name);
        pushHit(name + (d.author_name && d.author_name[0] ? ' — ' + d.author_name[0] : ''), 'openlibrary', 'Open Library', s, 0.06);
      });
    }catch(_){}
    try{
      const body = await getJson('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) + '&fl[]=title&fl[]=creator&fl[]=identifier&rows=5&page=1&output=json');
      const docs = body && body.response && body.response.docs || [];
      docs.forEach(function(d){
        const s = trigramScore(title, d.title || '');
        pushHit(d.title, 'archive', 'Internet Archive', s, 0.05);
      });
    }catch(_){}
    matches.sort(function(a,b){ return b.score - a.score; });
    const seen = {};
    const uniq = [];
    matches.forEach(function(m){
      const k = titleKey(m.title);
      if(seen[k]) return;
      seen[k] = 1;
      uniq.push(m);
    });
    return uniq.slice(0, 8);
  }
  async function loadCatalogMarks(){
    const out = [];
    if(!fbDb) return out;
    try{
      const snap = await fbDb.collection('originMarks').orderBy('createdAt', 'desc').limit(240).get();
      snap.docs.forEach(function(d){ out.push({ id: d.id, ...(d.data() || {}) }); });
    }catch(_){
      try{
        const snap = await fbDb.collection('originMarks').limit(80).get();
        snap.docs.forEach(function(d){ out.push({ id: d.id, ...(d.data() || {}) }); });
      }catch(_2){}
    }
    return out;
  }
  function scoreCatalog(mark, catalog){
    const out = [];
    (catalog || []).forEach(function(other){
      if(other.creatorUid && mark.creatorUid && other.creatorUid === mark.creatorUid && other.identity === mark.identity) return;
      let score = 0;
      const reasons = [];
      if(other.identity && mark.identity && other.identity === mark.identity){
        score = 100; reasons.push('same file identity');
      }
      const title = trigramScore(mark.title, other.title);
      if(title >= 0.72 && !titleIsGeneric(mark.title) && !titleIsGeneric(other.title)){
        score = Math.max(score, Math.round(title * 88));
        reasons.push('title close to “' + other.title + '”');
      }
      const stillA = mark.photoHash || ((mark.frameHashes && mark.frameHashes[0]) || '');
      const stillB = other.photoHash || ((other.frameHashes && other.frameHashes[0]) || '');
      const still = photoLikeness(stillA, stillB);
      if(still >= 0.82){
        score = Math.max(score, Math.round(still * 98));
        reasons.push('picture matches “' + (other.title || 'another Broadcast') + '”');
      } else if(still >= 0.72){
        score = Math.max(score, Math.round(still * 90));
        reasons.push('picture is close to “' + (other.title || 'another Broadcast') + '”');
      }
      const frames = frameOverlap(mark.frameHashes, other.frameHashes);
      if(frames >= 0.72){
        score = Math.max(score, Math.round(frames * 94));
        reasons.push('video frames match another Broadcast');
      }
      if(mark.audioHash && other.audioHash && mark.audioHash === other.audioHash){
        score = Math.max(score, 91);
        reasons.push('sound fingerprint matches');
      }
      if(mark.duration && other.duration){
        const ratio = Math.min(mark.duration, other.duration) / Math.max(mark.duration, other.duration);
        if(ratio > 0.96 && frames > 0.62){
          score = Math.max(score, 90);
        }
      }
      if(score >= 55){
        out.push({ title: other.title, source: 'catalog', detail: reasons.join(' · '), score: score });
      }
    });
    out.sort(function(a,b){ return b.score - a.score; });
    return out.slice(0, 4);
  }
  function scoreKnown(title){
    const hits = [];
    KNOWN.forEach(function(work){
      const s = trigramScore(title, work);
      if(s >= 0.55){
        hits.push({ title: work, source: 'known', detail: 'Title is close to a well-known work', score: Math.round(s * 100) });
      }
    });
    hits.sort(function(a,b){ return b.score - a.score; });
    return hits.slice(0, 3);
  }
  function assemble(opts){
    const matches = (opts.catalog || []).concat(opts.web || []).concat(opts.known || []);
    matches.sort(function(a,b){ return b.score - a.score; });
    const top = matches[0] ? matches[0].score : 0;
    let status = 'clear';
    if(top >= 86) status = 'match';
    else if(top >= 70) status = 'review';
    const reasons = [];
    if(opts.catalog[0]) reasons.push(opts.catalog[0].detail);
    if(opts.web[0] && (!opts.catalog[0] || opts.catalog[0].score < 80)) reasons.push('Open web: ' + opts.web[0].title);
    return {
      status: status,
      score: top,
      reasons: reasons.slice(0, 3),
      matches: matches.slice(0, 6),
      identity: opts.identity,
      duration: opts.duration,
      frameHashes: opts.frameHashes,
      photoHash: opts.photoHash || '',
      audioHash: opts.audioHash || '',
    };
  }

  async function runOriginScan(file, title, description, durationHint){
    const identity = await fileIdentity(file);
    const frames = await sampleFrameHashes(file, durationHint || 0);
    const catalog = await loadCatalogMarks();
    const mark = {
      identity: identity,
      duration: frames.duration,
      frameHashes: frames.hashes,
      photoHash: frames.photoHash || (frames.hashes && frames.hashes[0]) || '',
      audioHash: frames.audioHash || '',
      title: title,
      creatorUid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : '',
    };
    const catalogHits = scoreCatalog(mark, catalog);
    const strongVisual = catalogHits[0] && catalogHits[0].score >= 80;
    let web = [];
    let known = [];
    if(!strongVisual && !titleIsGeneric(title)){
      web = await scanOpenWeb(title, description || '');
      known = scoreKnown(title);
    }
    return assemble({
      identity: identity,
      duration: frames.duration,
      frameHashes: frames.hashes,
      photoHash: mark.photoHash,
      audioHash: mark.audioHash,
      catalog: catalogHits,
      web: web,
      known: known,
    });
  }

  async function saveOriginMark(broadcastId, report, title){
    if(!fbDb || !currentUser || !report) return;
    try{
      await fbDb.collection('originMarks').add({
        creatorUid: currentUser.uid,
        broadcastId: broadcastId || null,
        title: (title || '').slice(0, 120),
        identity: report.identity,
        duration: report.duration || 0,
        frameHashes: (report.frameHashes || []).slice(0, 8),
        photoHash: report.photoHash || '',
        audioHash: report.audioHash || '',
        status: report.status,
        score: report.score || 0,
        createdAt: Date.now(),
      });
    }catch(e){ console.warn('[origin] mark', e); }
  }

  window.runOriginScan = runOriginScan;
  window.saveOriginMark = saveOriginMark;
  window.originTrigramScore = trigramScore;
  window.originScanOpenWeb = scanOpenWeb;
})();

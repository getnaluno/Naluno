/* OWNERSHIP (origin.js): Naluno OriginID — picture, motion, sound.
   MUST NOT touch calls / WebRTC. */
(function(){
  const KNOWN = [
    'bohemian rhapsody','let it be','hey jude','thriller','billie jean','shape of you',
    'blinding lights','baby shark','despacito','star wars','frozen let it go',
    'happy birthday to you','super mario','game of thrones','the beatles','taylor swift',
    'smells like teen spirit','hotel california','imagine','rolling in the deep',
    'someone like you','old town road','as it was','anti-hero','espresso',
    'the lion king','inception','avatar','titanic','harry potter','stranger things',
    'never gonna give you up','sweet child o mine','smells like teen spirit',
    'bad guy','blinding lights','levitating','flowery','die with a smile'
  ];
  const CHROMA_HZ = [261.63,277.18,293.66,311.13,329.63,349.23,369.99,392.00,415.30,440.00,466.16,493.88];

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
  function aHashFromCanvas(canvas){
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if(!ctx) return '';
    ctx.drawImage(canvas, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const lum = [];
    let sum = 0;
    for(let i = 0; i < 64; i++){
      const L = data[i*4] * 0.3 + data[i*4+1] * 0.59 + data[i*4+2] * 0.11;
      lum.push(L); sum += L;
    }
    const avg = sum / 64;
    return lum.map(function(L){ return L > avg ? '1' : '0'; }).join('');
  }
  function stillFromCanvas(canvas){
    const d = dHashFromCanvas(canvas);
    const a = aHashFromCanvas(canvas);
    return (d && a) ? (d + ':' + a) : (d || a || '');
  }
  function photoLikeness(a, b){
    if(!a || !b) return 0;
    function one(x, y){
      if(!x || !y) return 0;
      const n = Math.max(x.length, y.length);
      if(!n) return 0;
      return 1 - (hamming(x, y) / n);
    }
    if(String(a).indexOf(':') >= 0 && String(b).indexOf(':') >= 0){
      const A = String(a).split(':'), B = String(b).split(':');
      return (one(A[0], B[0]) + one(A[1], B[1])) / 2;
    }
    const n = Math.max(a.length, b.length);
    if(!n) return 0;
    return 1 - (hamming(a, b) / n);
  }
  function sequenceOverlap(a, b){
    if(!a || !b || !a.length || !b.length) return 0;
    let sum = 0;
    a.forEach(function(ha, i){
      let best = 0;
      b.forEach(function(hb, j){
        const L = photoLikeness(ha, hb);
        const pos = 1 - Math.min(1, Math.abs((i + 1) / a.length - (j + 1) / b.length) * 1.5);
        best = Math.max(best, L * (0.72 + 0.28 * pos));
      });
      sum += best;
    });
    return sum / a.length;
  }
  function audioLikeness(a, b){
    if(!a || !b) return 0;
    const A = String(a), B = String(b);
    if(!A || !B) return 0;
    if(A === B) return 1;
    function one(x, y){
      if(!x || !y) return 0;
      const n = Math.max(x.length, y.length);
      if(!n) return 0;
      return 1 - (hamming(x, y) / n);
    }
    if(A.indexOf('#') >= 0 && B.indexOf('#') >= 0){
      const aa = A.split('#'), bb = B.split('#');
      return one(aa[0], bb[0]) * 0.72 + one(aa[1] || '', bb[1] || '') * 0.28;
    }
    return one(A, B);
  }
  function titleIsGeneric(s){
    const t = titleKey(s);
    if(!t || t.length < 8) return true;
    return /^(sweet|delicious|photo|video|image|pic|clip|untitled|broadcast|test|new|untitled broadcast|my video|my photo)$/i.test(t);
  }
  function looksVideo(file){
    const t = (file && file.type) || '';
    const n = (file && file.name) || '';
    return t.indexOf('video/') === 0 || /\.(mp4|mov|webm|m4v|mkv|3gp)$/i.test(n);
  }
  function looksAudio(file){
    const t = (file && file.type) || '';
    const n = (file && file.name) || '';
    return t.indexOf('audio/') === 0 || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(n);
  }
  function looksImage(file){
    const t = (file && file.type) || '';
    const n = (file && file.name) || '';
    return t.indexOf('image/') === 0 || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(n);
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
            const h = stillFromCanvas(c);
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
  function fingerprintSamples(samples, sampleRate){
    const slices = 16;
    const n = samples.length;
    if(!n) return { chroma: '', energy: '' };
    const chromaParts = [];
    const energy = [];
    const win = Math.max(256, Math.floor(n / slices));
    for(let i = 0; i < slices; i++){
      const start = Math.min(n - 1, i * win);
      const len = Math.min(2048, n - start);
      let rms = 0;
      const bands = new Array(12).fill(0);
      for(let k = 0; k < 12; k++){
        const f = CHROMA_HZ[k];
        let re = 0, im = 0;
        const step = Math.max(1, Math.floor(len / 256));
        for(let t = 0; t < len; t += step){
          const s = samples[start + t] || 0;
          const ang = 2 * Math.PI * f * t / sampleRate;
          re += s * Math.cos(ang);
          im += s * Math.sin(ang);
          rms += s * s;
        }
        bands[k] = Math.sqrt(re * re + im * im);
      }
      energy.push(Math.sqrt(rms / Math.max(1, len)));
      const mx = Math.max.apply(null, bands) || 1;
      chromaParts.push(bands.map(function(b){ return b > mx * 0.55 ? '1' : '0'; }).join(''));
    }
    const eMax = Math.max.apply(null, energy) || 1;
    const eBits = energy.map(function(e){ return e > eMax * 0.42 ? '1' : '0'; }).join('');
    return { chroma: chromaParts.join(''), energy: eBits };
  }
  function audioHashFromParts(parts){
    if(!parts || (!parts.chroma && !parts.energy)) return '';
    return String(parts.chroma || '') + '#' + String(parts.energy || '');
  }
  async function fingerprintAudioBuffer(file){
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return '';
      const ctx = new Ctx();
      const slice = file.slice(0, Math.min(file.size, 6 * 1024 * 1024));
      const raw = await slice.arrayBuffer();
      const audio = await ctx.decodeAudioData(raw.slice(0));
      const ch = audio.getChannelData(0);
      const fp = fingerprintSamples(ch, audio.sampleRate || 44100);
      try{ ctx.close(); }catch(_){}
      return audioHashFromParts(fp);
    }catch(_){ return ''; }
  }
  function fingerprintVideoAudio(file, durationHint){
    return new Promise(function(resolve){
      try{
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if(!Ctx){ resolve(''); return; }
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        const url = URL.createObjectURL(file);
        v.src = url;
        let settled = false;
        const done = function(h){
          if(settled) return;
          settled = true;
          try{ URL.revokeObjectURL(url); }catch(_){}
          try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(_){}
          resolve(h || '');
        };
        v.onerror = function(){ done(''); };
        v.onloadedmetadata = async function(){
          try{
            const ctx = new Ctx();
            let stream = null;
            try{ stream = v.captureStream ? v.captureStream() : (v.mozCaptureStream && v.mozCaptureStream()); }catch(_){}
            if(!stream || !stream.getAudioTracks || !stream.getAudioTracks().length){
              try{ ctx.close(); }catch(_){}
              done(''); return;
            }
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            src.connect(analyser);
            const freq = new Uint8Array(analyser.frequencyBinCount);
            const d = isFinite(v.duration) ? v.duration : (durationHint || 0);
            const spots = d > 3 ? [0.1,0.22,0.34,0.46,0.58,0.7,0.82,0.94] : [0.25,0.6];
            const chromaParts = [];
            const energy = [];
            v.muted = true;
            await v.play().catch(function(){});
            for(let i = 0; i < spots.length; i++){
              try{
                v.currentTime = Math.max(0.05, spots[i] * (d || 1));
                await new Promise(function(ok){
                  const t = setTimeout(ok, 500);
                  v.onseeked = function(){ clearTimeout(t); ok(); };
                });
                analyser.getByteFrequencyData(freq);
                const bands = new Array(12).fill(0);
                let rms = 0;
                for(let b = 0; b < freq.length; b++){
                  rms += freq[b];
                  bands[b % 12] += freq[b];
                }
                energy.push(rms);
                const mx = Math.max.apply(null, bands) || 1;
                chromaParts.push(bands.map(function(x){ return x > mx * 0.5 ? '1' : '0'; }).join(''));
              }catch(_){}
            }
            try{ v.pause(); ctx.close(); }catch(_){}
            const eMax = Math.max.apply(null, energy) || 1;
            const eBits = energy.map(function(e){ return e > eMax * 0.42 ? '1' : '0'; }).join('');
            done(audioHashFromParts({ chroma: chromaParts.join(''), energy: eBits }));
          }catch(_){ done(''); }
        };
        setTimeout(function(){ done(''); }, 7000);
      }catch(_){ resolve(''); }
    });
  }
  function sampleFrameHashes(file, durationHint){
    if(looksImage(file) && !looksVideo(file)){
      return hashStillImage(file).then(function(h){
        return { duration: 0, hashes: h ? [h] : [], photoHash: h, audioHash: '', kind: 'photo' };
      });
    }
    if(looksAudio(file) && !looksVideo(file)){
      return fingerprintAudioBuffer(file).then(function(h){
        return { duration: durationHint || 0, hashes: [], photoHash: '', audioHash: h, kind: 'audio' };
      });
    }
    if(!looksVideo(file)){
      return Promise.resolve({ duration: 0, hashes: [], photoHash: '', audioHash: '', kind: 'unknown' });
    }
    return new Promise(function(resolve){
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const url = URL.createObjectURL(file);
      const hashes = [];
      let settled = false;
      const finish = function(duration, audioHash){
        if(settled) return;
        settled = true;
        try{ URL.revokeObjectURL(url); }catch(_){}
        try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(_){}
        resolve({
          duration: duration || 0,
          hashes: hashes,
          photoHash: hashes[0] || '',
          audioHash: audioHash || '',
          kind: 'video',
        });
      };
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const grab = function(){
        try{
          const ctx = canvas.getContext('2d');
          if(ctx){
            ctx.drawImage(v, 0, 0, 64, 64);
            const h = stillFromCanvas(canvas);
            if(h) hashes.push(h);
          }
        }catch(_){}
      };
      v.onloadedmetadata = async function(){
        const d = isFinite(v.duration) ? v.duration : (durationHint || 0);
        const spots = d > 8 ? [0.08,0.18,0.3,0.42,0.54,0.66,0.78,0.9] : (d > 2 ? [0.12,0.32,0.5,0.68,0.88] : [0.2]);
        let audioHash = '';
        try{
          const Ctx = window.AudioContext || window.webkitAudioContext;
          let analyser = null, freq = null, ctx = null;
          if(Ctx){
            try{
              ctx = new Ctx();
              const stream = v.captureStream ? v.captureStream() : (v.mozCaptureStream && v.mozCaptureStream());
              if(stream && stream.getAudioTracks && stream.getAudioTracks().length){
                const src = ctx.createMediaStreamSource(stream);
                analyser = ctx.createAnalyser();
                analyser.fftSize = 2048;
                src.connect(analyser);
                freq = new Uint8Array(analyser.frequencyBinCount);
                try{ v.muted = true; await v.play(); }catch(_){}
              }
            }catch(_){ analyser = null; }
          }
          const chromaParts = [];
          const energy = [];
          for(let i = 0; i < spots.length; i++){
            try{
              v.currentTime = Math.max(0.05, spots[i] * (d || 1));
              await new Promise(function(ok){
                const t = setTimeout(ok, 650);
                v.onseeked = function(){ clearTimeout(t); ok(); };
              });
              grab();
              if(analyser && freq){
                analyser.getByteFrequencyData(freq);
                const bands = new Array(12).fill(0);
                let rms = 0;
                for(let b = 0; b < freq.length; b++){
                  rms += freq[b];
                  bands[b % 12] += freq[b];
                }
                energy.push(rms);
                const mx = Math.max.apply(null, bands) || 1;
                chromaParts.push(bands.map(function(x){ return x > mx * 0.5 ? '1' : '0'; }).join(''));
              }
            }catch(_){}
          }
          try{ v.pause(); if(ctx) ctx.close(); }catch(_){}
          if(chromaParts.length){
            const eMax = Math.max.apply(null, energy) || 1;
            const eBits = energy.map(function(e){ return e > eMax * 0.42 ? '1' : '0'; }).join('');
            audioHash = audioHashFromParts({ chroma: chromaParts.join(''), energy: eBits });
          }
        }catch(_){}
        if(!audioHash){
          try{ audioHash = await fingerprintAudioBuffer(file); }catch(_){}
        }
        finish(d, audioHash);
      };
      v.onerror = function(){ finish(durationHint || 0, ''); };
      setTimeout(function(){ finish(durationHint || 0, ''); }, 10000);
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
        channel: 'web',
        detail: String(detail || source).replace(/<[^>]+>/g, ' ').slice(0, 160),
        score: Math.round(Math.min(0.97, s + (boost || 0)) * 100),
      });
    }
    async function getJson(url, ms){
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = setTimeout(function(){ try{ if(ctl) ctl.abort(); }catch(_){} }, ms || 4200);
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
    await Promise.all([
      getJson('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=5&format=json&origin=*').then(function(body){
        const hits = (body && body.query && body.query.search) || [];
        hits.forEach(function(hit){
          const s = Math.max(trigramScore(title, hit.title), trigramScore(description || '', hit.title) * 0.7);
          pushHit(hit.title, 'wikipedia', hit.snippet || 'Wikipedia', s, 0.08);
        });
      }).catch(function(){}),
      getJson('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song,musicVideo,movie,tvSeason,audiobook&limit=6').then(function(body){
        (body && body.results || []).forEach(function(r){
          const name = r.trackName || r.collectionName || '';
          const s = trigramScore(title, name);
          pushHit(name + (r.artistName ? ' — ' + r.artistName : ''), 'itunes', 'Public iTunes / Apple catalog', s, 0.1);
        });
      }).catch(function(){}),
      getJson('https://musicbrainz.org/ws/2/recording/?query=' + encodeURIComponent(q) + '&fmt=json&limit=5').then(function(body){
        (body && body.recordings || []).forEach(function(r){
          const artist = (r['artist-credit'] && r['artist-credit'][0] && r['artist-credit'][0].name) || '';
          const s = trigramScore(title, r.title || '');
          pushHit((r.title || '') + (artist ? ' — ' + artist : ''), 'musicbrainz', 'MusicBrainz recording', s, 0.08);
        });
      }).catch(function(){}),
      getJson('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=5').then(function(body){
        (body && body.data || []).forEach(function(r){
          const name = r.title || '';
          const artist = (r.artist && r.artist.name) || '';
          const s = trigramScore(title, name);
          pushHit(name + (artist ? ' — ' + artist : ''), 'deezer', 'Deezer catalog', s, 0.08);
        });
      }).catch(function(){}),
      getJson('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q)).then(function(body){
        (body || []).slice(0, 5).forEach(function(row){
          const show = row && row.show;
          if(!show) return;
          const s = trigramScore(title, show.name || '');
          pushHit(show.name, 'tvmaze', (show.premiered ? 'First aired ' + show.premiered : 'TV catalog'), s, 0.08);
        });
      }).catch(function(){}),
      getJson('https://openlibrary.org/search.json?q=' + encodeURIComponent(q) + '&limit=4').then(function(body){
        (body && body.docs || []).slice(0, 4).forEach(function(d){
          const name = d.title || '';
          const s = trigramScore(title, name);
          pushHit(name + (d.author_name && d.author_name[0] ? ' — ' + d.author_name[0] : ''), 'openlibrary', 'Open Library', s, 0.06);
        });
      }).catch(function(){}),
      getJson('https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) + '&fl[]=title&fl[]=creator&fl[]=identifier&rows=5&page=1&output=json').then(function(body){
        const docs = body && body.response && body.response.docs || [];
        docs.forEach(function(d){
          const s = trigramScore(title, d.title || '');
          pushHit(d.title, 'archive', 'Internet Archive', s, 0.05);
        });
      }).catch(function(){}),
    ]);
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
  function fuseChannels(ch){
    const keys = ['file','picture','motion','sound','title','web','known'];
    const vals = keys.map(function(k){ return ch[k] || 0; });
    const top = Math.max.apply(null, [0].concat(vals));
    const fired = vals.filter(function(v){ return v >= 70; }).length;
    let score = top;
    if(ch.file >= 99) score = 100;
    else if(fired >= 2) score = Math.min(99, Math.round(top + 8 + (fired - 2) * 4));
    // Naluno remix: same sound, different picture (cover / lip-sync)
    if((ch.sound || 0) >= 82 && (ch.picture || 0) < 55) score = Math.max(score, 88);
    return score;
  }
  function scoreCatalog(mark, catalog){
    const out = [];
    (catalog || []).forEach(function(other){
      if(other.creatorUid && mark.creatorUid && other.creatorUid === mark.creatorUid && other.identity === mark.identity) return;
      const ch = { file: 0, picture: 0, motion: 0, sound: 0, title: 0 };
      const reasons = [];
      if(other.identity && mark.identity && other.identity === mark.identity){
        ch.file = 100; reasons.push('same file identity');
      }
      const title = trigramScore(mark.title, other.title);
      if(title >= 0.72 && !titleIsGeneric(mark.title) && !titleIsGeneric(other.title)){
        ch.title = Math.round(title * 88);
        reasons.push('title close to “' + other.title + '”');
      }
      const stillA = mark.photoHash || ((mark.frameHashes && mark.frameHashes[0]) || '');
      const stillB = other.photoHash || ((other.frameHashes && other.frameHashes[0]) || '');
      const still = photoLikeness(stillA, stillB);
      if(still >= 0.82){
        ch.picture = Math.round(still * 98);
        reasons.push('picture matches “' + (other.title || 'another Broadcast') + '”');
      } else if(still >= 0.72){
        ch.picture = Math.round(still * 90);
        reasons.push('picture is close to “' + (other.title || 'another Broadcast') + '”');
      }
      const motion = sequenceOverlap(mark.frameHashes, other.frameHashes);
      if(motion >= 0.72){
        ch.motion = Math.round(motion * 96);
        reasons.push('video motion matches another Broadcast');
      } else if(motion >= 0.62){
        ch.motion = Math.round(motion * 88);
        reasons.push('video scenes resemble another Broadcast');
      }
      const sound = audioLikeness(mark.audioHash, other.audioHash);
      if(sound >= 0.86){
        ch.sound = Math.round(sound * 97);
        reasons.push('sound fingerprint matches “' + (other.title || 'another Broadcast') + '”');
      } else if(sound >= 0.74){
        ch.sound = Math.round(sound * 90);
        reasons.push('sound is close to another Broadcast');
      }
      if(mark.duration && other.duration){
        const ratio = Math.min(mark.duration, other.duration) / Math.max(mark.duration, other.duration);
        if(ratio > 0.96 && motion > 0.62){
          ch.motion = Math.max(ch.motion, 90);
        }
      }
      const sameCreator = !!(other.creatorUid && mark.creatorUid && other.creatorUid === mark.creatorUid);
      let score = fuseChannels(ch);
      if(sameCreator && ch.file < 100 && score >= 80){
        reasons.push('same creator — treated as a version, not a theft');
        score = Math.min(score, 69);
      }
      if(score >= 55){
        out.push({
          title: other.title,
          source: 'naluno',
          channel: ch.sound >= ch.picture && ch.sound >= ch.motion ? 'sound' : (ch.motion >= ch.picture ? 'motion' : (ch.file ? 'file' : 'picture')),
          detail: reasons.join(' · '),
          score: score,
          channels: ch,
          sameCreator: sameCreator,
        });
      }
    });
    out.sort(function(a,b){ return b.score - a.score; });
    return out.slice(0, 5);
  }
  function scoreKnown(title){
    const hits = [];
    KNOWN.forEach(function(work){
      const s = trigramScore(title, work);
      if(s >= 0.55){
        hits.push({ title: work, source: 'known', channel: 'known', detail: 'Title is close to a well-known work', score: Math.round(s * 100) });
      }
    });
    hits.sort(function(a,b){ return b.score - a.score; });
    return hits.slice(0, 3);
  }
  function makeDna(mark){
    return [
      String(mark.identity || '').slice(0, 18),
      String(mark.photoHash || '').replace(/[^01]/g,'').slice(0, 16),
      String(mark.audioHash || '').replace(/[^01]/g,'').slice(0, 16),
      String(Math.round(mark.duration || 0)),
    ].join('.');
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
    const ch = (opts.catalog[0] && opts.catalog[0].channels) || {};
    return {
      status: status,
      score: top,
      reasons: reasons.slice(0, 3),
      matches: matches.slice(0, 6),
      channels: {
        picture: ch.picture || 0,
        motion: ch.motion || 0,
        sound: ch.sound || 0,
        title: ch.title || 0,
        file: ch.file || 0,
      },
      kind: opts.kind || '',
      identity: opts.identity,
      duration: opts.duration,
      frameHashes: opts.frameHashes,
      photoHash: opts.photoHash || '',
      audioHash: opts.audioHash || '',
      dna: opts.dna || '',
    };
  }

  async function runOriginScan(file, title, description, durationHint){
    const identityP = fileIdentity(file);
    const mediaP = sampleFrameHashes(file, durationHint || 0);
    const catalogP = loadCatalogMarks();
    const identity = await identityP;
    const frames = await mediaP;
    const catalog = await catalogP;
    const mark = {
      identity: identity,
      duration: frames.duration,
      frameHashes: frames.hashes,
      photoHash: frames.photoHash || (frames.hashes && frames.hashes[0]) || '',
      audioHash: frames.audioHash || '',
      title: title,
      kind: frames.kind,
      creatorUid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : '',
    };
    mark.dna = makeDna(mark);
    const catalogHits = scoreCatalog(mark, catalog);
    const strongMedia = catalogHits[0] && catalogHits[0].score >= 80 && catalogHits[0].source === 'naluno';
    let web = [];
    let known = [];
    if(!strongMedia && !titleIsGeneric(title)){
      web = await scanOpenWeb(title, description || '');
      known = scoreKnown(title);
    }
    return assemble({
      identity: identity,
      duration: frames.duration,
      frameHashes: frames.hashes,
      photoHash: mark.photoHash,
      audioHash: mark.audioHash,
      dna: mark.dna,
      kind: frames.kind,
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
        frameHashes: (report.frameHashes || []).slice(0, 10),
        photoHash: report.photoHash || '',
        audioHash: report.audioHash || '',
        dna: report.dna || '',
        kind: report.kind || '',
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
  window.originPhotoLikeness = photoLikeness;
  window.originAudioLikeness = audioLikeness;
  window.originSequenceOverlap = sequenceOverlap;
  window.originTitleIsGeneric = titleIsGeneric;
  window.originScoreKnown = scoreKnown;
  window.originScoreCatalog = scoreCatalog;
  window.originFuseChannels = fuseChannels;
  window.originDhashFromCanvas = dHashFromCanvas;
  window.originHashStillImage = hashStillImage;
  window.originHamming = hamming;
  window.originMakeDna = makeDna;
})();

/* OWNERSHIP (strand.js): related Broadcast folders (Strands). */
(function(){
  let myStrands = [];
  let openStrandFolderId = null;

  async function loadMyStrands(){
    myStrands = [];
    if(!fbDb || !currentUser) return myStrands;
    try{
      const snap = await fbDb.collection('strands').where('creatorUid', '==', currentUser.uid).limit(40).get();
      myStrands = snap.docs.map(function(d){ return { id: d.id, ...(d.data() || {}) }; })
        .sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); });
    }catch(e){ console.warn('[strand] load', e); }
    return myStrands;
  }

  async function ensureStrand(name, tags){
    if(!fbDb || !currentUser) return null;
    const n = String(name || '').trim().slice(0, 48);
    if(!n) return null;
    const existing = (myStrands || []).find(function(s){ return String(s.name || '').toLowerCase() === n.toLowerCase(); });
    if(existing) return existing;
    const ref = fbDb.collection('strands').doc();
    const doc = {
      creatorUid: currentUser.uid,
      creatorName: (currentProfile && currentProfile.name) || currentUser.displayName || 'Someone',
      name: n,
      tags: (tags || []).slice(0, 8),
      createdAt: Date.now(),
    };
    await ref.set(doc);
    const full = { id: ref.id, ...doc };
    myStrands = [full].concat(myStrands);
    return full;
  }

  function fillStrandSelect(sel){
    if(!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">New Strand</option>' + (myStrands || []).map(function(s){
      return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
    if(cur) sel.value = cur;
  }

  async function relatedBroadcasts(b){
    const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    if(!b) return { items: [], label: 'Related Broadcasts', foreign: false };
    if(b.strandId){
      // FIX: sorted oldest→newest (upload order) so "the next one after this"
      // really means "the next episode uploaded", not whatever order the feed
      // pool happened to be in (which is newest-first).
      const same = pool.filter(function(x){ return x.strandId === b.strandId && x.id !== b.id && !x.deleted; })
        .sort(function(x,y){ return (Number(x.createdAt)||0) - (Number(y.createdAt)||0); });
      if(same.length){
        return { items: same.slice(0, 8), label: 'Strand · ' + (b.strandName || 'this Strand'), foreign: false };
      }
    }
    const tags = (b.tags || []).map(function(t){ return String(t).toLowerCase(); });
    let best = null, bestScore = 0;
    pool.forEach(function(x){
      if(!x.strandId || x.creatorUid === b.creatorUid || x.id === b.id) return;
      const overlap = (x.tags || []).filter(function(t){ return tags.indexOf(String(t).toLowerCase()) >= 0; }).length;
      if(overlap > bestScore){ bestScore = overlap; best = x; }
    });
    if(best){
      const peers = pool.filter(function(x){ return x.strandId === best.strandId && !x.deleted; }).slice(0, 8);
      return {
        items: peers,
        label: 'Another Strand · ' + (best.strandName || 'related') + ' · ' + (best.creatorName || 'Someone'),
        foreign: true,
      };
    }
    return {
      items: pool.filter(function(x){ return x.id !== b.id && !x.deleted; }).slice(0, 6),
      label: 'Nearby Broadcasts',
      foreign: true,
    };
  }

  async function attachBroadcastToStrand(broadcastId, strandId, strandName){
    if(!fbDb || !currentUser || !broadcastId) return null;
    let strand = null;
    if(strandId){
      strand = (myStrands || []).find(function(s){ return s.id === strandId; }) || { id: strandId, name: strandName || 'Strand' };
    } else if(strandName){
      strand = await ensureStrand(strandName);
    }
    if(!strand || !strand.id) return null;
    await fbDb.collection('broadcasts').doc(broadcastId).set({
      strandId: strand.id,
      strandName: strand.name,
      updatedAt: Date.now(),
    }, { merge: true });
    try{
      await fbDb.collection('strands').doc(strand.id).set({
        broadcastIds: firebase.firestore.FieldValue.arrayUnion(broadcastId),
        updatedAt: Date.now(),
      }, { merge: true });
    }catch(_){}
    try{
      const list = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
      list.forEach(function(b){
        if(b.id === broadcastId){ b.strandId = strand.id; b.strandName = strand.name; }
      });
      (typeof myBroadcasts !== 'undefined' && myBroadcasts || []).forEach(function(b){
        if(b.id === broadcastId){ b.strandId = strand.id; b.strandName = strand.name; }
      });
    }catch(_){}
    return strand;
  }

  /* ---- Broadcast-tab folders ----
     Entry shows one folder per Strand. Only Broadcasts with no strandId
     stay free as their own plate. Opening a folder lists what sits inside. */
  function groupBroadcastsForEntry(list){
    const folders = {};
    const free = [];
    (list || []).forEach(function(b){
      if(!b || b.deleted) return;
      const sid = b.strandId;
      if(sid){
        if(!folders[sid]){
          folders[sid] = {
            strandId: sid,
            strandName: b.strandName || 'Strand',
            creatorName: b.creatorName || 'Someone',
            creatorUid: b.creatorUid,
            items: [],
            latestAt: 0,
            live: false,
          };
        }
        const f = folders[sid];
        f.items.push(b);
        if(b.strandName) f.strandName = b.strandName;
        const ts = Number(b.createdAt) || 0;
        if(ts >= f.latestAt){
          f.latestAt = ts;
          f.creatorName = b.creatorName || f.creatorName;
        }
        if(b.live) f.live = true;
      } else {
        free.push(b);
      }
    });
    const folderList = Object.keys(folders).map(function(k){
      const f = folders[k];
      f.items.sort(function(a,b){ return (Number(a.createdAt)||0) - (Number(b.createdAt)||0); });
      return f;
    });
    return { folders: folderList, free: free };
  }

  function broadcastPreviewSrc(b){
    if(!b || b.live) return '';
    if(b.mediaType === 'photo') return '';
    return b.mediaUrl || b.videoUrl || (b.chapters && b.chapters[0] && b.chapters[0].mediaUrl) || '';
  }
  function broadcastPosterSrc(b){
    if(!b) return '';
    return b.thumbUrl || ((b.mediaType === 'photo') ? (b.mediaUrl || '') : '') || '';
  }

  function strandFolderHtml(f){
    const items = (f.items || []).slice();
    const n = items.length;
    const first = items[0] || null;
    const poster = broadcastPosterSrc(first);
    const preview = broadcastPreviewSrc(first);
    const rest = items.slice(1, 5);
    const rail = rest.map(function(b, i){
      const thumb = broadcastPosterSrc(b);
      const label = 'E' + (i + 2);
      if(thumb){
        return '<div class="strand-rail-tile"><img src="' + escapeHtml(thumb) + '" alt="" /><span>' + label + '</span></div>';
      }
      const ch = escapeHtml(String((b.creatorName || '?')).slice(0,1).toUpperCase());
      return '<div class="strand-rail-tile strand-rail-fallback">' + ch + '<span>' + label + '</span></div>';
    }).join('');
    const live = f.live ? '<span class="bcast-plate-live">LIVE</span>' : '';
    const count = n === 1 ? '1 part' : (n + ' parts');
    const creator = escapeHtml(String(f.creatorName || 'Someone').split(' ')[0]);
    const name = escapeHtml(String(f.strandName || 'Strand').slice(0, 48));
    const hero = (preview
      ? '<video class="strand-preview" muted playsinline webkit-playsinline loop preload="none" poster="' + escapeHtml(poster) + '" data-preview-src="' + escapeHtml(preview) + '" data-naluno-preview="1"></video>'
      : (poster
        ? '<img src="' + escapeHtml(poster) + '" alt="" class="bcast-plate-media strand-poster" />'
        : '<div class="bcast-plate-fallback">' + escapeHtml(String((f.creatorName || '?')).slice(0,1).toUpperCase()) + '</div>'))
      + (poster && preview ? '<img src="' + escapeHtml(poster) + '" alt="" class="strand-poster" />' : '');
    return '<article class="bcast-plate bcast-folder bcast-strand-entry' + (rail ? ' has-rail' : '') + '" data-strand-id="' + escapeHtml(f.strandId) + '" role="button" tabindex="0">'
      + '<div class="bcast-plate-frame bcast-strand-stage">'
      +   '<div class="strand-hero">' + hero + '</div>'
      +   (rail ? '<div class="strand-rail" aria-hidden="true">' + rail + '</div>' : '')
      +   '<span class="strand-kicker">Strand · ' + count + '</span>'
      +   live
      +   '<span class="strand-playhint" aria-hidden="true">▶</span>'
      +   '<div class="bcast-plate-scan"></div>'
      + '</div>'
      + '<div class="bcast-plate-meta">'
      +   '<div class="bcast-plate-title">' + name + '</div>'
      +   '<div class="bcast-plate-sub">' + creator + ' · first episode preview</div>'
      + '</div>'
      + '</article>';
  }

  let __strandPreviewIO = null;
  let __strandPreviewActive = null;

  function pauseStrandPreview(video){
    if(!video) return;
    try{ video.pause(); }catch(_){}
    if(__strandPreviewActive === video) __strandPreviewActive = null;
  }
  function pauseAllStrandPreviews(root){
    const scope = root || document;
    try{
      scope.querySelectorAll('video[data-naluno-preview="1"]').forEach(pauseStrandPreview);
    }catch(_){}
    __strandPreviewActive = null;
  }
  function playStrandPreview(video){
    if(!video) return;
    try{
      const bs = document.getElementById('bspace');
      if(bs && bs.classList.contains('active')) return;
      const bv = document.getElementById('bviewer');
      if(bv && bv.classList.contains('active')) return;
    }catch(_){}
    const src = video.getAttribute('data-preview-src') || '';
    if(!src) return;
    if(__strandPreviewActive && __strandPreviewActive !== video){
      pauseStrandPreview(__strandPreviewActive);
    }
    try{
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.loop = true;
      video.controls = false;
      video.disableRemotePlayback = true;
    }catch(_){}
    if(video.getAttribute('src') !== src){
      try{ video.src = src; }catch(_){}
    }
    if(video.paused){
      const p = video.play();
      if(p && p.catch) p.catch(function(){});
    }
    __strandPreviewActive = video;
    if(typeof lockOutChromeMediaSession === 'function'){
      try{ lockOutChromeMediaSession(); }catch(_){}
    }
  }
  function armStrandPreviews(grid){
    if(!grid) return;
    if(__strandPreviewIO){
      try{ __strandPreviewIO.disconnect(); }catch(_){}
      __strandPreviewIO = null;
    }
    const videos = grid.querySelectorAll('video[data-naluno-preview="1"]');
    if(!videos.length) return;
    if(typeof IntersectionObserver === 'undefined'){
      if(videos[0]) playStrandPreview(videos[0]);
      return;
    }
    const scroller = document.getElementById('broadcastTabScroll');
    const root = (scroller && scroller.clientHeight > 40) ? scroller : null;
    __strandPreviewIO = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        en.target.__nalunoRatio = en.intersectionRatio;
        en.target.__nalunoOn = en.isIntersecting;
      });
      let best = (__strandPreviewActive && __strandPreviewActive.__nalunoOn)
        ? __strandPreviewActive
        : null;
      let bestRatio = best ? Math.max(0.28, (best.__nalunoRatio || 0) + 0.12) : 0.4;
      videos.forEach(function(v){
        const r = v.__nalunoRatio || 0;
        if(v.__nalunoOn && r > bestRatio){
          best = v;
          bestRatio = r;
        }
      });
      videos.forEach(function(v){
        if(v === best) playStrandPreview(v);
        else if(v === __strandPreviewActive) pauseStrandPreview(v);
      });
    }, { root: root, threshold: [0.25, 0.55, 0.75, 0.9] });
    videos.forEach(function(v){ __strandPreviewIO.observe(v); });
  }

  function bindBroadcastEntryClicks(grid){
    if(!grid) return;
    grid.querySelectorAll('[data-strand-id]').forEach(function(el){
      el.onclick = function(e){
        if(e){ e.preventDefault(); e.stopPropagation(); }
        openStrandFolder(el.getAttribute('data-strand-id'));
      };
    });
    grid.querySelectorAll('[data-broadcast-id]').forEach(function(el){
      el.onclick = function(){
        if(typeof openBroadcastById === 'function') openBroadcastById(el.getAttribute('data-broadcast-id'));
      };
    });
  }

  function plateHtml(b){
    if(typeof broadcastThumbHtml === 'function') return broadcastThumbHtml(b);
    return '<article class="bcast-plate" data-broadcast-id="' + escapeHtml(b.id) + '" role="button" tabindex="0">'
      + '<div class="bcast-plate-meta"><div class="bcast-plate-title">' + escapeHtml(b.title || 'Broadcast') + '</div></div></article>';
  }

  function renderBroadcastEntryGrid(grid, empty, list){
    if(!grid) return;
    const raw = (list || []).filter(function(b){ return b && !b.deleted; });
    const bar = (typeof $ === 'function') ? $('bcastStrandBar') : document.getElementById('bcastStrandBar');
    const grouped = groupBroadcastsForEntry(raw);

    if(openStrandFolderId){
      const f = grouped.folders.find(function(x){ return x.strandId === openStrandFolderId; });
      if(f && f.items && f.items.length){
        if(empty) empty.style.display = 'none';
        try{ document.body.classList.add('naluno-strand-open'); }catch(_){}
        if(bar){
          bar.style.display = 'flex';
          const t = (typeof $ === 'function') ? $('bcastStrandTitle') : document.getElementById('bcastStrandTitle');
          const s = (typeof $ === 'function') ? $('bcastStrandSub') : document.getElementById('bcastStrandSub');
          if(t) t.textContent = f.strandName || 'Strand';
          if(s) s.textContent = String(f.creatorName || '').split(' ')[0]
            + ' · ' + (f.items.length === 1 ? '1 Broadcast' : (f.items.length + ' Broadcasts'));
        }
        grid.innerHTML = f.items.map(plateHtml).join('');
        bindBroadcastEntryClicks(grid);
        pauseAllStrandPreviews(grid);
        try{ if(typeof nalunoRevealBroadcastPlates === 'function') nalunoRevealBroadcastPlates(grid); }catch(_){}
        try{ armStrandPreviews(grid); }catch(_){}
        return;
      }
      openStrandFolderId = null;
    }

    try{ document.body.classList.remove('naluno-strand-open'); }catch(_){}
    if(bar) bar.style.display = 'none';
    if(!raw.length){
      grid.innerHTML = '';
      if(empty) empty.style.display = 'block';
      return;
    }
    if(empty) empty.style.display = 'none';

    const cards = [];
    grouped.folders.forEach(function(f){
      cards.push({ ts: f.latestAt || 0, html: strandFolderHtml(f) });
    });
    grouped.free.forEach(function(b){
      cards.push({ ts: Number(b.createdAt) || 0, html: plateHtml(b) });
    });
    cards.sort(function(a,b){ return (b.ts || 0) - (a.ts || 0); });
    grid.innerHTML = cards.map(function(c){ return c.html; }).join('');
    bindBroadcastEntryClicks(grid);
    try{ if(typeof nalunoRevealBroadcastPlates === 'function') nalunoRevealBroadcastPlates(grid); }catch(_){}
    try{ armStrandPreviews(grid); }catch(_){}
  }

  function openStrandFolder(id){
    pauseAllStrandPreviews();
    openStrandFolderId = id || null;
    try{ document.body.classList.toggle('naluno-strand-open', !!openStrandFolderId); }catch(_){}
    if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  }
  function closeStrandFolder(){
    openStrandFolderId = null;
    try{ document.body.classList.remove('naluno-strand-open'); }catch(_){}
    if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  }

  function wireStrandFolderUi(){
    const back = (typeof $ === 'function') ? $('bcastStrandBack') : document.getElementById('bcastStrandBack');
    if(back) back.onclick = function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      closeStrandFolder();
    };
    const shareBtn = (typeof $ === 'function') ? $('bcastStrandShareBtn') : document.getElementById('bcastStrandShareBtn');
    if(shareBtn) shareBtn.onclick = async function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      if(!openStrandFolderId) return;
      const link = (typeof strandShareUrl === 'function')
        ? strandShareUrl(openStrandFolderId)
        : (location.origin + '/?strand=' + openStrandFolderId);
      const titleEl = (typeof $ === 'function') ? $('bcastStrandTitle') : document.getElementById('bcastStrandTitle');
      const name = (titleEl && titleEl.textContent) || 'Strand';
      try{
        if(navigator.share){
          await navigator.share({ title: name, text: 'Watch on Naluno', url: link });
        } else if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(link);
          if(typeof toast === 'function') toast('Link copied');
        } else if(typeof toast === 'function') toast(link);
      }catch(err){
        if(err && err.name !== 'AbortError' && typeof toast === 'function') toast(link);
      }
    };
  }
  try{ wireStrandFolderUi(); }catch(_){}

  window.loadMyStrands = loadMyStrands;
  window.ensureStrand = ensureStrand;
  window.fillStrandSelect = fillStrandSelect;
  window.relatedBroadcasts = relatedBroadcasts;
  window.attachBroadcastToStrand = attachBroadcastToStrand;
  window.getMyStrands = function(){ return myStrands; };
  window.groupBroadcastsForEntry = groupBroadcastsForEntry;
  window.renderBroadcastEntryGrid = renderBroadcastEntryGrid;
  window.openStrandFolder = openStrandFolder;
  window.closeStrandFolder = closeStrandFolder;
  window.pauseAllStrandPreviews = pauseAllStrandPreviews;
  window.getOpenStrandFolderId = function(){ return openStrandFolderId; };
})();

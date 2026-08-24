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
      const same = pool.filter(function(x){ return x.strandId === b.strandId && x.id !== b.id && !x.deleted; });
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
      f.items.sort(function(a,b){ return (Number(b.createdAt)||0) - (Number(a.createdAt)||0); });
      return f;
    });
    return { folders: folderList, free: free };
  }

  function strandFolderHtml(f){
    const n = (f.items || []).length;
    const tiles = (f.items || []).slice(0, 4).map(function(b){
      const thumb = b.thumbUrl || ((b.mediaType === 'photo') ? (b.mediaUrl || '') : '');
      if(thumb){
        return '<img src="' + escapeHtml(thumb) + '" alt="" class="bcast-folder-tile" loading="lazy" />';
      }
      const ch = escapeHtml(String((b.creatorName || '?')).slice(0,1).toUpperCase());
      return '<div class="bcast-folder-tile bcast-folder-tile-fallback">' + ch + '</div>';
    }).join('');
    const live = f.live ? '<span class="bcast-plate-live">LIVE</span>' : '';
    const count = n === 1 ? '1 inside' : (n + ' inside');
    const creator = escapeHtml(String(f.creatorName || 'Someone').split(' ')[0]);
    const name = escapeHtml(String(f.strandName || 'Strand').slice(0, 48));
    return '<article class="bcast-plate bcast-folder" data-strand-id="' + escapeHtml(f.strandId) + '" role="button" tabindex="0">'
      + '<div class="bcast-plate-frame">'
      +   '<div class="bcast-folder-tab" aria-hidden="true">'
      +     '<svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 8c2-4 4-6 6-6s4 2 6 6" stroke="#7CFFB2" stroke-width="1.5" stroke-linecap="round"/></svg>'
      +   '</div>'
      +   '<div class="bcast-folder-body">'
      +     '<div class="bcast-folder-mosaic n' + Math.min(n, 4) + '">' + tiles + '</div>'
      +     live
      +     '<span class="bcast-folder-count">' + n + '</span>'
      +     '<div class="bcast-plate-scan"></div>'
      +   '</div>'
      + '</div>'
      + '<div class="bcast-plate-meta">'
      +   '<div class="bcast-plate-title">' + name + '</div>'
      +   '<div class="bcast-plate-sub">' + creator + ' · ' + count + '</div>'
      + '</div>'
      + '</article>';
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
        return;
      }
      openStrandFolderId = null;
    }

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
  }

  function openStrandFolder(id){
    openStrandFolderId = id || null;
    if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  }
  function closeStrandFolder(){
    openStrandFolderId = null;
    if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  }

  function wireStrandFolderUi(){
    const back = (typeof $ === 'function') ? $('bcastStrandBack') : document.getElementById('bcastStrandBack');
    if(back) back.onclick = function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      closeStrandFolder();
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
  window.getOpenStrandFolderId = function(){ return openStrandFolderId; };
})();

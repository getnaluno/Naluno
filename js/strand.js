/* OWNERSHIP (strand.js): related Broadcast folders (Strands). */
(function(){
  let myStrands = [];

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

  window.loadMyStrands = loadMyStrands;
  window.ensureStrand = ensureStrand;
  window.fillStrandSelect = fillStrandSelect;
  window.relatedBroadcasts = relatedBroadcasts;
  window.getMyStrands = function(){ return myStrands; };
})();

/* ============================================================
   MODULE: js/beacon.js
   Find Naluno — opt-in last-known location for YOUR devices only.
   Never writes another person's position. Never on unless enabled.
   OWNERSHIP: this file.
   ============================================================ */

const FIND_NALUNO_ON_KEY = 'nalunoFindOn';
let findNalunoWatchId = null;
let findNalunoLastWrite = 0;
let findNalunoLastLat = null;
let findNalunoLastLng = null;
let findNalunoUnsub = null;
let findNalunoDevices = [];

function nalunoDeviceId(){
  try{
    let id = localStorage.getItem('nalunoDeviceId');
    if(!id){
      id = 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('nalunoDeviceId', id);
    }
    return id;
  }catch(_){
    return 'd-temp';
  }
}

function nalunoDeviceLabel(){
  const ua = navigator.userAgent || '';
  if(/Android/i.test(ua)) return 'Android';
  if(/iPhone|iPad/i.test(ua)) return 'iPhone';
  if(/Samsung/i.test(ua)) return 'Samsung';
  if(/Windows/i.test(ua)) return 'Windows';
  if(/Mac/i.test(ua)) return 'Mac';
  return 'This device';
}

function findNalunoEnabledLocal(){
  try{ return localStorage.getItem(FIND_NALUNO_ON_KEY) === '1'; }catch(_){ return false; }
}

function setFindNalunoEnabledLocal(on){
  try{ localStorage.setItem(FIND_NALUNO_ON_KEY, on ? '1' : '0'); }catch(_){}
}

function isFindNalunoQuery(text){
  const t = String(text || '').toLowerCase();
  if(!t) return false;
  const aboutDevice = /(naluno|\bphone\b|\bdevice\b|handset|android|iphone|my\s+mobile)/.test(t);
  const aboutFind = /(where|find|locate|track|\bping\b|\bgps\b|coordinate|\bmap\b|stolen|last\s+seen|last\s+place|last\s+known)/.test(t);
  return aboutDevice && aboutFind;
}

async function fetchFindNalunoDevices(){
  if(!fbDb || !currentUser) return findNalunoDevices || [];
  try{
    const snap = await fbDb.collection('users').doc(currentUser.uid).collection('beacons').get();
    findNalunoDevices = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
  }catch(_){}
  return findNalunoDevices || [];
}

async function findNalunoContextText(){
  const devices = await fetchFindNalunoDevices();
  const live = (devices || []).filter(function(d){ return d.lat != null && d.lng != null; });
  if(!live.length) return 'No Find Naluno ping stored yet.';
  live.sort(function(a,b){ return (b.ts||0) - (a.ts||0); });
  const d = live[0];
  let place = d.placeName || '';
  if(!place && typeof lookupPlaceName === 'function') place = await lookupPlaceName(d.lat, d.lng);
  return (d.label || 'Device') + ' last seen ' + formatFindAge(d.ts) +
    (place ? (' at ' + place) : '') +
    ' (' + Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5) + ').';
}

function formatFindAge(ts){
  if(!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if(s < 45) return 'just now';
  if(s < 120) return 'a minute ago';
  if(s < 3600) return Math.round(s / 60) + ' min ago';
  if(s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

function mapsLinks(lat, lng){
  const q = encodeURIComponent(lat + ',' + lng);
  return {
    osm: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng,
    osmEn: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng,
    embed: 'https://www.openstreetmap.org/export/embed.html?bbox=' +
      (lng - 0.012) + ',' + (lat - 0.008) + ',' + (lng + 0.012) + ',' + (lat + 0.008) +
      '&layer=mapnik&marker=' + lat + ',' + lng,
    geo: 'geo:' + lat + ',' + lng + '?q=' + q,
  };
}

const findPlaceCache = {};

function findPlaceCacheKey(lat, lng){
  return Number(lat).toFixed(4) + ',' + Number(lng).toFixed(4);
}

function placeFromNominatim(data){
  if(!data) return '';
  const a = data.address || {};
  const bits = [];
  const locality = a.neighbourhood || a.suburb || a.quarter || a.village || a.town || a.city_district || a.hamlet;
  const city = a.city || a.town || a.municipality || a.county;
  const road = a.road || a.pedestrian;
  if(road) bits.push(road);
  if(locality && locality !== road) bits.push(locality);
  if(city && city !== locality) bits.push(city);
  if(a.state && a.state !== city && a.state !== locality) bits.push(a.state);
  if(a.country) bits.push(a.country);
  return bits.filter(Boolean).join(', ') || (data.display_name || '');
}

async function lookupPlaceName(lat, lng){
  if(lat == null || lng == null) return '';
  const key = findPlaceCacheKey(lat, lng);
  if(findPlaceCache[key]) return findPlaceCache[key];
  try{
    const raw = localStorage.getItem('nalunoPlace:' + key);
    if(raw){ findPlaceCache[key] = raw; return raw; }
  }catch(_){}
  try{
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=16'
      + '&lat=' + encodeURIComponent(lat)
      + '&lon=' + encodeURIComponent(lng)
      + '&accept-language=en';
    const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'Accept': 'application/json' } });
    if(!res.ok) return '';
    const name = placeFromNominatim(await res.json());
    if(name){
      findPlaceCache[key] = name;
      try{ localStorage.setItem('nalunoPlace:' + key, name); }catch(_){}
    }
    return name || '';
  }catch(_){
    return '';
  }
}

async function formatFindNalunoReply(devices){
  let list = devices;
  if(!list || !list.length){
    if(typeof fetchFindNalunoDevices === 'function') list = await fetchFindNalunoDevices();
  }
  const live = (list || []).filter(function(d){ return d.lat != null && d.lng != null; });
  if(!live.length){
    return 'I do not have a ping yet. Turn Find Naluno on under Callsign on that phone and allow location. After it reports once, I will give you the place.';
  }
  live.sort(function(a,b){ return (b.ts||0) - (a.ts||0); });
  const parts = [];
  for(let i = 0; i < live.length; i++){
    const d = live[i];
    let place = d.placeName || '';
    if(!place) place = await lookupPlaceName(d.lat, d.lng);
    const acc = d.accuracy ? (' ±' + Math.round(d.accuracy) + ' m') : '';
    const coords = Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5);
    const link = mapsLinks(d.lat, d.lng).osmEn;
    let block = '';
    if(place) block += place + '\n';
    block += coords + acc + '\n';
    block += 'Seen ' + formatFindAge(d.ts);
    if(d.label) block += ' · ' + d.label;
    block += '\n' + link;
    parts.push(block);
  }
  return parts.join('\n\n');
}

function beaconRef(){
  if(!fbDb || !currentUser) return null;
  return fbDb.collection('users').doc(currentUser.uid).collection('beacons').doc(nalunoDeviceId());
}

async function writeBeaconPing(pos, opts){
  const coords = pos && pos.coords;
  if(!coords) return false;
  const force = !!(opts && opts.force);
  const lat = coords.latitude;
  const lng = coords.longitude;
  const accuracy = coords.accuracy || null;
  const now = Date.now();
  const moved = (findNalunoLastLat == null) ||
    (Math.abs(lat - findNalunoLastLat) + Math.abs(lng - findNalunoLastLng) > 0.0003);
  if(!force && !moved && (now - findNalunoLastWrite) < 80000) return false;
  findNalunoLastLat = lat;
  findNalunoLastLng = lng;
  findNalunoLastWrite = now;
  const ref = beaconRef();
  if(!ref) return false;
  try{
    let placeName = '';
    try{
      placeName = await Promise.race([
        lookupPlaceName(lat, lng),
        new Promise(function(res){ setTimeout(function(){ res(''); }, 2500); })
      ]);
    }catch(_){ placeName = ''; }
    const payload = {
      deviceId: nalunoDeviceId(),
      label: nalunoDeviceLabel(),
      lat, lng, accuracy,
      ts: now,
      enabled: true,
      ua: String(navigator.userAgent || '').slice(0, 140),
    };
    if(placeName) payload.placeName = placeName;
    await ref.set(payload, { merge: true });
    try{ if(typeof renderFindNalunoPanel === 'function') renderFindNalunoPanel(); }catch(_){}
    return true;
  }catch(e){
    console.warn('[find-naluno] ping', e);
    return false;
  }
}

function geoOnce(){
  return new Promise(function(resolve, reject){
    function fail(err){ reject(err || { code: 2 }); }
    if(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Geolocation){
      Capacitor.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy:false, timeout:20000 })
        .then(function(p){ resolve(p); })
        .catch(function(){ webGeo(); });
      return;
    }
    webGeo();
    function webGeo(){
      if(!navigator.geolocation){ fail({ code: 0 }); return; }
      function attempt(opts, fallback){
        navigator.geolocation.getCurrentPosition(resolve, function(err){
          if(fallback) fallback();
          else fail(err);
        }, opts);
      }
      attempt({ enableHighAccuracy:false, timeout:15000, maximumAge:180000 }, function(){
        attempt({ enableHighAccuracy:true, timeout:20000, maximumAge:0 }, null);
      });
    }
  });
}

async function pingThisPhoneNow(){
  if(!currentUser || !fbDb){ toast('Sign in first'); return; }
  if(!navigator.geolocation){ toast('This phone cannot share a place here'); return; }
  if(!findNalunoEnabledLocal()){
    const on = await enableFindNaluno();
    if(!on) return;
  }
  toast('Finding this phone…');
  try{ if(window.NalunoNative && typeof window.NalunoNative.requestFindPermission === 'function') window.NalunoNative.requestFindPermission(); }catch(_){}
  try{ if(window.NalunoNative && typeof window.NalunoNative.pingFindNow === 'function') window.NalunoNative.pingFindNow(); }catch(_){}
  try{
    const pos = await geoOnce();
    const ok = await writeBeaconPing(pos, { force:true });
    try{ if(typeof startNativeFindNaluno === 'function') startNativeFindNaluno(); }catch(_){}
    try{ if(typeof fetchFindNalunoDevices === 'function') await fetchFindNalunoDevices(); }catch(_){}
    try{ renderFindNalunoPanel(); }catch(_){}
    toast(ok ? 'Place updated' : 'Could not save the place — try again');
  }catch(err){
    const code = err && err.code;
    if(code === 1) toast('Allow location, then ping again');
    else if(code === 3) toast('That took too long. Turn on GPS and try again');
    else toast('Could not read this phone’s place');
  }
}


function stopFindNalunoWatch(){
  if(findNalunoWatchId != null && navigator.geolocation){
    try{ navigator.geolocation.clearWatch(findNalunoWatchId); }catch(_){}
  }
  findNalunoWatchId = null;
}

function startFindNalunoWatch(){
  if(!navigator.geolocation){
    toast('This browser cannot share a place');
    return;
  }
  if(findNalunoWatchId != null) return;
  findNalunoWatchId = navigator.geolocation.watchPosition(
    function(pos){ writeBeaconPing(pos); },
    function(err){
      console.warn('[find-naluno] geo', err && err.message);
      if(err && err.code === 1) toast('Location permission is off — Find Naluno cannot ping');
    },
    { enableHighAccuracy: true, maximumAge: 20000, timeout: 25000 }
  );
}

async function enableFindNaluno(){
  if(!currentUser || !fbDb){ toast('Sign in first'); return false; }
  if(!navigator.geolocation){ toast('Location is not available here'); return false; }
  const ok = await new Promise(function(resolve){
    navigator.geolocation.getCurrentPosition(
      function(pos){ writeBeaconPing(pos); resolve(true); },
      function(){ resolve(false); },
      { enableHighAccuracy: true, timeout: 20000 }
    );
  });
  if(!ok){
    toast('Allow location to turn Find Naluno on');
    return false;
  }
  setFindNalunoEnabledLocal(true);
  try{
    await fbDb.collection('users').doc(currentUser.uid).set({ findNalunoEnabled: true }, { merge: true });
  }catch(_){}
  startFindNalunoWatch();
  startNativeFindNaluno();
  syncFindNalunoToggle();
  toast('Find Naluno is on for this phone');
  return true;
}

async function disableFindNaluno(){
  if(currentProfile && currentProfile.compassPasswordHash){
    const entered = prompt('Enter your Compass password to turn Find Naluno off:');
    if(!entered) return;
    try{
      if(typeof sha256Hex === 'function'){
        const hash = await sha256Hex(entered);
        if(hash !== currentProfile.compassPasswordHash){
          toast('Password did not match');
          return;
        }
      }
    }catch(_){}
  } else if(!confirm('Turn off Find Naluno on this phone?')){
    return;
  }
  stopFindNalunoWatch();
  stopNativeFindNaluno();
  setFindNalunoEnabledLocal(false);
  const ref = beaconRef();
  if(ref){
    try{ await ref.set({ enabled: false, ts: Date.now() }, { merge: true }); }catch(_){}
  }
  try{
    if(fbDb && currentUser){
      await fbDb.collection('users').doc(currentUser.uid).set({ findNalunoEnabled: false }, { merge: true });
    }
  }catch(_){}
  syncFindNalunoToggle();
  toast('Find Naluno is off on this phone');
}

function syncFindNalunoToggle(){
  const on = findNalunoEnabledLocal();
  const sw = $('findNalunoToggle');
  if(sw) sw.classList.toggle('on', on);
  const st = $('findNalunoStatus');
  if(st){
    st.textContent = on
      ? (window.NalunoNative
        ? 'On — this phone reports while it is on and online, even if Naluno is closed. Last ping remains if the battery is dead.'
        : 'On — last place is saved. The Android app can keep reporting after you leave the screen.')
      : 'Off — this phone will not report a place.';
  }
}

function startNativeFindNaluno(){
  try{
    if(!window.NalunoNative || typeof window.NalunoNative.startFindNaluno !== 'function') return false;
    if(!currentUser) return false;
    const cfg = (typeof firebaseConfig === 'object' && firebaseConfig) ? firebaseConfig : {};
    window.NalunoNative.startFindNaluno(
      currentUser.uid,
      currentUser.refreshToken || '',
      cfg.apiKey || '',
      cfg.projectId || '',
      nalunoDeviceId(),
      nalunoDeviceLabel()
    );
    return true;
  }catch(_){ return false; }
}
function stopNativeFindNaluno(){
  try{
    if(window.NalunoNative && typeof window.NalunoNative.stopFindNaluno === 'function'){
      window.NalunoNative.stopFindNaluno();
    }
  }catch(_){}
}

function resumeFindNalunoIfEnabled(){
  if(findNalunoEnabledLocal() && currentUser){
    startFindNalunoWatch();
    startNativeFindNaluno();
  }
}

function listenFindNalunoDevices(){
  if(findNalunoUnsub){ try{ findNalunoUnsub(); }catch(_){} findNalunoUnsub = null; }
  if(!fbDb || !currentUser) return;
  findNalunoUnsub = fbDb.collection('users').doc(currentUser.uid).collection('beacons')
    .onSnapshot(function(snap){
      findNalunoDevices = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
      renderFindNalunoPanel();
    }, function(){});
}

function renderFindNalunoPanel(){
  const list = $('findNalunoList');
  const map = $('findNalunoMap');
  if(!list) return;
  const rows = findNalunoDevices.slice().sort((a,b)=> (b.ts||0) - (a.ts||0)).slice(0, 2);
  if(!rows.length){
    list.innerHTML = '<div class="lobby-sub" style="padding:8px 0;">No pings yet. Turn it on below on the phone you want to find later.</div>';
    if(map) map.innerHTML = '';
    return;
  }
  list.innerHTML = rows.map(function(d){
    const has = d.lat != null && d.lng != null;
    const here = d.id === nalunoDeviceId() ? ' · this phone' : '';
    const acc = d.accuracy ? (' ±' + Math.round(d.accuracy) + ' m') : '';
    return '<button type="button" class="contact-row" data-beacon="' + escapeHtml(d.id) + '" style="width:100%;text-align:left;border:1px solid var(--line);margin-bottom:8px;">' +
      '<div class="contact-meta"><div class="contact-name">' + escapeHtml(d.label || 'Device') + here + '</div>' +
      '<div class="contact-sub">' + (has ? (formatFindAge(d.ts) + acc) : 'No place yet') +
      (d.enabled === false ? ' · reporting off' : '') + '</div></div></button>';
  }).join('');
  list.querySelectorAll('[data-beacon]').forEach(function(el){
    el.onclick = function(){ showFindNalunoDevice(el.getAttribute('data-beacon')); };
  });
  showFindNalunoDevice(rows[0].id);
}

function showFindNalunoDevice(id){
  const d = findNalunoDevices.find(function(x){ return x.id === id; });
  const map = $('findNalunoMap');
  const meta = $('findNalunoMeta');
  if(!d || d.lat == null || d.lng == null){
    if(map) map.innerHTML = '<div class="lobby-sub">No map for this device yet.</div>';
    if(meta) meta.textContent = '';
    return;
  }
  const links = mapsLinks(d.lat, d.lng);
  if(map){
    const img = 'https://staticmap.openstreetmap.de/staticmap.php?center=' + d.lat + ',' + d.lng
      + '&zoom=16&size=640x280&maptype=mapnik&markers=' + d.lat + ',' + d.lng + ',red-pushpin';
    map.innerHTML = '<img alt="Last known place" src="' + img +
      '" style="width:100%;height:220px;object-fit:cover;border-radius:14px;background:var(--surface);display:block;" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">' +
      '<div style="display:none;height:220px;border-radius:14px;background:var(--surface);align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--text-dim);font-family:var(--font-mono);font-size:12px;">' +
      Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5) + '<br>Use Open map below</div>';
  }
  const coords = Number(d.lat).toFixed(5) + ', ' + Number(d.lng).toFixed(5);
  function paintMeta(place){
    if(!meta) return;
    const title = place || '';
    meta.innerHTML = '<div style="font-weight:600;color:var(--text);margin-bottom:4px;">' +
      escapeHtml(title || (d.label || 'Device')) + '</div>' +
      escapeHtml(coords) + (d.accuracy ? ' · ±' + Math.round(d.accuracy) + ' m' : '') +
      '<br><a href="' + links.osmEn + '" target="_blank" rel="noopener" style="color:var(--mint);">Open map</a>' +
      ' · <a href="' + links.geo + '" style="color:var(--mint);">Maps app</a>';
  }
  paintMeta(d.placeName);
  if(!d.placeName){
    lookupPlaceName(d.lat, d.lng).then(function(name){ if(name) paintMeta(name); });
  }
}

function goToCompassTab(){
  document.querySelectorAll('.navbtn').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab === 'compass');
  });
  document.querySelectorAll('.tabscreen').forEach(function(s){
    s.classList.toggle('active', s.id === 'tab-compass');
  });
}

function openFindNaluno(){
  goToCompassTab();
  if(typeof compassIsLocked === 'function' && compassIsLocked()){
    toast('Unlock Compass to see Find Naluno');
    if(typeof showCompassLockScreenIfNeeded === 'function') showCompassLockScreenIfNeeded();
    return;
  }
  const panel = $('findNalunoPanel');
  if(panel) panel.classList.add('active');
  syncFindNalunoToggle();
  listenFindNalunoDevices();
  try{ fetchFindNalunoDevices().then(function(){ renderFindNalunoPanel(); }); }catch(_){}
}

function closeFindNaluno(){
  if($('findNalunoPanel')) $('findNalunoPanel').classList.remove('active');
}

function wireFindNalunoUi(){
  if($('findNalunoCloseBtn')) $('findNalunoCloseBtn').onclick = closeFindNaluno;
  if($('compassFindBtn')) $('compassFindBtn').onclick = openFindNaluno;
  if($('findNalunoToggle')){
    $('findNalunoToggle').onclick = function(){
      if(findNalunoEnabledLocal()) disableFindNaluno();
      else enableFindNaluno();
    };
  }
  if($('findNalunoPingBtn')){
    $('findNalunoPingBtn').onclick = function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      pingThisPhoneNow();
    };
    $('findNalunoPingBtn').addEventListener('touchend', function(e){
      e.preventDefault();
      pingThisPhoneNow();
    }, { passive:false });
  }
}

document.addEventListener('visibilitychange', function(){
  if(!document.hidden) resumeFindNalunoIfEnabled();
});
window.addEventListener('online', resumeFindNalunoIfEnabled);

try{ wireFindNalunoUi(); }catch(_){}
try{ resumeFindNalunoIfEnabled(); }catch(_){}

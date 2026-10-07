/* ============================================================
   MODULE: js/find-history.js  (07 Oct d)
   Find Naluno · "Where was I?"

   While Find Naluno is on, each phone also keeps a trail of where it has
   been: a point when it has moved about 100 m, or every half hour when it
   stays put. The trail lives under users/{you}/beaconTrail and only you can
   read it (not even the Naluno desk). Inside Find Naluno, under the map, a
   chip opens a date picker: a day, a month, a year, or any span between two
   moments, with an optional time of day ("August, 6 to 10 pm"). The path
   for that period comes back on a map, with the places you stopped and when.
   You can delete the whole trail at any time.
   ============================================================ */
(function(){
  'use strict';
  var TRAIL = 'beaconTrail';
  var MOVE_DEG = 0.0009;               /* about 100 m */
  var STILL_MS = 30 * 60 * 1000;       /* a point every half hour when still */
  var LAST_KEY = 'nalunoTrailLast';
  var MAX_POINTS = 6000;
  var STOP_RADIUS_M = 150;

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function db(){ try{ return (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null; }catch(_){ return null; } }
  function me(){ try{ return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }catch(_){ return null; } }
  function say(t){ try{ if(typeof toast === 'function') toast(t); }catch(_){} }
  function trailCol(){
    var d = db(), u = me();
    if(!d || !u) return null;
    return d.collection('users').doc(u.uid).collection(TRAIL);
  }
  function deviceId(){ try{ return (typeof nalunoDeviceId === 'function') ? nalunoDeviceId() : 'd-web'; }catch(_){ return 'd-web'; } }
  function safeId(s){ return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'd'; }

  /* ---------- writing the trail ---------- */
  function readLast(){
    try{ return JSON.parse(localStorage.getItem(LAST_KEY) || 'null') || null; }catch(_){ return null; }
  }
  function writeLast(v){ try{ localStorage.setItem(LAST_KEY, JSON.stringify(v)); }catch(_){} }
  /* Should this ping become a trail point? Pure, for tests. */
  function trailWants(last, lat, lng, ts){
    if(!isFinite(lat) || !isFinite(lng) || !isFinite(ts)) return false;
    if(Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    if(!last) return true;
    if(ts <= last.ts) return false;
    var moved = Math.abs(lat - last.lat) + Math.abs(lng - last.lng) >= MOVE_DEG;
    return moved || (ts - last.ts) >= STILL_MS;
  }
  function note(p){
    try{
      if(!p) return false;
      var lat = Number(p.lat), lng = Number(p.lng), ts = Number(p.ts) || Date.now();
      var dev = safeId(p.deviceId || deviceId());
      var lastAll = readLast() || {};
      var last = lastAll[dev] || null;
      if(!trailWants(last, lat, lng, ts)) return false;
      var col = trailCol();
      if(!col) return false;
      lastAll[dev] = { lat: lat, lng: lng, ts: ts };
      writeLast(lastAll);
      var row = {
        deviceId: dev,
        label: String(p.label || 'Device').slice(0, 40),
        lat: lat, lng: lng,
        accuracy: isFinite(Number(p.accuracy)) ? Math.round(Number(p.accuracy)) : null,
        ts: Math.round(ts),
      };
      if(p.placeName) row.placeName = String(p.placeName).slice(0, 160);
      /* The same id the Android service uses, so a point is never doubled. */
      col.doc(dev + '_' + Math.round(ts)).set(row).catch(function(){});
      return true;
    }catch(_){ return false; }
  }

  /* ---------- reading a period ---------- */
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  /* The period asked for, in this phone's local time. Pure, for tests. */
  function periodFor(sel){
    var mode = sel && sel.mode, from = 0, to = 0, label = '';
    var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if(mode === 'day' && sel.day){
      var d = String(sel.day).split('-').map(Number);
      if(d.length === 3 && d[0]){
        from = new Date(d[0], d[1] - 1, d[2]).getTime();
        to = new Date(d[0], d[1] - 1, d[2] + 1).getTime();
        label = new Date(from).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'long', year:'numeric' });
      }
    } else if(mode === 'month' && sel.year && sel.month != null){
      var y = Number(sel.year), m = Number(sel.month);
      from = new Date(y, m, 1).getTime();
      to = new Date(y, m + 1, 1).getTime();
      label = MONTHS[m] + ' ' + y;
    } else if(mode === 'year' && sel.year){
      var yy = Number(sel.year);
      from = new Date(yy, 0, 1).getTime();
      to = new Date(yy + 1, 0, 1).getTime();
      label = String(yy);
    } else if(mode === 'range' && sel.from && sel.to){
      from = new Date(sel.from).getTime();
      to = new Date(sel.to).getTime();
      if(to < from){ var t = from; from = to; to = t; }
      label = fmtWhen(from) + ' to ' + fmtWhen(to);
    }
    if(!isFinite(from) || !isFinite(to) || !from || !to || to <= from) return null;
    var tod = null;
    if(sel.timeFrom && sel.timeTo){
      var a = String(sel.timeFrom).split(':').map(Number), b = String(sel.timeTo).split(':').map(Number);
      if(a.length >= 2 && b.length >= 2 && isFinite(a[0]) && isFinite(b[0])){
        tod = { from: a[0] * 60 + (a[1] || 0), to: b[0] * 60 + (b[1] || 0) };
        label += ', ' + pad(a[0]) + ':' + pad(a[1] || 0) + ' to ' + pad(b[0]) + ':' + pad(b[1] || 0);
      }
    }
    return { from: from, to: to, tod: tod, label: label };
  }
  function inTimeOfDay(ts, tod){
    if(!tod) return true;
    var d = new Date(ts);
    var m = d.getHours() * 60 + d.getMinutes();
    if(tod.from <= tod.to) return m >= tod.from && m < tod.to;
    return m >= tod.from || m < tod.to;   /* e.g. 22:00 to 02:00 */
  }
  function fmtWhen(ts){
    try{
      return new Date(ts).toLocaleString(undefined, { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    }catch(_){ return new Date(ts).toISOString(); }
  }
  function fmtTime(ts){
    try{ return new Date(ts).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' }); }catch(_){ return ''; }
  }
  function fmtDay(ts){
    try{ return new Date(ts).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short', year:'numeric' }); }catch(_){ return ''; }
  }

  async function fetchPeriod(per){
    var col = trailCol();
    if(!col) throw new Error('Sign in to see your history');
    var out = [];
    var lastDoc = null;
    for(var page = 0; page < 8 && out.length < MAX_POINTS; page++){
      var q = col.where('ts', '>=', per.from).where('ts', '<', per.to).orderBy('ts');
      if(lastDoc) q = q.startAfter(lastDoc);
      var snap = await q.limit(1000).get();
      if(!snap || !snap.docs || !snap.docs.length) break;
      snap.docs.forEach(function(doc){
        var d = doc.data() || {};
        if(isFinite(Number(d.lat)) && isFinite(Number(d.lng)) && isFinite(Number(d.ts))) out.push(d);
      });
      lastDoc = snap.docs[snap.docs.length - 1];
      if(snap.docs.length < 1000) break;
    }
    return out.filter(function(p){ return inTimeOfDay(Number(p.ts), per.tod); });
  }

  /* ---------- stops ---------- */
  function metres(a, b){
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  /* Consecutive points within ~150 m are one stop. Pure, for tests. */
  function stopsOf(points){
    var stops = [];
    (points || []).forEach(function(p){
      var cur = stops[stops.length - 1];
      var pt = { lat: Number(p.lat), lng: Number(p.lng) };
      if(cur && cur.deviceId === p.deviceId && metres(cur, pt) <= STOP_RADIUS_M){
        cur.to = Number(p.ts);
        cur.count++;
        if(!cur.placeName && p.placeName) cur.placeName = p.placeName;
      } else {
        stops.push({ lat: pt.lat, lng: pt.lng, from: Number(p.ts), to: Number(p.ts), count: 1,
          deviceId: p.deviceId, label: p.label, placeName: p.placeName || '' });
      }
    });
    return stops;
  }

  /* ---------- the map: OpenStreetMap tiles + the path drawn over them ---------- */
  function proj(lat, lng, z){
    var s = 256 * Math.pow(2, z);
    var sin = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
    return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  function drawMap(box, points, stops){
    if(!box) return;
    var W = Math.max(240, box.clientWidth || 320), H = 260;
    var lats = points.map(function(p){ return Number(p.lat); });
    var lngs = points.map(function(p){ return Number(p.lng); });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var z = 17;
    for(; z > 1; z--){
      var a = proj(maxLat, minLng, z), b = proj(minLat, maxLng, z);
      if((b.x - a.x) <= W - 48 && (b.y - a.y) <= H - 48) break;
    }
    var c1 = proj(maxLat, minLng, z), c2 = proj(minLat, maxLng, z);
    var cx = (c1.x + c2.x) / 2, cy = (c1.y + c2.y) / 2;
    var ox = cx - W / 2, oy = cy - H / 2;
    var n = Math.pow(2, z);
    var tiles = '';
    for(var tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++){
      for(var ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++){
        if(ty < 0 || ty >= n) continue;
        var wx = ((tx % n) + n) % n;
        tiles += '<img alt="" draggable="false" src="https://tile.openstreetmap.org/' + z + '/' + wx + '/' + ty + '.png" style="position:absolute;left:'
          + Math.round(tx * 256 - ox) + 'px;top:' + Math.round(ty * 256 - oy) + 'px;width:256px;height:256px;" onerror="this.style.display=\'none\'">';
      }
    }
    var step = Math.max(1, Math.ceil(points.length / 2500));
    var pts = [];
    for(var i = 0; i < points.length; i += step){
      var q = proj(Number(points[i].lat), Number(points[i].lng), z);
      pts.push((q.x - ox).toFixed(1) + ',' + (q.y - oy).toFixed(1));
    }
    var last = points[points.length - 1];
    var ql = proj(Number(last.lat), Number(last.lng), z);
    pts.push((ql.x - ox).toFixed(1) + ',' + (ql.y - oy).toFixed(1));
    var dots = (stops || []).slice(0, 400).map(function(s, k){
      var q = proj(s.lat, s.lng, z);
      var first = k === 0, end = k === stops.length - 1;
      var r = first || end ? 6 : 4;
      var fill = first ? '#7CFFB2' : (end ? '#FF7AB6' : '#FFFFFF');
      return '<circle cx="' + (q.x - ox).toFixed(1) + '" cy="' + (q.y - oy).toFixed(1) + '" r="' + r + '" fill="' + fill + '" stroke="#0D0F17" stroke-width="2"/>';
    }).join('');
    box.innerHTML = '<div class="trail-map" style="height:' + H + 'px;">' + tiles
      + '<svg class="trail-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
      + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#0D0F17" stroke-opacity=".55" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="url(#trailGrad)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<defs><linearGradient id="trailGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7CFFB2"/><stop offset=".5" stop-color="#6FD3FF"/><stop offset="1" stop-color="#FF7AB6"/></linearGradient></defs>'
      + dots + '</svg>'
      + '<a class="trail-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>';
  }

  /* ---------- the panel ---------- */
  var state = { mode: 'day', open: false, busy: false, device: 'all', points: [], per: null };

  function yearsOptions(sel){
    var now = new Date().getFullYear(), html = '';
    for(var y = now; y >= now - 6; y--) html += '<option value="' + y + '"' + (String(sel) === String(y) ? ' selected' : '') + '>' + y + '</option>';
    return html;
  }
  function monthsOptions(sel){
    var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return names.map(function(n, i){ return '<option value="' + i + '"' + (Number(sel) === i ? ' selected' : '') + '>' + n + '</option>'; }).join('');
  }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowLocal(off){
    var d = new Date(Date.now() + (off || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function paintPicker(){
    var box = $('findHistPicker');
    if(!box) return;
    if(!state.open){ box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    var m = state.mode, now = new Date();
    var fields = '';
    if(m === 'day'){
      fields = '<label class="fh-field"><span>Date</span><input type="date" id="fhDay" max="' + today() + '" value="' + (state.day || today()) + '"></label>';
    } else if(m === 'month'){
      fields = '<label class="fh-field"><span>Month</span><select id="fhMonth">' + monthsOptions(state.month != null ? state.month : now.getMonth()) + '</select></label>'
        + '<label class="fh-field"><span>Year</span><select id="fhYear">' + yearsOptions(state.year || now.getFullYear()) + '</select></label>';
    } else if(m === 'year'){
      fields = '<label class="fh-field"><span>Year</span><select id="fhYear">' + yearsOptions(state.year || now.getFullYear()) + '</select></label>';
    } else {
      fields = '<label class="fh-field"><span>From</span><input type="datetime-local" id="fhFrom" value="' + (state.from || nowLocal(-86400000)) + '"></label>'
        + '<label class="fh-field"><span>To</span><input type="datetime-local" id="fhTo" value="' + (state.to || nowLocal(0)) + '"></label>';
    }
    var tod = state.tod
      ? '<div class="fh-row"><label class="fh-field"><span>From time</span><input type="time" id="fhTimeFrom" value="' + (state.timeFrom || '08:00') + '"></label>'
        + '<label class="fh-field"><span>To time</span><input type="time" id="fhTimeTo" value="' + (state.timeTo || '18:00') + '"></label></div>'
      : '';
    box.innerHTML = '<div class="filter-chip-row fh-modes" role="tablist">'
      + [['day','A day'],['month','A month'],['year','A year'],['range','Between']].map(function(x){
          return '<button type="button" class="filter-chip' + (m === x[0] ? ' active' : '') + '" data-fh-mode="' + x[0] + '">' + x[1] + '</button>';
        }).join('')
      + '<button type="button" class="filter-chip' + (state.tod ? ' active' : '') + '" data-fh-tod="1">' + (state.tod ? 'Any time of day' : '+ Time of day') + '</button>'
      + '</div>'
      + '<div class="fh-row">' + fields + '</div>' + tod
      + '<button type="button" class="save-btn" id="fhShow">Show where I was</button>';
    box.querySelectorAll('[data-fh-mode]').forEach(function(b){
      b.onclick = function(){ keepInputs(); state.mode = b.getAttribute('data-fh-mode'); paintPicker(); };
    });
    var t = box.querySelector('[data-fh-tod]');
    if(t) t.onclick = function(){ keepInputs(); state.tod = !state.tod; paintPicker(); };
    $('fhShow').onclick = function(){ keepInputs(); show(); };
  }
  function keepInputs(){
    var v = function(id){ var el = $(id); return el ? el.value : undefined; };
    if(v('fhDay') !== undefined) state.day = v('fhDay');
    if(v('fhMonth') !== undefined) state.month = Number(v('fhMonth'));
    if(v('fhYear') !== undefined) state.year = Number(v('fhYear'));
    if(v('fhFrom') !== undefined) state.from = v('fhFrom');
    if(v('fhTo') !== undefined) state.to = v('fhTo');
    if(v('fhTimeFrom') !== undefined) state.timeFrom = v('fhTimeFrom');
    if(v('fhTimeTo') !== undefined) state.timeTo = v('fhTimeTo');
  }
  function selection(){
    return {
      mode: state.mode, day: state.day || today(),
      month: state.month != null ? state.month : new Date().getMonth(),
      year: state.year || new Date().getFullYear(),
      from: state.from || nowLocal(-86400000), to: state.to || nowLocal(0),
      timeFrom: state.tod ? (state.timeFrom || '08:00') : '', timeTo: state.tod ? (state.timeTo || '18:00') : '',
    };
  }

  async function show(){
    var out = $('findHistResult');
    if(!out || state.busy) return;
    var per = periodFor(selection());
    if(!per){ out.innerHTML = '<div class="lobby-sub">Pick a date first.</div>'; return; }
    state.busy = true;
    out.innerHTML = '<div class="lobby-sub">Looking for ' + esc(per.label) + '…</div>';
    try{
      state.points = await fetchPeriod(per);
      state.per = per;
      state.device = 'all';
      paintResult();
    }catch(e){
      out.innerHTML = '<div class="lobby-sub">Could not load your history right now. ' + esc((e && e.message) || '') + '</div>';
    }finally{ state.busy = false; }
  }

  function paintResult(){
    var out = $('findHistResult');
    if(!out) return;
    var per = state.per;
    var all = state.points || [];
    var devices = {};
    all.forEach(function(p){ devices[p.deviceId] = p.label || 'Device'; });
    var ids = Object.keys(devices);
    var pts = state.device === 'all' ? all : all.filter(function(p){ return p.deviceId === state.device; });
    if(!pts.length){
      out.innerHTML = '<div class="fh-empty"><strong>Nothing saved for ' + esc(per ? per.label : 'that time') + '.</strong>'
        + '<span>Your trail is kept only while Find Naluno is on, from the day this version arrived.</span></div>';
      return;
    }
    var stops = stopsOf(pts);
    var devChips = ids.length > 1
      ? '<div class="filter-chip-row">' + ['all'].concat(ids).map(function(id){
          return '<button type="button" class="filter-chip' + (state.device === id ? ' active' : '') + '" data-fh-dev="' + esc(id) + '">' + esc(id === 'all' ? 'All phones' : devices[id]) + '</button>';
        }).join('') + '</div>'
      : '';
    var multiDay = fmtDay(pts[0].ts) !== fmtDay(pts[pts.length - 1].ts);
    var lastDay = '';
    var SHOW = 250;
    var list = stops.slice(0, SHOW).map(function(s, i){
      var dayHead = '';
      if(multiDay){
        var dd = fmtDay(s.from);
        if(dd !== lastDay){ dayHead = '<div class="fh-day">' + esc(dd) + '</div>'; lastDay = dd; }
      }
      var when = fmtTime(s.from) + (s.to - s.from >= 60000 ? ' – ' + fmtTime(s.to) : '');
      var links = (typeof mapsLinks === 'function') ? mapsLinks(s.lat, s.lng) : { osm: 'https://www.openstreetmap.org/?mlat=' + s.lat + '&mlon=' + s.lng };
      return dayHead + '<div class="fh-stop" data-fh-stop="' + i + '">'
        + '<span class="fh-dot' + (i === 0 ? ' first' : (i === stops.length - 1 ? ' last' : '')) + '"></span>'
        + '<div class="fh-stop-text"><div class="fh-place" data-fh-place="' + i + '">' + esc(s.placeName || (s.lat.toFixed(4) + ', ' + s.lng.toFixed(4))) + '</div>'
        + '<div class="fh-when">' + esc(when) + (ids.length > 1 && state.device === 'all' ? ' · ' + esc(s.label || '') : '') + '</div></div>'
        + '<a class="fh-open" href="' + esc(links.osm) + '" target="_blank" rel="noopener">Map</a></div>';
    }).join('');
    out.innerHTML = '<div class="fh-head"><strong>' + esc(per.label) + '</strong><span>'
      + stops.length + (stops.length === 1 ? ' place' : ' places') + ' · ' + esc(fmtWhen(pts[0].ts)) + ' to ' + esc(fmtWhen(pts[pts.length - 1].ts)) + '</span></div>'
      + devChips + '<div id="findHistMap"></div><div class="fh-stops">' + list + '</div>'
      + (stops.length > SHOW ? '<div class="fh-more">Showing the first ' + SHOW + ' of ' + stops.length + ' places. Pick a shorter time to see the rest.</div>' : '');
    out.querySelectorAll('[data-fh-dev]').forEach(function(b){
      b.onclick = function(){ state.device = b.getAttribute('data-fh-dev'); paintResult(); };
    });
    drawMap($('findHistMap'), pts, stops);
    nameStops(stops);
  }
  /* Street names for the first stops, one lookup a second (the map service's rule). */
  function nameStops(stops){
    if(typeof lookupPlaceName !== 'function') return;
    var todo = stops.map(function(s, i){ return { s: s, i: i }; }).filter(function(x){ return !x.s.placeName; }).slice(0, 12);
    var k = 0;
    (function next(){
      if(k >= todo.length) return;
      var x = todo[k++];
      lookupPlaceName(x.s.lat, x.s.lng).then(function(name){
        if(!name) return;
        x.s.placeName = name;
        var el = document.querySelector('[data-fh-place="' + x.i + '"]');
        if(el) el.textContent = name;
      }).catch(function(){}).then(function(){ setTimeout(next, 1100); });
    })();
  }

  async function clearAll(){
    if(!window.confirm('Delete your whole Find Naluno history? This cannot be undone.')) return;
    var col = trailCol();
    if(!col) return;
    var n = 0;
    try{
      for(var round = 0; round < 60; round++){
        var snap = await col.limit(400).get();
        if(!snap || snap.empty) break;
        var batch = db().batch();
        snap.docs.forEach(function(d){ batch.delete(d.ref); });
        await batch.commit();
        n += snap.docs.length;
      }
      writeLast(null);
      state.points = [];
      var out = $('findHistResult');
      if(out) out.innerHTML = '';
      say(n ? 'History deleted' : 'No history to delete');
    }catch(e){ say('Could not delete history: ' + ((e && e.message) || 'try again')); }
  }

  function mount(){
    var panel = $('findNalunoPanel');
    if(!panel || $('findHistBox')) return;
    var anchor = $('findNalunoPingBtn');
    if(!anchor || !anchor.parentNode) return;
    var box = document.createElement('div');
    box.id = 'findHistBox';
    box.className = 'fh-box';
    box.innerHTML = '<div class="filter-chip-row fh-entry">'
      + '<button type="button" class="filter-chip" id="findHistChip"><span aria-hidden="true">◷</span> Where was I?</button>'
      + '</div>'
      + '<div id="findHistPicker" hidden></div>'
      + '<div id="findHistResult"></div>'
      + '<div class="fh-foot">Only you can see this trail. It is saved while Find Naluno is on. '
      + '<button type="button" class="fh-clear" id="findHistClear">Delete history</button></div>';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    $('findHistChip').onclick = function(){
      state.open = !state.open;
      $('findHistChip').classList.toggle('active', state.open);
      paintPicker();
    };
    $('findHistClear').onclick = clearAll;
  }

  window.NalunoFindHistory = {
    note: note, mount: mount, show: show,
    _trailWants: trailWants, _periodFor: periodFor, _stopsOf: stopsOf, _inTimeOfDay: inTimeOfDay, _proj: proj,
  };
  window.nalunoTrailNote = note;
  try{ mount(); }catch(_){}
  document.addEventListener('DOMContentLoaded', function(){ try{ mount(); }catch(_){} });
})();

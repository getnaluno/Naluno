/* ============================================================
   MODULE: js/weather.js
   Live weather strip + Compass weather answers.
   OWNERSHIP: Open-Meteo only (free). Does not touch calls or media.
   Place comes from THIS phone — Find Naluno live ping first, then
   high-accuracy GPS. Never a hardcoded city.
   ============================================================ */

const WEATHER_HIDE_KEY = 'nalunoWeatherHide';
const WEATHER_CACHE_KEY = 'nalunoWeatherCacheV2';
const WEATHER_MIN_FETCH_MS = 45000;
const WEATHER_POLL_MS = 3 * 60 * 1000;
const WEATHER_MOVE_M = 250;
const WEATHER_FRESH_MS = 10 * 60 * 1000;
const WEATHER_WAITING = "Waiting for this phone's place…";
let weatherTimer = null;
let weatherLast = null;
let weatherLastFetchAt = 0;
let weatherFetchInFlight = false;
let weatherLive = null;

function weatherHidden(){
  try{ return localStorage.getItem(WEATHER_HIDE_KEY) === '1'; }catch(_){ return false; }
}
function setWeatherHidden(on){
  try{ localStorage.setItem(WEATHER_HIDE_KEY, on ? '1' : '0'); }catch(_){}
}

function isWeatherQuery(text){
  const t = String(text || '').toLowerCase();
  if(!t) return false;
  return /(weather|temperature|forecast|rain|hot\b|cold\b|humid|windy|how.?s the sky|what.?s it like outside|climate|thunder|storm|drizzle|cloudy|sunny|tonight|tomorrow)/.test(t)
    || /(embeera|enkuba|omusana)/.test(t);
}

function weatherCodeLabel(code){
  const c = Number(code);
  if(c === 0) return 'Clear';
  if(c <= 3) return 'Partly cloudy';
  if(c === 45 || c === 48) return 'Fog';
  if(c >= 51 && c <= 57) return 'Drizzle';
  if(c >= 61 && c <= 67) return 'Rain';
  if(c >= 71 && c <= 77) return 'Snow';
  if(c >= 80 && c <= 82) return 'Showers';
  if(c >= 95) return 'Thunder';
  return 'Mixed skies';
}

function isHardcodedAlAin(lat, lon){
  const la = Number(lat), lo = Number(lon);
  if(!isFinite(la) || !isFinite(lo)) return false;
  return Math.abs(la - 24.2075) < 0.0002 && Math.abs(lo - 55.7447) < 0.0002;
}

function weatherHaversineM(aLat, aLon, bLat, bLon){
  const R = 6371000;
  const toRad = function(d){ return d * Math.PI / 180; };
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function rememberLiveCoords(lat, lon, extra){
  extra = extra || {};
  const la = Number(lat), lo = Number(lon);
  if(!isFinite(la) || !isFinite(lo)) return null;
  if(isHardcodedAlAin(la, lo)) return weatherLive;
  weatherLive = {
    lat: la,
    lon: lo,
    place: extra.place || (weatherLive && weatherLive.place) || '',
    accuracy: extra.accuracy != null ? extra.accuracy : (weatherLive && weatherLive.accuracy),
    ts: extra.ts || Date.now(),
    source: extra.source || 'gps',
  };
  return weatherLive;
}

function coordsFromFind(){
  try{
    if(typeof nalunoLiveCoords === 'function'){
      const c = nalunoLiveCoords();
      if(c && c.lat != null){
        const lon = c.lng != null ? c.lng : c.lon;
        if(isHardcodedAlAin(c.lat, lon)) return null;
        return {
          lat: Number(c.lat),
          lon: Number(lon),
          place: c.place || '',
          accuracy: c.accuracy,
          ts: c.ts || Date.now(),
          source: c.source || 'find',
        };
      }
    }
  }catch(_){}
  try{
    const raw = localStorage.getItem('nalunoLastBeacon');
    if(raw){
      const b = JSON.parse(raw);
      if(b && b.lat != null && b.ts && (Date.now() - b.ts) < WEATHER_FRESH_MS){
        const lon = b.lng != null ? b.lng : b.lon;
        if(isHardcodedAlAin(b.lat, lon)) return null;
        return {
          lat: Number(b.lat),
          lon: Number(lon),
          place: b.place || '',
          accuracy: b.accuracy,
          ts: b.ts,
          source: 'beacon-cache',
        };
      }
    }
  }catch(_){}
  return null;
}

function weatherLine(data){
  if(!data) return WEATHER_WAITING;
  const place = data.place || 'Your area';
  const t = Math.round(data.temp);
  const feel = Math.round(data.feels);
  const wind = Math.round(data.wind);
  return place + ' · ' + weatherCodeLabel(data.code) + ' · ' + t + '°C (feels ' + feel + '°) · wind ' + wind + ' km/h · humidity ' + Math.round(data.humidity) + '%';
}

function placeFromBigDataCloud(j){
  if(!j) return '';
  const city = j.city || '';
  const loc = j.locality || '';
  if(loc && city && loc !== city) return loc + ', ' + city;
  return city || loc || j.principalSubdivision || j.countryName || '';
}

async function weatherPlaceName(lat, lon){
  try{
    if(typeof lookupPlaceName === 'function'){
      const rich = await lookupPlaceName(lat, lon);
      if(rich){
        const first = String(rich).split(',')[0].trim();
        const second = String(rich).split(',')[1];
        if(first && second) return first + ',' + second;
        return first || rich;
      }
    }
  }catch(_){}
  try{
    const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='
      + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&localityLanguage=en';
    const res = await fetch(url);
    if(!res.ok) return '';
    return placeFromBigDataCloud(await res.json());
  }catch(_){ return ''; }
}

function weatherGpsOnce(){
  return new Promise(function(resolve, reject){
    if(!navigator.geolocation){ reject(new Error('no-geo')); return; }
    navigator.geolocation.getCurrentPosition(function(pos){
      resolve(pos);
    }, function(err){
      reject(err || new Error('geo-denied'));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

function weatherCoords(){
  return new Promise(function(resolve, reject){
    const fromFind = coordsFromFind();
    if(fromFind){
      rememberLiveCoords(fromFind.lat, fromFind.lon, fromFind);
      resolve(weatherLive);
      return;
    }
    if(weatherLive && weatherLive.lat && (Date.now() - weatherLive.ts) < WEATHER_FRESH_MS){
      resolve(weatherLive);
      return;
    }
    weatherGpsOnce().then(function(pos){
      rememberLiveCoords(pos.coords.latitude, pos.coords.longitude, {
        accuracy: pos.coords.accuracy, source: 'gps', ts: Date.now(),
      });
      resolve(weatherLive);
    }).catch(function(err){
      reject(err || new Error('geo-denied'));
    });
  });
}

/** Summarise next N hours of precip probability into a short forecast line. */
function summarizeHours(hourly, fromHour, toHour){
  if(!hourly || !hourly.time || !hourly.time.length) return null;
  const times = hourly.time;
  const precip = hourly.precipitation_probability || [];
  const codes = hourly.weather_code || [];
  const temps = hourly.temperature_2m || [];
  let maxP = 0;
  let rainHours = 0;
  let thunder = false;
  let minT = Infinity, maxT = -Infinity;
  let samples = 0;
  const now = Date.now();
  for(let i = 0; i < times.length; i++){
    const t = Date.parse(times[i]);
    if(!isFinite(t)) continue;
    const hFromNow = (t - now) / 3600000;
    if(hFromNow < fromHour || hFromNow > toHour) continue;
    samples++;
    const p = Number(precip[i]);
    if(isFinite(p) && p > maxP) maxP = p;
    if(isFinite(p) && p >= 40) rainHours++;
    const code = Number(codes[i]);
    if(code >= 95) thunder = true;
    const temp = Number(temps[i]);
    if(isFinite(temp)){
      if(temp < minT) minT = temp;
      if(temp > maxT) maxT = temp;
    }
  }
  if(!samples) return null;
  return {
    maxPrecip: Math.round(maxP),
    rainHours: rainHours,
    thunder: thunder,
    minT: isFinite(minT) ? Math.round(minT) : null,
    maxT: isFinite(maxT) ? Math.round(maxT) : null,
    samples: samples,
  };
}

function summarizeMinutely(minutely){
  if(!minutely || !minutely.time || !minutely.time.length) return null;
  const now = Date.now();
  let precip = 0;
  let n = 0;
  for(let i = 0; i < minutely.time.length; i++){
    const t = Date.parse(minutely.time[i]);
    if(!isFinite(t) || t < now - 5 * 60 * 1000 || t > now + 60 * 60 * 1000) continue;
    n++;
    const mm = Number((minutely.precipitation || [])[i] || 0);
    if(isFinite(mm)) precip += mm;
  }
  if(!n) return null;
  return { precipMm: precip, samples: n };
}

function forecastPhrase(summary, label){
  if(!summary) return '';
  const p = summary.maxPrecip;
  let chance;
  if(p < 15) chance = 'very low (under 15%)';
  else if(p < 30) chance = 'low (around ' + p + '%)';
  else if(p < 55) chance = 'moderate (around ' + p + '%)';
  else if(p < 75) chance = 'fairly high (around ' + p + '%)';
  else chance = 'high (around ' + p + '%)';
  let line = 'For ' + label + ', chance of rain looks ' + chance;
  if(summary.thunder) line += ', with a chance of thunder';
  if(summary.minT != null && summary.maxT != null){
    if(summary.minT === summary.maxT) line += '. Temps around ' + summary.minT + '°C';
    else line += '. Temps roughly ' + summary.minT + '–' + summary.maxT + '°C';
  }
  line += '.';
  return line;
}

function weatherNeedsFetch(here, force){
  if(force) return true;
  if(!weatherLast || !weatherLast.ts) return true;
  if((Date.now() - weatherLastFetchAt) < WEATHER_MIN_FETCH_MS) return false;
  if(here && weatherLast.lat != null && weatherLast.lon != null){
    const moved = weatherHaversineM(weatherLast.lat, weatherLast.lon, here.lat, here.lon);
    if(moved > WEATHER_MOVE_M) return true;
  }
  return (Date.now() - weatherLastFetchAt) > WEATHER_POLL_MS;
}

async function fetchWeather(force){
  const here = await weatherCoords();
  if(!here || here.lat == null) throw new Error('no-place');
  if(!force && !weatherNeedsFetch(here, false) && weatherLast) return weatherLast;
  if(weatherFetchInFlight && weatherLast) return weatherLast;
  weatherFetchInFlight = true;
  weatherLastFetchAt = Date.now();
  try{
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(here.lat)
      + '&longitude=' + encodeURIComponent(here.lon)
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
      + '&minutely_15=temperature_2m,precipitation,weather_code'
      + '&hourly=temperature_2m,precipitation_probability,weather_code'
      + '&forecast_days=2'
      + '&timezone=auto';
    const res = await fetch(url);
    if(!res.ok) throw new Error('Weather unavailable');
    const j = await res.json();
    const cur = j.current || {};
    let place = here.place;
    if(!place) place = await weatherPlaceName(here.lat, here.lon);
    const hourly = j.hourly || null;
    const tonight = summarizeHours(hourly, 0, 12);
    const tomorrow = summarizeHours(hourly, 12, 36);
    const minutely = summarizeMinutely(j.minutely_15 || null);
    weatherLast = {
      lat: here.lat,
      lon: here.lon,
      place: place || '',
      accuracy: here.accuracy,
      source: here.source || '',
      temp: cur.temperature_2m,
      feels: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      code: cur.weather_code,
      hourly: hourly,
      tonight: tonight,
      tomorrow: tomorrow,
      minutely: minutely,
      ts: Date.now(),
    };
    try{ localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherLast)); }catch(_){}
    try{
      if(typeof nalunoDiag === 'function'){
        nalunoDiag('weather', (place || 'here') + ' ' + Math.round(cur.temperature_2m) + 'C',
          Number(here.lat).toFixed(5) + ',' + Number(here.lon).toFixed(5) + ' ±' + Math.round(here.accuracy || 0) + 'm');
      }
    }catch(_){}
    return weatherLast;
  } finally {
    weatherFetchInFlight = false;
  }
}

function paintWeatherWaiting(){
  const line = WEATHER_WAITING;
  const a = $('weatherStripA');
  const b = $('weatherStripB');
  if(a) a.textContent = line + '   ·   ';
  if(b) b.textContent = line + '   ·   ';
}

function paintWeatherStrip(data){
  if(!data){ paintWeatherWaiting(); return; }
  const line = weatherLine(data);
  const a = $('weatherStripA');
  const b = $('weatherStripB');
  if(a) a.textContent = line + '   ·   ';
  if(b) b.textContent = line + '   ·   ';
}

function showWeatherStrip(){
  setWeatherHidden(false);
  const el = $('weatherStrip');
  if(el) el.classList.add('on');
  document.body.classList.add('weather-on');
  if(!weatherLast) paintWeatherWaiting();
  refreshWeather().catch(function(){});
}

function hideWeatherStrip(){
  setWeatherHidden(true);
  const el = $('weatherStrip');
  if(el) el.classList.remove('on');
  document.body.classList.remove('weather-on');
}

async function refreshWeather(force){
  try{
    const cached = localStorage.getItem(WEATHER_CACHE_KEY);
    if(cached && !weatherLast){
      const c = JSON.parse(cached);
      if(c && c.lat && !isHardcodedAlAin(c.lat, c.lon) && (Date.now() - (c.ts || 0)) < 30 * 60 * 1000){
        weatherLast = c;
        paintWeatherStrip(weatherLast);
      }
    }
  }catch(_){}
  try{
    const data = await fetchWeather(!!force);
    paintWeatherStrip(data);
  }catch(_){
    if(weatherLast && !isHardcodedAlAin(weatherLast.lat, weatherLast.lon)) paintWeatherStrip(weatherLast);
    else paintWeatherWaiting();
  }
}

function onNalunoLocation(ev){
  const d = (ev && ev.detail) || {};
  if(d.lat == null) return;
  const lon = d.lng != null ? d.lng : d.lon;
  if(lon == null || isHardcodedAlAin(d.lat, lon)) return;
  rememberLiveCoords(d.lat, lon, d);
  const moved = (weatherLast && weatherLast.lat != null)
    ? weatherHaversineM(weatherLast.lat, weatherLast.lon, Number(d.lat), Number(lon))
    : Infinity;
  const age = Date.now() - weatherLastFetchAt;
  if(!weatherLast || moved > WEATHER_MOVE_M || age > WEATHER_MIN_FETCH_MS){
    refreshWeather(moved > WEATHER_MOVE_M).catch(function(){});
  }
}

/**
 * Full Compass answer. Optional queryText steers tonight/tomorrow phrasing.
 * Always includes current + short forecast so the model is never forced to say
 * "I only have current conditions."
 */
async function formatWeatherReply(queryText){
  try{
    const data = await fetchWeather(true);
    const line = weatherLine(data);
    const q = String(queryText || '').toLowerCase();
    const wantsTonight = /(tonight|this evening|later today|rain|thunder|storm|forecast)/.test(q);
    const wantsTomorrow = /(tomorrow|next day|morning)/.test(q);
    const parts = [line];
    if(data.minutely && data.minutely.precipMm > 0.2){
      parts.push('Rain is showing in the next hour at this place.');
    }
    if(data.tonight){
      parts.push(forecastPhrase(data.tonight, 'the next ~12 hours (tonight / later today)'));
    }
    if(wantsTomorrow && data.tomorrow){
      parts.push(forecastPhrase(data.tomorrow, 'tomorrow'));
    } else if(!wantsTonight && data.tomorrow){
      parts.push(forecastPhrase(data.tomorrow, 'tomorrow'));
    }
    const acc = data.accuracy ? (' ±' + Math.round(data.accuracy) + ' m') : '';
    parts.push('Updated just now from this phone' + acc + '.');
    return parts.filter(Boolean).join('\n');
  }catch(_){
    return 'I need this phone’s place first. Turn on location or Find Naluno, then ask again.';
  }
}

/** Compact system-hint for the AI worker — current + tonight precip. */
async function weatherSystemHint(){
  try{
    const data = weatherLast && (Date.now() - weatherLast.ts < 90 * 1000)
      ? weatherLast
      : await fetchWeather(true);
    let hint = weatherLine(data);
    if(data.tonight){
      hint += ' | Tonight rain chance ~' + data.tonight.maxPrecip + '%';
      if(data.tonight.thunder) hint += ' (thunder possible)';
      if(data.tonight.minT != null) hint += ', ' + data.tonight.minT + '–' + (data.tonight.maxT != null ? data.tonight.maxT : data.tonight.minT) + '°C';
    }
    if(data.tomorrow){
      hint += ' | Tomorrow rain chance ~' + data.tomorrow.maxPrecip + '%';
    }
    return hint;
  }catch(_){
    return '';
  }
}

function bindWeatherStrip(){
  const x = $('weatherStripDismiss');
  if(x) x.onclick = function(){ hideWeatherStrip(); };
  const recall = $('compassWeatherBtn');
  if(recall) recall.onclick = function(){ showWeatherStrip(); toast('Weather is back on the strip'); };
  try{ window.addEventListener('naluno-location', onNalunoLocation); }catch(_){}
  if(weatherHidden()){
    hideWeatherStrip();
  } else {
    showWeatherStrip();
  }
  if(weatherTimer) clearInterval(weatherTimer);
  weatherTimer = setInterval(function(){ refreshWeather().catch(function(){}); }, WEATHER_POLL_MS);
}

window.isWeatherQuery = isWeatherQuery;
window.formatWeatherReply = formatWeatherReply;
window.weatherSystemHint = weatherSystemHint;
window.showWeatherStrip = showWeatherStrip;
window.hideWeatherStrip = hideWeatherStrip;
window.weatherCoords = weatherCoords;
window.isHardcodedAlAin = isHardcodedAlAin;
window.weatherHaversineM = weatherHaversineM;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindWeatherStrip);
} else {
  bindWeatherStrip();
}

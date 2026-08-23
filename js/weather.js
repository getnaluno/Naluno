/* ============================================================
   MODULE: js/weather.js
   Live weather strip + Compass weather answers.
   OWNERSHIP: Open-Meteo only (free). Does not touch calls or media.
   Includes hourly precip so Compass can answer "rain tonight" without
   claiming it only has current conditions.
   ============================================================ */

const WEATHER_HIDE_KEY = 'nalunoWeatherHide';
const WEATHER_CACHE_KEY = 'nalunoWeatherCache';
let weatherTimer = null;
let weatherLast = null;

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

function weatherLine(data){
  if(!data) return 'Weather is updating…';
  const place = data.place || 'Your area';
  const t = Math.round(data.temp);
  const feel = Math.round(data.feels);
  const wind = Math.round(data.wind);
  return place + ' · ' + weatherCodeLabel(data.code) + ' · ' + t + '°C (feels ' + feel + '°) · wind ' + wind + ' km/h · humidity ' + Math.round(data.humidity) + '%';
}

async function weatherPlaceName(lat, lon){
  try{
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat)
      + '&lon=' + encodeURIComponent(lon) + '&zoom=12&addressdetails=1&accept-language=en';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const j = await res.json();
    const a = j.address || {};
    return a.city || a.town || a.village || a.suburb || a.state || a.country || '';
  }catch(_){ return ''; }
}

function weatherCoords(){
  return new Promise(function(resolve){
    if(weatherLast && weatherLast.lat){
      resolve({ lat: weatherLast.lat, lon: weatherLast.lon, place: weatherLast.place || '' });
      return;
    }
    const done = function(lat, lon, place){ resolve({ lat: lat, lon: lon, place: place || '' }); };
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(function(pos){
        done(pos.coords.latitude, pos.coords.longitude, '');
      }, function(){
        try{
          const raw = localStorage.getItem('nalunoLastBeacon');
          if(raw){
            const b = JSON.parse(raw);
            if(b && b.lat){ done(b.lat, b.lng || b.lon, b.place || ''); return; }
          }
        }catch(_){}
        done(24.2075, 55.7447, 'Al Ain');
      }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 });
    } else {
      done(24.2075, 55.7447, 'Al Ain');
    }
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

async function fetchWeather(){
  const here = await weatherCoords();
  // Free Open-Meteo: current + next 48h hourly precip/temp/code — no key, no paid tier.
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + here.lat
    + '&longitude=' + here.lon
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
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
  const tonight = summarizeHours(hourly, 0, 12);   // next ~12h
  const tomorrow = summarizeHours(hourly, 12, 36); // ~12–36h window
  weatherLast = {
    lat: here.lat,
    lon: here.lon,
    place: place || '',
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m,
    code: cur.weather_code,
    hourly: hourly,
    tonight: tonight,
    tomorrow: tomorrow,
    ts: Date.now(),
  };
  try{ localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherLast)); }catch(_){}
  return weatherLast;
}

function paintWeatherStrip(data){
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
  refreshWeather().catch(function(){});
}

function hideWeatherStrip(){
  setWeatherHidden(true);
  const el = $('weatherStrip');
  if(el) el.classList.remove('on');
  document.body.classList.remove('weather-on');
}

async function refreshWeather(){
  try{
    const cached = localStorage.getItem(WEATHER_CACHE_KEY);
    if(cached && !weatherLast){
      weatherLast = JSON.parse(cached);
      paintWeatherStrip(weatherLast);
    }
  }catch(_){}
  try{
    const data = await fetchWeather();
    paintWeatherStrip(data);
  }catch(_){
    if(weatherLast) paintWeatherStrip(weatherLast);
  }
}

/**
 * Full Compass answer. Optional queryText steers tonight/tomorrow phrasing.
 * Always includes current + short forecast so the model is never forced to say
 * "I only have current conditions."
 */
async function formatWeatherReply(queryText){
  try{
    const data = weatherLast && (Date.now() - weatherLast.ts < 20 * 60 * 1000)
      ? weatherLast
      : await fetchWeather();
    const line = weatherLine(data);
    const q = String(queryText || '').toLowerCase();
    const wantsTonight = /(tonight|this evening|later today|rain|thunder|storm|forecast)/.test(q);
    const wantsTomorrow = /(tomorrow|next day|morning)/.test(q);
    const parts = [line];
    if(data.tonight){
      parts.push(forecastPhrase(data.tonight, 'the next ~12 hours (tonight / later today)'));
    }
    if(wantsTomorrow && data.tomorrow){
      parts.push(forecastPhrase(data.tomorrow, 'tomorrow'));
    } else if(!wantsTonight && data.tomorrow){
      // Still attach a light tomorrow line when available so Compass has range.
      parts.push(forecastPhrase(data.tomorrow, 'tomorrow'));
    }
    parts.push('Updated just now from your location.');
    return parts.filter(Boolean).join('\n');
  }catch(_){
    return 'I could not read the weather from here. Ask again in a moment.';
  }
}

/** Compact system-hint for the AI worker — current + tonight precip. */
async function weatherSystemHint(){
  try{
    const data = weatherLast && (Date.now() - weatherLast.ts < 20 * 60 * 1000)
      ? weatherLast
      : await fetchWeather();
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
  if(weatherHidden()){
    hideWeatherStrip();
  } else {
    showWeatherStrip();
  }
  if(weatherTimer) clearInterval(weatherTimer);
  weatherTimer = setInterval(function(){ refreshWeather().catch(function(){}); }, 15 * 60 * 1000);
}

window.isWeatherQuery = isWeatherQuery;
window.formatWeatherReply = formatWeatherReply;
window.weatherSystemHint = weatherSystemHint;
window.showWeatherStrip = showWeatherStrip;
window.hideWeatherStrip = hideWeatherStrip;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindWeatherStrip);
} else {
  bindWeatherStrip();
}

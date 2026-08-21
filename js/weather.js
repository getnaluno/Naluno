/* ============================================================
   MODULE: js/weather.js
   Live weather strip + Compass weather answers.
   OWNERSHIP: Open-Meteo only. Does not touch calls or media.
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
  return /(weather|temperature|forecast|rain|hot\b|cold\b|humid|windy|how.?s the sky|what.?s it like outside|climate)/.test(t)
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

async function fetchWeather(){
  const here = await weatherCoords();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + here.lat
    + '&longitude=' + here.lon
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
    + '&timezone=auto';
  const res = await fetch(url);
  if(!res.ok) throw new Error('Weather unavailable');
  const j = await res.json();
  const cur = j.current || {};
  let place = here.place;
  if(!place) place = await weatherPlaceName(here.lat, here.lon);
  weatherLast = {
    lat: here.lat,
    lon: here.lon,
    place: place || '',
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m,
    code: cur.weather_code,
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

async function formatWeatherReply(){
  try{
    const data = weatherLast && (Date.now() - weatherLast.ts < 20 * 60 * 1000)
      ? weatherLast
      : await fetchWeather();
    const line = weatherLine(data);
    return line + '\nUpdated just now from your location.';
  }catch(_){
    return 'I could not read the weather from here. Ask again in a moment.';
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
window.showWeatherStrip = showWeatherStrip;
window.hideWeatherStrip = hideWeatherStrip;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindWeatherStrip);
} else {
  bindWeatherStrip();
}

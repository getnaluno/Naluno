/* ============================================================
   MODULE: js/camera.js
   Camera stream, flip, filters, borders, segmentation, quality
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- CAMERA + GREENROOM ---------------- */
let stream = null, camOn = true, micOn = true, greenroomEnabled = true;
let cameraRequestPending = null; // in-flight getUserMedia promise, so overlapping calls share one request

function stopCameraStream(){
  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream = null;
  }
  [$('camRawVideo'),$('pipRawVideo'),$('incomingSelfVideo'),$('sendRawVideo')].forEach(v=>{ if(v) v.srcObject = null; });
  const badge = $('camQualityBadge'); if(badge) badge.style.display = 'none';
}
/* ---------------- LIVE BORDER PATTERNS ----------------
   Each preset is drawn every frame onto the border canvas — genuinely moving, not a
   static image — confined to a thin frame around the real, unmodified camera feed.

   Depth: a slow virtual camera drifts on a Lissajous path, and every element is offset by
   camera × its own depth (0 = far, 1 = near). Near things move more than far things — that's
   the actual mechanism behind most perceived depth in a 2D scene, and combined with slightly
   dimmer/hazier far layers (atmospheric perspective) it reads as three-dimensional without
   any real geometry. Kept in canvas 2D deliberately — this sits behind a live, masked video
   feed during calls, and that's already the expensive part of the frame. */
function cameraDrift(t){
  return { x: Math.sin(t*0.05)*10, y: Math.cos(t*0.037)*6 };
}
function paintAurora(ctx,w,h,t){
  ctx.fillStyle = '#0D0F17'; ctx.fillRect(0,0,w,h);
  const bands = [
    { color:'124,255,178', speed:.15, amp:.20, phase:0 },
    { color:'0,229,255',   speed:.11, amp:.24, phase:2.1 },
    { color:'124,77,255',  speed:.09, amp:.18, phase:4.3 },
  ];
  bands.forEach(b=>{
    const y = h * (0.32 + b.amp * Math.sin(t*b.speed + b.phase));
    const x = w * (0.5 + 0.12 * Math.cos(t*b.speed*0.7 + b.phase));
    const grad = ctx.createRadialGradient(x,y,0, x,y, w*0.85);
    grad.addColorStop(0, `rgba(${b.color},0.38)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  });
}
function paintIonRain(ctx,w,h,t){
  ctx.fillStyle = '#0A0D16'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = 'rgba(124,255,178,0.5)'; ctx.lineWidth = 1.4;
  for(let i=0;i<36;i++){
    const seed = i*97.31;
    const x = (seed*13) % w;
    const speed = 130 + (seed % 70);
    const len = 22 + (seed % 46);
    const y = ((t*speed + seed*40) % (h+len)) - len;
    ctx.globalAlpha = 0.2 + (i%5)*0.09;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x, y+len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function paintDeepField(ctx,w,h,t){
  ctx.fillStyle = '#05060C'; ctx.fillRect(0,0,w,h);
  const cam = cameraDrift(t);
  for(let i=0;i<64;i++){
    const seed = i*53.7;
    const depth = 0.15 + (seed % 100)/100 * 0.7; // near stars drift and shine more
    const x = (seed*37) % w + cam.x*depth;
    const y = (seed*71) % h + cam.y*depth;
    const twinkle = 0.35 + 0.65*Math.abs(Math.sin(t*(0.5+(i%5)*0.15) + seed));
    ctx.globalAlpha = twinkle * (0.45+depth*0.8);
    ctx.fillStyle = i%7===0 ? '#7CFFB2' : '#EDEFF7';
    ctx.beginPath(); ctx.arc(x,y, (0.4+depth*0.9)*(1+(i%3)*0.4), 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function paintStudioGlow(ctx,w,h,t){
  ctx.fillStyle = '#171A26'; ctx.fillRect(0,0,w,h);
  const pulse = 0.5 + 0.5*Math.sin(t*0.6);
  const g1 = ctx.createRadialGradient(w*0.25,h*0.2,0, w*0.25,h*0.2, w*0.85);
  g1.addColorStop(0, `rgba(255,184,107,${0.35+0.15*pulse})`); g1.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g1; ctx.fillRect(0,0,w,h);
  const g2 = ctx.createRadialGradient(w*0.75,h*0.85,0, w*0.75,h*0.85, w*0.85);
  g2.addColorStop(0, `rgba(255,84,112,${0.25+0.1*(1-pulse)})`); g2.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0,0,w,h);
}
/* Desert Sky — night sky fading to a warm dune horizon, a soft Milky Way band, twinkling
   stars, and a glowing crescent moon. Built off the desert book-cover reference: same
   palette logic (deep navy → violet → ember horizon), same crescent-and-starfield idea,
   redrawn as a live, depth-layered scene rather than a static image. The Milky Way barely
   moves (it's the farthest thing in the frame), stars drift a little by individual depth,
   and there are now two dune ridges — a hazy far one and a darker near one — so the whole
   scene visibly separates into layers as the camera drifts instead of moving as one flat sheet. */
function paintDesertSky(ctx,w,h,t){
  const cam = cameraDrift(t);
  const sky = ctx.createLinearGradient(0,0,0,h);
  sky.addColorStop(0, '#05060F'); sky.addColorStop(0.55, '#1B1440');
  sky.addColorStop(0.78, '#4A2545'); sky.addColorStop(1, '#7A3420');
  ctx.fillStyle = sky; ctx.fillRect(0,0,w,h);

  ctx.save(); ctx.globalAlpha = 0.5;
  for(let i=0;i<14;i++){
    const p = i/13;
    const x = w*(0.15+p*0.55) + cam.x*0.04, y = h*(0.05+p*0.55) + cam.y*0.04;
    const grad = ctx.createRadialGradient(x,y,0, x,y, w*0.28);
    grad.addColorStop(0, 'rgba(150,130,220,0.16)'); grad.addColorStop(1, 'rgba(150,130,220,0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  }
  ctx.restore();

  for(let i=0;i<90;i++){
    const seed = i*53.7;
    const depth = 0.1 + (seed % 100)/100 * 0.45;
    const x = (seed*37) % w + cam.x*depth, y = (seed*71) % (h*0.65) + cam.y*depth;
    const twinkle = 0.3+0.7*Math.abs(Math.sin(t*(0.4+(i%5)*0.12)+seed));
    ctx.globalAlpha = twinkle * (0.55+depth); ctx.fillStyle = '#FFF6E0';
    ctx.beginPath(); ctx.arc(x,y, (0.4+depth*1.2)*(0.5+(i%3)*0.5), 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const moonX = w*0.82 + cam.x*0.06, moonY = h*0.16 + cam.y*0.06, moonR = w*0.09, pulse = 0.85+0.15*Math.sin(t*0.5);
  const glow = ctx.createRadialGradient(moonX,moonY,0, moonX,moonY, moonR*3);
  glow.addColorStop(0, `rgba(255,230,170,${0.35*pulse})`); glow.addColorStop(1, 'rgba(255,230,170,0)');
  ctx.fillStyle = glow; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#FFE9B8';
  ctx.beginPath(); ctx.arc(moonX,moonY,moonR,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(moonX-moonR*0.4, moonY-moonR*0.15, moonR*0.92, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const horizonY = h*0.78;
  const glowGrad = ctx.createLinearGradient(0,horizonY-h*0.12,0,horizonY+h*0.05);
  glowGrad.addColorStop(0, 'rgba(255,140,80,0)'); glowGrad.addColorStop(1, 'rgba(255,140,80,0.35)');
  ctx.fillStyle = glowGrad; ctx.fillRect(0,horizonY-h*0.12,w,h*0.17);

  // far dune ridge — hazier, muted color (atmospheric perspective), gentle parallax
  ctx.fillStyle = 'rgba(46,28,38,0.7)';
  const fx = cam.x*0.35, fy = cam.y*0.35;
  ctx.beginPath();
  ctx.moveTo(fx,h); ctx.lineTo(fx,h*0.83+fy);
  ctx.quadraticCurveTo(w*0.3+fx,h*0.78+fy, w*0.6+fx,h*0.82+fy);
  ctx.quadraticCurveTo(w*0.85+fx,h*0.86+fy, w+fx,h*0.80+fy);
  ctx.lineTo(w+fx,h); ctx.closePath(); ctx.fill();

  // near dune ridge — full contrast, strongest parallax (foreground)
  ctx.fillStyle = '#1A0F14';
  const nx = cam.x*0.95, ny = cam.y*0.95;
  ctx.beginPath();
  ctx.moveTo(nx,h); ctx.lineTo(nx,h*0.90+ny);
  ctx.quadraticCurveTo(w*0.25+nx,h*0.85+ny, w*0.5+nx,h*0.90+ny);
  ctx.quadraticCurveTo(w*0.75+nx,h*0.95+ny, w+nx,h*0.87+ny);
  ctx.lineTo(w+nx,h); ctx.closePath(); ctx.fill();
}
/* Waterfall — falling streaks with real per-drop speed/drift variance, a base mist glow,
   and canyon walls at two depths: a hazy far pair framing the scene, and a darker near
   pair with stronger parallax so the canyon visibly has a front and a back. */
function paintWaterfall(ctx,w,h,t){
  const cam = cameraDrift(t);
  const bg = ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,'#0E2A2E'); bg.addColorStop(1,'#04141A');
  ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);

  // far canyon walls — hazy, minimal parallax
  ctx.fillStyle = 'rgba(6,20,22,0.7)';
  ctx.beginPath(); ctx.moveTo(cam.x*0.2,0); ctx.lineTo(w*0.16+cam.x*0.2,0); ctx.lineTo(w*0.08+cam.x*0.2,h); ctx.lineTo(cam.x*0.2,h); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w+cam.x*0.2,0); ctx.lineTo(w*0.84+cam.x*0.2,0); ctx.lineTo(w*0.92+cam.x*0.2,h); ctx.lineTo(w+cam.x*0.2,h); ctx.closePath(); ctx.fill();

  ctx.strokeStyle = 'rgba(200,240,255,0.55)';
  for(let i=0;i<60;i++){
    const seed = i*61.3;
    const depth = 0.4 + (seed%100)/100*0.5;
    const x = w*0.3 + ((seed*17)%(w*0.4)) + cam.x*depth*0.3;
    const speed = 260 + (seed%140), len = 30 + (seed%60);
    const y = ((t*speed + seed*50) % (h+len)) - len;
    const drift = Math.sin(t*1.2+seed)*4;
    ctx.globalAlpha = (0.25 + (i%5)*0.1) * (0.6+depth*0.5);
    ctx.lineWidth = (1.2 + (i%3)*0.6) * (0.7+depth*0.6);
    ctx.beginPath(); ctx.moveTo(x+drift,y); ctx.lineTo(x+drift*1.3, y+len); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const mist = ctx.createRadialGradient(w*0.5,h,0, w*0.5,h, w*0.7);
  mist.addColorStop(0,'rgba(220,250,255,0.35)'); mist.addColorStop(1,'rgba(220,250,255,0)');
  ctx.fillStyle = mist; ctx.fillRect(0,h*0.72,w,h*0.3);

  // near canyon walls — full contrast, strongest parallax (foreground framing)
  ctx.fillStyle = '#02090C';
  const nx = cam.x*0.9;
  ctx.beginPath(); ctx.moveTo(nx,0); ctx.lineTo(w*0.22+nx,0); ctx.lineTo(w*0.12+nx,h); ctx.lineTo(nx,h); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(w+nx,0); ctx.lineTo(w*0.78+nx,0); ctx.lineTo(w*0.9+nx,h); ctx.lineTo(w+nx,h); ctx.closePath(); ctx.fill();
}
/* Forest Park — layered canopy green, pulsing dapples of light standing in for sun through
   leaves, faint light shafts, and two treelines: a hazy far one (almost still) and a dark
   near one carrying most of the parallax, the way a real treeline separates from its
   background as you move past it. */
function paintForestPark(ctx,w,h,t){
  const cam = cameraDrift(t);
  const bg = ctx.createLinearGradient(0,0,0,h);
  bg.addColorStop(0,'#173620'); bg.addColorStop(1,'#0B1F13');
  ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);

  for(let i=0;i<10;i++){
    const seed = i*41.3;
    const depth = 0.15 + (seed%100)/100*0.4;
    const x = (seed*23)%w + cam.x*depth, y = (seed*59)%(h*0.7) + cam.y*depth;
    const pulse = 0.4+0.5*Math.abs(Math.sin(t*0.3+seed));
    const grad = ctx.createRadialGradient(x,y,0, x,y, w*0.14);
    grad.addColorStop(0, `rgba(230,255,180,${0.20*pulse})`); grad.addColorStop(1, 'rgba(230,255,180,0)');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  }

  ctx.save(); ctx.globalAlpha = 0.10;
  for(let i=0;i<4;i++){
    const rx = w*(0.2+i*0.22) + Math.sin(t*0.2+i)*10 + cam.x*0.15;
    ctx.fillStyle = '#EFFFCE';
    ctx.beginPath();
    ctx.moveTo(rx,0); ctx.lineTo(rx+w*0.09,0); ctx.lineTo(rx-w*0.05,h); ctx.lineTo(rx-w*0.14,h);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // far treeline — hazy, muted, near-still
  ctx.fillStyle = 'rgba(6,26,14,0.65)';
  const fx = cam.x*0.25, fy = cam.y*0.25;
  ctx.beginPath(); ctx.moveTo(fx,h); ctx.lineTo(fx,h*0.66+fy);
  ctx.quadraticCurveTo(w*0.3+fx,h*0.58+fy, w*0.55+fx,h*0.68+fy);
  ctx.quadraticCurveTo(w*0.8+fx,h*0.60+fy, w+fx,h*0.66+fy);
  ctx.lineTo(w+fx,h); ctx.closePath(); ctx.fill();

  // near treeline — full contrast, strongest parallax (foreground)
  ctx.fillStyle = '#04140A';
  const nx = cam.x*0.95, ny = cam.y*0.95;
  ctx.beginPath(); ctx.moveTo(nx,h); ctx.lineTo(nx,h*0.72+ny);
  ctx.quadraticCurveTo(w*0.2+nx,h*0.6+ny, w*0.35+nx,h*0.75+ny);
  ctx.quadraticCurveTo(w*0.55+nx,h*0.62+ny, w*0.7+nx,h*0.78+ny);
  ctx.quadraticCurveTo(w*0.88+nx,h*0.65+ny, w+nx,h*0.74+ny);
  ctx.lineTo(w+nx,h); ctx.closePath(); ctx.fill();
}
/* Scene painters kept for Compass / vibe accents that still reference them. */
const backgroundPresets = {
  none:      { name:'Original', type:'none', painter:null },
  aurora:    { name:'Aurora Drift',  type:'canvas', painter:paintAurora },
  studio:    { name:'Studio Glow',   type:'canvas', painter:paintStudioGlow },
  rain:      { name:'Ion Rain',      type:'canvas', painter:paintIonRain },
  stars:     { name:'Deep Field',    type:'canvas', painter:paintDeepField },
  desert:    { name:'Desert Sky',    type:'canvas', painter:paintDesertSky },
  waterfall: { name:'Waterfall',     type:'canvas', painter:paintWaterfall },
  forest:    { name:'Forest Park',   type:'canvas', painter:paintForestPark },
};

/* ---------------- NALUNO FILTERS ----------------
   Original-to-Naluno looks applied on the composited camera (you + what the other
   person sees). Built from color science + light overlays — no ML cutouts. */
const nalunoFilters = {
  original: {
    name: 'Original',
    css: 'none',
    grade: null,
  },
  signal: {
    name: 'Signal',
    // Brand mint lift in the mids, clean contrast — the Naluno "on-air" look
    css: 'contrast(1.08) saturate(1.12) brightness(1.03)',
    grade: 'signal',
  },
  wireline: {
    name: 'Wireline',
    css: 'contrast(1.14) saturate(0.92) brightness(1.02)',
    grade: 'wireline',
  },
  frequency: {
    name: 'Frequency',
    css: 'contrast(1.1) saturate(1.25) hue-rotate(-8deg)',
    grade: 'frequency',
  },
  nightcall: {
    name: 'Night Call',
    css: 'contrast(1.18) saturate(0.85) brightness(0.92)',
    grade: 'nightcall',
  },
  ambergrid: {
    name: 'Amber Grid',
    css: 'contrast(1.12) saturate(1.15) sepia(0.22) brightness(1.04)',
    grade: 'ambergrid',
  },
  monomint: {
    name: 'Mono Mint',
    css: 'grayscale(1) contrast(1.2) brightness(1.05)',
    grade: 'monomint',
  },
  ionbloom: {
    name: 'Ion Bloom',
    css: 'contrast(1.06) saturate(1.45) brightness(1.08)',
    grade: 'ionbloom',
  },
  ghost: {
    name: 'Ghost Protocol',
    css: 'contrast(0.92) saturate(0.55) brightness(1.12)',
    grade: 'ghost',
  },
  broadcast: {
    name: 'Broadcast',
    css: 'contrast(1.16) saturate(1.05) brightness(1.0)',
    grade: 'broadcast',
  },
  orbit: {
    name: 'Orbit',
    css: 'contrast(1.1) saturate(1.2) hue-rotate(18deg)',
    grade: 'orbit',
  },
  pulse: {
    name: 'Pulse',
    css: 'contrast(1.22) saturate(1.35) brightness(1.05)',
    grade: 'pulse',
  },
  deepfield: {
    name: 'Deep Field',
    css: 'contrast(1.25) saturate(0.7) brightness(0.88)',
    grade: 'deepfield',
  },
  silverline: {
    name: 'Silverline',
    css: 'contrast(1.15) saturate(0.4) brightness(1.06)',
    grade: 'silverline',
  },
  // —— Digital / HD set ——
  retina: {
    name: 'Retina HD',
    css: 'contrast(1.14) saturate(1.08) brightness(1.04)',
    grade: 'retina',
  },
  crisp: {
    name: 'Crisp',
    css: 'contrast(1.28) saturate(1.05) brightness(1.02)',
    grade: 'crisp',
  },
  neon: {
    name: 'Neon Digital',
    css: 'contrast(1.2) saturate(1.55) brightness(1.06) hue-rotate(-12deg)',
    grade: 'neon',
  },
  cyber: {
    name: 'Cyber',
    css: 'contrast(1.22) saturate(1.3) brightness(0.96) hue-rotate(200deg)',
    grade: 'cyber',
  },
  pixel: {
    name: 'Pixel',
    css: 'contrast(1.15) saturate(1.2)',
    grade: 'pixel',
  },
  glitch: {
    name: 'Glitch',
    css: 'contrast(1.18) saturate(1.35)',
    grade: 'glitch',
  },
  holo: {
    name: 'Holo',
    css: 'contrast(1.1) saturate(1.4) brightness(1.05)',
    grade: 'holo',
  },
  matrix: {
    name: 'Matrix',
    css: 'contrast(1.25) saturate(0.3) brightness(0.95) hue-rotate(80deg)',
    grade: 'matrix',
  },
  film: {
    name: 'Film HD',
    css: 'contrast(1.12) saturate(0.88) brightness(1.02) sepia(0.12)',
    grade: 'film',
  },
  cleanhd: {
    name: 'Clean HD',
    css: 'contrast(1.06) saturate(1.02) brightness(1.03)',
    grade: 'cleanhd',
  },
  infrared: {
    name: 'Infrared',
    css: 'contrast(1.3) saturate(0.2) brightness(1.08) hue-rotate(-20deg)',
    grade: 'infrared',
  },
  vapor: {
    name: 'Vapor',
    css: 'contrast(1.08) saturate(1.5) brightness(1.1) hue-rotate(-25deg)',
    grade: 'vapor',
  },
};

let selectedFilterId = 'original';
let selectedBackgroundId = 'none'; // legacy id used by a few non-camera paths
let userPickedBackground = false;
let userPickedFilter = false;

function applyFilterOverlays(ctx, w, h, grade, t){
  if(!grade) return;
  ctx.save();
  // Soft vignette — almost every cinematic grade uses one; keeps faces centered.
  if(grade !== 'original'){
    const vig = ctx.createRadialGradient(w*0.5, h*0.45, Math.min(w,h)*0.25, w*0.5, h*0.5, Math.max(w,h)*0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, grade === 'nightcall' || grade === 'deepfield' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vig;
    ctx.fillRect(0,0,w,h);
  }
  // Per-filter color washes / accents unique to Naluno
  if(grade === 'signal'){
    const g = ctx.createRadialGradient(w*0.5, h*0.35, 0, w*0.5, h*0.35, Math.max(w,h)*0.55);
    g.addColorStop(0, 'rgba(124,255,178,0.10)');
    g.addColorStop(1, 'rgba(124,255,178,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(grade === 'wireline'){
    ctx.fillStyle = 'rgba(0, 40, 55, 0.12)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'frequency'){
    // Subtle dual-tone wash (mint + violet) — reads as "signal interference" without noise
    const a = ctx.createLinearGradient(0,0,w,h);
    a.addColorStop(0, 'rgba(124,255,178,0.07)');
    a.addColorStop(1, 'rgba(124,77,255,0.08)');
    ctx.fillStyle = a; ctx.fillRect(0,0,w,h);
  } else if(grade === 'nightcall'){
    ctx.fillStyle = 'rgba(10, 18, 40, 0.22)';
    ctx.fillRect(0,0,w,h);
    const g = ctx.createRadialGradient(w*0.5, h*0.3, 0, w*0.5, h*0.3, Math.max(w,h)*0.5);
    g.addColorStop(0, 'rgba(0,229,255,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(grade === 'ambergrid'){
    ctx.fillStyle = 'rgba(255, 160, 60, 0.08)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'monomint'){
    // Mint ghosting in the highlights only
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(124,255,178,0.08)';
    ctx.fillRect(0,0,w,h);
    ctx.globalCompositeOperation = 'source-over';
  } else if(grade === 'ionbloom'){
    const g = ctx.createRadialGradient(w*0.5, h*0.4, 0, w*0.5, h*0.4, Math.max(w,h)*0.6);
    g.addColorStop(0, 'rgba(180,240,255,0.12)');
    g.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(grade === 'ghost'){
    ctx.fillStyle = 'rgba(200, 210, 255, 0.10)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'broadcast'){
    // Thin letterbox bars — "on air" framing
    const bar = Math.max(4, Math.round(h * 0.03));
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0,0,w,bar);
    ctx.fillRect(0,h-bar,w,bar);
  } else if(grade === 'orbit'){
    const a = ctx.createLinearGradient(0,0,w,0);
    a.addColorStop(0, 'rgba(124,77,255,0.10)');
    a.addColorStop(0.5, 'rgba(0,0,0,0)');
    a.addColorStop(1, 'rgba(0,229,255,0.10)');
    ctx.fillStyle = a; ctx.fillRect(0,0,w,h);
  } else if(grade === 'pulse'){
    const pulse = 0.06 + 0.04 * Math.sin((t||0) * 2.2);
    ctx.fillStyle = `rgba(124,255,178,${pulse})`;
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'deepfield'){
    ctx.fillStyle = 'rgba(5, 8, 24, 0.28)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'silverline'){
    ctx.fillStyle = 'rgba(180, 190, 210, 0.06)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'retina'){
    // Subtle clarity ring — reads as “HD” without crunching skin
    const g = ctx.createRadialGradient(w*0.5, h*0.4, Math.min(w,h)*0.15, w*0.5, h*0.45, Math.max(w,h)*0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(grade === 'crisp'){
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'neon'){
    const a = ctx.createLinearGradient(0,0,w,h);
    a.addColorStop(0, 'rgba(255,0,180,0.08)');
    a.addColorStop(0.5, 'rgba(0,0,0,0)');
    a.addColorStop(1, 'rgba(0,255,220,0.08)');
    ctx.fillStyle = a; ctx.fillRect(0,0,w,h);
  } else if(grade === 'cyber'){
    // Scanline mesh
    ctx.fillStyle = 'rgba(0, 255, 200, 0.03)';
    for(let y=0; y<h; y+=3) ctx.fillRect(0, y, w, 1);
    const g = ctx.createRadialGradient(w*0.5, h*0.35, 0, w*0.5, h*0.35, Math.max(w,h)*0.55);
    g.addColorStop(0, 'rgba(0,255,180,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(grade === 'pixel'){
    // No extra wash — pixel look is applied in compositeFrame via scale trick
  } else if(grade === 'glitch'){
    // RGB-ish edge flash
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,40,80,0.05)';
    ctx.fillRect(0,0,w*0.5,h);
    ctx.fillStyle = 'rgba(40,200,255,0.05)';
    ctx.fillRect(w*0.5,0,w*0.5,h);
    ctx.globalCompositeOperation = 'source-over';
  } else if(grade === 'holo'){
    const a = ctx.createLinearGradient(0,0,w,h);
    a.addColorStop(0, 'rgba(255,100,200,0.07)');
    a.addColorStop(0.5, 'rgba(100,200,255,0.07)');
    a.addColorStop(1, 'rgba(180,255,120,0.07)');
    ctx.fillStyle = a; ctx.fillRect(0,0,w,h);
  } else if(grade === 'matrix'){
    ctx.fillStyle = 'rgba(0, 40, 0, 0.15)';
    ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'rgba(0, 255, 70, 0.04)';
    for(let y=0; y<h; y+=4) ctx.fillRect(0, y, w, 1);
  } else if(grade === 'film'){
    ctx.fillStyle = 'rgba(40, 30, 15, 0.08)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'cleanhd'){
    // intentionally minimal
  } else if(grade === 'infrared'){
    ctx.fillStyle = 'rgba(80, 0, 20, 0.12)';
    ctx.fillRect(0,0,w,h);
  } else if(grade === 'vapor'){
    const a = ctx.createLinearGradient(0,h,w,0);
    a.addColorStop(0, 'rgba(255,100,180,0.10)');
    a.addColorStop(1, 'rgba(100,180,255,0.10)');
    ctx.fillStyle = a; ctx.fillRect(0,0,w,h);
  }
  ctx.restore();
}

function renderBackgroundChips(){
  // Chips now select Naluno filters (camera looks), not scene borders.
  const html = Object.entries(nalunoFilters).map(([key,p])=>
    `<div class="filter-chip ${selectedFilterId===key?'active':''}" data-filter="${key}">${p.name}</div>`
  ).join('');
  ['lobbyBgChipRow','incallBgChipRow'].forEach(rowId=>{
    const row = $(rowId); if(!row) return;
    row.innerHTML = html;
    row.querySelectorAll('[data-filter]').forEach(el=>{
      el.onclick = ()=> chooseFilter(el.dataset.filter, true);
    });
  });
}
function chooseFilter(id, manual){
  if(!nalunoFilters[id]) return;
  selectedFilterId = id;
  try{ if(typeof refreshOutboundFilterIfInCall === 'function') refreshOutboundFilterIfInCall(); }catch(_){}
  selectedBackgroundId = id === 'original' ? 'none' : id; // keep legacy field roughly in sync
  if(manual){ userPickedFilter = true; userPickedBackground = true; }
  renderBackgroundChips();
  const label = nalunoFilters[id].name;
  if($('greenroomLabel')) $('greenroomLabel').textContent = 'Filter · ' + label;
  if(manual){
    toast(id === 'original' ? 'Original look' : ('Filter · ' + label));
    saveBackgroundChoice();
  }
}
// Back-compat name used by a few call sites
function chooseBackground(id, manual){
  if(id === 'none') return chooseFilter('original', manual);
  if(nalunoFilters[id]) return chooseFilter(id, manual);
  // Old scene ids → map to a sensible filter
  const map = { aurora:'orbit', studio:'signal', rain:'frequency', stars:'deepfield', desert:'ambergrid', waterfall:'ionbloom', forest:'wireline' };
  chooseFilter(map[id] || 'original', manual);
}
function saveBackgroundChoice(){
  try{ localStorage.setItem('naluno:filter', JSON.stringify({ id: selectedFilterId })); }catch(e){}
}
function loadBackgroundChoice(){
  try{
    const saved = localStorage.getItem('naluno:filter') || localStorage.getItem('naluno:background');
    if(saved){
      const data = JSON.parse(saved);
      if(nalunoFilters[data.id]){ selectedFilterId = data.id; userPickedFilter = true; }
      else if(data.id === 'none'){ selectedFilterId = 'original'; }
    }
  }catch(e){ /* no saved choice yet */ }
  renderBackgroundChips();
}
loadBackgroundChoice();

/* ---------------- PERSON SEGMENTATION (true virtual backgrounds) ----------------
   MediaPipe Selfie Segmentation cuts you out of the real room so a live background
   can replace it. Falls back to plain camera if the model fails to load. */
let selfieSeg = null;
let selfieSegLoading = null;
let segMaskCanvas = null;   // refined alpha mask (person = opaque), same orientation as raw video
let segPersonCanvas = null; // layer 2: person cutout
let segAlphaCanvas = null;  // working buffer for mask refinement
let segWorkCanvas = null;   // downscaled frame sent to the model (faster + stabler)
let segProcessing = false;
let segLastTs = 0;
const SEG_MIN_INTERVAL_MS = 50; // ~20fps mask updates
const SEG_PROCESS_MAX = 256;    // model input long edge — sharp enough, much cleaner than full res thrash

function loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    if(document.querySelector('script[src="'+src+'"]')){ resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = ()=> resolve();
    s.onerror = ()=> reject(new Error('Failed to load '+src));
    document.head.appendChild(s);
  });
}

/* Refine a grayscale person-mask into a clean alpha matte:
   - threshold mid values so partial pixels become solid person or solid hole
   - slight expand keeps hair/shoulders
   - light edge feather only (not a whole-mask blur that melts the silhouette) */
function refineMaskToAlpha(srcMask, outCanvas){
  const mw = srcMask.width, mh = srcMask.height;
  if(outCanvas.width !== mw || outCanvas.height !== mh){ outCanvas.width = mw; outCanvas.height = mh; }
  const octx = outCanvas.getContext('2d');
  octx.clearRect(0,0,mw,mh);
  octx.drawImage(srcMask, 0, 0, mw, mh);
  try{
    const img = octx.getImageData(0,0,mw,mh);
    const d = img.data;
    // Pass 1: hard-ish threshold. MediaPipe outputs person≈255, bg≈0 with soft edges.
    for(let i=0;i<d.length;i+=4){
      const v = d[i]; // luminance
      // Bias toward keeping person (helps hair). Soft ramp only near the edge.
      let a;
      if(v >= 160) a = 255;
      else if(v <= 40) a = 0;
      else a = Math.round(((v - 40) / 120) * 255);
      d[i] = 255; d[i+1] = 255; d[i+2] = 255; d[i+3] = a;
    }
    octx.putImageData(img, 0, 0);
    // Pass 2: tiny blur only to feather the cut edge (background-eraser style).
    octx.filter = 'blur(1.2px)';
    octx.drawImage(outCanvas, 0, 0);
    octx.filter = 'none';
  }catch(e){
    // If getImageData is blocked, leave the raw mask drawn.
  }
  return outCanvas;
}

async function ensureSelfieSegmentation(){
  if(selfieSeg) return true;
  if(selfieSegLoading) return selfieSegLoading;
  selfieSegLoading = (async ()=>{
    try{
      await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
      if(typeof SelfieSegmentation === 'undefined') throw new Error('SelfieSegmentation missing');
      const seg = new SelfieSegmentation({
        locateFile: (file)=> 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/'+file,
      });
      // 0 = general (better for close-up selfie / portrait on phones)
      seg.setOptions({ modelSelection: 0, selfie: true });
      seg.onResults((results)=>{
        if(!results || !results.segmentationMask) return;
        if(!segMaskCanvas) segMaskCanvas = document.createElement('canvas');
        if(!segAlphaCanvas) segAlphaCanvas = document.createElement('canvas');
        // Keep a raw copy then refine into alpha matte.
        const raw = segAlphaCanvas;
        const mw = results.segmentationMask.width || (results.image && results.image.width) || 256;
        const mh = results.segmentationMask.height || (results.image && results.image.height) || 256;
        if(raw.width !== mw || raw.height !== mh){ raw.width = mw; raw.height = mh; }
        const rctx = raw.getContext('2d');
        rctx.clearRect(0,0,mw,mh);
        rctx.drawImage(results.segmentationMask, 0, 0, mw, mh);
        refineMaskToAlpha(raw, segMaskCanvas);
        segMaskCanvas._ready = true;
      });
      await seg.initialize();
      selfieSeg = seg;
      console.log('[bg] Selfie segmentation ready');
      return true;
    }catch(e){
      console.warn('[bg] Segmentation unavailable — showing real camera', e);
      selfieSeg = null;
      return false;
    }finally{
      selfieSegLoading = null;
    }
  })();
  return selfieSegLoading;
}
async function tickSegmentation(video){
  if(!video || video.readyState < 2 || !video.videoWidth) return;
  if(selectedBackgroundId === 'none' || !greenroomEnabled) return;
  if(!selfieSeg){
    ensureSelfieSegmentation();
    return;
  }
  const now = performance.now();
  if(segProcessing || (now - segLastTs) < SEG_MIN_INTERVAL_MS) return;
  segProcessing = true;
  segLastTs = now;
  try{
    // Always feed the model an unmirrored, modestly sized frame so the mask
    // lines up 1:1 with the raw video we later draw (mirroring happens only at composite time).
    if(!segWorkCanvas) segWorkCanvas = document.createElement('canvas');
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, SEG_PROCESS_MAX / Math.max(vw, vh));
    const tw = Math.max(2, Math.round(vw * scale));
    const th = Math.max(2, Math.round(vh * scale));
    if(segWorkCanvas.width !== tw || segWorkCanvas.height !== th){
      segWorkCanvas.width = tw; segWorkCanvas.height = th;
    }
    const wctx = segWorkCanvas.getContext('2d');
    wctx.drawImage(video, 0, 0, tw, th);
    await selfieSeg.send({ image: segWorkCanvas });
  }catch(e){
    // One bad frame should not kill the loop.
  }finally{
    segProcessing = false;
  }
}
function drawVideoCover(ctx, video, w, h, mirror){
  if(!video || video.readyState < 2 || !video.videoWidth){
    ctx.fillStyle = '#171A26';
    ctx.fillRect(0,0,w,h);
    return;
  }
  ctx.save();
  if(mirror){ ctx.translate(w,0); ctx.scale(-1,1); }
  const vw = video.videoWidth, vh = video.videoHeight;
  const scale = Math.max(w/vw, h/vh);
  const dw = vw*scale, dh = vh*scale;
  ctx.drawImage(video, (w-dw)/2, (h-dh)/2, dw, dh);
  ctx.restore();
}
/* Two-layer composite:
   Layer 1 (already on ctx): live background scene, full frame
   Layer 2: camera frame with background erased via the alpha matte
   Mask and camera share the same orientation; mirror is applied to BOTH so the cut stays aligned. */
function drawPersonWithMask(ctx, video, maskCanvas, w, h, mirror){
  if(!segPersonCanvas) segPersonCanvas = document.createElement('canvas');
  const pc = segPersonCanvas;
  if(pc.width !== w || pc.height !== h){ pc.width = w; pc.height = h; }
  const pctx = pc.getContext('2d');
  pctx.clearRect(0,0,w,h);

  // Layer 2a — full camera (same cover-fit + mirror as the real-bg path)
  drawVideoCover(pctx, video, w, h, mirror);

  // Layer 2b — background eraser: keep only pixels where the matte is opaque.
  // CRITICAL: apply the same mirror to the mask so it lines up with the mirrored camera.
  pctx.save();
  pctx.globalCompositeOperation = 'destination-in';
  if(mirror){
    pctx.translate(w, 0);
    pctx.scale(-1, 1);
  }
  pctx.drawImage(maskCanvas, 0, 0, w, h);
  pctx.restore();
  pctx.globalCompositeOperation = 'source-over';

  // Stack person on top of the background scene already in ctx.
  ctx.drawImage(pc, 0, 0);
}

/* Keeps a canvas's actual pixel resolution matched to its on-screen size — used by
   the segmentation compositor above and Band's ambient background animation. */
function ensureCanvasSize(canvas){
  // getBoundingClientRect() forces the browser to recompute page layout — genuinely
  // expensive, and this used to run unconditionally on every single animation frame
  // for as long as a call lasted. A canvas's on-screen size essentially never changes
  // frame to frame, so checking twice a second instead of 60 times a second loses
  // nothing visually (the expand toggle still feels instant) while cutting a 30-minute
  // call from roughly 108,000 forced layout passes down to about 3,600.
  const now = performance.now();
  if(canvas._lastSizeCheck && now - canvas._lastSizeCheck < 500) return;
  canvas._lastSizeCheck = now;
  const r = canvas.getBoundingClientRect();
  // The actual cause of the severe blur: this never accounted for the screen's real
  // device pixel ratio, only CSS pixel size. On any modern phone (routinely 2.5-4x),
  // that meant the canvas's internal buffer held far fewer pixels than the screen
  // needed, and the browser stretched it to fill the display — real blur, regardless
  // of how sharp the underlying captured video actually was. Capped at 2x rather than
  // the full device value as a deliberate balance: still a dramatic sharpness fix,
  // without fully reintroducing the per-frame compositing cost that caused the
  // earlier lag by matching the highest device ratios exactly.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if(canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
}
/* ---------------- CAMERA COMPOSITE + NALUNO FILTERS ----------------
   Full-frame camera, then an original Naluno color grade + light overlays.
   What you see is what the other person receives (send canvas uses the same path). */
let camAnimStart = performance.now();
let pipAnimStart = performance.now();
/* Mirror ONLY the true front camera. Prefer the live track's facingMode over our
   toggle variable — after a flip, the variable can briefly disagree with hardware. */
function shouldMirrorCamera(){
  try{
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if(track && track.getSettings){
      const fm = track.getSettings().facingMode;
      if(fm === 'environment' || fm === 'left' || fm === 'right') return false;
      if(fm === 'user' || fm === 'face') return true;
    }
  }catch(e){}
  return cameraFacingMode !== 'environment';
}
function compositeFrame(canvas, video, animStart){
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0,0,w,h);

  const mirror = shouldMirrorCamera();
  const filterId = (greenroomEnabled && selectedFilterId) ? selectedFilterId : 'original';
  const filt = nalunoFilters[filterId] || nalunoFilters.original;

  if(filt.grade === 'pixel'){
    // Pixel look: draw small, scale up with nearest-neighbor
    const pw = Math.max(32, Math.round(w / 8));
    const ph = Math.max(32, Math.round(h / 8));
    if(!compositeFrame._pixel) compositeFrame._pixel = document.createElement('canvas');
    const pc = compositeFrame._pixel;
    if(pc.width !== pw || pc.height !== ph){ pc.width = pw; pc.height = ph; }
    const pctx = pc.getContext('2d');
    pctx.clearRect(0,0,pw,ph);
    if(filt.css && filt.css !== 'none') pctx.filter = filt.css;
    drawVideoCover(pctx, video, pw, ph, mirror);
    pctx.filter = 'none';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pc, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  } else {
    if(filt.css && filt.css !== 'none') ctx.filter = filt.css;
    drawVideoCover(ctx, video, w, h, mirror);
    ctx.filter = 'none';
  }

  if(filt.grade){
    applyFilterOverlays(ctx, w, h, filt.grade, (performance.now() - animStart) / 1000);
  }
  ctx.restore();
}
function drawStage(canvasId, videoId, animStart){
  const canvas = $(canvasId), video = $(videoId);
  if(!canvas || !video) return;
  ensureCanvasSize(canvas);
  compositeFrame(canvas, video, animStart);
}
let sendAnimStart = performance.now();
/* This is what the other person actually sees now — previously the border and glow
   were purely local rendering, visible only on your own screen, while the other
   person received the plain unmodified camera track. Runs continuously the whole time
   a stream exists, independent of which local screen happens to be showing, since the
   other person's view shouldn't blink out just because you're looking at your own
   lobby preview versus the in-call pip. Capped at 960px on the long edge — no point
   encoding and transmitting at full 4K for something only ever watched at a small size. */
function drawSendCanvas(){
  const canvas = $('sendCanvas'), video = $('sendRawVideo');
  if(!canvas || !video) return;
  const vw = video.videoWidth || 720, vh = video.videoHeight || 960;
  const maxDim = 960;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const tw = Math.max(2, Math.round(vw*scale)), th = Math.max(2, Math.round(vh*scale));
  if(canvas.width !== tw || canvas.height !== th){ canvas.width = tw; canvas.height = th; }
  compositeFrame(canvas, video, sendAnimStart);
}
function stageLoopTick(){
  requestAnimationFrame(stageLoopTick);
  if($('lobby').classList.contains('active')) drawStage('camStageCanvas', 'camRawVideo', camAnimStart);
  if($('incall').classList.contains('active')) drawStage('pipStageCanvas', 'pipRawVideo', pipAnimStart);
  if(stream) drawSendCanvas();
}
requestAnimationFrame(stageLoopTick);
function startCamView(target){
  if(target==='lobby'){ camAnimStart = performance.now(); const v = $('camRawVideo'); if(v) v.srcObject = stream; }
  else { pipAnimStart = performance.now(); const v = $('pipRawVideo'); if(v) v.srcObject = stream; }
  const srv = $('sendRawVideo');
  if(srv && stream){ srv.srcObject = stream; try{ srv.play(); }catch(_){}}
}

/* ---------------- CAMERA QUALITY ----------------
   One constraint-and-fallback strategy used everywhere the app opens a camera (calls,
   incoming-call simulation, Band Live). Asks for the best the device can actually give —
   up to 1080p/30fps with clean audio — and steps down through two more permissive attempts
   rather than failing outright if the browser or hardware can't meet the ideal. */
let cameraFacingMode = 'user';
let preferredVideoDeviceId = null;

function buildVideoConstraints(){
  // "ideal" only pulls toward this value — it never exceeds what the hardware actually
  // supports, so a modest front camera still settles at its own real max.
  // 4K was genuinely wasted downstream (nothing renders or sends anywhere near that),
  // but dropping all the way to 1080p traded away real sharpness — likely because many
  // phone camera systems, especially a high-resolution back sensor, use a visibly
  // softer "fast preview" processing path when asked for something well below their
  // native resolution, not just a clean crop of the same quality at fewer pixels.
  // 1440p is a genuine middle ground: still only about 44% of 4K's pixel count (real
  // relief for camera negotiation time and per-frame decode cost, the actual cause of
  // the lag), while sitting close enough to a typical back camera's native resolution
  // to likely still land in its higher-quality processing mode rather than the soft one.
  const base = { width:{ ideal:2560 }, height:{ ideal:1440 }, frameRate:{ ideal:30, max:60 } };
  if(preferredVideoDeviceId) base.deviceId = { exact: preferredVideoDeviceId };
  else base.facingMode = { ideal: cameraFacingMode };
  return base;
}
async function requestHighQualityStream(opts={}){
  const wantVideo = opts.video !== false;
  const wantAudio = opts.audio !== false;
  const audioConstraints = wantAudio ? { echoCancellation:true, noiseSuppression:true, autoGainControl:true } : false;
  const attempts = [
    { video: wantVideo ? buildVideoConstraints() : false, audio: audioConstraints },
    { video: wantVideo ? { facingMode:{ ideal:cameraFacingMode } } : false, audio: wantAudio },
    { video: wantVideo, audio: wantAudio },
  ];
  let lastErr;
  for(const constraints of attempts){
    try{ return await navigator.mediaDevices.getUserMedia(constraints); }
    catch(e){ lastErr = e; }
  }
  throw lastErr;
}
function updateCameraQualityBadge(){
  const badge = $('camQualityBadge'); if(!badge) return;
  const track = stream && stream.getVideoTracks()[0];
  if(!track){ badge.style.display = 'none'; return; }
  const s = track.getSettings ? track.getSettings() : {};
  if(!s.width || !s.height){ badge.style.display = 'none'; return; }
  let label = s.width + '×' + s.height;
  if(s.height >= 2160) label += ' · 4K';
  else if(s.height >= 1080) label += ' · HD';
  if(s.frameRate) label += ' · ' + Math.round(s.frameRate) + 'fps';
  badge.textContent = label;
  badge.style.display = 'block';
}
/* Real front/back (or multi-camera) switching, not a placeholder. Falls back to toggling
   facingMode when the device only exposes one enumerable camera, which still works on
   phones even before device labels are available. */
function syncFacingModeFromTrack(){
  try{
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if(track && track.getSettings){
      const fm = track.getSettings().facingMode;
      if(fm === 'environment' || fm === 'left' || fm === 'right') cameraFacingMode = 'environment';
      else if(fm === 'user' || fm === 'face') cameraFacingMode = 'user';
    }
  }catch(e){}
}
function mediaStreamIsLive(s){
  if(!s) return false;
  const tracks = s.getTracks();
  if(!tracks.length) return false;
  const vids = tracks.filter(t => t.kind === 'video');
  if(vids.length) return vids.some(t => t.readyState === 'live');
  return tracks.some(t => t.readyState === 'live');
}
async function listVideoInputDevices(){
  try{
    // Labels are empty until permission has been granted at least once.
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput');
  }catch(e){
    return [];
  }
}
function classifyCameraDevice(device){
  const label = (device.label || '').toLowerCase();
  if(/back|rear|environment|world|posterior|traseira|arrière|背面|後/.test(label)) return 'environment';
  if(/front|user|face|selfie|anterior|frente|avant|前面|前/.test(label)) return 'user';
  // Some Android builds expose facing via groupId patterns; leave unknown.
  return null;
}
async function resolveCameraDeviceId(wantFacing){
  const devices = await listVideoInputDevices();
  if(!devices.length) return null;
  // Prefer explicit label match.
  const labeled = devices.find(d => classifyCameraDevice(d) === wantFacing);
  if(labeled && labeled.deviceId) return labeled.deviceId;
  // If only two cameras and one is clearly front, pick the other for rear.
  if(devices.length >= 2 && wantFacing === 'environment'){
    const front = devices.find(d => classifyCameraDevice(d) === 'user');
    const other = devices.find(d => front && d.deviceId !== front.deviceId);
    if(other) return other.deviceId;
    // Common mobile layout: index 0 = front, index 1 = rear
    return devices[1].deviceId || null;
  }
  if(devices.length >= 2 && wantFacing === 'user'){
    const rear = devices.find(d => classifyCameraDevice(d) === 'environment');
    const other = devices.find(d => rear && d.deviceId !== rear.deviceId);
    if(other) return other.deviceId;
    return devices[0].deviceId || null;
  }
  return devices[0].deviceId || null;
}
async function flipCamera(){
  /* Definitive flip:
     1) Stop current VIDEO tracks (Android needs this)
     2) Open the other camera
     3) Rebind every preview + sendRawVideo (canvas pipeline picks it up)
     4) Do NOT replaceTrack the canvas video sender — that would break the filter path.
        Only replaceTrack audio if needed. Canvas captureStream keeps streaming new frames.
  */
  if(window.__flipBusy) return;
  window.__flipBusy = true;
  const next = (cameraFacingMode === 'user') ? 'environment' : 'user';
  preferredVideoDeviceId = null;

  try{
    const oldStream = stream;
    // Release video hardware before requesting the other lens
    if(oldStream){
      oldStream.getVideoTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    }

    let newStream = null;
    const audioConstraint = { echoCancellation:true, noiseSuppression:true, autoGainControl:true };
    const videoAttempts = [];

    const deviceId = await resolveCameraDeviceId(next).catch(()=>null);
    if(deviceId){
      videoAttempts.push({ deviceId: { exact: deviceId }, width:{ideal:2560}, height:{ideal:1440}, frameRate:{ideal:30, max:60} });
    }
    videoAttempts.push({ facingMode: { exact: next }, width:{ideal:2560}, height:{ideal:1440}, frameRate:{ideal:30, max:60} });
    videoAttempts.push({ facingMode: { ideal: next }, width:{ideal:2560}, height:{ideal:1440}, frameRate:{ideal:30, max:60} });
    videoAttempts.push({ facingMode: next });

    for(const video of videoAttempts){
      if(newStream) break;
      try{
        newStream = await navigator.mediaDevices.getUserMedia({ video, audio: audioConstraint });
        if(video.deviceId && video.deviceId.exact) preferredVideoDeviceId = video.deviceId.exact;
      }catch(e){
        console.warn('[camera] flip attempt failed', video, e && e.name);
      }
    }

    if(!newStream){
      // Restore previous facing if we can
      cameraFacingMode = next;
      try{
        await enableCamera();
        toast(cameraFacingMode === 'environment' ? 'Rear camera' : 'Front camera');
      }catch(e){
        toast('Couldn\u2019t switch camera on this device');
      }
      return;
    }

    // Stop leftover audio from old stream after new one is live
    if(oldStream){
      oldStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    }

    stream = newStream;
    cameraFacingMode = next;
    try{
      const fm = stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings
        ? stream.getVideoTracks()[0].getSettings().facingMode
        : null;
      if(fm === 'user' || fm === 'environment') cameraFacingMode = fm;
      else cameraFacingMode = next;
    }catch(_){ cameraFacingMode = next; }

    const mirror = shouldMirrorCamera() ? 'scaleX(-1)' : 'none';
    ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo','localVideo'].forEach(id=>{
      const el = $(id);
      if(!el) return;
      el.srcObject = stream;
      if(id === 'incomingSelfVideo' || id === 'localVideo') el.style.transform = mirror;
      el.play && el.play().catch(()=>{});
    });

    // Keep canvas send pipeline on the new camera
    try{
      if(typeof startCamView === 'function'){
        startCamView($('incall') && $('incall').classList.contains('active') ? 'pip' : 'lobby');
      }
      if(typeof resizeSendCanvas === 'function') resizeSendCanvas();
      else if(typeof sizeSendCanvas === 'function') sizeSendCanvas();
    }catch(_){}

    // Peer connection: canvas video track continues; replace audio only.
    // If a sender still holds a dead *camera* video track (fallback path), replace it.
    if(typeof peerConnection !== 'undefined' && peerConnection){
      try{
        const senders = peerConnection.getSenders();
        const newVid = stream.getVideoTracks()[0];
        const newAud = stream.getAudioTracks()[0];
        senders.forEach(sender=>{
          if(!sender.track) return;
          if(sender.track.kind === 'audio' && newAud){
            sender.replaceTrack(newAud).catch(e=>console.warn('[camera] audio replace', e));
          }
          if(sender.track.kind === 'video' && newVid){
            // Only replace if the sender is NOT a canvas track (canvas has no 'facingMode' usually)
            const settings = sender.track.getSettings ? sender.track.getSettings() : {};
            const isCanvas = !settings.facingMode && (settings.displaySurface || sender.track.label === 'canvas' || (sender.track.label||'').includes('Canvas'));
            if(!isCanvas && sender.track.readyState !== 'live'){
              sender.replaceTrack(newVid).catch(e=>console.warn('[camera] video replace', e));
            } else if(!isCanvas && sender.track.readyState === 'live' && settings.deviceId){
              // Raw camera sender — swap to new lens
              sender.replaceTrack(newVid).catch(e=>console.warn('[camera] video replace', e));
            }
            // Canvas sender: leave it — frames update via sendRawVideo
          }
        });
      }catch(e){ console.warn('[camera] PC replace', e); }
    }

    updateCameraQualityBadge && updateCameraQualityBadge();
    updateSignatureGlow && updateSignatureGlow();
    if(typeof runGreenroom === 'function') runGreenroom();
    toast(cameraFacingMode === 'environment' ? 'Rear camera' : 'Front camera');
  }catch(e){
    console.error('[camera] flip failed', e);
    toast('Couldn\u2019t switch camera on this device');
    try{ await enableCamera(); }catch(_){}
  }finally{
    window.__flipBusy = false;
  }
}


async function enableCameraForCall(){
  /* Prefer high-res when the device can deliver it; fall back gracefully. */
  function hideCamFallback(){
    try{
      if($('camFallback')) $('camFallback').style.display = 'none';
    }catch(_){}
  }
  if(mediaStreamIsLive(stream) && stream.getAudioTracks().some(t => t.readyState === 'live')){
    try{
      stream.getAudioTracks().forEach(t => { t.enabled = true; });
      stream.getVideoTracks().forEach(t => { t.enabled = camOn; });
    }catch(_){}
    ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo'].forEach(id=>{
      const el = $(id);
      if(el){ el.srcObject = stream; el.play && el.play().catch(()=>{}); }
    });
    hideCamFallback();
    if(typeof startCamView === 'function'){
      startCamView(($('incall') && $('incall').classList.contains('active')) ? 'pip' : 'lobby');
    }
    runGreenroom();
    try{ updateCameraQualityBadge && updateCameraQualityBadge(); }catch(_){}
    return;
  }
  if(stream){
    try{ stream.getTracks().forEach(t => t.stop()); }catch(_){}
    stream = null;
  }
  const audioConstraints = { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } };
  // Higher first — user asked to keep the higher resolution
  const attempts = [
    { video: { facingMode: { ideal: cameraFacingMode }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } }, audio: audioConstraints },
    { video: { facingMode: { ideal: cameraFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: audioConstraints },
    { video: { facingMode: { ideal: cameraFacingMode } }, audio: audioConstraints },
    { video: true, audio: true },
  ];
  let lastErr;
  for(const c of attempts){
    try{
      stream = await navigator.mediaDevices.getUserMedia(c);
      lastErr = null;
      break;
    }catch(e){ lastErr = e; }
  }
  if(!stream) throw lastErr || new Error('Camera unavailable');
  try{
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    stream.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }catch(_){}
  ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo'].forEach(id=>{
    const el = $(id);
    if(el){ el.srcObject = stream; el.play && el.play().catch(()=>{}); }
  });
  hideCamFallback();
  if(typeof startCamView === 'function'){
    startCamView(($('incall') && $('incall').classList.contains('active')) ? 'pip' : 'lobby');
  }
  try{ runGreenroom(); }catch(_){}
  try{
    const vt = stream.getVideoTracks()[0];
    if(vt && vt.applyConstraints){
      // Prefer HD when the device can deliver it (non-blocking)
      vt.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }).catch(()=>{});
    }
  }catch(_){}
  try{ updateCameraQualityBadge && updateCameraQualityBadge(); }catch(_){}
}
async function enableCamera(){
  // If a request is already in flight, reuse it instead of a second getUserMedia prompt.
  if(cameraRequestPending){ await cameraRequestPending; return; }
  // After a long call, stream may still be non-null while every track is ended.
  // Treating that as "camera on" is what made the next call fail silently.
  if(mediaStreamIsLive(stream)){
    try{ if($('camFallback')) $('camFallback').style.display='none'; }catch(_){}
    ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo'].forEach(id=>{
      const el = $(id);
      if(el && el.srcObject !== stream){ el.srcObject = stream; el.play && el.play().catch(()=>{}); }
    });
    if(typeof startCamView === 'function'){
      startCamView(($('incall') && $('incall').classList.contains('active')) ? 'pip' : 'lobby');
    }
    runGreenroom();
    return;
  }
  if(stream){
    try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){}
    stream = null;
  }
  cameraRequestPending = requestHighQualityStream();
  try{
    stream = await cameraRequestPending;
    syncFacingModeFromTrack();
    const inv = $('incomingSelfVideo');
    if(inv){
      inv.srcObject = stream;
      inv.style.transform = shouldMirrorCamera() ? 'scaleX(-1)' : 'none';
    }
    $('sendRawVideo').srcObject = stream;
    startCamView($('incall').classList.contains('active') ? 'pip' : 'lobby');
    $('camFallback').style.display='none';
    updateCameraQualityBadge();
    updateSignatureGlow();
    runGreenroom();
  }catch(err){
    // This used to show a leftover placeholder from a much earlier sandboxed preview
    // environment ("works once hosted on Netlify") — actively wrong on the real, live,
    // properly-HTTPS-hosted site, and it discarded the actual error entirely. That's
    // the real reason a call could silently proceed with zero camera/mic ever
    // captured: the person saw a confusing, unrelated message instead of the real
    // problem, and nothing stopped the call from continuing anyway.
    console.error('[camera] getUserMedia failed:', err.name, err.message);
    let reason = 'Camera/mic unavailable — check your browser permissions and try again.';
    if(err.name === 'NotAllowedError') reason = 'Camera/mic access was denied. Check your browser\u2019s site permissions and try again.';
    else if(err.name === 'NotFoundError') reason = 'No camera or microphone was found on this device.';
    else if(err.name === 'NotReadableError') reason = 'Your camera or mic is already in use by another app. Close it and try again.';
    $('camFallback').innerHTML = `Camera unavailable<br><span style="opacity:.65">(${escapeHtml(reason)})</span><br><button class="enable-cam-btn" id="enableCamBtn2">Try again</button>`;
    $('enableCamBtn2').onclick = enableCamera;
    runGreenroom(); // still runs with a sensible default
  }finally{
    cameraRequestPending = null;
  }
}
$('enableCamBtn').onclick = enableCamera;
/* Doubles the camera stage's height rather than changing its aspect ratio to something
   wide/tall — stays true to the square framing, just gives more of it, so there's more
   natural room to fit yourself without needing to physically back away from the camera.
   Deliberately doesn't touch the person-cutout mask — that's what broke the backgrounds
   last time this problem got solved the wrong way. */
$('camExpandBtn').onclick = function(){
  const expanded = $('camStage').classList.toggle('expanded');
  this.classList.toggle('expanded', expanded);
};
/* Captures exactly what's on screen — the border pattern and your real camera feed
   together, the same composited canvas you're actually looking at — not just a raw,
   unstyled camera frame. */
$('camCaptureBtn').onclick = ()=>{
  const canvas = $('camStageCanvas');
  if(!canvas || !canvas.width){ toast('Camera not ready yet'); return; }
  canvas.toBlob(blob=>{
    if(!blob){ toast('Couldn\u2019t capture a photo'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'naluno-' + Date.now() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
    toast('Photo saved');
  }, 'image/png');
};
$('bgPickerBtn').onclick = ()=>{
  const row = $('incallBgChipRow');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
};
$('greenroomPill').onclick = ()=>{ if(stream) runGreenroom(); };

function runGreenroom(){
  if(!greenroomEnabled){
    $('greenroomPill').classList.add('ready');
    $('greenroomLabel').textContent = 'Filter · off';
    return;
  }
  $('greenroomPill').classList.remove('ready');
  $('greenroomLabel').textContent = 'Filter · matching…';
  setTimeout(()=>{
    const id = userPickedFilter ? selectedFilterId : suggestFilterId();
    chooseFilter(id, false);
    $('greenroomPill').classList.add('ready');
    const name = (nalunoFilters[id] && nalunoFilters[id].name) || id;
    toast('Filter · ' + name);
    $('sceneReadyNote').style.display = 'inline-flex';
  }, 500);
}

/* Suggest a filter from scene brightness — only when the user hasn't chosen one. */
function suggestFilterId(){
  if(!stream) return 'signal';
  try{
    const v = $('camRawVideo') || $('sendRawVideo');
    if(!v || v.readyState < 2) return 'signal';
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, 16, 16);
    const data = ctx.getImageData(0,0,16,16).data;
    let total = 0;
    for(let i=0;i<data.length;i+=4){ total += (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114); }
    const avg = total / (data.length/4);
    if(avg < 55) return 'nightcall';
    if(avg < 100) return 'wireline';
    if(avg < 160) return 'signal';
    if(avg < 200) return 'broadcast';
    return 'ghost';
  }catch(e){ return 'signal'; }
}
function suggestBackgroundId(){ return suggestFilterId(); }


function setCam(on){
  camOn = on;
  $('toggleCam').classList.toggle('off', !on);
  $('camBtn').classList.toggle('active', !on);
  if(stream) stream.getVideoTracks().forEach(t=>t.enabled=on);
}
function setMic(on){
  micOn = on;
  $('toggleMic').classList.toggle('off', !on);
  $('micBtn').classList.toggle('active', !on);
  $('localPip').classList.toggle('muted', !on);
  if(stream) stream.getAudioTracks().forEach(t=>t.enabled=on);
}
$('toggleCam').onclick = ()=> setCam(!camOn);
$('toggleMic').onclick = ()=> setMic(!micOn);
// Big lobby Flip + small in-call icon — same handler, stop bubbling so parents can't swallow the tap.
['lobbySwitchCam','switchCam'].forEach(id=>{
  const el = $(id);
  if(!el) return;
  el.onclick = (e)=>{ if(e){ e.preventDefault(); e.stopPropagation(); } flipCamera(); };
});
$('camBtn').onclick = ()=>{ setCam(!camOn); toast(camOn?'Camera on':'Camera off'); };
$('micBtn').onclick = ()=>{ setMic(!micOn); toast(micOn?'Mic on':'Mic muted'); };
$('chatBtn').onclick = ()=>{
  if(!currentCallContactId){ toast('No one to message right now'); return; }
  openThread(currentCallContactId); // opens on top of the call — the call keeps running underneath
};

/* waveform bars */
const wf = $('waveform');
for(let i=0;i<22;i++){ const s=document.createElement('span'); s.style.animationDelay=(Math.random()*1.1).toFixed(2)+'s'; wf.appendChild(s); }



/* Hardened flip binding — survives DOM re-renders and overlay stacking */
(function nalunoFlipDelegate(){
  document.addEventListener('click', function(e){
    const t = e.target && e.target.closest && e.target.closest('#lobbySwitchCam, #switchCam, [data-action="flip-camera"]');
    if(!t) return;
    e.preventDefault();
    e.stopPropagation();
    if(typeof flipCamera === 'function') flipCamera();
  }, true);
})();

/* 2026-09-28e: Send panel, ad review note, optional chapters. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const nalunoAtLeast = (v, min) => (v || '') >= min;
const swBuild = (s) => (s.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1];
const swCache = (s) => Number((s.match(/'naluno-shell-v(\d+)'/) || [])[1] || 0);
const appVer = (h) => (h.match(/<meta name="app-version" content="(\d{4}\.\d{2}\.\d{2}[a-z])">/) || [])[1];
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const space = read('broadcast-space.js');
const comp = read('broadcast-composer.js');
const ads = read('ads.js');

assert.ok(space.includes("$('bspaceMoreMenu').classList.add('bspace-menu-side')"), 'Send list opens as a side panel');
assert.ok(space.includes("menu.classList.remove('bspace-menu-side');"), 'other menu cards stay full width');
assert.ok(css.includes('.bspace-more-menu.bspace-menu-side #bspaceActionCard{') && /width:50%/.test(css), 'half the screen');
assert.ok(space.includes("n.toLowerCase() !== 'you'"), 'people with the default name show their number');

assert.ok(css.includes('.tab-scroll[hidden]{ display:none !important; }'), 'ad review note hidden until saved');
assert.ok(/<div class="tab-scroll" id="bcastAdPay" hidden/.test(html), 'review note starts hidden');
assert.ok(ads.includes("toast('Ad saved')"), 'saving says so');

assert.ok(html.includes('id="bwriteChaptered"') && html.includes('id="bwriteChTitle"') && html.includes('id="bwriteAddChapter"'), 'chapters are a choice on the Write screen');
assert.ok(html.indexOf('id="bwriteChapteredRow"') > html.indexOf('id="bwriteOriginAckRow"'), 'choice sits with the photo and rights');
assert.ok(comp.includes("(bcompChaptered() ? ('Chapter ' + (i + 1)) : '')"), 'no "Chapter 1" heading on a single piece');
assert.ok(comp.includes('window.__bcompChaptered = true;'), 'full composer keeps chapters');
assert.ok(space.includes('const dup = single && (!raw || norm(raw) === pageTitle'), 'older pieces stop printing the title twice');
assert.ok(space.includes("(root.length > 1 ? ('Chapter ' + (i + 1)) : '')"), 'editing a single piece does not add a chapter heading');

['css/app.css', 'js/broadcast-space.js', 'js/broadcast-composer.js', 'js/ads.js'].forEach((f) => assert.ok(((html.match(new RegExp('/' + f.replace('.', '\\.') + '\\?v=(\\d{8}[a-z])')) || [])[1] || '') >= '20260928e', 'stamp ' + f));
assert.ok(Number((sw.match(/'naluno-shell-v(\d+)'/) || [])[1]) >= 233 && ((sw.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1] || '') >= '20260928e', 'service worker cache bumped');
assert.ok(nalunoAtLeast(appVer(html), '2026.09.28e'), 'update banner can see the new build');
/* 28f */
assert.ok(space.includes("if(!seg || seg.type !== 'video'){") && space.includes("const chipHost = document.getElementById('bspaceChapterHost');"), 'video chapter chips do not follow into a writing');
assert.ok(space.includes("['bspaceFitToggle', 'bspaceOrientToggle'].forEach"), 'video Fill/Fit buttons do not follow into a writing');
assert.ok(css.includes('#bspaceListenWrap #bspaceListenBtn{') && css.includes('height:24px;'), 'Listen row is smaller than the title');
assert.ok(nalunoAtLeast((html.match(/\/js\/broadcast-space\.js\?v=(\d{8}[a-z])/) || [])[1], '20260928f') && swCache(sw) >= 234, '28f stamps');
console.log('fixes-28e tests passed');

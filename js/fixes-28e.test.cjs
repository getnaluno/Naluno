/* 2026-09-28e: Send panel, ad review note, optional chapters. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
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

['css/app.css', 'js/broadcast-space.js', 'js/broadcast-composer.js', 'js/ads.js'].forEach((f) => assert.ok(new RegExp('/' + f.replace('.', '\\.') + '\\?v=20260928[e-z]').test(html), 'stamp ' + f));
assert.ok(/'naluno-shell-v23[3-9]'/.test(sw) && /'20260928[e-z]'/.test(sw), 'service worker cache bumped');
assert.ok(/<meta name="app-version" content="2026\.09\.28[e-z]">/.test(html), 'update banner can see the new build');
/* 28f */
assert.ok(space.includes("if(!seg || seg.type !== 'video'){") && space.includes("const chipHost = document.getElementById('bspaceChapterHost');"), 'video chapter chips do not follow into a writing');
assert.ok(space.includes("['bspaceFitToggle', 'bspaceOrientToggle'].forEach"), 'video Fill/Fit buttons do not follow into a writing');
assert.ok(css.includes('#bspaceListenWrap #bspaceListenBtn{') && css.includes('height:24px;'), 'Listen row is smaller than the title');
assert.ok(/\/js\/broadcast-space\.js\?v=20260928[f-z]/.test(html) && /'naluno-shell-v23[4-9]'/.test(sw), '28f stamps');
console.log('fixes-28e tests passed');

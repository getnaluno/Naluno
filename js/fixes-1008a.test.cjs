/* 08 Oct a: a preview of the next Broadcast in the swipe-up cue, and the
   Signal's play button inside its ring. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('app/index.html');
const css = read('css/app.css');
const sp = read('js/broadcast-space.js');

// 1. The cue carries a preview card under the title.
assert.ok(html.includes('<span class="bspace-next-title" id="bspaceNextTitle"></span>\n          <span class="bspace-next-card" id="bspaceNextCard" hidden></span>'), 'card inside the cue, under the title');
assert.ok(sp.includes("const card = document.getElementById('bspaceNextCard');"), 'painted with the title');
assert.ok(sp.includes('sc.scrollHeight - 700) nalunoPaintNextCue();'), 'ready before it scrolls into view');
assert.ok(sp.includes("try{ if(typeof nalunoPaintNextCue === 'function') nalunoPaintNextCue(); }catch(_){}\n\n  // Membership button"), 'filled as the Broadcast opens, so the page does not jump');
// Run the preview builder on its own.
const i = sp.indexOf('function nalunoNextPreviewHtml(b){');
let depth = 0, end = -1;
for (let k = sp.indexOf('{', i); k < sp.length; k++) { if (sp[k] === '{') depth++; if (sp[k] === '}') { depth--; if (!depth) { end = k + 1; break; } } }
const ctx = { String, RegExp };
vm.createContext(ctx);
vm.runInContext(sp.slice(i, end), ctx);
const vid = ctx.nalunoNextPreviewHtml({ id: 'a', title: 'Kampala at dawn', creatorName: 'Nakato Patience', mediaType: 'video', thumbUrl: 'https://media.test/v.jpg', description: 'Riders before the sun.' });
assert.ok(vid.includes('<img src="https://media.test/v.jpg"') && vid.includes('bnc-play') && vid.includes('>Watch<') && vid.includes('by Nakato') && vid.includes('Riders before the sun.'), 'video: picture, play mark, kind, maker, line');
assert.ok(!/<video/.test(vid), 'never a playing video in the cue (no data cost)');
const read1 = ctx.nalunoNextPreviewHtml({ title: 'Ebigambo', creatorName: 'Kato', mediaType: 'writing', body: 'Jjajja yagamba nti...', lang: 'lg' });
assert.ok(read1.includes('bnc-words') && read1.includes('Read · Luganda'), 'writing with no cover: its opening words');
const live = ctx.nalunoNextPreviewHtml({ title: 'Jam', live: true, creatorName: 'N' });
assert.ok(live.includes('bnc-kind bnc-live') && live.includes('>Live<'));
const evil = ctx.nalunoNextPreviewHtml({ title: '<img src=x onerror=alert(1)>', creatorName: '"><b>', mediaType: 'photo', mediaUrl: 'javascript:alert(1)', description: '<script>x</script>' });
assert.ok(!evil.includes('<img src=x') && !evil.includes('<script>') && !evil.includes('javascript:') && !evil.includes('by "><b>'), 'titles, names and links are made safe');
assert.equal(ctx.nalunoNextPreviewHtml(null), '');
assert.ok(css.includes('.bspace-next-card{') && css.includes('.bspace-next-card[hidden]{ display:none; }'));

// 2. Play sits inside the ring.
assert.ok(css.includes('left:50%; top:69%; right:auto; bottom:auto; transform:translate(-50%,-50%);\n  width:18px; height:18px;'), 'play inside the circle (circle runs 17% to 83%)');

// 3. Stamps
const LATER = '(20261008[a-z]|202610(09|[1-3][0-9])[a-z])';
['broadcast-space.js', 'pwa.js'].forEach((f) => assert.ok(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=' + LATER).test(html), f + ' stamp (08a or later)'));
assert.ok(new RegExp('/css/app\\.css\\?v=' + LATER).test(html) && new RegExp("APP_BUILD = '" + LATER + "'").test(read('sw.js')) && new RegExp('/sw\\.js\\?v=' + LATER).test(read('js/pwa.js')));
console.log('fixes-1008a tests passed');

/* 10 Oct e: "Go on air" choices did nothing.
   broadcast-upload.js and broadcast-composer.js both declared
   `const BCAST_MAX_OBJECT_BYTES`. Classic scripts share one global scope,
   so the browser refused the whole composer file and Video, Write and
   Go live had nothing to open. This test reads every classic script the
   app, console and site load, in order, and fails on any top-level name
   that two files declare where one of them is let, const or class. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* Top-level declarations, found without a parser: only lines that start at
   column 0 are top level in these files (they are not indented modules). */
function topLevel(src) {
  const out = [];
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  noBlock.split('\n').forEach((line) => {
    let m = line.match(/^(let|const|var)\s+([A-Za-z_$][\w$]*)\s*(=|;|,)/);
    if (m) { out.push([m[1], m[2]]); return; }
    m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { out.push(['function', m[1]]); return; }
    m = line.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if (m) out.push(['class', m[1]]);
  });
  return out;
}
const lexical = (k) => k === 'let' || k === 'const' || k === 'class';

['app/index.html', 'admin/index.html', 'index.html'].forEach((page) => {
  const html = read(page);
  const srcs = [...html.matchAll(/<script(?![^>]*type=["']module)[^>]*src=["'](\/[^"'?]+)[^"']*["']/g)].map((m) => m[1]);
  const seen = {};
  const clashes = [];
  srcs.forEach((s) => {
    const f = s.replace(/^\//, '');
    if (!fs.existsSync(path.join(root, f))) return;
    topLevel(read(f)).forEach(([kind, name]) => {
      const prev = seen[name];
      if (prev && prev.file !== f && (lexical(kind) || lexical(prev.kind))) clashes.push(name + ': ' + prev.kind + ' in ' + prev.file + ', ' + kind + ' in ' + f);
      if (!prev) seen[name] = { kind, file: f };
    });
  });
  assert.deepStrictEqual(clashes, [], page + ': two scripts declare the same top-level name, so the later one will not load');
});

/* The 8 GB limit stays in both files (the console loads the uploader alone). */
assert.ok(/^var BCAST_MAX_OBJECT_BYTES = 8 \* 1024 \* 1024 \* 1024;/m.test(read('js/broadcast-upload.js')), 'uploader keeps its 8 GB limit');
assert.ok(/^var BCAST_MAX_OBJECT_BYTES = 8 \* 1024 \* 1024 \* 1024;/m.test(read('js/broadcast-composer.js')), 'composer keeps its 8 GB limit');

/* Phones fetch the fixed files, not the cached ones. */
const app = read('app/index.html');
assert.ok(app.includes('/js/broadcast-upload.js?v=20261010e') && app.includes('/js/broadcast-composer.js?v=20261010e'), 'new stamps on the fixed files');
assert.ok(read('sw.js').includes("CACHE_NAME = 'naluno-shell-v307'"), 'shell cache moved on');
console.log('fixes-1010e tests passed');

/* A small static server for a folder, on a free port, like GitHub Pages:
   /x/ serves /x/index.html, /x serves /x.html when there is one. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.txt': 'text/plain' };
function serve(dir, port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(dir, u);
      if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
      try {
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
        else if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f = f + '.html';
        const body = fs.readFileSync(f);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(body);
      } catch (_) { res.writeHead(404); res.end('not found'); }
    });
    s.listen(port || 0, '127.0.0.1', () => {
      const p = s.address().port;
      resolve({ base: 'http://localhost:' + p, port: p, close: () => s.close() });
    });
  });
}
module.exports = { serve };

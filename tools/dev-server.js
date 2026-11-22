/**
 * Local preview: serves the site and answers /api with backend/Code.gs running
 * on the in-memory Sheets stand-in. Data is kept in tools/.devdata.json so a
 * page reload (or a server restart) keeps it. Delete that file to start empty.
 *
 *   node tools/dev-server.js [port] [--memory]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createBackend } = require('./gas-mock');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2]) || 8787;
const memory = process.argv.includes('--memory');
const store = path.join(__dirname, '.devdata.json');
const backend = createBackend({ data: !memory && fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : null });
backend.setup();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      const out = backend.post(body);
      if (!memory) fs.writeFileSync(store, JSON.stringify(backend.dump()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(root, rel === '/' ? 'index.html' : rel));
  const allowed = file === path.join(root, 'index.html') || file.startsWith(path.join(root, 'assets') + path.sep);
  if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log('SV Workspace preview: http://localhost:' + port + (memory ? ' (memory only)' : '')));

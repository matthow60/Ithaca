// Minimal target app for the verify tests.
//   node server.js broken  → POST /api/boom returns 500 (the bug is still there)
//   node server.js fixed   → POST /api/boom returns 200
import http from 'node:http';

const broken = process.argv[2] === 'broken';
const page = `<!doctype html><title>fixture</title>
<button data-testid="boom" onclick="fetch('/api/boom', { method: 'POST' })">boom</button>`;

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/boom') {
      res.writeHead(broken ? 500 : 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(broken ? { error: 'boom' } : { ok: true }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  })
  .listen(process.env.PORT, '127.0.0.1');

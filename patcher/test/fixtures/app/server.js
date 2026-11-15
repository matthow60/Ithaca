// Minimal target app for the verify tests. The argument lists which endpoints return 500:
//   node server.js boom        → POST /api/boom fails (the bug being fixed)
//   node server.js other,boom  → also POST /api/other (a separate, existing bug)
//   node server.js other,extra → boom fixed, but POST /api/extra now fails (a new bug)
//   node server.js none        → nothing fails
// One button per endpoint: [data-testid="other"], [data-testid="extra"], [data-testid="boom"].
import http from 'node:http';

const failing = new Set(String(process.argv[2] || '').split(','));
const endpoints = ['other', 'extra', 'boom'];
const page = `<!doctype html><title>fixture</title>${endpoints
  .map((name) => `<button data-testid="${name}" onclick="fetch('/api/${name}', { method: 'POST' })">${name}</button>`)
  .join('')}`;

http
  .createServer((req, res) => {
    const name = req.method === 'POST' && req.url.startsWith('/api/') ? req.url.slice(5) : null;
    if (endpoints.includes(name)) {
      const broken = failing.has(name);
      res.writeHead(broken ? 500 : 200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(broken ? { error: name } : { ok: true }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  })
  .listen(process.env.PORT, '127.0.0.1');

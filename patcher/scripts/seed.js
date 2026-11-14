// Insert a fake open incident for local testing.
//   node scripts/seed.js                 → incident-123
//   node scripts/seed.js incident-456    → custom id
// Re-seeding deletes and re-inserts, so the change stream sees a fresh insert.
import '../src/env.js'; // shared repo-root .env
import { connectDb, closeDb, incidents } from '../src/db.js';

const incidentId = process.argv[2] || 'incident-123';
const now = Date.now();

const incident = {
  incidentId,
  status: 'open',
  createdAt: new Date(now),
  route: 'POST /api/cart/add',
  error: {
    message: "TypeError: Cannot read properties of undefined (reading 'quantity')",
    stack: [
      "TypeError: Cannot read properties of undefined (reading 'quantity')",
      '    at /app/server/src/routes/cart.js:17:51',
      '    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)',
      '    at next (/app/node_modules/express/lib/router/route.js:149:13)',
    ].join('\n'),
    file: 'server/src/routes/cart.js', // repo-relative — must match patches/server/src/routes/cart.js
    line: 17,
  },
  // Replayed in a headless browser. URLs can be from any host — only path + query are used.
  actions: [
    { t: now - 9000, type: 'navigate', target: null, value: null, url: 'http://localhost:3000/' },
    { t: now - 6000, type: 'input', target: '[data-testid="qty-sku-42"]', value: '2', url: 'http://localhost:3000/' },
    { t: now - 3000, type: 'click', target: '[data-testid="add-sku-42"]', value: null, url: 'http://localhost:3000/' },
  ],
  request: {
    method: 'POST',
    path: '/api/cart/add',
    body: { productId: 'sku-42', quantity: 2 },
    headers: { 'content-type': 'application/json', 'x-session-id': 'demo-session' },
  },
};

await connectDb();
await incidents().deleteOne({ incidentId });
await incidents().insertOne(incident);
console.log(`seeded open incident "${incidentId}"`);
await closeDb();

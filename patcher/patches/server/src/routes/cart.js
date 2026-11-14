// MOCK PATCH for the seed incident (incident-123).
// This file REPLACES server/src/routes/cart.js in the target repo verbatim,
// so it must be a complete, working version of that file. Edit it to match
// your real target app — this one assumes an Express router mounted at /api/cart.
//
// Bug in the original: line 17 did
//   cart.items.find((i) => i.productId === productId).quantity += quantity;
// which crashes with "Cannot read properties of undefined (reading 'quantity')"
// the first time a product is added to an empty cart.
import { Router } from 'express';

const router = Router();
const carts = new Map(); // sessionId -> { items: [{ productId, quantity }] }

function getCart(req) {
  const sessionId = req.get('x-session-id') || 'anonymous';
  if (!carts.has(sessionId)) carts.set(sessionId, { items: [] });
  return carts.get(sessionId);
}

router.get('/', (req, res) => {
  res.json(getCart(req));
});

router.post('/add', (req, res) => {
  const { productId, quantity = 1 } = req.body ?? {};
  if (!productId) return res.status(400).json({ error: 'productId is required' });

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });

  const cart = getCart(req);
  const existing = cart.items.find((i) => i.productId === productId);
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.items.push({ productId, quantity: qty });
  }
  res.status(200).json(cart);
});

export default router;

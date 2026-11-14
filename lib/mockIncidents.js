// Mock incidents shaped like the MongoDB documents Member 1 writes
// and Member 2 updates. Agree on this schema with your team.
//
// {
//   _id, route, errorMessage, stackTrace,
//   actions: [{ type: 'click' | 'input' | 'navigate', target, value?, timestamp }],  // last 15
//   timestamp,                                   // crash time (ISO)
//   status: 'open' | 'patching' | 'fixed',
//   prUrl, codeDiff                              // set by Member 2 when fixed
// }
//
// `mockSummary` and `simulate` exist only for this prototype.

const now = Date.now();

// Turns [type, target, value?] tuples into actions spaced a few seconds apart,
// ending right before the crash.
function steps(list, crashTime) {
  return list.map(([type, target, value], i) => ({
    type,
    target,
    ...(value !== undefined && { value }),
    timestamp: new Date(crashTime - (list.length - i) * 3500).toISOString(),
  }));
}

const crash1 = now - 6 * 60 * 1000;
const crash2 = now - 20 * 1000;
const crash3 = now - 42 * 60 * 1000;

export const MOCK_INCIDENTS = [
  {
    _id: 'incident-124',
    simulate: true, // walks open → patching → fixed so the badges animate in the demo
    route: 'POST /api/checkout/split',
    errorMessage: 'RangeError: Invalid charge amount: Infinity',
    timestamp: new Date(crash2).toISOString(),
    status: 'open',
    stackTrace: `RangeError: Invalid charge amount: Infinity
    at createCharge (/app/server/payments.js:18:11)
    at splitPayment (/app/server/routes/checkout.js:67:22)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:149:13)`,
    actions: steps(
      [
        ['navigate', '/'],
        ['click', 'Shop Hoodies'],
        ['click', 'Add to cart: Mavs Hoodie (L)'],
        ['click', 'Add to cart: Maverick Cap'],
        ['navigate', '/cart'],
        ['click', 'Checkout'],
        ['navigate', '/checkout'],
        ['input', '#email', 'student@mavs.uta.edu'],
        ['input', '#card', '•••• 4242'],
        ['click', 'Split payment'],
        ['input', '#split-count', '3'],
        ['input', '#split-count', ''],
        ['input', '#split-count', '0'],
        ['click', 'Confirm split'],
        ['click', 'Pay now'],
      ],
      crash2
    ),
    prUrl: 'https://github.com/your-org/mavs-merch/pull/124',
    codeDiff: `--- a/server/routes/checkout.js
+++ b/server/routes/checkout.js
@@ -62,8 +62,11 @@ router.post('/split', async (req, res) => {
   const { total } = getCart(req.session.id);
-  const people = Number(req.body.splitCount);
+  const people = Number.parseInt(req.body.splitCount, 10);
+  if (!Number.isInteger(people) || people < 1) {
+    return res.status(400).json({ error: 'Split count must be at least 1' });
+  }
   const share = Math.round((total / people) * 100) / 100;
   const charges = await Promise.all(
     Array.from({ length: people }, () => createCharge(share))
   );`,
    mockSummary: {
      whatBroke:
        'The split-payment endpoint divided the cart total by the number of people. A split count of 0 produced a per-person share of Infinity, which the payment helper rejected with a RangeError and the server returned a 500.',
      whyTriggered:
        'The user opened "Split payment", cleared the field, typed 0, then hit "Pay now". The form never validated the value, so 0 went straight to the server.',
      howFixed:
        'The PR parses the split count as an integer and returns a 400 "Split count must be at least 1" before any division happens, so the charge helper never sees Infinity.',
    },
  },
  {
    _id: 'incident-123',
    route: 'POST /api/cart/promo',
    errorMessage: "TypeError: Cannot read properties of undefined (reading 'price')",
    timestamp: new Date(crash1).toISOString(),
    status: 'fixed',
    stackTrace: `TypeError: Cannot read properties of undefined (reading 'price')
    at applyPromo (/app/server/routes/cart.js:42:31)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:119:3)`,
    actions: steps(
      [
        ['navigate', '/'],
        ['click', 'Shop Jerseys'],
        ['navigate', '/shop/jerseys'],
        ['click', 'Mavs Home Jersey'],
        ['click', 'Size: M'],
        ['click', 'Add to cart'],
        ['navigate', '/cart'],
        ['click', 'Quantity −'],
        ['click', 'Remove item'],
        ['click', 'Have a promo code?'],
        ['input', '#promo', 'MAV'],
        ['input', '#promo', 'MAVS20'],
        ['click', 'Apply'],
        ['click', 'Apply'],
        ['click', 'Apply'],
      ],
      crash1
    ),
    prUrl: 'https://github.com/your-org/mavs-merch/pull/123',
    codeDiff: `--- a/server/routes/cart.js
+++ b/server/routes/cart.js
@@ -38,7 +38,13 @@ router.post('/promo', (req, res) => {
   const { code } = req.body;
   const cart = getCart(req.session.id);
   const discount = PROMOS[code];
-  const newTotal = cart.items[0].price * (1 - discount);
+  if (!discount) {
+    return res.status(400).json({ error: 'Invalid promo code' });
+  }
+  if (cart.items.length === 0) {
+    return res.status(400).json({ error: 'Cart is empty' });
+  }
+  const subtotal = cart.items.reduce((sum, item) => sum + item.price, 0);
+  const newTotal = subtotal * (1 - discount);
   res.json({ total: newTotal });
 });`,
    mockSummary: {
      whatBroke:
        'The promo endpoint read cart.items[0].price without checking whether the cart had any items. With an empty cart, items[0] is undefined and the handler crashed.',
      whyTriggered:
        'The user added a jersey, removed it, then entered MAVS20 and clicked "Apply" three times on an empty cart. Each click hit the same unguarded line.',
      howFixed:
        'The PR rejects unknown codes and empty carts with a 400, and computes the discount from the full subtotal instead of only the first item.',
    },
  },
  {
    _id: 'incident-122',
    route: 'GET /api/products/:id',
    errorMessage: "TypeError: Cannot read properties of null (reading 'sizes')",
    timestamp: new Date(crash3).toISOString(),
    status: 'open',
    stackTrace: `TypeError: Cannot read properties of null (reading 'sizes')
    at getProduct (/app/server/routes/products.js:21:28)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/app/node_modules/express/lib/router/route.js:149:13)`,
    actions: steps(
      [
        ['navigate', '/'],
        ['click', 'Shop All'],
        ['navigate', '/shop'],
        ['input', '#search', 'scarf'],
        ['click', 'Search'],
        ['click', 'Blue Scarf'],
        ['navigate', '/shop/products/88'],
        ['click', 'Back'],
        ['navigate', '/shop'],
        ['click', 'Sort: Price'],
        ['click', 'Clearance'],
        ['click', 'Retro Pennant'],
        ['navigate', '/shop/products/0'],
        ['click', 'Size guide'],
        ['click', 'Reload'],
      ],
      crash3
    ),
    prUrl: null,
    codeDiff: null,
    mockSummary: null,
  },
];

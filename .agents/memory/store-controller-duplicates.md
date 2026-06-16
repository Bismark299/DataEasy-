---
name: storeController duplicated blocks
description: Several near-identical code blocks in storeController.js require disambiguation when editing
---

`backend/controllers/storeController.js` contains multiple near-identical blocks that break naive single-edit replacements:
- Paystack `initializeTransaction({...})` exists in BOTH `createOrder` (owner-created) and `createPublicOrder` (public storefront). Customer-facing redirect/callback changes belong ONLY to `createPublicOrder`.
- The query destructure `const { page = 1, limit = 20, status } = req.query;` appears in both `getOrders` (storefront sales) and another list endpoint.

**Why:** edits failed with "N matches" errors; applying to the wrong copy silently changes the wrong feature.
**How to apply:** anchor edits with surrounding unique context (function signature or adjacent unique lines) rather than the shared block alone.

---
name: Admin orders page merges store orders client-side
description: Why store orders can be safely merged into the admin getAllOrders response, and the route-ordering constraint for public store endpoints.
---

# Admin orders page + store-order merge

The admin orders list (`admin/orders.html`) fetches `GET /api/admin/orders` with `limit: 9999` and does ALL pagination, item-expansion, and most filtering client-side. The server `pagination` object is essentially ignored for the table (the UI counts `expandedItems.length`).

**Consequence / decision:** store-link orders (`StoreOrder`) are merged into `getAllOrders`'s response array (mapped to the platform-order shape, tagged `source:'store'`), then sorted by `createdAt`. Because the frontend re-paginates in memory, the inaccurate `pagination.total` (still platform-`Order` count only) does not break the table.

**Why:** the user wanted store orders visible "like normal orders" on the main admin page without a separate view. Merging server-side was the least-invasive way given the client-side-pagination architecture.

**How to apply:**
- Store rows must be guarded against platform-only mutation endpoints. The frontend hides retry/complete/cancel for `source==='store'` and shows a "Store" badge. Any future bulk/action code on the orders page must check `source` before calling `/api/admin/orders/...` mutations.
- The merge is skipped when a `userId` filter is set (store orders have no platform user).
- If a future API consumer relies on accurate `pagination.total/pages` from `getAllOrders`, the merge count must be added in.

**Display conventions (product decisions):**
- Only payment-complete store orders belong on the main admin orders dashboard: the merge filters `StoreOrder.status IN ['paid','fulfilled','refunded']` (excludes unpaid `pending` and `cancelled`). **Why:** unpaid store orders were leaking onto the main dashboard.
- The main orders page shows the store OWNER's name, NOT the store name: the merge nests `Store -> owner` and maps `user.fullName/name/agentCode` from the owner (fallback `'Store Owner'`/`'STORE'`). The store NAME appears only on the admin **stores** page. The `orders.html` store-link badge tooltip is generic (no store name).
- Admin **stores** page tables (per-store modal + global list) show a Profit column: `profit = netAmount - totalCost`, badge `Credited` when `status==='fulfilled'` else `Pending`. Mirrors profit recognition timing (see store-profit-recognition.md).

# Public store route ordering

Static public store paths (`/public/orders/:reference/verify`, `/public/track`) MUST be registered before the parameterized `/public/:storeId` in `backend/routes/store.js`, or `:storeId` swallows them. The public order-tracking endpoint (`/public/track?orderId=&phone=`) requires both params and matches phone by last-9-digits to prevent ID enumeration; it returns a single generic 404 for both not-found and mismatch.

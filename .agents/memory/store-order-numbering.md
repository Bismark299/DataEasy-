---
name: Store order numbering (SO- ref vs shared orderNumber)
description: How store orders get a display order number that shares the platform sequence while keeping SO- as the immutable reference.
---

Store orders carry two identifiers:
- `orderId` = `SO-...` — the immutable store **reference**. It is the ledger / tracking / Paystack-match / match-complete key. NEVER repurpose or change it.
- `orderNumber` (nullable STRING) — a sequential display number drawn from the **same** `order_id_seq` as platform orders, via the exported `generateOrderId` in `orderController`.

**Rules:**
- `orderNumber` is assigned at **payment confirmation** (in `verifyOrderPayment` + `verifyPublicPayment` via `assignStoreOrderNumber`), NOT at order creation — so abandoned/unpaid orders don't burn sequence values and create gaps in the shared platform numbering.
- The SO- reference is shown ONLY on the admin **stores** page (its own endpoint returns raw `orderId`). Everywhere else (main admin orders page) shows the normal number: the `getAllOrders` merge maps `orderId = orderNumber || orderId` and also exposes `orderNumber` + `storeReference` (the SO-). Legacy paid orders with null `orderNumber` fall back to showing SO-.

**Why:** the user wanted store orders to "continue with the normal order number system" everywhere but keep SO- only on the stores page, without breaking the live ledger/tracking that already keys on SO-.

**How to apply:** if you add another store-order paid-transition path, call `assignStoreOrderNumber` there too. Assignment is best-effort (not transactional) — concurrent verify calls can waste a sequence value; `if (order.orderNumber) return` guards re-assignment.

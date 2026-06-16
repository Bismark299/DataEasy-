---
name: Admin actions on store orders
description: How admin orders-page actions (complete/cancel/retry/status/paste-reconcile) are made to work on StoreOrder, and why they route through the delivery service.
---

Store-link orders (`StoreOrder`, tagged `source:'store'`) are merged into the admin
main orders page alongside platform `Order`s. Every admin action must work on both.

**Rule:** The admin order action endpoints (`updateItemStatus`, `updateOrderStatus`,
`retryFailedItems`, AND `matchAndCompleteOrders` in `adminController.js`) look up
`Order` first, then fall back to `StoreOrder` (resolve by UUID PK via `findByPk`,
else by `orderId` string). Store status changes are applied through
`storeOrderDelivery.updateItem(...)`, never by writing `StoreOrder` directly.

**Why:** `updateItem` runs in a row-locked transaction and, on the `paid -> fulfilled`
(all items Delivered) transition, calls `ledgerService.recordSale` once to credit
commission/settlement. Bypassing it would either skip the ledger entry or risk
double-recording. It only transitions on first fulfillment, so it is idempotent and
never reverses `fulfilled -> paid`. Marking an order Failed leaves `status` as `paid`
(matches auto-delivery behavior; no spurious fulfillment/ledger).

**Watch out — store order field mismatches:**
- Order-level `deliveryStatus` can be `Processing` while the single item is still
  `Pending` (dispatch attempted but auto-delivery disabled). UI must map per-item
  status (`it.deliveryStatus || so.deliveryStatus`) so action buttons reflect reality.
- The recipient phone lives on the ITEM (`item.recipientPhone`), not just
  `so.customerPhone`. Phone-matching tools must check `recipientPhone` first.

**Paste/reconcile tool (`matchAndCompleteOrders`):** admins copy delivered
numbers from the provider and paste them to auto-complete by phone+numeric-data-size.
It must scan store orders too, else pasted entries silently leave store orders
pending. Each provider entry matches at most ONE order (platform preferred, then
store); mutate the in-memory item status after a store match to avoid re-matching it
on later entries in the same batch.

**How to apply:** When adding any new admin action on orders, mirror the same
fallback. The admin UI sends loose statuses (`completed`/`cancelled`/`processing`/
`pending`) — normalize to the shared lifecycle (`Delivered`/`Failed`/`Processing`/
`Pending`) before validating. Store retries reset failed items to Pending and call
`dispatchStoreOrder` to re-send to MCBIS (frontend routes store rows to
`/retry-failed` via a `data-source` attribute on the action button).

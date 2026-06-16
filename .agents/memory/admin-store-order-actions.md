---
name: Admin actions on store orders
description: How admin orders-page actions (complete/cancel/retry/status) are made to work on StoreOrder, and why they route through the delivery service.
---

Store-link orders (`StoreOrder`, tagged `source:'store'`) are merged into the admin
main orders page alongside platform `Order`s. Every admin action must work on both.

**Rule:** The admin order action endpoints (`updateItemStatus`, `updateOrderStatus`,
`retryFailedItems` in `adminController.js`) look up `Order` first, then fall back to
`StoreOrder` (resolve by UUID PK via `findByPk`, else by `orderId` string). Store
status changes are applied through `storeOrderDelivery.updateItem(...)`, never by
writing `StoreOrder` directly.

**Why:** `updateItem` runs in a row-locked transaction and, on the `paid -> fulfilled`
(all items Delivered) transition, calls `ledgerService.recordSale` once to credit
commission/settlement. Bypassing it would either skip the ledger entry or risk
double-recording. It only transitions on first fulfillment, so it is idempotent and
never reverses `fulfilled -> paid`. Marking an order Failed leaves `status` as `paid`
(matches auto-delivery behavior; no spurious fulfillment/ledger).

**How to apply:** When adding any new admin action on orders, mirror the same
fallback. The admin UI sends loose statuses (`completed`/`cancelled`/`processing`/
`pending`) — normalize to the shared lifecycle (`Delivered`/`Failed`/`Processing`/
`Pending`) before validating. Store retries reset failed items to Pending and call
`dispatchStoreOrder` to re-send to MCBIS (frontend routes store rows to
`/retry-failed` via a `data-source` attribute on the action button).

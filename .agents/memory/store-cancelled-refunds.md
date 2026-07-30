---
name: MCBIS cancelled → auto-refund
description: How cancelled deliveries are refunded for platform vs store orders, and the double-refund safeguards
---
- Platform (wallet) orders: `cancelled`/`rejected` are terminal-failure statuses in ALL three paths (live poller, background sync, recovery phase 1) of orderStatusPoller; marking an item newly-Failed triggers the wallet refund inside `updateOrderItemStatus`. If you add a new MCBIS status, add it to all three checks.
- Store orders (Paystack): only `cancelled` triggers an automatic Paystack refund (`refundCancelledItem` in storeOrderDelivery); other failures stay manual by design.
- Refund is two-phase: claim `refundStatus:'processing'` + `refundClaimedAt` under row lock, then call Paystack, then persist `refunded`/`failed`. Stale claims (>10 min) are retried by `retryStuckRefunds` in the sweep, which first reconciles against Paystack's refund list by merchant_note match — never remove that reconciliation or crashes can double-refund.
- Order status flips to `refunded` only when every item is refunded and order was `paid`.
- Known gap: if an admin manually marks a store item Failed before MCBIS reports cancelled, poll paths skip it and no auto-refund fires — admin reconciles manually.

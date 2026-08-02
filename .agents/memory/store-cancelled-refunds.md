---
name: MCBIS cancelled → auto-refund
description: How cancelled deliveries are refunded for platform vs store orders, and the double-refund safeguards
---
- MCBIS returns `canceled` (one L), `cancelled`, or `failed` — both cancel spellings must appear in every status set (orderStatusPoller ×3 paths, mcbisProvider map, secureProviderService indicators, storeOrderDelivery). If you add a new MCBIS status, add it to all of them.
- Platform (wallet) orders: marking an item newly-Failed triggers the wallet refund inside `updateOrderItemStatus`.
- Store orders (Paystack): ONLY `cancelled`/`canceled` trigger an automatic Paystack refund (`refundCancelledItem`, REFUNDABLE_STATUSES in storeOrderDelivery). Per user's spec (Aug 2026): 'failed' can be temporary/ambiguous and must NOT move money automatically — failed/error/rejected/404 stay manual by design.
- Refund is two-phase: claim `refundStatus:'processing'` + `refundClaimedAt` under row lock, then call Paystack, then persist `refunded`/`failed`. Stale claims (>10 min) are retried by `retryStuckRefunds` in the sweep, which first reconciles against Paystack's refund list by merchant_note match — never remove that reconciliation or crashes can double-refund.
- Order status flips to `refunded` only when every item is refunded and order was `paid`.
- Known gap: if an admin manually marks a store item Failed before MCBIS reports cancelled, poll paths skip it and no auto-refund fires — admin reconciles manually.

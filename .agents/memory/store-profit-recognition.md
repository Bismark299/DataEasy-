---
name: Store profit recognition timing
description: When store-order profit/settlement is credited and the invariant that protects it
---

Store-order profit (ledgerService.recordSale → settlement availableBalance + REVENUE/COGS ledger entries) is credited at the **paid→fulfilled transition**, NOT at payment. Paying only sets status='paid'.

**Why:** owner requested profit be credited only when an order is actually delivered/fulfilled, so failed/undelivered paid orders never inflate the balance.

**How to apply:**
- recordSale must be called exactly ONCE per order, only when a transaction actually flips status paid→fulfilled.
- Both fulfillment paths take a row lock (`lock: t.LOCK.UPDATE`) on the StoreOrder and re-check `status === 'paid'` inside the txn before recording — auto-delivery (storeOrderDelivery.updateItem) and manual (fulfillOrder controller). They contend on the same row lock, so no double-credit.
- Any new fulfillment path MUST follow the same lock + status re-check + recordSale-in-same-transaction pattern.
- Financial reports must recognize revenue AND COGS at fulfillment: COGS filter is status='fulfilled' dated by fulfilledAt (revenue ledger entries are created at fulfillment). Do not revert COGS to include 'paid' or filter by paidAt.

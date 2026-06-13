---
name: Store order auto-delivery design
description: Why paid store orders are delivered by a separate service that mirrors the normal-order pipeline's recovery semantics
---

# Store order MCBIS auto-delivery

Paid StoreOrders are delivered to MCBIS by a dedicated service (`backend/services/storeOrderDelivery.js`), kept SEPARATE from the normal `orderStatusPoller`.

**Why separate:** normal `Order` delivery is coupled to wallet refunds and the `Order` model. Store orders are paid via Paystack by an external customer (no wallet), so on failed delivery there is NO automatic refund — admin reconciles manually. Reusing the normal poller would risk the live normal-order flow.

**Deliberate parity with the normal pipeline (do NOT "fix" these in isolation):**
- 7-day recovery cutoff: the background sweep ignores paid orders older than 7 days, exactly like `orderStatusPoller`'s `MAX_RECOVERY_AGE`. Aged stuck orders are handled manually by design.
- `providerReference` is persisted only AFTER `mcbisProvider.deliverBundle()` returns (same as `orderController`). The narrow crash-window risk is identical to the live, accepted normal flow. Idempotency relies on `deliverBundle`'s `existingReference` check + in-process `dispatchLock`.

**How to apply:** if asked to harden store delivery against double-send or stuck orders, change the normal-order pipeline and the store pipeline TOGETHER to keep them consistent — don't diverge one.

**Status model:** StoreOrder keeps `status` (payment lifecycle: pending/paid/fulfilled/cancelled/refunded) and a separate `deliveryStatus` VARCHAR (Pending/Processing/Delivered/Failed/Partially Delivered). When all items Delivered → status becomes 'fulfilled'. Frontend `orderDisplayStatus(o)` shows delivery status only while status==='paid'.

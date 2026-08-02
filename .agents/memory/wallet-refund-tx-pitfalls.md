---
name: Wallet refund transaction pitfalls
description: Postgres tx poisoning, Transaction.paymentMethod enum, and refund reference idempotency rules for wallet refunds
---

# Wallet refund transaction pitfalls

- **Postgres tx poisoning**: any SQL error inside a Sequelize transaction aborts the WHOLE transaction — a try/catch around one statement does NOT let the rest commit. If a side-write (e.g. refund Transaction record) must not block the main update, wrap it in a savepoint: `sequelize.transaction({ transaction: t }, async (st) => {...})`.
  - **Why:** In production (Aug 2026) a bad enum value in the refund insert silently rolled back the item's Failed status too, so the poller retried the same orders forever and no one got refunded.
- **Transaction.paymentMethod enum** is `('paystack','manual','momo','order','refund')` — there is NO `'wallet'`. `'wallet'` is valid only on Order.paymentMethod (different enum). Wallet refunds use `'refund'`.
- **Refund idempotency reference** must use the immutable order UUID (`order.id`), never the sequential display `orderId` — display IDs can be reused after purges, and a collision with an old unique reference silently skips the new customer's refund.

---
name: Order transaction reference uniqueness
description: Why order transaction references must use the order UUID, not the sequential orderId
---

# Order transaction references must use the internal UUID, not the sequential orderId

`transactions.reference` has a UNIQUE constraint. Order creation writes one
transaction per batch with `reference = 'ORDER-<...>'`.

**Rule:** Build the reference from the order's internal `id` (UUIDv4), never from
the human-facing sequential `orderId`.

**Why:** The sequential `orderId` comes from a Postgres sequence whose init block
(`generateOrderId`) resets the sequence to `MAX(orderId)` of *surviving* orders on
boot. If pending orders are purged but their transaction rows are left behind, the
sequence rewinds and new orders reuse old orderIds — then `ORDER-<orderId>` collides
with a leftover transaction reference, throwing SequelizeUniqueConstraintError. The
controller catch block turns that into a generic 500 "Failed to create order", which
surfaced as "bulk orders can't make payment".

**How to apply:** Any time you purge orders, also purge their transaction rows (or at
least don't rely on orderId uniqueness over time). Keep transaction `reference` keyed
on the order UUID. Also cap `description` at 255 chars (DataTypes.STRING) — batch
descriptions list every orderId and can overflow.

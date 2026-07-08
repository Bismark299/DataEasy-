---
name: Bulk push to MCBIS
description: Safety semantics of the admin bulk "Push to MCBIS" tool and its relationship to the recovery sweep
---

# Bulk Push to MCBIS — safety semantics

The admin bulk-push endpoint (date-range re-dispatch of stuck orders) classifies items strictly:

- **Delivered** → never touched.
- **Has providerReference** → NEVER re-sent, regardless of status. Processing-with-ref → status re-check only (recovery sweep phase 1). Failed-with-ref → counted separately (`failedAfterSend`) and left alone; only the per-order "Retry Failed Items" button (which deliberately clears refs) may retry those.
- **Processing without ref** → manual admin flow, skipped.
- **Failed without ref** → reset to Pending (ref stays null), then dispatched.
- **Pending without ref** → dispatched.

**Why:** re-sending anything with a providerReference risks double delivery — MCBIS may have delivered even if our record says Failed. The bulk tool is conservative by design; the per-order retry button is the explicit, admin-reviewed escape hatch.

**How to apply:** any change to bulk push, `recoverPendingOrders` (which now accepts `{startDate,endDate}` overriding the 7-day cutoff, still capped at 60s MIN_ORDER_AGE), or item classification must preserve these rules for BOTH platform Orders and StoreOrders. Reset phase must recompute aggregate status (platform inline, store via `computeOverall`) and always build new item arrays (JSONB pitfall). Concurrency: single module-level running flag + the sweep's dispatchLock/fresh-reload pre-checks.

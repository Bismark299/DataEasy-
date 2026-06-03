---
name: Settings query batching
description: N+1 fix applied to backend/models/Setting.js — getMultiple() batch method and refactored config loaders
---

## The fix
Added `Setting.getMultiple(keys[])` static method that fetches many settings keys in a single `WHERE key IN (...)` query and returns a plain object map.

## Refactored functions (all now use getMultiple)
- `getMcbisSettings`, `getNetworkAvailability`, `getClientUISettings`, `getAppSettings`, `getTopupFeeSettings`, `getSecuritySettings`, `getDepositLimits`
- Result: packages endpoint went from 10+ sequential queries down to 2 queries

**Why:** Each config loader previously called `Setting.getValue(key)` once per key, causing N sequential SELECT queries on every packages/config request. Batching via `WHERE key IN (...)` eliminates the N+1 pattern.

**How to apply:** Any new setting group added to Setting.js should use `getMultiple()` rather than repeated `getValue()` calls.

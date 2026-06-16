---
name: Sequelize JSONB mutation not persisted
description: Mutating a loaded JSONB object in place and saving silently skips the DB write
---

When updating a Sequelize JSONB column (e.g. `store.pricing`, any `metadata`), do NOT mutate the existing loaded object reference and then save it — Sequelize compares by reference, sees "no change", and skips the UPDATE. The write silently no-ops.

**Symptom seen:** store owner set a package selling price; `store.pricing` stayed `{}` in the DB; public store page kept showing the cost-price fallback.

**Why:** `const p = store.pricing || {}; p[key] = val; await store.update({ pricing: p })` passes the SAME reference Sequelize already holds, so `changed('pricing')` is false.

**How to apply:** build a NEW object reference before saving, e.g. `const p = { ...(store.pricing || {}) }; p[key] = val; await store.update({ pricing: p })`. Alternatively `instance.changed('pricing', true)` before `save()`. Applies to every JSONB/JSON column mutation.

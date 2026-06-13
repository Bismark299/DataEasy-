---
name: findByPk UUID fallback trap
description: Sequelize findByPk on a UUID PK throws on non-UUID input, silently breaking multi-strategy lookup chains.
---

# findByPk on UUID columns throws on non-UUID input

When a model's primary key is a Postgres `UUID` column, calling `Model.findByPk(ref)`
with a `ref` that is NOT a valid UUID (e.g. a slug or human code) does **not** return
null — Postgres rejects the cast with `invalid input syntax for type uuid`, which
Sequelize surfaces as a thrown error.

**Why it matters:** resolver helpers often try several strategies in order
(UUID → code → slug). If the UUID attempt is the first line and is unguarded, a
non-UUID `ref` throws before any fallback runs. The endpoint returns 500, and any
caller that treats all errors as "not found" masks the real cause.

**How to apply:** guard the `findByPk` behind a UUID-format check before calling it,
so non-UUID refs fall through to the other lookup strategies:
```js
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ref));
if (isUuid) { const x = await Model.findByPk(ref); if (x) return x; }
```
This bit the public store resolver (`findStoreByRef`): frontend builds store links
from the slugified store name, so every public link hit the unguarded findByPk and
500'd. Symptom on the client was a generic "store not found".

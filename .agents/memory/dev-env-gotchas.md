---
name: DataEasy+ dev env gotchas (schema migrations + tailwind purge)
description: Two non-obvious environment constraints that silently break things — schema column additions and tailwind content scanning.
---

**Schema: sync() does NOT add columns.** Startup uses `sequelize.sync()` WITHOUT `alter`, so adding a new field to a model does NOT create the column on the existing DB. New columns need an explicit idempotent `ALTER TABLE "<table>" ADD COLUMN IF NOT EXISTS ...` in the startup-migrations block in `backend/server.js` (alongside the MoMo enum migration). Table names are snake_case (e.g. `store_orders`).

**Tailwind: the `content` array must list every top-level dir that uses classes.** The frontend lives at workspace ROOT (`assets/`, `pages/`, `store/`, `admin/`). If a dir is missing from `tailwind.config.js` `content`, every arbitrary-value class used only there (e.g. `bg-[#0f172a]`, `bg-[#1e293b]`) gets purged from the built CSS — symptom was the store track modal rendering transparent + invisible white-on-white text. After editing config, rebuild: `npx --yes tailwindcss@3.4.19 -i ./assets/css/tailwind-src.css -o ./assets/css/tailwind.min.css --minify` (or `npm run build:css`). NOTE: `tailwindcss` is a devDependency that is NOT installed by default in a fresh env — run `npm install` first or the `build:css` script fails with `tailwindcss: not found`. Whenever you add NEW utility classes (esp. responsive `lg:` variants like `lg:grid-cols-5`, `lg:col-span-2`) to store/admin/pages HTML or JS, you MUST rebuild or they get purged and the layout silently breaks.

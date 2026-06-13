---
name: Screenshot tool can't verify authed pages
description: Why app-preview screenshots of store/admin dashboards show the login page
---

The `screenshot` (app_preview) tool runs in a fresh headless browser session with no
JWT in localStorage. Any page gated by auth (e.g. `/store/index.html`, `/admin/*`)
redirects it to the login page, so it cannot visually verify the authenticated view.

**Why:** Frontend auth stores the JWT in browser localStorage; the screenshot session
does not share the user's interactive browser state.

**How to apply:** To verify authed dashboards, rely on the workflow server logs instead —
confirm the relevant API endpoints (e.g. `/api/store`, `/api/store/dashboard`,
`/api/store/orders`) return 200 with real data. Don't treat a login-page screenshot of an
authed route as a bug.

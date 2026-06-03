---
name: XSS audit coverage
description: Which frontend files were audited/fixed for innerHTML XSS and what escaping functions each file uses
---

## Escaping functions per file type
- Admin HTML files (`admin/*.html`): use inline `esc()` at top of each file's `<script>` block; also available via `admin-common.js` global `esc()` at line 280
- `assets/js/store.js`: uses `escapeHtml()` (defined in the file)
- `assets/js/app.js`: uses `escHtml()` (defined at top of file)
- `assets/js/cart.js`: uses `escHtml()` (added during audit)
- `assets/js/admin.js`: uses `escHtml()` (added during audit)

## Files fully audited and fixed
- `admin/momo-deposits.html` — deposits table, detail modal, user search results
- `admin/orders.html` — orders table, order detail modal
- `admin/packages.html` — network grid cards
- `admin/index.html` — mobile cards, recent orders, order detail modal, renderUserCards/renderRecentOrders in admin.js
- `admin/reports.html` — agents table already used `esc()`; daily sales table uses only numbers/dates (safe)
- `assets/js/store.js` — financialContent error messages (e.message wrapped in escapeHtml)
- `assets/js/app.js` — createPackageCard pkg.data, cart/modal fields
- `assets/js/cart.js` — phone, network, package.data fields
- `assets/js/admin.js` — name/email/phone in user cards, orderId/userName/network/status in recent orders

## Files already safe (no changes needed)
- `admin/api-keys.html` — uses `escapeHtml()` throughout
- `admin/stores.html` — uses `escapeHtml()` throughout
- `assets/js/utils.js` — `options.innerHTML` is caller-controlled internal utility (low risk)

## Remaining low-risk patterns (intentionally not escaped)
- Server-generated enum values (network names: MTN/AirtelTigo/Telecel, order statuses)
- Numbers and currency formatted via `.toFixed()` / `parseFloat()`
- Static hardcoded HTML strings (empty-state messages, icon markup)
- `new Date(...).toLocaleString()` / `toLocaleDateString()` output

**Why:** Any field sourced from user registration (fullName, phone, email, agentCode) or user-provided order data (recipient phone, packageName) must be escaped before innerHTML injection. Server enum values and computed numbers are safe without escaping.

# Price Integrity & Single Source of Truth

## Overview

The DataEasy+ system enforces **database as the single source of truth** for all pricing. This document describes the architecture and safeguards in place.

## Core Principles

1. **Database is AUTHORITATIVE** - All prices come from PostgreSQL `packages` table
2. **NO STATIC FALLBACKS** - If database is unavailable, operations fail (fail closed)
3. **NO CLIENT-SIDE PRICES** - Frontend fetches prices from API, never stores static values
4. **IMMUTABLE ORDER SNAPSHOTS** - Prices are locked at order creation time
5. **AUDIT TRAIL** - All price changes are logged with admin attribution

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Admin Panel   │────▶│  Admin API      │────▶│   PostgreSQL    │
│   (Edit Prices) │     │  /api/admin/*   │     │   packages      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Orders API     │────▶│   Cache (30s)   │
│   (Display)     │     │  /api/orders/*  │     │   In-Memory     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Price Flow

### 1. Frontend Package Display

```
Frontend loads → calls /api/orders/packages → API fetches from DB → Returns with priceSource: 'database'
```

- Frontend `cart.js` starts with **empty** packages array
- Packages are populated via `syncPackagesFromAPI()` on page load
- If API fails, packages remain empty and checkout is blocked

### 2. Order Creation

```
User clicks Checkout → Frontend sends {packageId, phoneNumber} → Backend validates DB price → Creates immutable snapshot
```

Key validations in `orderController.js`:
- `findPackage()` fetches from database ONLY
- Validates `priceSource === 'database'`
- Validates `price > 0`
- Creates price snapshot with `priceLockedAt` timestamp

### 3. Admin Price Updates

```
Admin edits price → /api/admin/packages/:id → Logs old/new prices → Clears cache → Returns success
```

Key features:
- Old and new prices logged to `AdminAuditLog`
- Cache invalidated via `clearPackagesCache()`
- Changes take effect on next API call (within 30 seconds max)

## Safeguards

### Backend

| Component | Protection |
|-----------|------------|
| `packages.js` | No static prices, metadata only |
| `orderController.js` | Validates `priceSource === 'database'` |
| `orderController.js` | Validates price > 0 |
| `adminController.js` | Logs all price changes with attribution |
| `priceIntegrity.js` | Startup validation of all prices |
| `server.js` | Runs `runStartupValidation()` on boot |

### Frontend

| Component | Protection |
|-----------|------------|
| `cart.js` | Starts with empty packages array |
| `cart.js` | Validates `packagesLoaded` before operations |
| `cart.js` | Shows error if API fails (no fallback) |
| Order payload | Only sends `packageId` + `phoneNumber` (no prices) |

## Files Modified

### Backend

- **`backend/config/packages.js`** - Removed all static prices, metadata only
- **`backend/controllers/orderController.js`** - Added price validation, immutable snapshots
- **`backend/controllers/adminController.js`** - Enhanced price change logging
- **`backend/utils/priceIntegrity.js`** - NEW: Validation utilities
- **`backend/server.js`** - Added startup price validation

### Frontend

- **`assets/js/cart.js`** - Removed static prices, now API-only
- **`assets/js/admin-packages.js`** - Removed unused `getSamplePackages()`

### Database

- **`backend/models/Package.js`** - Documented seed data as initial-only

## How to Update Prices

1. Login to Admin Dashboard
2. Navigate to Packages Management
3. Click Edit on the package to change
4. Update `Price (₵)` and/or `Cost Price (₵)`
5. Click Save

⚠️ **DO NOT** modify code files to change prices. All pricing changes must go through the Admin Dashboard.

## Startup Validation

On server boot, `priceIntegrity.js` runs:

1. Fetches all packages from database
2. Validates each package has:
   - Valid `price` > 0
   - Valid `costPrice` (if set)
   - Positive profit margin (warns if cost >= price)
3. Logs validation results
4. **Does not block startup** on validation failure (logs warnings)

## Profit Warnings

If `costPrice >= price` for any package, the startup log will show:

```
⚠️ PROFIT WARNING: Package mtn-1gb has cost (5.00) >= selling price (4.50)
```

This should be fixed immediately via Admin Dashboard.

## Emergency: Database Unavailable

If the database becomes unavailable:

1. **API Behavior**: Returns HTTP 503 with `{ success: false, code: 'PACKAGES_UNAVAILABLE' }`
2. **Frontend Behavior**: Shows "Unable to load packages. Please refresh the page."
3. **Order Behavior**: All order creation blocked until database is restored

This is intentional (fail closed) to prevent using stale or incorrect prices.

## Testing Price Updates

1. Note current price in database
2. Update price via Admin Dashboard
3. Within 30 seconds, prices should reflect in:
   - Frontend package display
   - New order totals
4. Old orders retain their snapshot prices (immutable)

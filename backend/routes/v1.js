/**
 * Public Developer API Routes (v1)
 * These endpoints are authenticated via X-API-Key header
 * External websites use these to integrate with DataEasy+
 */

const express = require('express');
const router = express.Router();
const developerApiController = require('../controllers/developerApiController');
const { apiKeyAuth, requirePermission, apiKeyRateLimiter } = require('../middleware/apiKey');
const { optionalIdempotency } = require('../middleware/idempotency');

// All routes require API key authentication
router.use(apiKeyAuth);

// Packages (read-only, no strict rate limit — covered by global limiter)
router.get('/packages', requirePermission('packages:read'), developerApiController.getPackages);

// Orders: POST is rate-limited strictly, GET reads are not (prevents polling from blocking order creation)
router.post('/orders', requirePermission('orders:create'), apiKeyRateLimiter, optionalIdempotency, developerApiController.createOrder);
router.get('/orders', requirePermission('orders:read'), developerApiController.getOrders);
router.get('/orders/:orderId', requirePermission('orders:read'), developerApiController.getOrder);

// Account / Wallet (read-only)
router.get('/balance', requirePermission('account:read'), developerApiController.getBalance);
router.get('/account', requirePermission('account:read'), developerApiController.getAccount);

module.exports = router;

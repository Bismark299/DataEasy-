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
router.use(apiKeyRateLimiter);

// Packages
router.get('/packages', requirePermission('packages:read'), developerApiController.getPackages);

// Orders (idempotency prevents duplicate orders on retries)
router.post('/orders', requirePermission('orders:create'), optionalIdempotency, developerApiController.createOrder);
router.get('/orders', requirePermission('orders:read'), developerApiController.getOrders);
router.get('/orders/:orderId', requirePermission('orders:read'), developerApiController.getOrder);

// Account / Wallet
router.get('/balance', requirePermission('account:read'), developerApiController.getBalance);
router.get('/account', requirePermission('account:read'), developerApiController.getAccount);

module.exports = router;

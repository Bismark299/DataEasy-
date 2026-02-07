/**
 * Order Routes
 * Create and manage orders
 * With rate limiting and idempotency protection
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, optionalAuth } = require('../middleware/auth');
const { orderValidation, orderIdValidation } = require('../middleware/validation');
const { orderLimiter } = require('../middleware/rateLimiter');
const { requireIdempotency } = require('../middleware/idempotency');

// PUBLIC routes (no authentication required)
// Get packages - available to all visitors to show availability
// Uses optionalAuth to get user role for role-based pricing if logged in
router.get('/packages', optionalAuth, orderController.getPackages);
router.get('/packages/:network', optionalAuth, orderController.getPackagesByNetwork);

// Protected routes require authentication
router.use(protect);

// Order operations
// POST /orders - Create order with rate limiting and idempotency protection
router.post('/', orderLimiter, requireIdempotency, orderValidation, orderController.createOrder);

// Read operations (no rate limit for user's own data)
router.get('/', orderController.getOrders);
router.get('/:orderId', orderController.getOrder);
router.get('/:orderId/status', orderController.getOrderStatus);

module.exports = router;

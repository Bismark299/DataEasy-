/**
 * Store Routes
 * Agent-facing store management, data packages, orders, payouts, financials
 * Public customer-facing store routes (no auth)
 */

const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');
const { protect } = require('../middleware/auth');
const { publicStoreOrderLimiter, publicTrackLimiter } = require('../middleware/rateLimiter');

// ==========================================
// PUBLIC ROUTES (no auth - customer facing)
// ==========================================
// Static path first (before :storeId param catches "orders")
router.get('/public/orders/:reference/verify', storeController.verifyPublicPayment);
router.get('/public/track', publicTrackLimiter, storeController.trackPublicOrder);
// Parameterized store routes
router.get('/public/:storeId', storeController.getPublicStore);
router.get('/public/:storeId/packages', storeController.getPublicPackages);
router.post('/public/:storeId/orders', publicStoreOrderLimiter, storeController.createPublicOrder);

// ==========================================
// AUTHENTICATED ROUTES (agent)
// ==========================================
router.use(protect);

// Store management
router.post('/', storeController.createStore);
router.get('/', storeController.getStore);
router.put('/', storeController.updateStore);

// Dashboard
router.get('/dashboard', storeController.getDashboard);

// Data packages (MTN, Telecel, AirtelTigo)
router.get('/packages', storeController.getPackages);
router.put('/packages/pricing', storeController.savePricing);

// Store orders
router.post('/orders', storeController.createOrder);
router.get('/orders', storeController.getOrders);
router.get('/orders/:reference/verify', storeController.verifyOrderPayment);
router.put('/orders/:orderId/fulfill', storeController.fulfillOrder);

// Payouts
router.post('/payouts', storeController.requestPayout);
router.get('/payouts', storeController.getPayouts);

// Financial statements
router.get('/financials/income-statement', storeController.getIncomeStatement);
router.get('/financials/balance-sheet', storeController.getBalanceSheet);
router.get('/financials/cash-flow', storeController.getCashFlow);
router.get('/financials/ledger', storeController.getLedger);

module.exports = router;

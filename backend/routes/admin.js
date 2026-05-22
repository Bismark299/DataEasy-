/**
 * Admin Routes
 * Dashboard, order management, user management
 * With rate limiting for sensitive operations
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminStoreController = require('../controllers/adminStoreController');
const apiKeyController = require('../controllers/apiKeyController');
const { adminAuth } = require('../middleware/auth');
const { sensitiveAdminLimiter } = require('../middleware/rateLimiter');
const { requireIdempotency } = require('../middleware/idempotency');
const { cacheResponse } = require('../middleware/cache');

// All routes require admin authentication
router.use(adminAuth);

// Dashboard (read operations - cached)
router.get('/stats', cacheResponse(30), adminController.getStats);
router.get('/dashboard', cacheResponse(15), adminController.getDashboard);

// Orders management
router.get('/orders', cacheResponse(30), adminController.getAllOrders);
router.get('/orders/:orderId', adminController.getOrder);
router.put('/orders/:orderId/status', adminController.updateOrderStatus);
router.put('/orders/:orderId/item/:itemIndex/status', adminController.updateItemStatus);
router.put('/orders/bulk-item-status', adminController.bulkUpdateItemStatus);
router.put('/orders/match-complete', adminController.matchAndCompleteOrders);

// Users management
router.get('/users', cacheResponse(15), adminController.getAllUsers);
router.get('/users/:userId', adminController.getUser);
router.put('/users/:userId', sensitiveAdminLimiter, adminController.updateUser);

// Sensitive operations with rate limiting and idempotency
router.post('/users/:userId/wallet', sensitiveAdminLimiter, requireIdempotency, adminController.adjustWallet);
router.put('/users/:userId/status', sensitiveAdminLimiter, adminController.updateUserStatus);

// Transactions (read only)
router.get('/transactions', cacheResponse(30), adminController.getAllTransactions);

// Packages management
router.get('/packages', adminController.getPackages);
router.post('/packages', sensitiveAdminLimiter, adminController.createPackage);
router.put('/packages/bulk', sensitiveAdminLimiter, adminController.bulkUpdatePackages);
router.put('/packages/:id', sensitiveAdminLimiter, adminController.updatePackage);
router.delete('/packages/:id', sensitiveAdminLimiter, adminController.deletePackage);

// Data Provider (MCBIS) routes
router.get('/provider/balance', adminController.getProviderBalance);
router.get('/provider/products', adminController.getProviderProducts);
router.get('/provider/status/:reference', adminController.getProviderOrderStatus);
router.post('/provider/deliver', sensitiveAdminLimiter, adminController.deliverOrder);

// Secure Provider routes (with full safeguards)
router.post('/provider/secure-deliver', sensitiveAdminLimiter, adminController.secureDeliverOrder);
router.get('/provider/circuit-breaker', adminController.getCircuitBreakerStatus);
router.post('/provider/circuit-breaker/reset', sensitiveAdminLimiter, adminController.resetCircuitBreaker);
router.post('/provider/emergency-stop', sensitiveAdminLimiter, adminController.emergencyStop);
router.post('/provider/reconciliation', sensitiveAdminLimiter, adminController.runReconciliation);
router.get('/provider/summary', adminController.getProviderSummary);
router.post('/provider/refund', sensitiveAdminLimiter, requireIdempotency, adminController.processProviderRefund);

// Order Status Polling routes
router.get('/provider/active-polls', adminController.getActivePolls);
router.post('/provider/retry-poll', sensitiveAdminLimiter, adminController.retryPoll);
router.post('/provider/sync-status', sensitiveAdminLimiter, adminController.syncOrderStatus);

// Provider transaction review routes
router.get('/provider/transactions/review', adminController.getTransactionsForReview);
router.get('/provider/transactions/mismatches', adminController.getTransactionMismatches);
router.post('/provider/transactions/:id/review', sensitiveAdminLimiter, adminController.reviewProviderTransaction);

// Network availability settings (for client to show/hide networks)
router.get('/network-availability', adminController.getNetworkAvailability);
router.put('/network-availability', sensitiveAdminLimiter, adminController.updateNetworkAvailability);

// MCBIS Settings routes
router.get('/mcbis/settings', adminController.getMcbisSettings);
router.put('/mcbis/settings', sensitiveAdminLimiter, adminController.updateMcbisSettings);

// Topup fee settings routes
router.get('/fee-settings', adminController.getFeeSettings);
router.put('/fee-settings', sensitiveAdminLimiter, adminController.updateFeeSettings);

// General app settings routes
router.get('/app-settings', adminController.getAppSettings);
router.put('/app-settings', sensitiveAdminLimiter, adminController.updateAppSettings);

// ==========================================
// STORE MANAGEMENT (Admin)
// ==========================================
router.get('/stores/stats', adminStoreController.getStoreStats);
router.get('/stores/payouts', adminStoreController.getAllPayouts);
router.put('/stores/payouts/:payoutId/approve', sensitiveAdminLimiter, adminStoreController.approvePayout);
router.put('/stores/payouts/:payoutId/complete', sensitiveAdminLimiter, adminStoreController.completePayout);
router.put('/stores/payouts/:payoutId/reject', sensitiveAdminLimiter, adminStoreController.rejectPayout);
router.get('/stores/reconciliation', adminStoreController.getAllReconciliations);
router.put('/stores/reconciliations/:recordId/resolve', sensitiveAdminLimiter, adminStoreController.resolveReconciliation);
router.get('/stores', adminStoreController.getAllStores);
router.get('/stores/:storeId', adminStoreController.getStoreDetails);
router.put('/stores/:storeId', sensitiveAdminLimiter, adminStoreController.updateStoreSettings);
router.post('/stores/:storeId/adjust', sensitiveAdminLimiter, adminStoreController.adjustSettlement);
router.post('/stores/:storeId/reconcile', sensitiveAdminLimiter, adminStoreController.runReconciliation);
router.get('/stores/:storeId/reconciliations', adminStoreController.getReconciliations);

// ==========================================
// API KEY MANAGEMENT (Admin)
// ==========================================
router.get('/api-keys/stats', apiKeyController.adminGetStats);
router.get('/api-keys', apiKeyController.adminListKeys);
router.delete('/api-keys/:keyId', sensitiveAdminLimiter, apiKeyController.adminRevokeKey);

module.exports = router;

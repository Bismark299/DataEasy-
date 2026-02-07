/**
 * Wallet Routes
 * Balance, topup, transactions
 * With rate limiting and idempotency protection
 */

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect } = require('../middleware/auth');
const { topupValidation } = require('../middleware/validation');
const { topupLimiter } = require('../middleware/rateLimiter');
const { requireIdempotency } = require('../middleware/idempotency');

// All routes require authentication
router.use(protect);

// Read operations
router.get('/balance', walletController.getBalance);
router.get('/history', walletController.getHistory);

// Fee calculation (get fee before paying)
router.get('/topup/fee', walletController.calculateFee);

// Topup operations with rate limiting and idempotency protection
router.post('/topup', topupLimiter, requireIdempotency, topupValidation, walletController.initializeTopup);
router.get('/topup/verify/:reference', walletController.verifyTopup);

module.exports = router;

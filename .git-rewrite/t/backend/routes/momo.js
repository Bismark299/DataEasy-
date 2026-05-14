/**
 * MoMo Routes
 * Handles MoMo deposit endpoints from SMS listener
 */

const express = require('express');
const router = express.Router();
const {
    authenticateListener,
    processDeposit,
    getDeposits,
    manualCredit
} = require('../controllers/momoController');
const { adminAuth } = require('../middleware/auth');

/**
 * Public endpoint for SMS listener app
 * POST /api/momo/deposit
 * 
 * Authenticates via X-Auth-Token header
 */
router.post('/deposit', authenticateListener, processDeposit);

/**
 * Admin endpoints (require admin auth)
 */

// Get all deposits (with pagination and filters)
// GET /api/momo/deposits?status=unmatched&page=1&limit=50
router.get('/deposits', adminAuth, getDeposits);

// Manually credit a deposit to a user
// POST /api/momo/deposits/:id/credit
router.post('/deposits/:id/credit', adminAuth, manualCredit);

module.exports = router;

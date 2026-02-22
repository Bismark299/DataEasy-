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
const { authenticate } = require('../middleware/auth');

/**
 * Public endpoint for SMS listener app
 * POST /api/momo/deposit
 * 
 * Authenticates via X-Auth-Token header
 */
router.post('/deposit', authenticateListener, processDeposit);

/**
 * Admin endpoints (require user auth + admin check)
 */

// Get all deposits (with pagination and filters)
// GET /api/momo/deposits?status=unmatched&page=1&limit=50
router.get('/deposits', authenticate, async (req, res, next) => {
    // Check if admin (you may have middleware for this)
    if (req.user.role !== 'super-dealer' && !req.admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    getDeposits(req, res, next);
});

// Manually credit a deposit to a user
// POST /api/momo/deposits/:id/credit
router.post('/deposits/:id/credit', authenticate, async (req, res, next) => {
    if (req.user.role !== 'super-dealer' && !req.admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    manualCredit(req, res, next);
});

module.exports = router;

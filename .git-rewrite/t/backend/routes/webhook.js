/**
 * Webhook Routes
 * Paystack webhooks
 */

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Paystack webhook (no auth - verified by signature)
router.post('/paystack', webhookController.handlePaystack);

module.exports = router;

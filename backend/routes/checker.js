/**
 * MTN Order Status Checker Routes
 * Proxies status check requests to checker.instantdatagh.com
 */

const express = require('express');
const router = express.Router();
const checkerController = require('../controllers/checkerController');
const { requestTimeout } = require('../middleware/security');

router.post('/check', checkerController.check);
router.post('/bulk', requestTimeout(180000), checkerController.bulk);

module.exports = router;

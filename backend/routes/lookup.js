/**
 * Lookup Proxy Routes
 * Proxies allocation lookup requests to HST LOOKUP service
 */

const express = require('express');
const router = express.Router();
const lookupController = require('../controllers/lookupController');
const { requestTimeout } = require('../middleware/security');

router.post('/search', lookupController.search);
router.post('/bulk-search', requestTimeout(120000), lookupController.bulkSearch);
router.post('/export-download', lookupController.exportDownload);
router.get('/health', lookupController.health);

module.exports = router;

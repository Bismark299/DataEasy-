/**
 * Lookup Proxy Routes
 * POST /api/lookup/login  — public (password check against LOOKUP_PASSWORD env var)
 * All other routes require a valid lookup JWT.
 */

const express = require('express');
const router  = express.Router();
const lookupController = require('../controllers/lookupController');
const { requestTimeout }  = require('../middleware/security');

router.post('/login', lookupController.login);

router.use(lookupController.verifyLookupToken);

router.post('/search',          lookupController.search);
router.post('/bulk-search',     requestTimeout(120000), lookupController.bulkSearch);
router.post('/export-download', lookupController.exportDownload);
router.get('/health',           lookupController.health);

module.exports = router;

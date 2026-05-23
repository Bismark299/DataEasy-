/**
 * Lookup Proxy Routes
 * Proxies allocation lookup requests to HST LOOKUP service.
 * register / login are public; everything else requires a lookup token.
 */

const express = require('express');
const router = express.Router();
const lookupController = require('../controllers/lookupController');
const { requestTimeout } = require('../middleware/security');

// ── Public auth routes (no token needed) ────────────────────────────────────
router.post('/register', lookupController.register);
router.post('/login',    lookupController.login);

// ── Protected routes (lookup JWT required) ───────────────────────────────────
router.use(lookupController.verifyLookupToken);

router.post('/search',          lookupController.search);
router.post('/bulk-search',     requestTimeout(120000), lookupController.bulkSearch);
router.post('/export-download', lookupController.exportDownload);
router.get('/health',           lookupController.health);

module.exports = router;

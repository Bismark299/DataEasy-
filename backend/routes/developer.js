/**
 * Developer Routes
 * API key management for authenticated users
 */

const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKeyController');
const { protect } = require('../middleware/auth');

// All routes require user authentication (JWT)
router.use(protect);

// API key CRUD
router.post('/keys', apiKeyController.createKey);
router.get('/keys', apiKeyController.listKeys);
router.get('/keys/:keyId', apiKeyController.getKey);
router.put('/keys/:keyId', apiKeyController.updateKey);
router.delete('/keys/:keyId', apiKeyController.revokeKey);

module.exports = router;

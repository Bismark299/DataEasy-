/**
 * User Routes
 * Profile management
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.get('/orders', userController.getUserOrders);
router.get('/stats', userController.getUserStats);

module.exports = router;

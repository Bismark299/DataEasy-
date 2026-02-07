/**
 * Authentication Routes
 * Login, Register, Logout
 * With rate limiting for security
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { registerValidation, loginValidation, adminLoginValidation } = require('../middleware/validation');
const { protect } = require('../middleware/auth');
const { authLimiter, adminAuthLimiter, registrationLimiter, passwordLimiter } = require('../middleware/rateLimiter');

// Public routes with rate limiting
router.post('/register', registrationLimiter, registerValidation, authController.register);
router.post('/login', authLimiter, loginValidation, authController.login);
router.post('/admin/login', adminAuthLimiter, adminLoginValidation, authController.adminLogin);

// Protected routes
router.get('/me', protect, authController.getMe);
router.post('/logout', protect, authController.logout);
router.put('/password', protect, passwordLimiter, authController.changePassword);

module.exports = router;

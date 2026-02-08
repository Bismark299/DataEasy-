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
const { PAYSTACK_PUBLIC_KEY } = require('../config/paystack');

// Public config endpoint (returns non-sensitive config for frontend)
router.get('/config', (req, res) => {
    const publicKey = PAYSTACK_PUBLIC_KEY;
    
    // Log for debugging (only in development or when troubleshooting)
    if (!publicKey) {
        console.warn('⚠️ PAYSTACK_PUBLIC_KEY environment variable is not set!');
    } else {
        console.log('✅ Paystack public key configured:', publicKey.substring(0, 12) + '...');
    }
    
    res.json({
        success: true,
        config: {
            paystackPublicKey: publicKey || '',
            paystackConfigured: !!publicKey
        }
    });
});

// Public routes with rate limiting
router.post('/register', registrationLimiter, registerValidation, authController.register);
router.post('/login', authLimiter, loginValidation, authController.login);
router.post('/admin/login', adminAuthLimiter, adminLoginValidation, authController.adminLogin);

// Protected routes
router.get('/me', protect, authController.getMe);
router.post('/logout', protect, authController.logout);
router.put('/password', protect, passwordLimiter, authController.changePassword);

module.exports = router;

/**
 * Rate Limiting Configuration
 * Per-endpoint rate limits for security
 */

const rateLimit = require('express-rate-limit');

/**
 * Default rate limiter (general API)
 */
const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { 
        error: 'Too many requests',
        message: 'Please try again later'
    },
    standardHeaders: false, // Don't reveal rate limit info in headers
    legacyHeaders: false
});

/**
 * Strict limiter for authentication endpoints
 * Prevents brute force attacks
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: { 
        error: 'Too many attempts',
        message: 'Please try again later'
    },
    standardHeaders: false, // Don't reveal limits to attackers
    legacyHeaders: false,
    skipSuccessfulRequests: false // Count all attempts
});

/**
 * Admin auth limiter - even stricter
 */
const adminAuthLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 3, // 3 attempts per 30 minutes
    message: { 
        error: 'Too many attempts',
        message: 'Please try again later'
    },
    standardHeaders: false,
    legacyHeaders: false
});

/**
 * Order creation limiter
 * Prevents rapid-fire orders
 */
const orderLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 orders per minute max
    message: { 
        error: 'Please wait',
        message: 'Try again shortly'
    },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip // Limit per user
});

/**
 * Wallet topup limiter
 * Prevents payment spam
 */
const topupLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // 3 topup attempts per 5 minutes
    message: { 
        error: 'Please wait',
        message: 'Try again shortly'
    },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip
});

/**
 * Registration limiter
 * Prevents mass account creation
 */
const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 registrations per hour per IP (admin-managed platform)
    message: { 
        error: 'Registration unavailable',
        message: 'Please try again later'
    },
    standardHeaders: false,
    legacyHeaders: false
});

/**
 * Password change limiter
 */
const passwordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password changes per hour
    message: { 
        error: 'Please wait',
        message: 'Try again later'
    },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip
});

/**
 * Admin action limiter
 * Prevents rapid admin operations
 */
const adminActionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 admin actions per minute
    message: { 
        error: 'Please wait',
        message: 'Try again shortly'
    },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.admin?.username || req.ip
});

/**
 * Sensitive admin action limiter (wallet adjustments, etc.)
 */
const sensitiveAdminLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 sensitive actions per hour
    message: { 
        error: 'Please wait',
        message: 'Try again later'
    },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.admin?.username || req.ip
});

/**
 * Public store order limiter
 * Prevents spam on unauthenticated store order endpoints
 */
const publicStoreOrderLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 orders per minute per IP
    message: { 
        error: 'Please wait',
        message: 'Too many order attempts. Try again shortly.'
    },
    standardHeaders: false,
    legacyHeaders: false
});

module.exports = {
    defaultLimiter,
    authLimiter,
    adminAuthLimiter,
    orderLimiter,
    topupLimiter,
    registrationLimiter,
    passwordLimiter,
    adminActionLimiter,
    sensitiveAdminLimiter,
    publicStoreOrderLimiter
};

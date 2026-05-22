/**
 * Security Middleware
 * CSRF protection, HTTPS redirect, request timeout, etc.
 */

const crypto = require('crypto');

/**
 * CSRF Protection using Double Submit Cookie Pattern
 * More compatible than csurf (which is deprecated)
 */
const csrfProtection = {
    // Generate CSRF token
    generateToken: () => {
        return crypto.randomBytes(32).toString('hex');
    },

    // Middleware to set CSRF cookie
    setCookie: (req, res, next) => {
        if (!req.cookies?.csrf_token) {
            const token = crypto.randomBytes(32).toString('hex');
            res.cookie('csrf_token', token, {
                httpOnly: false, // Must be readable by JS
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });
        }
        next();
    },

    // Middleware to validate CSRF token
    validate: (req, res, next) => {
        // Skip for safe methods
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        // Skip for webhooks (they use signature verification)
        if (req.path.startsWith('/api/webhook')) {
            return next();
        }

        // Skip for API calls with Bearer token (API clients don't need CSRF)
        // CSRF is mainly for browser-based attacks
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return next();
        }

        const cookieToken = req.cookies?.csrf_token;
        const headerToken = req.headers['x-csrf-token'];

        if (!cookieToken || !headerToken) {
            return res.status(403).json({ 
                error: 'Invalid request',
                code: 'CSRF_MISSING'
            });
        }

        // Timing-safe comparison
        try {
            const valid = crypto.timingSafeEqual(
                Buffer.from(cookieToken),
                Buffer.from(headerToken)
            );
            if (!valid) {
                return res.status(403).json({ 
                    error: 'Invalid request',
                    code: 'CSRF_INVALID'
                });
            }
        } catch (e) {
            return res.status(403).json({ 
                error: 'Invalid request',
                code: 'CSRF_ERROR'
            });
        }

        next();
    }
};

/**
 * HTTPS Redirect for Production
 */
const httpsRedirect = (req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        // Check various headers that proxies/load balancers set
        const isHttps = req.secure || 
                        req.headers['x-forwarded-proto'] === 'https' ||
                        req.headers['x-forwarded-ssl'] === 'on';
        
        if (!isHttps) {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
    }
    next();
};

/**
 * Request Timeout Middleware
 * Prevents slow loris and similar attacks
 */
const requestTimeout = (timeoutMs = 30000) => {
    return (req, res, next) => {
        // Set timeout
        req.setTimeout(timeoutMs, () => {
            if (!res.headersSent) {
                res.status(408).json({ error: 'Request timeout' });
            }
        });

        // Also set response timeout
        res.setTimeout(timeoutMs, () => {
            if (!res.headersSent) {
                res.status(408).json({ error: 'Request timeout' });
            }
        });

        next();
    };
};

/**
 * Sanitize error messages for production
 * Prevents information leakage
 */
const sanitizeErrors = (err, req, res, next) => {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Log full error for debugging
    console.error('Error:', err);

    // Known safe errors - can show message
    const safeErrors = [
        'ValidationError',
        'UnauthorizedError',
        'JsonWebTokenError',
        'TokenExpiredError'
    ];

    if (err.name === 'ValidationError') {
        return res.status(400).json({ 
            error: 'Validation failed',
            ...(isProduction ? {} : { details: err.message })
        });
    }

    if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired' });
    }

    // Sequelize errors
    if (err.name === 'SequelizeValidationError') {
        return res.status(400).json({ 
            error: isProduction ? 'Invalid data' : err.errors[0]?.message 
        });
    }

    if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Resource already exists' });
    }

    if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(400).json({ error: 'Invalid reference' });
    }

    // Default - hide details in production
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
        error: isProduction ? 'An error occurred' : err.message,
        ...(isProduction ? {} : { stack: err.stack })
    });
};

/**
 * Security headers for API responses
 */
const securityHeaders = (req, res, next) => {
    // Only prevent caching on API routes — static assets should be browser-cached
    if (req.path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    // Additional security headers (helmet covers most, but these are extras)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Remove server identification
    res.removeHeader('X-Powered-By');
    
    next();
};

module.exports = {
    csrfProtection,
    httpsRedirect,
    requestTimeout,
    sanitizeErrors,
    securityHeaders
};

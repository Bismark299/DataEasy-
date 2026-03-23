/**
 * API Key Authentication Middleware
 * Validates external API keys for developer integrations
 */

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const ApiKey = require('../models/ApiKey');
const { User, Wallet } = require('../models');

/**
 * Authenticate requests using an API key (X-API-Key header)
 */
const apiKeyAuth = async (req, res, next) => {
    try {
        const rawKey = req.headers['x-api-key'];

        if (!rawKey) {
            return res.status(401).json({ success: false, error: 'Missing API key. Include X-API-Key header.' });
        }

        // Validate key format
        if (!rawKey.startsWith('de_live_') || rawKey.length < 40) {
            return res.status(401).json({ success: false, error: 'Invalid API key format.' });
        }

        const apiKey = await ApiKey.findByRawKey(rawKey);

        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Invalid API key.' });
        }

        // Check expiry
        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
            return res.status(401).json({ success: false, error: 'API key has expired.' });
        }

        // Check IP whitelist
        if (apiKey.allowedIPs && apiKey.allowedIPs.length > 0) {
            const clientIP = req.ip || req.connection.remoteAddress;
            if (!apiKey.allowedIPs.includes(clientIP)) {
                return res.status(403).json({ success: false, error: 'Request from unauthorized IP address.' });
            }
        }

        // Check domain whitelist via Origin / Referer
        if (apiKey.allowedDomains && apiKey.allowedDomains.length > 0) {
            const origin = req.headers.origin || req.headers.referer || '';
            let hostname = '';
            try {
                hostname = new URL(origin).hostname;
            } catch (_) { /* server-to-server won't have origin */ }

            // Only enforce if request comes from a browser (has Origin)
            if (origin && !apiKey.allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) {
                return res.status(403).json({ success: false, error: 'Request from unauthorized domain.' });
            }
        }

        // Load the owning user
        const user = await User.findByPk(apiKey.userId, {
            attributes: { exclude: ['password'] },
            include: [{ model: Wallet, as: 'wallet' }]
        });

        if (!user || !user.isActive) {
            return res.status(403).json({ success: false, error: 'API key owner account is inactive.' });
        }

        // Attach context to request
        req.apiKey = apiKey;
        req.user = user;

        // Update usage stats asynchronously (don't block the request)
        const clientIP = req.ip || req.connection.remoteAddress;
        ApiKey.update(
            { lastUsedAt: new Date(), lastUsedIP: clientIP, requestCount: apiKey.requestCount + 1 },
            { where: { id: apiKey.id } }
        ).catch(() => {});

        next();
    } catch (error) {
        console.error('API Key auth error:', error.message);
        return res.status(500).json({ success: false, error: 'Authentication failed.' });
    }
};

/**
 * Check if the authenticated API key has a specific permission
 */
const requirePermission = (...requiredPermissions) => {
    return (req, res, next) => {
        if (!req.apiKey) {
            return res.status(401).json({ success: false, error: 'API key required.' });
        }

        const keyPerms = req.apiKey.permissions || [];
        const missing = requiredPermissions.filter(p => !keyPerms.includes(p));

        if (missing.length > 0) {
            return res.status(403).json({
                success: false,
                error: `Insufficient permissions. Missing: ${missing.join(', ')}`
            });
        }

        next();
    };
};

/**
 * Per-key rate limiter (uses the key's rateLimit field)
 */
const apiKeyRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: (req) => {
        return (req.apiKey && req.apiKey.rateLimit) ? req.apiKey.rateLimit : 60;
    },
    keyGenerator: (req) => {
        return req.apiKey ? req.apiKey.id : req.ip;
    },
    message: { success: false, error: 'Rate limit exceeded. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    apiKeyAuth,
    requirePermission,
    apiKeyRateLimiter
};

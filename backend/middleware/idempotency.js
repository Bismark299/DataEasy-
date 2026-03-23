/**
 * Idempotency Middleware
 * Prevents duplicate request processing for critical operations
 */

const crypto = require('crypto');
const { IdempotencyKey } = require('../models');
const logger = require('../utils/logger');

/**
 * Generate hash of request body for validation
 */
function hashRequestBody(body) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(body || {}))
        .digest('hex');
}

/**
 * Idempotency middleware for critical operations
 * Requires X-Idempotency-Key header
 */
const requireIdempotency = async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];
    
    // Require idempotency key for POST/PUT requests
    if (!idempotencyKey) {
        return res.status(400).json({
            error: 'Idempotency key required',
            message: 'Please include X-Idempotency-Key header for this operation'
        });
    }

    // Validate key format (UUID or similar)
    if (idempotencyKey.length < 16 || idempotencyKey.length > 255) {
        return res.status(400).json({
            error: 'Invalid idempotency key',
            message: 'Idempotency key must be between 16 and 255 characters'
        });
    }

    const userId = req.user?.id || req.admin?.id || req.admin?.username;
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const endpoint = req.originalUrl;
    const method = req.method;
    const requestHash = hashRequestBody(req.body);

    try {
        // Check if key already exists - scoped by endpoint to prevent cross-endpoint reuse
        const existingKey = await IdempotencyKey.findValidKey(idempotencyKey, userId, endpoint);

        if (existingKey) {
            // Key exists - check status
            if (existingKey.status === 'completed') {
                // Return cached response
                logger.debug('Idempotency hit: returning cached response', { idempotencyKey });
                return res.status(existingKey.responseCode || 200).json({
                    ...existingKey.responseBody,
                    _idempotent: true,
                    _cached: true
                });
            }
            
            if (existingKey.status === 'processing') {
                // Request is still being processed
                return res.status(409).json({
                    error: 'Request in progress',
                    message: 'A request with this idempotency key is already being processed'
                });
            }

            if (existingKey.status === 'failed') {
                // Previous request failed - allow retry with same key
                // But validate request body matches
                if (existingKey.requestHash !== requestHash) {
                    return res.status(400).json({
                        error: 'Request mismatch',
                        message: 'Request body does not match original request for this idempotency key'
                    });
                }
                // Delete failed key and allow retry
                await existingKey.destroy();
            }
        }

        // Create new idempotency record
        const keyRecord = await IdempotencyKey.createKey(
            idempotencyKey,
            userId,
            endpoint,
            method,
            requestHash
        );

        // Attach to request for later use
        req.idempotencyKey = keyRecord;

        // Override res.json to capture response
        const originalJson = res.json.bind(res);
        res.json = async function(data) {
            try {
                if (keyRecord && keyRecord.status === 'processing') {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        await keyRecord.markCompleted(res.statusCode, data);
                    } else {
                        await keyRecord.markFailed(res.statusCode, data);
                    }
                }
            } catch (e) {
                logger.error('Failed to update idempotency key', { error: e.message });
            }
            return originalJson(data);
        };

        next();
    } catch (error) {
        logger.error('Idempotency middleware error', { error: error.message });
        // Fail closed: reject request if idempotency check fails
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'Could not verify request uniqueness. Please retry.'
        });
    }
};

/**
 * Optional idempotency - uses key if provided, otherwise proceeds
 */
const optionalIdempotency = async (req, res, next) => {
    const idempotencyKey = req.headers['x-idempotency-key'];
    
    if (!idempotencyKey) {
        return next();
    }

    return requireIdempotency(req, res, next);
};

/**
 * Cleanup job for expired keys
 */
const cleanupIdempotencyKeys = async () => {
    try {
        const deleted = await IdempotencyKey.cleanupExpired();
        logger.info('Cleaned up expired idempotency keys', { count: deleted });
    } catch (error) {
        logger.error('Idempotency cleanup error', { error: error.message });
    }
};

// Run cleanup every hour
setInterval(cleanupIdempotencyKeys, 60 * 60 * 1000);

module.exports = {
    requireIdempotency,
    optionalIdempotency,
    cleanupIdempotencyKeys
};

/**
 * API Response Caching Middleware
 * In-memory cache for frequently accessed, rarely changing data
 */

const logger = require('../utils/logger');

// Simple in-memory cache
const cache = new Map();
const cacheStats = { hits: 0, misses: 0 };

/**
 * Cache entry structure
 */
class CacheEntry {
    constructor(data, ttlSeconds) {
        this.data = data;
        this.expiresAt = Date.now() + (ttlSeconds * 1000);
    }

    isExpired() {
        return Date.now() > this.expiresAt;
    }
}

/**
 * Generate cache key from request
 */
function generateCacheKey(req) {
    // Include user role for role-specific responses
    const role = req.user?.role || 'guest';
    return `${req.method}:${req.originalUrl}:${role}`;
}

/**
 * Cache middleware factory
 * @param {number} ttlSeconds - Time to live in seconds
 * @param {Object} options - Additional options
 */
function cacheResponse(ttlSeconds = 60, options = {}) {
    const { 
        keyGenerator = generateCacheKey,
        condition = () => true,  // Only cache if condition returns true
        varyByUser = false       // If true, cache per user
    } = options;

    return (req, res, next) => {
        // Skip caching for non-GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Check condition
        if (!condition(req)) {
            return next();
        }

        // Generate cache key
        let cacheKey = keyGenerator(req);
        if (varyByUser && req.user?.id) {
            cacheKey += `:user:${req.user.id}`;
        }

        // Check cache
        const cached = cache.get(cacheKey);
        if (cached && !cached.isExpired()) {
            cacheStats.hits++;
            // Add cache headers
            res.set('X-Cache', 'HIT');
            res.set('X-Cache-TTL', Math.round((cached.expiresAt - Date.now()) / 1000));
            return res.json(cached.data);
        }

        cacheStats.misses++;

        // Store original json method
        const originalJson = res.json.bind(res);

        // Override json method to cache response
        res.json = (data) => {
            // Only cache successful responses
            if (res.statusCode >= 200 && res.statusCode < 300) {
                cache.set(cacheKey, new CacheEntry(data, ttlSeconds));
            }
            res.set('X-Cache', 'MISS');
            return originalJson(data);
        };

        next();
    };
}

/**
 * Invalidate cache entries matching a pattern
 * @param {string|RegExp} pattern - Pattern to match cache keys
 */
function invalidateCache(pattern) {
    let count = 0;
    for (const key of cache.keys()) {
        if (typeof pattern === 'string' ? key.includes(pattern) : pattern.test(key)) {
            cache.delete(key);
            count++;
        }
    }
    logger.debug(`Cache invalidated: ${count} entries matching ${pattern}`);
    return count;
}

/**
 * Clear entire cache
 */
function clearCache() {
    const size = cache.size;
    cache.clear();
    logger.info(`Cache cleared: ${size} entries removed`);
    return size;
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    const hitRate = cacheStats.hits + cacheStats.misses > 0 
        ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2)
        : 0;
    
    return {
        size: cache.size,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: `${hitRate}%`
    };
}

/**
 * Cleanup expired entries (run periodically)
 */
function cleanupExpired() {
    let removed = 0;
    for (const [key, entry] of cache.entries()) {
        if (entry.isExpired()) {
            cache.delete(key);
            removed++;
        }
    }
    if (removed > 0) {
        logger.debug(`Cache cleanup: ${removed} expired entries removed`);
    }
    return removed;
}

// Run cleanup every 5 minutes
setInterval(cleanupExpired, 5 * 60 * 1000);

// Predefined cache configurations
const cacheConfigs = {
    // Packages change rarely - cache for 5 minutes
    packages: cacheResponse(300, {
        keyGenerator: (req) => `packages:${req.user?.role || 'guest'}`
    }),
    
    // Settings - cache for 2 minutes
    settings: cacheResponse(120),
    
    // User-specific data - short cache, vary by user
    userSpecific: cacheResponse(30, { varyByUser: true }),
    
    // Public data - longer cache
    public: cacheResponse(600)
};

module.exports = {
    cacheResponse,
    invalidateCache,
    clearCache,
    getCacheStats,
    cleanupExpired,
    cacheConfigs
};

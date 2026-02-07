/**
 * Maintenance Mode Middleware
 * Blocks all API requests when maintenance mode is enabled
 * Allows admin routes to still function for managing maintenance
 */

const { Setting } = require('../models');
const logger = require('../utils/logger');

// Cache maintenance status for 30 seconds to avoid DB hits on every request
let maintenanceCache = {
    isEnabled: false,
    lastChecked: 0
};
const CACHE_TTL = 30000; // 30 seconds

const checkMaintenance = async () => {
    const now = Date.now();
    
    // Return cached value if still valid
    if (now - maintenanceCache.lastChecked < CACHE_TTL) {
        return maintenanceCache.isEnabled;
    }

    try {
        const isEnabled = await Setting.isMaintenanceMode();
        maintenanceCache = {
            isEnabled,
            lastChecked: now
        };
        return isEnabled;
    } catch (error) {
        logger.error('Failed to check maintenance mode', { error: error.message });
        // Default to not in maintenance if DB check fails
        return false;
    }
};

// Clear cache (call when maintenance mode is toggled)
const clearMaintenanceCache = () => {
    maintenanceCache.lastChecked = 0;
};

const maintenanceMode = async (req, res, next) => {
    // Always allow these paths even in maintenance mode
    const allowedPaths = [
        '/api/admin',          // Admin panel must work to disable maintenance
        '/api/auth/admin',     // Admin login must work
        '/health',             // Health checks
        '/api/webhook'         // Payment webhooks must still work
    ];

    // Check if path is allowed
    const isAllowed = allowedPaths.some(path => req.path.startsWith(path));
    if (isAllowed) {
        return next();
    }

    // Check maintenance mode
    const isMaintenanceEnabled = await checkMaintenance();
    
    if (isMaintenanceEnabled) {
        logger.info('Request blocked - maintenance mode', { 
            path: req.path, 
            method: req.method,
            ip: req.ip 
        });
        
        return res.status(503).json({
            error: 'Service temporarily unavailable',
            message: 'We are currently performing scheduled maintenance. Please try again later.',
            maintenance: true
        });
    }

    next();
};

module.exports = { 
    maintenanceMode, 
    clearMaintenanceCache,
    checkMaintenance 
};

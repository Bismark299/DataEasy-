/**
 * Production-ready Logger Utility
 * Respects NODE_ENV and provides structured logging
 */

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'warn' : 'debug');

// Log levels: error > warn > info > debug
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const currentLevel = LOG_LEVELS[logLevel] ?? LOG_LEVELS.info;

/**
 * Format log message with timestamp
 */
function formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    
    if (isProduction) {
        // JSON format for production (easier to parse by log aggregators)
        return JSON.stringify({
            timestamp,
            level,
            message,
            ...meta
        });
    }
    
    // Human-readable format for development
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level) {
    return LOG_LEVELS[level] <= currentLevel;
}

const logger = {
    /**
     * Error level - always logged, represents failures
     */
    error(message, meta = {}) {
        if (shouldLog('error')) {
            console.error(formatMessage('error', message, meta));
            if (meta.error && isDevelopment) {
                console.error(meta.error);
            }
        }
    },

    /**
     * Warning level - potential issues
     */
    warn(message, meta = {}) {
        if (shouldLog('warn')) {
            console.warn(formatMessage('warn', message, meta));
        }
    },

    /**
     * Info level - general operational information
     */
    info(message, meta = {}) {
        if (shouldLog('info')) {
            console.log(formatMessage('info', message, meta));
        }
    },

    /**
     * Debug level - detailed debugging info (development only)
     */
    debug(message, meta = {}) {
        if (shouldLog('debug')) {
            console.log(formatMessage('debug', message, meta));
        }
    },

    /**
     * Security events - always log these for audit purposes
     */
    security(message, meta = {}) {
        // Security events should always be logged regardless of level
        console.log(formatMessage('security', message, meta));
    },

    /**
     * Financial transactions - always log for audit trail
     */
    financial(message, meta = {}) {
        // Financial events should always be logged regardless of level
        console.log(formatMessage('financial', message, meta));
    }
};

module.exports = logger;

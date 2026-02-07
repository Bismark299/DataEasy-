/**
 * Authentication Middleware
 * JWT verification and user authentication
 * Updated for PostgreSQL/Sequelize
 */

const jwt = require('jsonwebtoken');
const { User } = require('../models');

/**
 * Protect routes - require authentication
 */
const protect = async (req, res, next) => {
    try {
        let token;

        // Get token from header
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ error: 'Not authorized, no token' });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from token (Sequelize uses findByPk instead of findById)
        const user = await User.findByPk(decoded.id, {
            attributes: { exclude: ['password'] }
        });

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (!user.isActive) {
            return res.status(401).json({ error: 'Account is deactivated' });
        }

        // Check token version for invalidation (password change, etc.)
        if (decoded.tokenVersion !== undefined && user.tokenVersion !== undefined) {
            if (decoded.tokenVersion !== user.tokenVersion) {
                return res.status(401).json({ error: 'Token expired. Please login again.' });
            }
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        return res.status(401).json({ error: 'Not authorized, token failed' });
    }
};

/**
 * Admin authentication
 */
const adminAuth = (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ error: 'Not authorized, no token' });
        }

        // Verify admin token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Not authorized, token failed' });
    }
};

/**
 * Generate JWT Token
 */
const generateToken = (payload, expiresIn = process.env.JWT_EXPIRE || '24h') => {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Optional auth - attach user if token exists, but don't require it
 */
const optionalAuth = async (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findByPk(decoded.id, {
                attributes: { exclude: ['password'] }
            });
            if (user && user.isActive) {
                // Check token version
                if (decoded.tokenVersion === undefined || decoded.tokenVersion === user.tokenVersion) {
                    req.user = user;
                }
            }
        }
        next();
    } catch (error) {
        // Token invalid, continue without user
        next();
    }
};

module.exports = {
    protect,
    adminAuth,
    generateToken,
    optionalAuth
};

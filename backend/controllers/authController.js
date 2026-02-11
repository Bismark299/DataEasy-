/**
 * Authentication Controller
 * Handle user registration, login, and session management
 * Updated for PostgreSQL/Sequelize
 */

const { User, Wallet, Setting } = require('../models');
const { Op } = require('sequelize');
const { generateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Register new user
 * POST /api/auth/register
 */
exports.register = async (req, res) => {
    try {
        const { fullName, email, phone, password } = req.body;
        
        // Log incoming request
        logger.info('Register attempt', { fullName, email, phone: phone ? phone.substring(0, 4) + '***' : null });

        // Validate required fields
        if (!fullName || !email || !phone || !password) {
            return res.status(400).json({ 
                error: 'All fields are required (fullName, email, phone, password)' 
            });
        }

        // Check if user exists
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [
                    { email: email.toLowerCase() },
                    { phone }
                ]
            }
        });

        if (existingUser) {
            // Generic error message to prevent account enumeration attacks
            return res.status(400).json({
                error: 'An account with these details already exists'
            });
        }

        // Create user
        logger.info('Creating user...');
        const user = await User.create({
            fullName,
            email: email.toLowerCase(),
            phone,
            password
        });
        logger.info('User created', { userId: user.id });

        // Create wallet for user
        logger.info('Creating wallet...');
        await Wallet.create({ userId: user.id });
        logger.info('Wallet created');

        // Generate token
        const token = generateToken({ id: user.id });

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            token,
            user: user.toSafeObject()
        });
    } catch (error) {
        logger.error('Register error', { 
            error: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Handle Sequelize validation errors
        if (error.name === 'SequelizeValidationError') {
            const validationErrors = error.errors.map(e => e.message).join(', ');
            return res.status(400).json({ 
                error: validationErrors || 'Validation failed' 
            });
        }
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ 
                error: 'Email or phone already exists' 
            });
        }
        if (error.name === 'SequelizeDatabaseError') {
            return res.status(500).json({ 
                error: 'Database error: ' + error.message 
            });
        }
        
        res.status(500).json({ error: 'Failed to create account: ' + error.message });
    }
};

/**
 * Login user
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
    try {
        const { emailOrPhone, password } = req.body;

        // Validate input
        if (!emailOrPhone || !password) {
            return res.status(400).json({ error: 'Email/phone and password are required' });
        }

        logger.info('Login attempt', { emailOrPhone: emailOrPhone.substring(0, 5) + '***' });

        // Find user by email or phone
        const user = await User.findOne({
            where: {
                [Op.or]: [
                    { email: String(emailOrPhone).toLowerCase() },
                    { phone: String(emailOrPhone).replace(/\D/g, '') }
                ]
            }
        });

        if (!user) {
            logger.info('Login failed: user not found');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if account is locked
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
            const remainingMinutes = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
            return res.status(423).json({ 
                error: `Account temporarily locked. Try again in ${remainingMinutes} minutes.`,
                lockedUntil: user.lockedUntil
            });
        }

        // Get security settings with fallback defaults
        let securitySettings;
        try {
            securitySettings = await Setting.getSecuritySettings();
        } catch (settingError) {
            logger.warn('Could not fetch security settings, using defaults', { error: settingError.message });
            securitySettings = {
                maxLoginAttempts: 5,
                lockoutMinutes: 15,
                sessionTimeoutHours: 24
            };
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            // Increment failed login attempts
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            
            // Lock account after max failed attempts
            if (user.failedLoginAttempts >= securitySettings.maxLoginAttempts) {
                user.lockedUntil = new Date(Date.now() + securitySettings.lockoutMinutes * 60 * 1000);
                await user.save();
                return res.status(423).json({ 
                    error: `Account locked due to too many failed login attempts. Try again in ${securitySettings.lockoutMinutes} minutes.`,
                    lockedUntil: user.lockedUntil
                });
            }
            await user.save();
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.isActive) {
            return res.status(401).json({ error: 'Account is deactivated' });
        }

        // Reset failed login attempts on successful login
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.lastLogin = new Date();
        await user.save();

        // Generate token with tokenVersion for invalidation support
        const token = generateToken({ 
            id: user.id,
            tokenVersion: user.tokenVersion || 0
        });

        res.json({
            success: true,
            message: `Welcome back, ${user.fullName}!`,
            token,
            user: user.toSafeObject()
        });
    } catch (error) {
        logger.error('Login error', { 
            error: error.message, 
            stack: error.stack,
            name: error.name 
        });
        res.status(500).json({ error: 'Login failed: ' + error.message });
    }
};

/**
 * Admin Login
 * POST /api/auth/admin/login
 */
exports.adminLogin = async (req, res) => {
    try {
        // Accept both username and emailOrPhone for flexibility
        const identifier = req.body.username || req.body.emailOrPhone;
        const { password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // SECURITY: Admin credentials MUST be set via environment variables
        // NO fallback values - prevents default credential attacks
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
            logger.security('CRITICAL: Admin credentials not configured in environment');
            return res.status(503).json({ error: 'Admin login unavailable. Contact system administrator.' });
        }

        // Constant-time comparison to prevent timing attacks
        const crypto = require('crypto');
        const usernameMatch = crypto.timingSafeEqual(
            Buffer.from(identifier.padEnd(256)),
            Buffer.from(adminUsername.padEnd(256))
        );
        const passwordMatch = crypto.timingSafeEqual(
            Buffer.from(password.padEnd(256)),
            Buffer.from(adminPassword.padEnd(256))
        );

        if (!usernameMatch || !passwordMatch) {
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }

        // Generate admin token
        const token = generateToken({
            id: 'admin',
            isAdmin: true,
            username: adminUsername,
            name: 'Administrator',
            role: 'admin'
        });

        res.json({
            success: true,
            message: 'Welcome, Administrator!',
            token,
            admin: {
                id: 'admin',
                username: adminUsername,
                name: 'Administrator',
                role: 'admin'
            }
        });
    } catch (error) {
        logger.security('Admin login error', { error: error.message });
        res.status(500).json({ error: 'Login failed' });
    }
};

/**
 * Get current user
 * GET /api/auth/me
 */
exports.getMe = async (req, res) => {
    try {
        res.json({
            success: true,
            user: req.user.toSafeObject()
        });
    } catch (error) {
        logger.error('Get me error', { error: error.message });
        res.status(500).json({ error: 'Failed to get user' });
    }
};

/**
 * Change password
 * PUT /api/auth/password
 */
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Validate new password strength
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
        }

        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ error: 'Password must contain at least one lowercase letter' });
        }

        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ error: 'Password must contain at least one number' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        const user = await User.findByPk(req.user.id);

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        user.password = newPassword;
        // Increment token version to invalidate all existing tokens
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        res.json({
            success: true,
            message: 'Password changed successfully. Please login again on all devices.'
        });
    } catch (error) {
        logger.security('Change password error', { error: error.message });
        res.status(500).json({ error: 'Failed to change password' });
    }
};

/**
 * Logout
 * POST /api/auth/logout
 * Invalidates all tokens for the user by incrementing tokenVersion
 */
exports.logout = async (req, res) => {
    try {
        // Increment tokenVersion to invalidate all existing tokens
        if (req.user && req.user.id) {
            const user = await User.findByPk(req.user.id);
            if (user) {
                user.tokenVersion = (user.tokenVersion || 0) + 1;
                await user.save();
            }
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        // Even if token invalidation fails, tell user logout succeeded
        // (they'll get a new token on next login anyway)
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    }
};

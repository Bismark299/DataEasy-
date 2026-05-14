/**
 * API Key Controller
 * Manage API keys for user accounts (agents/dealers)
 * Users manage their own keys; admins can view all keys
 */

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const { User } = require('../models');
const logger = require('../utils/logger');

const VALID_PERMISSIONS = [
    'packages:read',
    'orders:create',
    'orders:read',
    'account:read'
];

const MAX_KEYS_PER_USER = 5;

/**
 * Create a new API key for the authenticated user
 * POST /api/developer/keys
 */
exports.createKey = async (req, res) => {
    try {
        const { name, permissions, allowedIPs, allowedDomains, rateLimit: customRateLimit } = req.body;

        if (!name || name.trim().length < 2 || name.trim().length > 100) {
            return res.status(400).json({ success: false, error: 'Name is required (2-100 characters).' });
        }

        // Validate permissions
        const perms = permissions || ['packages:read', 'orders:create', 'orders:read'];
        const invalidPerms = perms.filter(p => !VALID_PERMISSIONS.includes(p));
        if (invalidPerms.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid permissions: ${invalidPerms.join(', ')}`,
                validPermissions: VALID_PERMISSIONS
            });
        }

        // Max keys check
        const existingCount = await ApiKey.count({ where: { userId: req.user.id } });
        if (existingCount >= MAX_KEYS_PER_USER) {
            return res.status(400).json({ success: false, error: `Maximum ${MAX_KEYS_PER_USER} API keys allowed per account.` });
        }

        // Validate IPs
        if (allowedIPs && Array.isArray(allowedIPs)) {
            const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
            for (const ip of allowedIPs) {
                if (!ipRegex.test(ip)) {
                    return res.status(400).json({ success: false, error: `Invalid IP address: ${ip}` });
                }
            }
        }

        // Validate domains
        if (allowedDomains && Array.isArray(allowedDomains)) {
            const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            for (const domain of allowedDomains) {
                if (!domainRegex.test(domain)) {
                    return res.status(400).json({ success: false, error: `Invalid domain: ${domain}` });
                }
            }
        }

        // Generate key
        const { fullKey, keyHash, keyPrefix } = ApiKey.generateKey();

        const apiKey = await ApiKey.create({
            userId: req.user.id,
            name: name.trim(),
            keyPrefix,
            keyHash,
            permissions: perms,
            allowedIPs: allowedIPs || [],
            allowedDomains: allowedDomains || [],
            rateLimit: customRateLimit || 60
        });

        logger.info('API key created', { userId: req.user.id, keyId: apiKey.id, name: name.trim() });

        res.status(201).json({
            success: true,
            message: 'API key created. Copy the key now — it will not be shown again.',
            key: {
                id: apiKey.id,
                name: apiKey.name,
                apiKey: fullKey,  // Only shown once
                prefix: apiKey.keyPrefix,
                permissions: apiKey.permissions,
                rateLimit: apiKey.rateLimit,
                createdAt: apiKey.createdAt
            }
        });
    } catch (error) {
        logger.error('Failed to create API key', { error: error.message, userId: req.user.id });
        res.status(500).json({ success: false, error: 'Failed to create API key.' });
    }
};

/**
 * List all API keys for the authenticated user
 * GET /api/developer/keys
 */
exports.listKeys = async (req, res) => {
    try {
        const keys = await ApiKey.findAll({
            where: { userId: req.user.id },
            attributes: ['id', 'name', 'keyPrefix', 'permissions', 'allowedIPs', 'allowedDomains',
                'isActive', 'lastUsedAt', 'lastUsedIP', 'requestCount', 'rateLimit', 'expiresAt', 'createdAt'],
            order: [['createdAt', 'DESC']]
        });

        res.json({ success: true, keys });
    } catch (error) {
        logger.error('Failed to list API keys', { error: error.message, userId: req.user.id });
        res.status(500).json({ success: false, error: 'Failed to list API keys.' });
    }
};

/**
 * Get single API key details
 * GET /api/developer/keys/:keyId
 */
exports.getKey = async (req, res) => {
    try {
        const key = await ApiKey.findOne({
            where: { id: req.params.keyId, userId: req.user.id },
            attributes: ['id', 'name', 'keyPrefix', 'permissions', 'allowedIPs', 'allowedDomains',
                'isActive', 'lastUsedAt', 'lastUsedIP', 'requestCount', 'rateLimit', 'expiresAt', 'createdAt', 'updatedAt']
        });

        if (!key) {
            return res.status(404).json({ success: false, error: 'API key not found.' });
        }

        res.json({ success: true, key });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get API key.' });
    }
};

/**
 * Update an API key (name, permissions, IP/domain restrictions)
 * PUT /api/developer/keys/:keyId
 */
exports.updateKey = async (req, res) => {
    try {
        const key = await ApiKey.findOne({ where: { id: req.params.keyId, userId: req.user.id } });
        if (!key) {
            return res.status(404).json({ success: false, error: 'API key not found.' });
        }

        const { name, permissions, allowedIPs, allowedDomains, rateLimit: customRateLimit } = req.body;

        if (name !== undefined) {
            if (name.trim().length < 2 || name.trim().length > 100) {
                return res.status(400).json({ success: false, error: 'Name must be 2-100 characters.' });
            }
            key.name = name.trim();
        }

        if (permissions !== undefined) {
            const invalidPerms = permissions.filter(p => !VALID_PERMISSIONS.includes(p));
            if (invalidPerms.length > 0) {
                return res.status(400).json({ success: false, error: `Invalid permissions: ${invalidPerms.join(', ')}` });
            }
            key.permissions = permissions;
        }

        if (allowedIPs !== undefined) key.allowedIPs = allowedIPs;
        if (allowedDomains !== undefined) key.allowedDomains = allowedDomains;
        if (customRateLimit !== undefined) key.rateLimit = Math.max(1, Math.min(300, customRateLimit));

        await key.save();

        logger.info('API key updated', { userId: req.user.id, keyId: key.id });

        res.json({ success: true, message: 'API key updated.', key: { id: key.id, name: key.name, permissions: key.permissions, allowedIPs: key.allowedIPs, allowedDomains: key.allowedDomains, rateLimit: key.rateLimit } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to update API key.' });
    }
};

/**
 * Revoke (deactivate) an API key
 * DELETE /api/developer/keys/:keyId
 */
exports.revokeKey = async (req, res) => {
    try {
        const key = await ApiKey.findOne({ where: { id: req.params.keyId, userId: req.user.id } });
        if (!key) {
            return res.status(404).json({ success: false, error: 'API key not found.' });
        }

        key.isActive = false;
        await key.save();

        logger.info('API key revoked', { userId: req.user.id, keyId: key.id });

        res.json({ success: true, message: 'API key revoked.' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to revoke API key.' });
    }
};

// ==========================================
// ADMIN ENDPOINTS
// ==========================================

/**
 * Admin: List all API keys across all users
 * GET /api/admin/api-keys
 */
exports.adminListKeys = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, active } = req.query;
        const offset = (page - 1) * limit;

        const where = {};
        if (userId) where.userId = userId;
        if (active !== undefined) where.isActive = active === 'true';

        const { count, rows: keys } = await ApiKey.findAndCountAll({
            where,
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'fullName', 'email', 'phone', 'agentCode', 'role']
            }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        res.json({
            success: true,
            keys,
            pagination: {
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        logger.error('Admin list API keys error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to list API keys.' });
    }
};

/**
 * Admin: Revoke any API key
 * DELETE /api/admin/api-keys/:keyId
 */
exports.adminRevokeKey = async (req, res) => {
    try {
        const key = await ApiKey.findByPk(req.params.keyId);
        if (!key) {
            return res.status(404).json({ success: false, error: 'API key not found.' });
        }

        key.isActive = false;
        await key.save();

        logger.info('Admin revoked API key', { admin: req.admin.username, keyId: key.id, userId: key.userId });

        res.json({ success: true, message: 'API key revoked by admin.' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to revoke API key.' });
    }
};

/**
 * Admin: Get API key usage stats
 * GET /api/admin/api-keys/stats
 */
exports.adminGetStats = async (req, res) => {
    try {
        const totalKeys = await ApiKey.count();
        const activeKeys = await ApiKey.count({ where: { isActive: true } });
        const totalRequests = await ApiKey.sum('requestCount') || 0;

        // Recently used keys
        const recentlyUsed = await ApiKey.findAll({
            where: { lastUsedAt: { [require('sequelize').Op.ne]: null } },
            include: [{
                model: User,
                as: 'owner',
                attributes: ['id', 'fullName', 'email', 'agentCode']
            }],
            order: [['lastUsedAt', 'DESC']],
            limit: 10,
            attributes: ['id', 'name', 'keyPrefix', 'lastUsedAt', 'lastUsedIP', 'requestCount', 'isActive']
        });

        res.json({
            success: true,
            stats: {
                totalKeys,
                activeKeys,
                revokedKeys: totalKeys - activeKeys,
                totalRequests,
                recentlyUsed
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to get API key stats.' });
    }
};

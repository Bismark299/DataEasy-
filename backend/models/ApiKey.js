/**
 * ApiKey Model
 * Manages API keys for external developer integrations
 */

const { DataTypes } = require('sequelize');
const crypto = require('crypto');
const { sequelize } = require('../config/database');

const ApiKey = sequelize.define('ApiKey', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'The user (agent/dealer) who owns this key'
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Friendly label for the key (e.g. "My WordPress Site")'
    },
    keyPrefix: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: 'First 16 chars of the key for display (de_live_xxxx)'
    },
    keyHash: {
        type: DataTypes.STRING(128),
        allowNull: false,
        unique: true,
        comment: 'SHA-256 hash of the full API key'
    },
    permissions: {
        type: DataTypes.JSONB,
        defaultValue: ['packages:read', 'orders:create', 'orders:read'],
        comment: 'Array of permission scopes'
    },
    allowedIPs: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'Whitelist of IPs. Empty = allow all'
    },
    allowedDomains: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'Whitelist of referrer domains. Empty = allow all'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    lastUsedIP: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    requestCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Total requests made with this key'
    },
    rateLimit: {
        type: DataTypes.INTEGER,
        defaultValue: 60,
        comment: 'Max requests per minute'
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Optional expiry date'
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'api_keys',
    timestamps: true,
    indexes: [
        { fields: ['userId'] },
        { fields: ['keyHash'], unique: true },
        { fields: ['isActive'] }
    ]
});

/**
 * Generate a new API key pair (raw key + model instance)
 */
ApiKey.generateKey = function () {
    const prefix = 'de_live_';
    const raw = crypto.randomBytes(32).toString('hex');
    const fullKey = prefix + raw;
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = fullKey.substring(0, 16);
    return { fullKey, keyHash, keyPrefix };
};

/**
 * Find an API key by its raw value
 */
ApiKey.findByRawKey = async function (rawKey) {
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    return ApiKey.findOne({ where: { keyHash: hash, isActive: true } });
};

module.exports = ApiKey;

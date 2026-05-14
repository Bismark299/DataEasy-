/**
 * Idempotency Key Model
 * Prevents duplicate requests and ensures exactly-once processing
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const IdempotencyKey = sequelize.define('IdempotencyKey', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    key: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'The idempotency key from client request'
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'User ID or admin username who made the request'
    },
    endpoint: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'API endpoint that was called'
    },
    method: {
        type: DataTypes.STRING(10),
        allowNull: false,
        comment: 'HTTP method (POST, PUT, etc.)'
    },
    requestHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'SHA256 hash of request body for validation'
    },
    responseCode: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    responseBody: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Cached response for replay'
    },
    status: {
        type: DataTypes.ENUM('processing', 'completed', 'failed'),
        defaultValue: 'processing'
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'When this idempotency key expires'
    }
}, {
    tableName: 'idempotency_keys',
    timestamps: true,
    indexes: [
        { fields: ['key', 'userId', 'endpoint'], unique: true }, // Unique per key+user+endpoint
        { fields: ['userId', 'endpoint'] },
        { fields: ['expiresAt'] },
        { fields: ['status'] }
    ]
});

/**
 * Check if idempotency key exists and is still valid
 * Scoped by key + userId + endpoint to prevent cross-endpoint reuse
 */
IdempotencyKey.findValidKey = async function(key, userId, endpoint) {
    return await this.findOne({
        where: {
            key,
            userId,
            endpoint, // Scope by endpoint to prevent cross-endpoint reuse
            expiresAt: {
                [require('sequelize').Op.gt]: new Date()
            }
        }
    });
};

/**
 * Create a new idempotency record
 */
IdempotencyKey.createKey = async function(key, userId, endpoint, method, requestHash) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    return await this.create({
        key,
        userId,
        endpoint,
        method,
        requestHash,
        expiresAt,
        status: 'processing'
    });
};

/**
 * Mark key as completed with response
 */
IdempotencyKey.prototype.markCompleted = async function(responseCode, responseBody) {
    this.status = 'completed';
    this.responseCode = responseCode;
    this.responseBody = responseBody;
    await this.save();
    return this;
};

/**
 * Mark key as failed
 */
IdempotencyKey.prototype.markFailed = async function(responseCode, responseBody) {
    this.status = 'failed';
    this.responseCode = responseCode;
    this.responseBody = responseBody;
    await this.save();
    return this;
};

/**
 * Cleanup expired keys (run periodically)
 */
IdempotencyKey.cleanupExpired = async function() {
    const { Op } = require('sequelize');
    return await this.destroy({
        where: {
            expiresAt: {
                [Op.lt]: new Date()
            }
        }
    });
};

module.exports = IdempotencyKey;

/**
 * Admin Audit Log Model
 * Tracks all admin actions for accountability and security
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AdminAuditLog = sequelize.define('AdminAuditLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    adminUsername: {
        type: DataTypes.STRING,
        allowNull: false
    },
    action: {
        type: DataTypes.ENUM(
            'LOGIN',
            'LOGOUT',
            'WALLET_CREDIT',
            'WALLET_DEBIT',
            'WALLET_ADJUSTMENT',
            'ORDER_STATUS_UPDATE',
            'ORDER_ITEM_STATUS_UPDATE',
            'USER_ACTIVATE',
            'USER_DEACTIVATE',
            'USER_VIEW',
            'USER_UPDATE',
            'UPDATE_USER',
            'SETTINGS_UPDATE',
            'BULK_ORDER_UPDATE',
            'UPDATE_PACKAGE',
            'CREATE_PACKAGE',
            'DELETE_PACKAGE',
            'NETWORK_AVAILABILITY_UPDATE'
        ),
        allowNull: false
    },
    targetType: {
        type: DataTypes.ENUM('user', 'order', 'transaction', 'settings', 'system', 'package', 'wallet'),
        allowNull: true
    },
    targetId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'ID of the affected resource (userId, orderId, etc.)'
    },
    previousValue: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'State before the action'
    },
    newValue: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'State after the action'
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    userAgent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    },
    status: {
        type: DataTypes.ENUM('success', 'failed', 'pending'),
        defaultValue: 'success'
    },
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'admin_audit_logs',
    timestamps: true,
    updatedAt: false, // Audit logs should never be updated
    indexes: [
        { fields: ['adminUsername'] },
        { fields: ['action'] },
        { fields: ['targetType', 'targetId'] },
        { fields: ['createdAt'] },
        { fields: ['ipAddress'] }
    ]
});

/**
 * Helper function to create audit log entry
 */
AdminAuditLog.logAction = async function(req, {
    action,
    targetType = null,
    targetId = null,
    previousValue = null,
    newValue = null,
    description = null,
    status = 'success',
    errorMessage = null,
    metadata = {}
}) {
    try {
        const adminUsername = req.admin?.username || 'unknown';
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        return await this.create({
            adminUsername,
            action,
            targetType,
            targetId: targetId?.toString(),
            previousValue,
            newValue,
            description,
            ipAddress,
            userAgent,
            metadata,
            status,
            errorMessage
        });
    } catch (error) {
        console.error('Failed to create audit log:', error);
        // Don't throw - audit logging should not break main operations
        return null;
    }
};

module.exports = AdminAuditLog;

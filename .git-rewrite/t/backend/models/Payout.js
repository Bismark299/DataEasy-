/**
 * Payout Model
 * Tracks withdrawal requests from agents
 * Paid via Paystack Transfer
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Payout = sequelize.define('Payout', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    payoutId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'Human-readable payout ID e.g. PO-1234567890'
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        comment: 'The agent requesting the payout'
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: {
            min: 1
        },
        get() {
            const value = this.getDataValue('amount');
            return value === null ? 0 : parseFloat(value);
        }
    },
    fee: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Transfer fee charged',
        get() {
            const value = this.getDataValue('fee');
            return value === null ? 0 : parseFloat(value);
        }
    },
    netAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'Amount agent actually receives (amount - fee)',
        get() {
            const value = this.getDataValue('netAmount');
            return value === null ? 0 : parseFloat(value);
        }
    },
    method: {
        type: DataTypes.ENUM('bank_transfer', 'momo'),
        allowNull: false
    },
    recipientCode: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Paystack transfer recipient code'
    },
    transferCode: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Paystack transfer code after initiation'
    },
    transferReference: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'Unique reference for this transfer'
    },
    bankName: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    accountNumber: {
        type: DataTypes.STRING(30),
        allowNull: true
    },
    accountName: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM('pending', 'approved', 'processing', 'completed', 'failed', 'rejected'),
        defaultValue: 'pending'
    },
    approvedBy: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Admin who approved this payout'
    },
    approvedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    failureReason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    balanceBefore: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('balanceBefore');
            return value === null ? 0 : parseFloat(value);
        }
    },
    balanceAfter: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('balanceAfter');
            return value === null ? 0 : parseFloat(value);
        }
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'payouts',
    timestamps: true,
    indexes: [
        { fields: ['storeId'] },
        { fields: ['userId'] },
        { fields: ['status'] },
        { fields: ['payoutId'], unique: true },
        { fields: ['transferReference'] },
        { fields: ['createdAt'] },
        { fields: ['storeId', 'status'] }
    ]
});

module.exports = Payout;

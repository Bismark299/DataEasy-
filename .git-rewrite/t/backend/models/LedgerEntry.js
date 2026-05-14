/**
 * Ledger Entry Model
 * Double-entry bookkeeping - every money movement has a debit AND credit entry
 * This is the core of the bank-style financial system
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LedgerEntry = sequelize.define('LedgerEntry', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    // Double-entry: each entry has a counterpart
    counterEntryId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Links to the other side of this double-entry pair'
    },
    type: {
        type: DataTypes.ENUM('debit', 'credit'),
        allowNull: false
    },
    // Chart of accounts
    account: {
        type: DataTypes.ENUM(
            'REVENUE',              // Store sales income
            'COST_OF_GOODS',        // Cost of items sold
            'PLATFORM_COMMISSION',  // Commission taken by platform
            'SETTLEMENT',           // Agent's settlement account (what they can withdraw)
            'ACCOUNTS_RECEIVABLE',  // Pending customer payments
            'PAYOUT',               // Funds sent to agent
            'REFUND_EXPENSE',       // Refunds issued to customers
            'HOLD',                 // Funds on hold (disputes, verification)
            'ADJUSTMENT'            // Manual adjustments by admin
        ),
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: {
            min: 0.01
        },
        get() {
            const value = this.getDataValue('amount');
            return value === null ? 0 : parseFloat(value);
        }
    },
    balanceBefore: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Settlement account balance before this entry',
        get() {
            const value = this.getDataValue('balanceBefore');
            return value === null ? 0 : parseFloat(value);
        }
    },
    balanceAfter: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Settlement account balance after this entry',
        get() {
            const value = this.getDataValue('balanceAfter');
            return value === null ? 0 : parseFloat(value);
        }
    },
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    reference: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Order ID, payout ID, or other reference'
    },
    referenceType: {
        type: DataTypes.ENUM('store_order', 'payout', 'refund', 'adjustment', 'hold'),
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'ledger_entries',
    timestamps: true,
    updatedAt: false, // Ledger entries are immutable
    indexes: [
        { fields: ['storeId'] },
        { fields: ['account'] },
        { fields: ['type'] },
        { fields: ['reference'] },
        { fields: ['createdAt'] },
        { fields: ['storeId', 'account', 'createdAt'] },
        { fields: ['counterEntryId'] }
    ]
});

module.exports = LedgerEntry;

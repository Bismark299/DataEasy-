/**
 * Transaction Model
 * PostgreSQL Schema with Sequelize
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transaction = sequelize.define('Transaction', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    type: {
        type: DataTypes.ENUM('credit', 'debit'),
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        validate: {
            min: {
                args: [0.01],
                msg: 'Amount must be greater than 0'
            }
        },
        get() {
            const value = this.getDataValue('amount');
            return value === null ? 0 : parseFloat(value);
        }
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
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    reference: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: true
    },
    paymentMethod: {
        type: DataTypes.ENUM('paystack', 'manual', 'momo', 'order', 'refund'),
        defaultValue: 'paystack'
    },
    status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed'),
        defaultValue: 'pending'
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'orders',
            key: 'id'
        }
    }
}, {
    tableName: 'transactions',
    timestamps: true,
    indexes: [
        { fields: ['userId', 'createdAt'] },
        { fields: ['reference'] },
        { fields: ['type'] },
        { fields: ['status'] }
    ]
});

module.exports = Transaction;

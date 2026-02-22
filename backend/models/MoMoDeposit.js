/**
 * MoMo Deposit Model
 * Stores incoming MoMo deposits from SMS listener
 * PostgreSQL Schema with Sequelize
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MoMoDeposit = sequelize.define('MoMoDeposit', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    // MoMo Transaction ID (unique, from MoMo SMS)
    transactionId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'MoMo transaction ID from SMS'
    },
    
    // Amount in GHS
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
    
    // Phone number that sent the money
    senderPhone: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    
    // Reference from SMS (should be username)
    reference: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Reference/message from SMS - should contain username'
    },
    
    // Original SMS text
    rawMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    // User that was credited (if matched)
    userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'users',
            key: 'id'
        },
        comment: 'User whose wallet was credited'
    },
    
    // Processing status
    status: {
        type: DataTypes.ENUM('pending', 'credited', 'unmatched', 'duplicate', 'error'),
        defaultValue: 'pending',
        comment: 'pending=new, credited=wallet updated, unmatched=no user found, duplicate=already processed'
    },
    
    // Error or status message
    statusMessage: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    
    // Wallet transaction ID if credited
    walletTransactionId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Transaction ID in wallet_transactions table'
    },
    
    // When the SMS was received on the phone
    smsReceivedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    // Device/listener info (for debugging)
    deviceInfo: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Info about the SMS listener device'
    }
}, {
    tableName: 'momo_deposits',
    timestamps: true,
    indexes: [
        { unique: true, fields: ['transactionId'] },
        { fields: ['userId'] },
        { fields: ['status'] },
        { fields: ['reference'] },
        { fields: ['senderPhone'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = MoMoDeposit;

/**
 * Store Model
 * Each agent can have one store for selling products
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Store = sequelize.define('Store', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
            model: 'users',
            key: 'id'
        },
        comment: 'The agent who owns this store'
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            len: {
                args: [2, 100],
                msg: 'Store name must be between 2 and 100 characters'
            }
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    location: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING(15),
        allowNull: true
    },
    whatsapp: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: 'WhatsApp contact number shown on the public store link'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    bankName: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    bankAccountNumber: {
        type: DataTypes.STRING(30),
        allowNull: true
    },
    bankAccountName: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    momoNumber: {
        type: DataTypes.STRING(15),
        allowNull: true
    },
    momoProvider: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: 'MTN, AirtelTigo, Telecel'
    },
    commissionRate: {
        type: DataTypes.DECIMAL(5, 2),
        defaultValue: 5.00,
        comment: 'Platform commission percentage on each sale'
    },
    payoutThreshold: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 50.00,
        comment: 'Minimum balance required to request payout'
    },
    pricing: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Agent selling prices: { "mtn-1gb": { sellingPrice: 6.00, active: true }, ... }'
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'stores',
    timestamps: true,
    indexes: [
        { fields: ['userId'], unique: true },
        { fields: ['isActive'] }
    ]
});

module.exports = Store;

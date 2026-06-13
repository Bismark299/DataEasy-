/**
 * Store Order Model
 * Orders placed in an agent's store by customers
 * Paid via Paystack
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StoreOrder = sequelize.define('StoreOrder', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    orderId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'Human-readable order ID e.g. SO-1234567890'
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    customerName: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    customerPhone: {
        type: DataTypes.STRING(15),
        allowNull: true
    },
    customerEmail: {
        type: DataTypes.STRING,
        allowNull: true
    },
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of {productId, productName, quantity, unitPrice, costPrice, lineTotal}'
    },
    subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('subtotal');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalCost: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Total cost price of items (for profit calculation)',
        get() {
            const value = this.getDataValue('totalCost');
            return value === null ? 0 : parseFloat(value);
        }
    },
    commission: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Platform commission deducted',
        get() {
            const value = this.getDataValue('commission');
            return value === null ? 0 : parseFloat(value);
        }
    },
    netAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        comment: 'Amount credited to store settlement (subtotal - commission)',
        get() {
            const value = this.getDataValue('netAmount');
            return value === null ? 0 : parseFloat(value);
        }
    },
    paymentReference: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        comment: 'Paystack payment reference'
    },
    paymentMethod: {
        type: DataTypes.STRING(20),
        defaultValue: 'paystack'
    },
    status: {
        type: DataTypes.ENUM('pending', 'paid', 'fulfilled', 'cancelled', 'refunded'),
        defaultValue: 'pending'
    },
    deliveryStatus: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'Pending',
        comment: 'Bundle delivery lifecycle (MCBIS): Pending/Processing/Delivered/Failed/Partially Delivered'
    },
    paidAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    fulfilledAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'store_orders',
    timestamps: true,
    indexes: [
        { fields: ['storeId'] },
        { fields: ['orderId'], unique: true },
        { fields: ['status'] },
        { fields: ['paymentReference'] },
        { fields: ['createdAt'] },
        { fields: ['storeId', 'status'] }
    ]
});

module.exports = StoreOrder;

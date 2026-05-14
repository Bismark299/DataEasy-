/**
 * Order Model
 * PostgreSQL Schema with Sequelize
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    orderId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'Array of order items with packageId, packageName, data, price, phoneNumber, deliveryStatus'
    },
    network: {
        type: DataTypes.ENUM('MTN', 'AirtelTigo', 'Telecel'),
        allowNull: false
    },
    subtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('subtotal');
            return value === null ? 0 : parseFloat(value);
        }
    },
    total: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        get() {
            const value = this.getDataValue('total');
            return value === null ? 0 : parseFloat(value);
        }
    },
    paymentStatus: {
        type: DataTypes.ENUM('Pending', 'Completed', 'Failed', 'Refunded'),
        defaultValue: 'Pending'
    },
    paymentMethod: {
        type: DataTypes.ENUM('wallet', 'paystack'),
        defaultValue: 'wallet'
    },
    paymentReference: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    deliveryStatus: {
        type: DataTypes.ENUM('Pending', 'Processing', 'Delivered', 'Partially Delivered', 'Failed'),
        defaultValue: 'Pending'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
    },
    processedBy: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    }
}, {
    tableName: 'orders',
    timestamps: true,
    indexes: [
        { fields: ['orderId'] },
        { fields: ['userId'] },
        { fields: ['paymentStatus'] },
        { fields: ['deliveryStatus'] },
        { fields: ['createdAt'] },
        { fields: ['network'] },
        { fields: ['userId', 'createdAt'] },
        { fields: ['deliveryStatus', 'createdAt'] },
        { fields: ['network', 'createdAt'] }
    ]
});

// Calculate delivery stats
Order.prototype.getDeliveryStats = function() {
    const items = this.items || [];
    const total = items.length;
    const delivered = items.filter(i => i.deliveryStatus === 'Delivered').length;
    const failed = items.filter(i => i.deliveryStatus === 'Failed').length;
    const pending = items.filter(i => i.deliveryStatus === 'Pending' || i.deliveryStatus === 'Processing').length;
    
    return { total, delivered, failed, pending };
};

// Update overall delivery status based on items
Order.prototype.updateDeliveryStatus = async function() {
    const stats = this.getDeliveryStats();
    
    if (stats.delivered === stats.total) {
        this.deliveryStatus = 'Delivered';
    } else if (stats.failed === stats.total) {
        this.deliveryStatus = 'Failed';
    } else if (stats.delivered > 0 || stats.failed > 0) {
        this.deliveryStatus = 'Partially Delivered';
    } else if (stats.pending < stats.total) {
        this.deliveryStatus = 'Processing';
    }
    
    await this.save();
    return this;
};

module.exports = Order;

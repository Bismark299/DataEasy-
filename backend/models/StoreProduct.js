/**
 * Store Product Model
 * Products listed in an agent's store
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StoreProduct = sequelize.define('StoreProduct', {
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
    name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: {
            len: {
                args: [2, 150],
                msg: 'Product name must be between 2 and 150 characters'
            }
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    sku: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    category: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: 'general'
    },
    costPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'What the agent paid for this item',
        get() {
            const value = this.getDataValue('costPrice');
            return value === null ? 0 : parseFloat(value);
        }
    },
    sellingPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'What the customer pays',
        get() {
            const value = this.getDataValue('sellingPrice');
            return value === null ? 0 : parseFloat(value);
        }
    },
    stock: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    }
}, {
    tableName: 'store_products',
    timestamps: true,
    indexes: [
        { fields: ['storeId'] },
        { fields: ['category'] },
        { fields: ['isActive'] },
        { fields: ['storeId', 'sku'], unique: true, where: { sku: { [require('sequelize').Op.ne]: null } } }
    ]
});

module.exports = StoreProduct;

/**
 * Reconciliation Record Model
 * Tracks periodic reconciliation of store finances
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ReconciliationRecord = sequelize.define('ReconciliationRecord', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'stores',
            key: 'id'
        },
        comment: 'Null for platform-wide reconciliation'
    },
    periodStart: {
        type: DataTypes.DATE,
        allowNull: false
    },
    periodEnd: {
        type: DataTypes.DATE,
        allowNull: false
    },
    // Revenue reconciliation
    expectedRevenue: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('expectedRevenue');
            return value === null ? 0 : parseFloat(value);
        }
    },
    actualRevenue: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('actualRevenue');
            return value === null ? 0 : parseFloat(value);
        }
    },
    // Payout reconciliation
    expectedPayouts: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('expectedPayouts');
            return value === null ? 0 : parseFloat(value);
        }
    },
    actualPayouts: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('actualPayouts');
            return value === null ? 0 : parseFloat(value);
        }
    },
    // Commission reconciliation
    expectedCommission: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('expectedCommission');
            return value === null ? 0 : parseFloat(value);
        }
    },
    actualCommission: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('actualCommission');
            return value === null ? 0 : parseFloat(value);
        }
    },
    // Balance reconciliation
    expectedBalance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('expectedBalance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    actualBalance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('actualBalance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    discrepancy: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('discrepancy');
            return value === null ? 0 : parseFloat(value);
        }
    },
    status: {
        type: DataTypes.ENUM('balanced', 'discrepancy', 'resolved', 'investigating'),
        defaultValue: 'balanced'
    },
    resolvedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    resolutionNotes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    details: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Detailed breakdown of mismatches'
    }
}, {
    tableName: 'reconciliation_records',
    timestamps: true,
    indexes: [
        { fields: ['storeId'] },
        { fields: ['status'] },
        { fields: ['periodStart', 'periodEnd'] },
        { fields: ['createdAt'] }
    ]
});

module.exports = ReconciliationRecord;

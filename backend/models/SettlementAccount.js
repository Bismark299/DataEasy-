/**
 * Settlement Account Model
 * Bank-style settlement account for each store
 * Tracks ledger balance, available balance, and holds
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SettlementAccount = sequelize.define('SettlementAccount', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    storeId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
            model: 'stores',
            key: 'id'
        }
    },
    ledgerBalance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Total book balance (all credits - all debits)',
        get() {
            const value = this.getDataValue('ledgerBalance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    availableBalance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Withdrawable balance (ledgerBalance - holdAmount)',
        get() {
            const value = this.getDataValue('availableBalance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    holdAmount: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Funds on hold (disputes, pending verification)',
        get() {
            const value = this.getDataValue('holdAmount');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalRevenue: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Lifetime total sales revenue',
        get() {
            const value = this.getDataValue('totalRevenue');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalCommissionPaid: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Lifetime commissions paid to platform',
        get() {
            const value = this.getDataValue('totalCommissionPaid');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalPayouts: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Lifetime payouts to agent',
        get() {
            const value = this.getDataValue('totalPayouts');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalCostOfGoods: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Lifetime cost of goods sold',
        get() {
            const value = this.getDataValue('totalCostOfGoods');
            return value === null ? 0 : parseFloat(value);
        }
    },
    lastPayoutDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'GHS'
    },
    version: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Optimistic locking version'
    }
}, {
    tableName: 'settlement_accounts',
    timestamps: true,
    version: true
});

/**
 * Credit the settlement account (sale revenue minus commission)
 */
SettlementAccount.prototype.creditSettlement = async function(amount, options = {}) {
    const creditAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (creditAmount <= 0) throw new Error('Credit amount must be positive');

    const [affectedRows] = await SettlementAccount.update(
        {
            ledgerBalance: sequelize.literal(`"ledgerBalance" + ${creditAmount}`),
            availableBalance: sequelize.literal(`"availableBalance" + ${creditAmount}`)
        },
        {
            where: { id: this.id, version: this.version },
            ...options
        }
    );

    if (affectedRows === 0) throw new Error('Settlement update failed - concurrent modification');
    await this.reload(options);
    return this;
};

/**
 * Debit the settlement account (payout)
 */
SettlementAccount.prototype.debitSettlement = async function(amount, options = {}) {
    const debitAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (debitAmount <= 0) throw new Error('Debit amount must be positive');
    if (debitAmount > this.availableBalance) throw new Error('Insufficient available balance');

    const [affectedRows] = await SettlementAccount.update(
        {
            ledgerBalance: sequelize.literal(`"ledgerBalance" - ${debitAmount}`),
            availableBalance: sequelize.literal(`"availableBalance" - ${debitAmount}`)
        },
        {
            where: {
                id: this.id,
                version: this.version,
                availableBalance: { [require('sequelize').Op.gte]: debitAmount }
            },
            ...options
        }
    );

    if (affectedRows === 0) throw new Error('Settlement debit failed - insufficient balance or concurrent modification');
    await this.reload(options);
    return this;
};

/**
 * Place a hold on funds
 */
SettlementAccount.prototype.placeHold = async function(amount, options = {}) {
    const holdAmt = Math.round(parseFloat(amount) * 100) / 100;
    if (holdAmt <= 0) throw new Error('Hold amount must be positive');
    if (holdAmt > this.availableBalance) throw new Error('Insufficient available balance for hold');

    const [affectedRows] = await SettlementAccount.update(
        {
            holdAmount: sequelize.literal(`"holdAmount" + ${holdAmt}`),
            availableBalance: sequelize.literal(`"availableBalance" - ${holdAmt}`)
        },
        {
            where: {
                id: this.id,
                version: this.version,
                availableBalance: { [require('sequelize').Op.gte]: holdAmt }
            },
            ...options
        }
    );

    if (affectedRows === 0) throw new Error('Hold placement failed');
    await this.reload(options);
    return this;
};

/**
 * Release a hold
 */
SettlementAccount.prototype.releaseHold = async function(amount, options = {}) {
    const releaseAmt = Math.round(parseFloat(amount) * 100) / 100;
    if (releaseAmt <= 0) throw new Error('Release amount must be positive');

    const [affectedRows] = await SettlementAccount.update(
        {
            holdAmount: sequelize.literal(`"holdAmount" - ${releaseAmt}`),
            availableBalance: sequelize.literal(`"availableBalance" + ${releaseAmt}`)
        },
        {
            where: {
                id: this.id,
                version: this.version,
                holdAmount: { [require('sequelize').Op.gte]: releaseAmt }
            },
            ...options
        }
    );

    if (affectedRows === 0) throw new Error('Hold release failed');
    await this.reload(options);
    return this;
};

module.exports = SettlementAccount;

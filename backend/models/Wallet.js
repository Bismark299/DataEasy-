/**
 * Wallet Model
 * PostgreSQL Schema with Sequelize
 * With optimistic locking for race condition prevention
 * Includes two-phase commit (hold/reserve) mechanism
 */

const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../config/database');

const Wallet = sequelize.define('Wallet', {
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
        }
    },
    balance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        validate: {
            min: {
                args: [0],
                msg: 'Balance cannot be negative'
            }
        },
        get() {
            const value = this.getDataValue('balance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    // NEW: Reserved/held funds (two-phase commit)
    reservedBalance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        comment: 'Funds held for pending transactions (not yet confirmed)',
        get() {
            const value = this.getDataValue('reservedBalance');
            return value === null ? 0 : parseFloat(value);
        }
    },
    currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'GHS'
    },
    totalTopups: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('totalTopups');
            return value === null ? 0 : parseFloat(value);
        }
    },
    totalSpent: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
        get() {
            const value = this.getDataValue('totalSpent');
            return value === null ? 0 : parseFloat(value);
        }
    },
    version: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Optimistic locking version number'
    },
    lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Temporary lock for processing'
    }
}, {
    tableName: 'wallets',
    timestamps: true,
    version: false // Locking handled by SELECT FOR UPDATE in callers
});

/**
 * Get available balance (total minus reserved)
 */
Wallet.prototype.getAvailableBalance = function() {
    return Math.round((this.balance - this.reservedBalance) * 100) / 100;
};

/**
 * Atomic credit operation
 * Callers must use SELECT FOR UPDATE to prevent races
 * @param {number} amount - Amount to credit
 * @param {object} options - Sequelize options (transaction, etc.)
 */
Wallet.prototype.credit = async function(amount, options = {}) {
    const creditAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (creditAmount <= 0) {
        throw new Error('Credit amount must be positive');
    }

    const [updatedCount] = await Wallet.update(
        {
            balance: sequelize.literal(`balance + ${creditAmount}`),
            totalTopups: sequelize.literal(`"totalTopups" + ${creditAmount}`),
            version: sequelize.literal('version + 1')
        },
        {
            where: { id: this.id },
            ...options
        }
    );

    if (updatedCount === 0) {
        throw new Error('Wallet not found');
    }

    await this.reload(options);
    return this;
};

/**
 * Atomic debit operation with balance check
 * Callers must use SELECT FOR UPDATE to prevent races
 * @param {number} amount - Amount to debit
 * @param {object} options - Sequelize options (transaction, etc.)
 */
Wallet.prototype.debit = async function(amount, options = {}) {
    const debitAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (debitAmount <= 0) {
        throw new Error('Debit amount must be positive');
    }

    const [updatedCount] = await Wallet.update(
        {
            balance: sequelize.literal(`balance - ${debitAmount}`),
            totalSpent: sequelize.literal(`"totalSpent" + ${debitAmount}`),
            version: sequelize.literal('version + 1')
        },
        {
            where: {
                id: this.id,
                balance: {
                    [Op.gte]: debitAmount
                }
            },
            ...options
        }
    );

    if (updatedCount === 0) {
        const current = await Wallet.findByPk(this.id, options);
        if (!current || current.balance < debitAmount) {
            throw new Error('Insufficient balance');
        }
        throw new Error('Wallet update failed. Please retry.');
    }

    await this.reload(options);
    return this;
};

/**
 * Check if wallet has sufficient balance (considers reserved funds)
 */
Wallet.prototype.hasSufficientBalance = function(amount) {
    const available = this.getAvailableBalance();
    return Math.round(available * 100) >= Math.round(parseFloat(amount) * 100);
};

// ==================== TWO-PHASE COMMIT METHODS ====================

/**
 * Phase 1: Reserve/Hold funds
 * Funds remain in balance but are marked as reserved (unavailable)
 * @param {number} amount - Amount to reserve
 * @param {object} options - Sequelize options (transaction, etc.)
 * @returns {string} holdId - Unique identifier for this hold
 */
Wallet.prototype.holdFunds = async function(amount, holdReference, options = {}) {
    const holdAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (holdAmount <= 0) {
        throw new Error('Hold amount must be positive');
    }

    const currentVersion = this.version;
    const availableBalance = this.getAvailableBalance();
    
    if (availableBalance < holdAmount) {
        throw new Error(`Insufficient available balance. Available: ${availableBalance}, Required: ${holdAmount}`);
    }
    
    // Atomic update: increase reserved balance
    const [updatedCount] = await Wallet.update(
        {
            reservedBalance: sequelize.literal(`"reservedBalance" + ${holdAmount}`),
            version: sequelize.literal('version + 1')
        },
        {
            where: {
                id: this.id,
                version: currentVersion,
                // Ensure available balance is sufficient
                [Op.and]: sequelize.literal(`(balance - "reservedBalance") >= ${holdAmount}`)
            },
            ...options
        }
    );

    if (updatedCount === 0) {
        const current = await Wallet.findByPk(this.id, options);
        const currentAvailable = current.getAvailableBalance();
        if (currentAvailable < holdAmount) {
            throw new Error(`Insufficient available balance. Available: ${currentAvailable}, Required: ${holdAmount}`);
        }
        throw new Error('Wallet was modified by another transaction. Please retry.');
    }

    await this.reload(options);
    return holdReference;
};

/**
 * Phase 2a: Confirm hold - Convert reserved funds to actual debit
 * Call this when provider confirms successful delivery
 * @param {number} amount - Amount to confirm (must match original hold)
 * @param {object} options - Sequelize options
 */
Wallet.prototype.confirmHold = async function(amount, options = {}) {
    const confirmAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (confirmAmount <= 0) {
        throw new Error('Confirm amount must be positive');
    }

    const currentVersion = this.version;
    
    // Ensure we have enough reserved
    if (this.reservedBalance < confirmAmount) {
        throw new Error(`Insufficient reserved balance. Reserved: ${this.reservedBalance}, Confirming: ${confirmAmount}`);
    }
    
    // Atomic update: deduct from both balance and reserved
    const [updatedCount] = await Wallet.update(
        {
            balance: sequelize.literal(`balance - ${confirmAmount}`),
            reservedBalance: sequelize.literal(`"reservedBalance" - ${confirmAmount}`),
            totalSpent: sequelize.literal(`"totalSpent" + ${confirmAmount}`),
            version: sequelize.literal('version + 1')
        },
        {
            where: {
                id: this.id,
                version: currentVersion,
                reservedBalance: { [Op.gte]: confirmAmount },
                balance: { [Op.gte]: confirmAmount }
            },
            ...options
        }
    );

    if (updatedCount === 0) {
        throw new Error('Failed to confirm hold. Wallet may have been modified or insufficient reserved balance.');
    }

    await this.reload(options);
    return this;
};

/**
 * Phase 2b: Release hold - Return reserved funds to available balance
 * Call this when provider fails or order is cancelled
 * @param {number} amount - Amount to release (must match original hold)
 * @param {object} options - Sequelize options
 */
Wallet.prototype.releaseHold = async function(amount, options = {}) {
    const releaseAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (releaseAmount <= 0) {
        throw new Error('Release amount must be positive');
    }

    const currentVersion = this.version;
    
    // Ensure we have enough reserved to release
    if (this.reservedBalance < releaseAmount) {
        throw new Error(`Cannot release more than reserved. Reserved: ${this.reservedBalance}, Releasing: ${releaseAmount}`);
    }
    
    // Atomic update: just reduce reserved balance (funds return to available)
    const [updatedCount] = await Wallet.update(
        {
            reservedBalance: sequelize.literal(`"reservedBalance" - ${releaseAmount}`),
            version: sequelize.literal('version + 1')
        },
        {
            where: {
                id: this.id,
                version: currentVersion,
                reservedBalance: { [Op.gte]: releaseAmount }
            },
            ...options
        }
    );

    if (updatedCount === 0) {
        throw new Error('Failed to release hold. Wallet may have been modified or insufficient reserved balance.');
    }

    await this.reload(options);
    return this;
};

/**
 * Acquire a temporary lock on the wallet (for complex operations)
 */
Wallet.prototype.acquireLock = async function(durationMs = 5000, options = {}) {
    const lockUntil = new Date(Date.now() + durationMs);
    
    const [updatedCount] = await Wallet.update(
        { lockedUntil: lockUntil },
        {
            where: {
                id: this.id,
                [Op.or]: [
                    { lockedUntil: null },
                    { lockedUntil: { [Op.lt]: new Date() } }
                ]
            },
            ...options
        }
    );

    if (updatedCount === 0) {
        throw new Error('Wallet is currently locked. Please try again.');
    }

    await this.reload(options);
    return this;
};

/**
 * Release the lock
 */
Wallet.prototype.releaseLock = async function(options = {}) {
    this.lockedUntil = null;
    await this.save(options);
    return this;
};

module.exports = Wallet;

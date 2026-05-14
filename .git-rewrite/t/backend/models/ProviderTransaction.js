/**
 * Provider Transaction Model
 * Tracks all third-party API transactions with full audit trail
 * 
 * Purpose:
 * - Track every order sent to third-party providers
 * - Record full request/response lifecycle
 * - Enable reconciliation between internal orders and provider records
 * - Support two-phase commit (hold → confirm/release)
 * - Detect mismatches and prevent financial loss
 */

const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../config/database');

const ProviderTransaction = sequelize.define('ProviderTransaction', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    // Internal order reference
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Reference to our internal order'
    },
    orderItemIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Index of item within order'
    },
    internalReference: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'Our unique reference for this transaction (BT-{orderId}-{itemIndex}-{timestamp})'
    },
    
    // Provider details
    provider: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'MCBIS',
        comment: 'Third-party provider name'
    },
    providerReference: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Reference returned by provider'
    },
    
    // Transaction state machine
    // CREATED → PENDING_PROVIDER → CONFIRMED | FAILED | REVERSED | TIMEOUT
    status: {
        type: DataTypes.ENUM(
            'CREATED',           // Transaction created, not yet sent to provider
            'PENDING_PROVIDER',  // Sent to provider, awaiting response
            'CONFIRMED',         // Provider confirmed success
            'FAILED',            // Provider returned failure
            'REVERSED',          // Transaction reversed/refunded
            'TIMEOUT',           // Provider did not respond in time
            'UNKNOWN'            // Unknown/ambiguous state - requires manual review
        ),
        defaultValue: 'CREATED',
        allowNull: false
    },
    
    // Financial tracking
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'Amount charged to customer (selling price)'
    },
    costAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Cost to us from provider'
    },
    currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'GHS'
    },
    
    // Order details (snapshot at time of request)
    network: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phoneNumber: {
        type: DataTypes.STRING,
        allowNull: false
    },
    dataAmount: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'e.g., "1 GB", "500 MB"'
    },
    packageId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    
    // Request/Response tracking
    requestPayload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Full request sent to provider'
    },
    responsePayload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Full response received from provider'
    },
    responseHttpStatus: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    
    // Timing
    sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When request was sent to provider'
    },
    respondedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When response was received'
    },
    confirmedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When transaction was confirmed successful'
    },
    reversedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When transaction was reversed/refunded'
    },
    timeoutAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Deadline for provider response'
    },
    
    // Retry tracking
    attemptCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Number of delivery attempts'
    },
    maxAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 3
    },
    lastAttemptAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    nextRetryAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    // Error tracking
    errorCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    // Balance snapshot for reconciliation
    providerBalanceBefore: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Provider balance before this transaction'
    },
    providerBalanceAfter: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Provider balance after this transaction'
    },
    
    // Reconciliation flags
    reconciled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Has this been reconciled with provider records?'
    },
    reconciledAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    mismatchDetected: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    mismatchReason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    
    // Admin review
    requiresReview: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Flagged for manual admin review'
    },
    reviewedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    // User reference
    userId: {
        type: DataTypes.UUID,
        allowNull: false
    }
}, {
    tableName: 'provider_transactions',
    timestamps: true,
    indexes: [
        { fields: ['orderId'] },
        { fields: ['internalReference'], unique: true },
        { fields: ['providerReference'] },
        { fields: ['status'] },
        { fields: ['provider'] },
        { fields: ['userId'] },
        { fields: ['createdAt'] },
        { fields: ['reconciled'] },
        { fields: ['requiresReview'] },
        { fields: ['mismatchDetected'] },
        { 
            fields: ['orderId', 'orderItemIndex'],
            unique: true,
            name: 'unique_order_item'
        }
    ]
});

// ==================== STATIC METHODS ====================

/**
 * Check if an order item already has a transaction (duplicate prevention)
 */
ProviderTransaction.hasExistingTransaction = async function(orderId, itemIndex) {
    const existing = await this.findOne({
        where: {
            orderId,
            orderItemIndex: itemIndex,
            status: {
                [Op.notIn]: ['REVERSED', 'FAILED'] // Allow retry of failed/reversed
            }
        }
    });
    return existing;
};

/**
 * Create a new provider transaction (first phase of two-phase commit)
 */
ProviderTransaction.createTransaction = async function(data, options = {}) {
    const internalReference = `BT-${data.orderId.slice(-8)}-${data.orderItemIndex}-${Date.now()}`;
    
    // Check for duplicates
    const existing = await this.hasExistingTransaction(data.orderId, data.orderItemIndex);
    if (existing) {
        throw new Error(`Duplicate transaction detected. Existing: ${existing.internalReference} (${existing.status})`);
    }
    
    return await this.create({
        orderId: data.orderId,
        orderItemIndex: data.orderItemIndex || 0,
        internalReference,
        provider: data.provider || 'MCBIS',
        status: 'CREATED',
        amount: data.amount,
        costAmount: data.costAmount,
        network: data.network,
        phoneNumber: data.phoneNumber,
        dataAmount: data.dataAmount,
        packageId: data.packageId,
        userId: data.userId,
        timeoutAt: new Date(Date.now() + 60000) // 60 second timeout
    }, options);
};

/**
 * Mark as sent to provider (transition from CREATED to PENDING_PROVIDER)
 */
ProviderTransaction.prototype.markSent = async function(requestPayload, providerBalanceBefore, options = {}) {
    if (this.status !== 'CREATED') {
        throw new Error(`Invalid state transition: ${this.status} → PENDING_PROVIDER`);
    }
    
    return await this.update({
        status: 'PENDING_PROVIDER',
        requestPayload,
        sentAt: new Date(),
        providerBalanceBefore,
        attemptCount: this.attemptCount + 1,
        lastAttemptAt: new Date()
    }, options);
};

/**
 * Mark as confirmed (transition from PENDING_PROVIDER to CONFIRMED)
 */
ProviderTransaction.prototype.markConfirmed = async function(responsePayload, providerReference, providerBalanceAfter, options = {}) {
    if (this.status !== 'PENDING_PROVIDER') {
        throw new Error(`Invalid state transition: ${this.status} → CONFIRMED`);
    }
    
    return await this.update({
        status: 'CONFIRMED',
        responsePayload,
        providerReference,
        providerBalanceAfter,
        respondedAt: new Date(),
        confirmedAt: new Date(),
        responseHttpStatus: 200
    }, options);
};

/**
 * Mark as failed (transition to FAILED)
 */
ProviderTransaction.prototype.markFailed = async function(responsePayload, errorCode, errorMessage, httpStatus, options = {}) {
    return await this.update({
        status: 'FAILED',
        responsePayload,
        errorCode,
        errorMessage,
        responseHttpStatus: httpStatus,
        respondedAt: new Date(),
        requiresReview: true // Flag for admin review
    }, options);
};

/**
 * Mark as timed out
 */
ProviderTransaction.prototype.markTimeout = async function(options = {}) {
    return await this.update({
        status: 'TIMEOUT',
        requiresReview: true,
        errorCode: 'TIMEOUT',
        errorMessage: 'Provider did not respond within timeout period'
    }, options);
};

/**
 * Mark as reversed/refunded
 */
ProviderTransaction.prototype.markReversed = async function(reason, refundTransactionId, options = {}) {
    return await this.update({
        status: 'REVERSED',
        reversedAt: new Date(),
        reviewNotes: `Reversed: ${reason}. Refund TX: ${refundTransactionId || 'N/A'}`
    }, options);
};

/**
 * Flag for manual review
 */
ProviderTransaction.prototype.flagForReview = async function(reason, options = {}) {
    return await this.update({
        requiresReview: true,
        reviewNotes: (this.reviewNotes || '') + `\n[${new Date().toISOString()}] ${reason}`
    }, options);
};

/**
 * Get transactions requiring reconciliation
 */
ProviderTransaction.getUnreconciled = async function(limit = 100) {
    return await this.findAll({
        where: {
            reconciled: false,
            status: {
                [Op.in]: ['CONFIRMED', 'FAILED', 'TIMEOUT', 'UNKNOWN']
            }
        },
        order: [['createdAt', 'ASC']],
        limit
    });
};

/**
 * Get transactions requiring manual review
 */
ProviderTransaction.getRequiringReview = async function(limit = 50) {
    return await this.findAll({
        where: {
            requiresReview: true,
            reviewedAt: null
        },
        order: [['createdAt', 'ASC']],
        limit
    });
};

/**
 * Get transactions with detected mismatches
 */
ProviderTransaction.getMismatches = async function(limit = 100) {
    return await this.findAll({
        where: { mismatchDetected: true },
        order: [['createdAt', 'DESC']],
        limit
    });
};

/**
 * Get pending transactions that may have timed out
 */
ProviderTransaction.getTimedOut = async function() {
    return await this.findAll({
        where: {
            status: 'PENDING_PROVIDER',
            timeoutAt: { [Op.lt]: new Date() }
        }
    });
};

/**
 * Daily summary statistics
 */
ProviderTransaction.getDailySummary = async function(date = new Date()) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const results = await this.findAll({
        where: {
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
        },
        attributes: [
            'status',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount'],
            [sequelize.fn('SUM', sequelize.col('costAmount')), 'totalCost']
        ],
        group: ['status'],
        raw: true
    });
    
    const summary = {
        date: startOfDay.toISOString().split('T')[0],
        byStatus: {},
        totals: {
            transactions: 0,
            amount: 0,
            cost: 0,
            profit: 0
        }
    };
    
    results.forEach(r => {
        summary.byStatus[r.status] = {
            count: parseInt(r.count),
            amount: parseFloat(r.totalAmount || 0),
            cost: parseFloat(r.totalCost || 0)
        };
        summary.totals.transactions += parseInt(r.count);
        summary.totals.amount += parseFloat(r.totalAmount || 0);
        summary.totals.cost += parseFloat(r.totalCost || 0);
    });
    
    summary.totals.profit = summary.totals.amount - summary.totals.cost;
    
    return summary;
};

module.exports = ProviderTransaction;

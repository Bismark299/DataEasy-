/**
 * Ledger Service
 * Double-entry bookkeeping engine for store finances
 * Every money movement creates paired debit/credit entries
 */

const { LedgerEntry, SettlementAccount } = require('../models');
const { sequelize } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Create a double-entry ledger pair
 * @param {object} params
 * @param {string} params.storeId
 * @param {string} params.debitAccount - Account to debit
 * @param {string} params.creditAccount - Account to credit
 * @param {number} params.amount
 * @param {string} params.description
 * @param {string} params.reference
 * @param {string} params.referenceType
 * @param {object} params.metadata
 * @param {object} options - Sequelize transaction options
 */
const createDoubleEntry = async (params, options = {}) => {
    const {
        storeId, debitAccount, creditAccount, amount,
        description, reference, referenceType, metadata = {}
    } = params;

    const parsedAmount = Math.round(parseFloat(amount) * 100) / 100;
    if (parsedAmount <= 0) throw new Error('Ledger amount must be positive');

    // Get current settlement balance for snapshot
    const settlement = await SettlementAccount.findOne({
        where: { storeId },
        ...options
    });
    if (!settlement) throw new Error('Settlement account not found');

    const currentBalance = settlement.availableBalance;
    let newBalance = currentBalance;

    // Determine balance impact based on credit to SETTLEMENT
    if (creditAccount === 'SETTLEMENT') {
        newBalance = Math.round((currentBalance + parsedAmount) * 100) / 100;
    } else if (debitAccount === 'SETTLEMENT') {
        newBalance = Math.round((currentBalance - parsedAmount) * 100) / 100;
    }

    const debitEntryId = uuidv4();
    const creditEntryId = uuidv4();

    // Create debit entry
    const debitEntry = await LedgerEntry.create({
        id: debitEntryId,
        storeId,
        counterEntryId: creditEntryId,
        type: 'debit',
        account: debitAccount,
        amount: parsedAmount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        description,
        reference,
        referenceType,
        metadata
    }, options);

    // Create credit entry
    const creditEntry = await LedgerEntry.create({
        id: creditEntryId,
        storeId,
        counterEntryId: debitEntryId,
        type: 'credit',
        account: creditAccount,
        amount: parsedAmount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        description,
        reference,
        referenceType,
        metadata
    }, options);

    return { debitEntry, creditEntry };
};

/**
 * Record a store sale - creates all necessary ledger entries
 * When a customer pays for a store order:
 * 1. Debit ACCOUNTS_RECEIVABLE, Credit REVENUE (sale recorded)
 * 2. Debit REVENUE, Credit PLATFORM_COMMISSION (commission taken)
 * 3. Debit REVENUE, Credit SETTLEMENT (net revenue to agent)
 * 4. Debit COST_OF_GOODS, Credit SETTLEMENT (offset COGS - informational)
 */
const recordSale = async (storeId, storeOrder, options = {}) => {
    const { orderId, subtotal, commission, netAmount, totalCost } = storeOrder;

    logger.info('Recording sale ledger entries', { storeId, orderId, subtotal, commission, netAmount });

    // 1. Record the sale revenue
    await createDoubleEntry({
        storeId,
        debitAccount: 'ACCOUNTS_RECEIVABLE',
        creditAccount: 'REVENUE',
        amount: subtotal,
        description: `Sale revenue - Order ${orderId}`,
        reference: orderId,
        referenceType: 'store_order'
    }, options);

    // 2. Record platform commission
    if (commission > 0) {
        await createDoubleEntry({
            storeId,
            debitAccount: 'REVENUE',
            creditAccount: 'PLATFORM_COMMISSION',
            amount: commission,
            description: `Platform commission - Order ${orderId}`,
            reference: orderId,
            referenceType: 'store_order'
        }, options);
    }

    // 3. Credit net amount to settlement
    const settlement = await SettlementAccount.findOne({
        where: { storeId },
        ...options
    });
    if (!settlement) throw new Error('Settlement account not found');

    await settlement.creditSettlement(netAmount, options);

    await createDoubleEntry({
        storeId,
        debitAccount: 'ACCOUNTS_RECEIVABLE',
        creditAccount: 'SETTLEMENT',
        amount: netAmount,
        description: `Net revenue credited - Order ${orderId}`,
        reference: orderId,
        referenceType: 'store_order'
    }, options);

    // Update lifetime totals
    await SettlementAccount.update({
        totalRevenue: sequelize.literal(`"totalRevenue" + ${subtotal}`),
        totalCommissionPaid: sequelize.literal(`"totalCommissionPaid" + ${commission}`),
        totalCostOfGoods: sequelize.literal(`"totalCostOfGoods" + ${totalCost}`)
    }, {
        where: { storeId },
        ...options
    });

    logger.info('Sale ledger entries recorded', { storeId, orderId });
};

/**
 * Record a payout - when agent withdraws funds
 * Debit SETTLEMENT, Credit PAYOUT
 */
const recordPayout = async (storeId, payoutData, options = {}) => {
    const { payoutId, amount } = payoutData;

    const settlement = await SettlementAccount.findOne({
        where: { storeId },
        ...options
    });
    if (!settlement) throw new Error('Settlement account not found');

    await settlement.debitSettlement(amount, options);

    await createDoubleEntry({
        storeId,
        debitAccount: 'SETTLEMENT',
        creditAccount: 'PAYOUT',
        amount,
        description: `Payout withdrawal - ${payoutId}`,
        reference: payoutId,
        referenceType: 'payout'
    }, options);

    await SettlementAccount.update({
        totalPayouts: sequelize.literal(`"totalPayouts" + ${amount}`),
        lastPayoutDate: new Date()
    }, {
        where: { storeId },
        ...options
    });

    logger.info('Payout ledger entries recorded', { storeId, payoutId, amount });
};

/**
 * Record a refund
 * Debit REFUND_EXPENSE, Credit SETTLEMENT (reduces settlement balance)
 */
const recordRefund = async (storeId, refundData, options = {}) => {
    const { orderId, amount } = refundData;

    const settlement = await SettlementAccount.findOne({
        where: { storeId },
        ...options
    });
    if (!settlement) throw new Error('Settlement account not found');

    await settlement.debitSettlement(amount, options);

    await createDoubleEntry({
        storeId,
        debitAccount: 'REFUND_EXPENSE',
        creditAccount: 'SETTLEMENT',
        amount,
        description: `Refund issued - Order ${orderId}`,
        reference: orderId,
        referenceType: 'refund'
    }, options);

    logger.info('Refund ledger entries recorded', { storeId, orderId, amount });
};

/**
 * Record an admin adjustment
 */
const recordAdjustment = async (storeId, adjustmentData, options = {}) => {
    const { amount, type, description, adminUsername } = adjustmentData;

    const settlement = await SettlementAccount.findOne({
        where: { storeId },
        ...options
    });
    if (!settlement) throw new Error('Settlement account not found');

    if (type === 'credit') {
        await settlement.creditSettlement(amount, options);
        await createDoubleEntry({
            storeId,
            debitAccount: 'ADJUSTMENT',
            creditAccount: 'SETTLEMENT',
            amount,
            description: description || `Admin credit adjustment by ${adminUsername}`,
            reference: `ADJ-${Date.now()}`,
            referenceType: 'adjustment',
            metadata: { adminUsername, type: 'credit' }
        }, options);
    } else {
        await settlement.debitSettlement(amount, options);
        await createDoubleEntry({
            storeId,
            debitAccount: 'SETTLEMENT',
            creditAccount: 'ADJUSTMENT',
            amount,
            description: description || `Admin debit adjustment by ${adminUsername}`,
            reference: `ADJ-${Date.now()}`,
            referenceType: 'adjustment',
            metadata: { adminUsername, type: 'debit' }
        }, options);
    }

    logger.info('Adjustment ledger entries recorded', { storeId, type, amount });
};

module.exports = {
    createDoubleEntry,
    recordSale,
    recordPayout,
    recordRefund,
    recordAdjustment
};

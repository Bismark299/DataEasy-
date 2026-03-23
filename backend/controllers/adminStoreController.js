/**
 * Admin Store Controller
 * Admin-facing store management: approve payouts, view all stores, reconciliation
 */

const { Store, StoreProduct, StoreOrder, SettlementAccount, LedgerEntry, Payout, ReconciliationRecord, User, AdminAuditLog } = require('../models');
const { sequelize } = require('../config/database');
const { createTransferRecipient, initiateTransfer } = require('../config/paystack');
const ledgerService = require('../services/ledgerService');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

/**
 * Get all stores
 * GET /api/admin/stores
 */
exports.getAllStores = async (req, res) => {
    try {
        const { page = 1, limit = 20, active } = req.query;
        const where = {};
        if (active !== undefined) where.isActive = active === 'true';

        const { count, rows: stores } = await Store.findAndCountAll({
            where,
            include: [
                { model: User, as: 'owner', attributes: ['id', 'fullName', 'email', 'phone', 'agentCode', 'role'] },
                { model: SettlementAccount, as: 'settlementAccount' }
            ],
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            stores,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Admin get stores error', { error: error.message });
        res.status(500).json({ error: 'Failed to get stores' });
    }
};

/**
 * Get store details
 * GET /api/admin/stores/:storeId
 */
exports.getStoreDetails = async (req, res) => {
    try {
        const store = await Store.findByPk(req.params.storeId, {
            include: [
                { model: User, as: 'owner', attributes: ['id', 'fullName', 'email', 'phone', 'agentCode', 'role'] },
                { model: SettlementAccount, as: 'settlementAccount' }
            ]
        });

        if (!store) return res.status(404).json({ error: 'Store not found' });

        // Recent orders
        const recentOrders = await StoreOrder.findAll({
            where: { storeId: store.id },
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        // Product count
        const productCount = await StoreProduct.count({ where: { storeId: store.id } });

        // Pending payouts
        const pendingPayouts = await Payout.findAll({
            where: { storeId: store.id, status: { [Op.in]: ['pending', 'approved'] } },
            order: [['createdAt', 'DESC']]
        });

        res.json({
            success: true,
            store,
            recentOrders,
            productCount,
            pendingPayouts
        });
    } catch (error) {
        logger.error('Admin get store details error', { error: error.message });
        res.status(500).json({ error: 'Failed to get store details' });
    }
};

/**
 * Update store settings (commission rate, active status, payout threshold)
 * PUT /api/admin/stores/:storeId
 */
exports.updateStoreSettings = async (req, res) => {
    try {
        const store = await Store.findByPk(req.params.storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const previousValue = {
            isActive: store.isActive,
            commissionRate: store.commissionRate,
            payoutThreshold: store.payoutThreshold
        };

        const allowedFields = ['isActive', 'commissionRate', 'payoutThreshold'];
        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        await store.update(updates);

        await AdminAuditLog.logAction(req, {
            action: 'SETTINGS_UPDATE',
            targetType: 'settings',
            targetId: store.id,
            previousValue,
            newValue: updates,
            description: `Updated store settings for ${store.name}`
        });

        res.json({ success: true, store });
    } catch (error) {
        logger.error('Admin update store error', { error: error.message });
        res.status(500).json({ error: 'Failed to update store' });
    }
};

// ==========================================
// PAYOUT MANAGEMENT
// ==========================================

/**
 * Get all payouts (for admin approval queue)
 * GET /api/admin/stores/payouts
 */
exports.getAllPayouts = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const where = {};
        if (status) where.status = status;

        const { count, rows: payouts } = await Payout.findAndCountAll({
            where,
            include: [
                { model: Store, as: 'store', attributes: ['id', 'name'] },
                { model: User, as: 'user', attributes: ['id', 'fullName', 'agentCode', 'phone'] }
            ],
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            payouts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Admin get payouts error', { error: error.message });
        res.status(500).json({ error: 'Failed to get payouts' });
    }
};

/**
 * Approve payout
 * POST /api/admin/stores/payouts/:payoutId/approve
 */
exports.approvePayout = async (req, res) => {
    try {
        const payout = await Payout.findOne({
            where: { payoutId: req.params.payoutId },
            include: [{ model: Store, as: 'store' }]
        });

        if (!payout) return res.status(404).json({ error: 'Payout not found' });
        if (payout.status !== 'pending') {
            return res.status(400).json({ error: `Cannot approve payout with status: ${payout.status}` });
        }

        await payout.update({
            status: 'approved',
            approvedBy: req.admin.username,
            approvedAt: new Date()
        });

        await AdminAuditLog.logAction(req, {
            action: 'WALLET_CREDIT',
            targetType: 'wallet',
            targetId: payout.storeId,
            newValue: { payoutId: payout.payoutId, amount: payout.amount, method: payout.method },
            description: `Approved payout ${payout.payoutId} for GH₵${payout.amount} (${payout.store.name})`
        });

        res.json({ success: true, message: 'Payout approved', payout });
    } catch (error) {
        logger.error('Admin approve payout error', { error: error.message });
        res.status(500).json({ error: 'Failed to approve payout' });
    }
};

/**
 * Process/complete payout via Paystack Transfer API
 * POST /api/admin/stores/payouts/:payoutId/complete
 */
exports.completePayout = async (req, res) => {
    try {
        const payout = await Payout.findOne({
            where: { payoutId: req.params.payoutId },
            include: [
                { model: Store, as: 'store', include: [{ model: SettlementAccount, as: 'settlementAccount' }] },
                { model: User, as: 'user' }
            ]
        });

        if (!payout) return res.status(404).json({ error: 'Payout not found' });
        if (payout.status !== 'approved') {
            return res.status(400).json({ error: `Payout must be approved first. Current status: ${payout.status}` });
        }

        const store = payout.store;

        // Map MoMo provider to Paystack bank code for Ghana
        const momoProviderCodes = {
            'MTN': 'MTN',
            'AirtelTigo': 'ATL',
            'Telecel': 'VOD'
        };

        // Determine transfer details based on payout method
        let recipientType, recipientName, accountNumber, bankCode;

        if (payout.method === 'momo') {
            if (!store.momoNumber || !store.momoProvider) {
                return res.status(400).json({ error: 'Store MoMo details not configured' });
            }
            recipientType = 'mobile_money';
            recipientName = store.name;
            accountNumber = store.momoNumber;
            bankCode = momoProviderCodes[store.momoProvider];
            if (!bankCode) {
                return res.status(400).json({ error: `Unsupported MoMo provider: ${store.momoProvider}` });
            }
        } else if (payout.method === 'bank_transfer') {
            if (!store.bankAccountNumber || !store.bankName) {
                return res.status(400).json({ error: 'Store bank details not configured' });
            }
            recipientType = 'nuban';
            recipientName = store.bankAccountName || store.name;
            accountNumber = store.bankAccountNumber;
            bankCode = store.bankName; // Admin should ensure this is a valid Paystack bank code
        } else {
            return res.status(400).json({ error: `Unsupported payout method: ${payout.method}` });
        }

        // Update payout to processing
        await payout.update({ status: 'processing' });

        try {
            // Step 1: Create Paystack transfer recipient
            const recipientResponse = await createTransferRecipient({
                type: recipientType,
                name: recipientName,
                account_number: accountNumber,
                bank_code: bankCode,
                currency: 'GHS'
            });

            const recipientCode = recipientResponse.data.recipient_code;
            await payout.update({ recipientCode });

            // Step 2: Initiate the transfer
            const transferResponse = await initiateTransfer({
                source: 'balance',
                amount: payout.netAmount,
                recipient: recipientCode,
                reference: payout.transferReference,
                reason: `Store payout ${payout.payoutId} for ${store.name}`
            });

            const transferCode = transferResponse.data.transfer_code;
            await payout.update({ transferCode });

            // Step 3: Complete the ledger entries
            await sequelize.transaction(async (t) => {
                const settlement = payout.store.settlementAccount;
                await settlement.releaseHold(payout.amount, { transaction: t });

                await ledgerService.recordPayout(payout.storeId, {
                    payoutId: payout.payoutId,
                    amount: payout.amount
                }, { transaction: t });

                await payout.update({
                    status: 'completed',
                    completedAt: new Date()
                }, { transaction: t });
            });

            await AdminAuditLog.logAction(req, {
                action: 'WALLET_DEBIT',
                targetType: 'wallet',
                targetId: payout.storeId,
                newValue: { payoutId: payout.payoutId, amount: payout.amount, transferCode, recipientCode },
                description: `Completed payout ${payout.payoutId} for GH₵${payout.amount} via Paystack Transfer to ${payout.method === 'momo' ? store.momoNumber : store.bankAccountNumber}`
            });

            res.json({ success: true, message: 'Payout completed via Paystack Transfer', payout, transferCode });

        } catch (transferError) {
            // Transfer failed - revert to approved status so admin can retry            
            await payout.update({ 
                status: 'approved',
                failureReason: transferError.message 
            });
            logger.error('Paystack transfer failed', { 
                payoutId: payout.payoutId, 
                error: transferError.message 
            });
            return res.status(400).json({ 
                error: `Transfer failed: ${transferError.message}. Payout reverted to approved.` 
            });
        }
    } catch (error) {
        logger.error('Admin complete payout error', { error: error.message });
        res.status(500).json({ error: error.message || 'Failed to complete payout' });
    }
};

/**
 * Reject payout
 * POST /api/admin/stores/payouts/:payoutId/reject
 */
exports.rejectPayout = async (req, res) => {
    try {
        const { reason } = req.body;
        const payout = await Payout.findOne({
            where: { payoutId: req.params.payoutId },
            include: [
                { model: Store, as: 'store', include: [{ model: SettlementAccount, as: 'settlementAccount' }] }
            ]
        });

        if (!payout) return res.status(404).json({ error: 'Payout not found' });
        if (!['pending', 'approved'].includes(payout.status)) {
            return res.status(400).json({ error: `Cannot reject payout with status: ${payout.status}` });
        }

        await sequelize.transaction(async (t) => {
            // Release hold back to available
            const settlement = payout.store.settlementAccount;
            await settlement.releaseHold(payout.amount, { transaction: t });

            await payout.update({
                status: 'rejected',
                rejectionReason: reason || 'Rejected by admin'
            }, { transaction: t });
        });

        await AdminAuditLog.logAction(req, {
            action: 'WALLET_ADJUSTMENT',
            targetType: 'wallet',
            targetId: payout.storeId,
            newValue: { payoutId: payout.payoutId, reason },
            description: `Rejected payout ${payout.payoutId} - ${reason || 'No reason provided'}`
        });

        res.json({ success: true, message: 'Payout rejected', payout });
    } catch (error) {
        logger.error('Admin reject payout error', { error: error.message });
        res.status(500).json({ error: 'Failed to reject payout' });
    }
};

// ==========================================
// SETTLEMENT ADJUSTMENTS
// ==========================================

/**
 * Adjust store settlement balance (admin credit/debit)
 * POST /api/admin/stores/:storeId/adjustment
 */
exports.adjustSettlement = async (req, res) => {
    try {
        const { amount, type, description } = req.body;
        const store = await Store.findByPk(req.params.storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        if (!amount || !type || !['credit', 'debit'].includes(type)) {
            return res.status(400).json({ error: 'Amount and type (credit/debit) are required' });
        }

        await sequelize.transaction(async (t) => {
            await ledgerService.recordAdjustment(store.id, {
                amount: parseFloat(amount),
                type,
                description,
                adminUsername: req.admin.username
            }, { transaction: t });
        });

        const settlement = await SettlementAccount.findOne({ where: { storeId: store.id } });

        await AdminAuditLog.logAction(req, {
            action: 'WALLET_ADJUSTMENT',
            targetType: 'wallet',
            targetId: store.id,
            newValue: { type, amount, description },
            description: `${type === 'credit' ? 'Credited' : 'Debited'} GH₵${amount} to store ${store.name}`
        });

        res.json({ success: true, message: `Settlement ${type}ed GH₵${amount}`, settlement });
    } catch (error) {
        logger.error('Admin adjustment error', { error: error.message });
        res.status(500).json({ error: error.message || 'Failed to adjust settlement' });
    }
};

// ==========================================
// RECONCILIATION
// ==========================================

/**
 * Run reconciliation for a store
 * POST /api/admin/stores/:storeId/reconcile
 */
exports.runReconciliation = async (req, res) => {
    try {
        const store = await Store.findByPk(req.params.storeId, {
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { startDate, endDate } = req.body;
        const periodStart = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const periodEnd = endDate ? new Date(endDate) : new Date();

        const dateFilter = { [Op.between]: [periodStart, periodEnd] };

        // Expected revenue from paid orders
        const expectedRevenue = await StoreOrder.findOne({
            where: { storeId: store.id, status: { [Op.in]: ['paid', 'fulfilled'] }, paidAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('subtotal')), 0), 'total']],
            raw: true
        });

        // Actual revenue from ledger
        const actualRevenue = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'REVENUE', type: 'credit', createdAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Expected commission
        const expectedCommission = await StoreOrder.findOne({
            where: { storeId: store.id, status: { [Op.in]: ['paid', 'fulfilled'] }, paidAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('commission')), 0), 'total']],
            raw: true
        });

        // Actual commission from ledger
        const actualCommission = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'PLATFORM_COMMISSION', type: 'credit', createdAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Expected payouts
        const expectedPayouts = await Payout.findOne({
            where: { storeId: store.id, status: 'completed', completedAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Actual payouts from ledger
        const actualPayouts = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'PAYOUT', type: 'credit', createdAt: dateFilter },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        const expRev = parseFloat(expectedRevenue?.total || 0);
        const actRev = parseFloat(actualRevenue?.total || 0);
        const expComm = parseFloat(expectedCommission?.total || 0);
        const actComm = parseFloat(actualCommission?.total || 0);
        const expPay = parseFloat(expectedPayouts?.total || 0);
        const actPay = parseFloat(actualPayouts?.total || 0);

        const revenueDiscrepancy = Math.round((expRev - actRev) * 100) / 100;
        const commissionDiscrepancy = Math.round((expComm - actComm) * 100) / 100;
        const payoutDiscrepancy = Math.round((expPay - actPay) * 100) / 100;
        const totalDiscrepancy = Math.round((Math.abs(revenueDiscrepancy) + Math.abs(commissionDiscrepancy) + Math.abs(payoutDiscrepancy)) * 100) / 100;

        const hasDiscrepancy = totalDiscrepancy > 0.01;

        const record = await ReconciliationRecord.create({
            storeId: store.id,
            periodStart,
            periodEnd,
            expectedRevenue: expRev,
            actualRevenue: actRev,
            expectedCommission: expComm,
            actualCommission: actComm,
            expectedPayouts: expPay,
            actualPayouts: actPay,
            expectedBalance: store.settlementAccount.ledgerBalance,
            actualBalance: store.settlementAccount.availableBalance + store.settlementAccount.holdAmount,
            discrepancy: totalDiscrepancy,
            status: hasDiscrepancy ? 'discrepancy' : 'balanced',
            details: {
                revenueDiscrepancy,
                commissionDiscrepancy,
                payoutDiscrepancy,
                settlementBalance: store.settlementAccount.ledgerBalance,
                availableBalance: store.settlementAccount.availableBalance,
                holdAmount: store.settlementAccount.holdAmount
            }
        });

        res.json({
            success: true,
            reconciliation: record,
            summary: {
                status: hasDiscrepancy ? 'DISCREPANCY FOUND' : 'BALANCED',
                revenue: { expected: expRev, actual: actRev, discrepancy: revenueDiscrepancy },
                commission: { expected: expComm, actual: actComm, discrepancy: commissionDiscrepancy },
                payouts: { expected: expPay, actual: actPay, discrepancy: payoutDiscrepancy },
                totalDiscrepancy
            }
        });
    } catch (error) {
        logger.error('Reconciliation error', { error: error.message });
        res.status(500).json({ error: 'Failed to run reconciliation' });
    }
};

/**
 * Get ALL reconciliation records across all stores
 * GET /api/admin/stores/reconciliation
 */
exports.getAllReconciliations = async (req, res) => {
    try {
        const { page = 1, limit = 50, status } = req.query;
        const where = {};
        if (status) where.status = status;

        const { count, rows: records } = await ReconciliationRecord.findAndCountAll({
            where,
            include: [{ model: Store, as: 'store', attributes: ['id', 'name'] }],
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({ success: true, records, pagination: { page: parseInt(page), limit: parseInt(limit), total: count } });
    } catch (error) {
        logger.error('Get all reconciliations error', { error: error.message });
        res.status(500).json({ error: 'Failed to get reconciliations' });
    }
};

/**
 * Get reconciliation history for a specific store
 * GET /api/admin/stores/:storeId/reconciliations
 */
exports.getReconciliations = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const where = { storeId: req.params.storeId };
        if (status) where.status = status;

        const { count, rows: records } = await ReconciliationRecord.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            records,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Get reconciliations error', { error: error.message });
        res.status(500).json({ error: 'Failed to get reconciliations' });
    }
};

/**
 * Resolve reconciliation discrepancy
 * PUT /api/admin/stores/reconciliations/:recordId/resolve
 */
exports.resolveReconciliation = async (req, res) => {
    try {
        const record = await ReconciliationRecord.findByPk(req.params.recordId);
        if (!record) return res.status(404).json({ error: 'Reconciliation record not found' });

        const { resolutionNotes } = req.body;
        if (!resolutionNotes) {
            return res.status(400).json({ error: 'Resolution notes are required' });
        }

        await record.update({
            status: 'resolved',
            resolvedBy: req.admin.username,
            resolvedAt: new Date(),
            resolutionNotes
        });

        res.json({ success: true, record });
    } catch (error) {
        logger.error('Resolve reconciliation error', { error: error.message });
        res.status(500).json({ error: 'Failed to resolve reconciliation' });
    }
};

/**
 * Platform-wide store stats
 * GET /api/admin/stores/stats
 */
exports.getStoreStats = async (req, res) => {
    try {
        const totalStores = await Store.count();
        const activeStores = await Store.count({ where: { isActive: true } });

        const totalSales = await StoreOrder.findOne({
            where: { status: { [Op.in]: ['paid', 'fulfilled'] } },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('subtotal')), 0), 'revenue'],
                [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('commission')), 0), 'commission']
            ],
            raw: true
        });

        const totalPayoutsCompleted = await Payout.findOne({
            where: { status: 'completed' },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']
            ],
            raw: true
        });

        const pendingPayouts = await Payout.findOne({
            where: { status: { [Op.in]: ['pending', 'approved'] } },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']
            ],
            raw: true
        });

        res.json({
            success: true,
            stats: {
                stores: { total: totalStores, active: activeStores },
                sales: {
                    count: parseInt(totalSales?.count || 0),
                    revenue: parseFloat(totalSales?.revenue || 0),
                    commissionEarned: parseFloat(totalSales?.commission || 0)
                },
                payouts: {
                    completed: { count: parseInt(totalPayoutsCompleted?.count || 0), total: parseFloat(totalPayoutsCompleted?.total || 0) },
                    pending: { count: parseInt(pendingPayouts?.count || 0), total: parseFloat(pendingPayouts?.total || 0) }
                }
            }
        });
    } catch (error) {
        logger.error('Store stats error', { error: error.message });
        res.status(500).json({ error: 'Failed to get store stats' });
    }
};

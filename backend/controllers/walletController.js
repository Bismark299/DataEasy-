/**
 * Wallet Controller
 * Balance, topup, and transaction management
 * Updated for PostgreSQL/Sequelize
 * With atomic transactions for financial operations
 */

const { Wallet, Transaction, Setting } = require('../models');
const { sequelize } = require('../config/database');
const { verifyTransaction } = require('../config/paystack');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Get wallet balance
 * GET /api/wallet/balance
 */
exports.getBalance = async (req, res) => {
    try {
        let wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        
        // Create wallet if doesn't exist
        if (!wallet) {
            wallet = await Wallet.create({ userId: req.user.id });
        }

        res.json({
            success: true,
            balance: wallet.balance,
            currency: wallet.currency,
            totalTopups: wallet.totalTopups,
            totalSpent: wallet.totalSpent
        });
    } catch (error) {
        logger.error('Get balance error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to get balance' });
    }
};

/**
 * Calculate topup fee
 * GET /api/wallet/topup/fee?amount=100
 * Returns fee breakdown before user confirms payment
 */
exports.calculateFee = async (req, res) => {
    try {
        const amount = parseFloat(req.query.amount);
        
        if (isNaN(amount) || amount < 5) {
            return res.status(400).json({ error: 'Minimum topup amount is GH₵5.00' });
        }

        // Also check against admin-configured minimum deposit
        const depositLimits = await Setting.getDepositLimits();
        if (amount < depositLimits.minDeposit) {
            return res.status(400).json({ 
                error: `Minimum topup amount is GH₵${depositLimits.minDeposit.toFixed(2)}` 
            });
        }

        const feeInfo = await Setting.calculateTopupFee(amount);
        
        res.json({
            success: true,
            baseAmount: feeInfo.baseAmount,      // What user will receive in wallet
            feeAmount: feeInfo.feeAmount,        // Fee charged
            feePercentage: feeInfo.feePercentage, // Fee percentage
            totalAmount: feeInfo.totalAmount     // What user will pay
        });
    } catch (error) {
        logger.error('Calculate fee error', { error: error.message });
        res.status(500).json({ error: 'Failed to calculate fee' });
    }
};

/**
 * Get wallet transaction history
 * GET /api/wallet/history
 */
exports.getHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20, type, startDate, endDate } = req.query;

        const where = { userId: req.user.id };
        if (type) where.type = type;
        if (startDate || endDate) {
            const { Op } = require('sequelize');
            where.createdAt = {};
            if (startDate) where.createdAt[Op.gte] = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = end;
            }
        }

        const { count, rows: transactions } = await Transaction.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        logger.error('Get history error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to get history' });
    }
};

/**
 * Initialize wallet topup
 * POST /api/wallet/topup
 * Creates a pending transaction and returns reference for PaystackPop
 * 
 * Fee Structure (Option 4):
 * - User wants GH₵100 in wallet
 * - Fee (e.g., 2%) is added on top
 * - User pays GH₵102 total via Paystack
 * - User receives GH₵100 in wallet
 */
exports.initializeTopup = async (req, res) => {
    try {
        // This is the amount user wants credited to their wallet
        const baseAmount = Math.round(parseFloat(req.body.amount) * 100) / 100;
        logger.debug('Initialize topup request', { baseAmount, userId: req.user.id });

        if (isNaN(baseAmount) || baseAmount < 5) {
            return res.status(400).json({ error: 'Minimum topup amount is GH₵5.00' });
        }

        // Check deposit limits from settings
        const depositLimits = await Setting.getDepositLimits();
        if (baseAmount < depositLimits.minDeposit) {
            return res.status(400).json({ 
                error: `Minimum topup amount is GH₵${depositLimits.minDeposit.toFixed(2)}` 
            });
        }

        // Calculate fees
        const feeInfo = await Setting.calculateTopupFee(baseAmount);
        logger.debug('Fee calculation', feeInfo);

        const reference = `TOPUP-${Date.now()}-${uuidv4().split('-')[0]}`;
        logger.debug('Generated reference', { reference });

        // Get or create wallet
        let wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        if (!wallet) {
            wallet = await Wallet.create({ userId: req.user.id });
            logger.debug('Created new wallet for user', { userId: req.user.id });
        }

        // Create pending transaction record
        // Store baseAmount (what user gets) in amount field
        // Store totalAmount (what user pays) for Paystack
        const transaction = await Transaction.create({
            userId: req.user.id,
            type: 'credit',
            amount: feeInfo.baseAmount, // Amount to credit to wallet
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance, // Will update on verification
            description: feeInfo.feeAmount > 0 
                ? `Wallet Top-up (Fee: GH₵${feeInfo.feeAmount.toFixed(2)})`
                : 'Wallet Top-up',
            reference,
            paymentMethod: 'paystack',
            status: 'pending',
            metadata: JSON.stringify({
                baseAmount: feeInfo.baseAmount,
                feeAmount: feeInfo.feeAmount,
                feePercentage: feeInfo.feePercentage,
                totalPaid: feeInfo.totalAmount
            })
        });
        
        logger.financial('Pending transaction created', { 
            transactionId: transaction.id, 
            baseAmount: feeInfo.baseAmount,
            feeAmount: feeInfo.feeAmount,
            totalAmount: feeInfo.totalAmount,
            reference, 
            userId: req.user.id 
        });

        // Return fee breakdown to frontend
        res.json({
            success: true,
            message: 'Payment initialized',
            reference,
            email: req.user.email,
            // Amount breakdown
            baseAmount: feeInfo.baseAmount,      // What user will receive
            feeAmount: feeInfo.feeAmount,        // Fee charged
            feePercentage: feeInfo.feePercentage, // Fee %
            totalAmount: feeInfo.totalAmount,    // What user pays to Paystack
            // Legacy field for compatibility
            amount: feeInfo.baseAmount
        });
    } catch (error) {
        logger.error('Initialize topup error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to initialize payment' });
    }
};

/**
 * Verify topup payment with atomic transaction
 * GET /api/wallet/topup/verify/:reference
 */
exports.verifyTopup = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { reference } = req.params;
        logger.debug('Verifying payment', { reference, userId: req.user.id });

        // Find transaction with row lock
        const transaction = await Transaction.findOne({
            where: {
                reference,
                userId: req.user.id
            },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        logger.debug('Transaction lookup', { found: !!transaction, reference });

        if (!transaction) {
            await t.rollback();
            logger.warn('Transaction not found', { reference, userId: req.user.id });
            return res.status(404).json({ error: 'Transaction not found' });
        }

        logger.debug('Transaction details', { status: transaction.status, amount: transaction.amount });

        if (transaction.status === 'completed') {
            await t.rollback();
            const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
            return res.json({
                success: true,
                message: 'Payment already verified',
                status: 'completed',
                newBalance: wallet.balance
            });
        }

        // Verify with Paystack
        logger.debug('Calling Paystack verify API', { reference });
        const verification = await verifyTransaction(reference);
        logger.debug('Paystack verification response', { status: verification.data?.status });

        if (verification.data.status !== 'success') {
            logger.warn('Payment not successful', { reference, paystackStatus: verification.data.status });
            transaction.status = 'failed';
            await transaction.save({ transaction: t });
            await t.commit();
            return res.status(400).json({ error: 'Payment verification failed' });
        }

        // Get wallet with row lock for atomic update
        logger.debug('Payment successful, crediting wallet', { reference });
        const wallet = await Wallet.findOne({ 
            where: { userId: req.user.id },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        const balanceBefore = wallet.balance;
        
        // Credit wallet atomically
        await wallet.credit(transaction.amount, { transaction: t });
        
        logger.financial('Wallet credited', { 
            userId: req.user.id, 
            amount: transaction.amount,
            balanceBefore,
            balanceAfter: wallet.balance,
            reference
        });

        // Update transaction
        transaction.status = 'completed';
        transaction.balanceAfter = wallet.balance;
        await transaction.save({ transaction: t });

        // Commit all changes together
        await t.commit();

        logger.financial('Transaction completed', { reference, amount: transaction.amount });

        res.json({
            success: true,
            message: 'Payment verified successfully',
            status: 'completed',
            amount: transaction.amount,
            newBalance: wallet.balance
        });
    } catch (error) {
        await t.rollback();
        logger.error('Verify topup error', { error: error.message, reference: req.params?.reference });
        
        // Handle optimistic lock error
        if (error.message.includes('modified by another transaction')) {
            return res.status(409).json({ 
                error: 'Transaction conflict. Please try again.',
                code: 'CONFLICT'
            });
        }
        
        res.status(500).json({ error: 'Failed to verify payment' });
    }
};

/**
 * Cancel a pending deposit (when user closes popup without completing)
 * POST /api/wallet/topup/cancel/:reference
 */
exports.cancelTopup = async (req, res) => {
    try {
        const { reference } = req.params;
        logger.debug('Cancelling topup', { reference, userId: req.user.id });

        // Find the pending transaction belonging to this user
        const transaction = await Transaction.findOne({
            where: {
                reference,
                userId: req.user.id,
                status: 'pending'
            }
        });

        if (!transaction) {
            // Transaction not found or already completed/failed - that's fine
            return res.json({
                success: true,
                message: 'Transaction already processed or not found'
            });
        }

        // Mark as cancelled
        transaction.status = 'failed';
        transaction.metadata = JSON.stringify({
            ...JSON.parse(transaction.metadata || '{}'),
            cancelledByUser: true,
            cancelledAt: new Date().toISOString()
        });
        await transaction.save();

        logger.debug('Topup cancelled by user', { reference, userId: req.user.id });

        res.json({
            success: true,
            message: 'Payment cancelled'
        });
    } catch (error) {
        logger.error('Cancel topup error', { error: error.message, reference: req.params?.reference });
        res.status(500).json({ error: 'Failed to cancel payment' });
    }
};

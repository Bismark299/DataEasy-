/**
 * MoMo Controller
 * Handles incoming MoMo deposits from SMS listener app
 */

const { User, Wallet, Transaction, MoMoDeposit } = require('../models');
const { sequelize } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

// Secret token for SMS listener authentication
const SMS_LISTENER_TOKEN = process.env.SMS_LISTENER_TOKEN || 'CHANGE_THIS_TO_A_SECURE_TOKEN';

/**
 * Authenticate SMS listener request
 */
const authenticateListener = (req, res, next) => {
    const token = req.headers['x-auth-token'];
    
    if (!token || token !== SMS_LISTENER_TOKEN) {
        logger.warn('MoMo deposit: Invalid or missing auth token', {
            ip: req.ip,
            hasToken: !!token
        });
        return res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
    }
    
    next();
};

/**
 * Process incoming MoMo deposit from SMS listener
 * POST /api/momo/deposit
 * 
 * Required headers:
 * - X-Auth-Token: Secret token
 * 
 * Body:
 * - transactionId: MoMo transaction ID (string, required)
 * - amount: Amount in GHS (number, required)
 * - senderPhone: Sender phone number (string, required)
 * - reference: Reference/username (string, optional)
 * - rawMessage: Original SMS text (string, optional)
 * - receivedAt: Timestamp in ms (number, optional)
 */
const processDeposit = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const {
            transactionId,
            amount,
            senderPhone,
            reference,
            rawMessage,
            receivedAt
        } = req.body;
        
        // Validate required fields
        if (!transactionId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'Transaction ID is required'
            });
        }
        
        if (!amount || parseFloat(amount) <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'Valid amount is required'
            });
        }
        
        const depositAmount = parseFloat(amount);
        
        logger.info('MoMo deposit received', {
            transactionId,
            amount: depositAmount,
            senderPhone,
            reference
        });
        
        // Check for duplicate transaction
        const existingDeposit = await MoMoDeposit.findOne({
            where: { transactionId },
            transaction: t
        });
        
        if (existingDeposit) {
            await t.rollback();
            logger.warn('MoMo deposit: Duplicate transaction', { transactionId });
            return res.status(409).json({
                success: false,
                error: 'Duplicate transaction',
                message: 'This transaction has already been processed'
            });
        }
        
        // Create deposit record
        const deposit = await MoMoDeposit.create({
            transactionId,
            amount: depositAmount,
            senderPhone: senderPhone || 'Unknown',
            reference: reference || null,
            rawMessage: rawMessage || null,
            smsReceivedAt: receivedAt ? new Date(receivedAt) : null,
            status: 'pending',
            deviceInfo: {
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        }, { transaction: t });
        
        // Try to find user - PRIORITIZE AGENT CODE (BT-XXXX format)
        let user = null;
        let matchMethod = null;
        
        if (reference) {
            const searchTerm = reference.trim();
            
            // PRIORITY 1: Extract and match Agent Code (BT-XXXX format)
            const agentCodeMatch = searchTerm.match(/BT-\d{4}/i);
            if (agentCodeMatch) {
                const agentCode = agentCodeMatch[0].toUpperCase();
                logger.info('MoMo deposit: Looking for agent code', { agentCode });
                
                user = await User.findOne({
                    where: {
                        agentCode: agentCode,
                        isActive: true
                    },
                    transaction: t
                });
                
                if (user) {
                    matchMethod = 'agentCode';
                    logger.info('MoMo deposit: Matched by agent code', { 
                        agentCode, 
                        userId: user.id,
                        userName: user.fullName 
                    });
                }
            }
            
            // PRIORITY 2: Try exact match on agentCode (case-insensitive, in case format differs)
            if (!user) {
                user = await User.findOne({
                    where: sequelize.where(
                        sequelize.fn('UPPER', sequelize.col('agentCode')),
                        searchTerm.toUpperCase()
                    ),
                    transaction: t
                });
                if (user) matchMethod = 'agentCode';
            }
            
            // PRIORITY 3: Try phone number
            if (!user) {
                const normalizedRef = normalizeGhanaPhone(searchTerm);
                if (normalizedRef) {
                    user = await User.findOne({
                        where: {
                            phone: normalizedRef,
                            isActive: true
                        },
                        transaction: t
                    });
                    if (user) matchMethod = 'phone';
                }
            }
            
            // PRIORITY 4: Try email
            if (!user) {
                user = await User.findOne({
                    where: {
                        email: searchTerm.toLowerCase(),
                        isActive: true
                    },
                    transaction: t
                });
                if (user) matchMethod = 'email';
            }
        }
        
        // FALLBACK: Try matching by sender phone number
        if (!user && senderPhone) {
            const normalizedPhone = normalizeGhanaPhone(senderPhone);
            if (normalizedPhone) {
                user = await User.findOne({
                    where: {
                        phone: normalizedPhone,
                        isActive: true
                    },
                    transaction: t
                });
                if (user) matchMethod = 'senderPhone';
            }
        }
        
        if (!user) {
            // No user found - mark as unmatched
            await deposit.update({
                status: 'unmatched',
                statusMessage: `No user found matching reference: ${reference || 'none'}`
            }, { transaction: t });
            
            await t.commit();
            
            logger.warn('MoMo deposit: No user matched', {
                transactionId,
                reference,
                senderPhone
            });
            
            return res.status(200).json({
                success: false,
                error: 'User not found',
                message: `No user found with reference: ${reference || 'none'}. Deposit saved for manual review.`,
                depositId: deposit.id
            });
        }
        
        // User found - credit their wallet
        logger.info('MoMo deposit: User matched', {
            transactionId,
            userId: user.id,
            username: user.fullName,
            matchMethod
        });
        
        // Get or create wallet
        let wallet = await Wallet.findOne({
            where: { userId: user.id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        
        if (!wallet) {
            wallet = await Wallet.create({
                userId: user.id,
                balance: 0,
                currency: 'GHS'
            }, { transaction: t });
        }
        
        const balanceBefore = wallet.balance;
        const balanceAfter = balanceBefore + depositAmount;
        
        // Update wallet balance
        await wallet.update({
            balance: balanceAfter,
            totalTopups: wallet.totalTopups + depositAmount,
            version: wallet.version + 1
        }, { transaction: t });
        
        // Create wallet transaction record
        const walletTransaction = await Transaction.create({
            userId: user.id,
            type: 'credit',
            amount: depositAmount,
            balanceBefore,
            balanceAfter,
            description: `MoMo Deposit (${transactionId})`,
            reference: `MOMO-${transactionId}`,
            paymentMethod: 'manual', // Use 'manual' as it's an existing enum value
            status: 'completed',
            metadata: {
                momoTransactionId: transactionId,
                senderPhone,
                reference,
                matchMethod
            }
        }, { transaction: t });
        
        // Update deposit record
        await deposit.update({
            userId: user.id,
            status: 'credited',
            statusMessage: `Credited to ${user.fullName} (${matchMethod})`,
            walletTransactionId: walletTransaction.id
        }, { transaction: t });
        
        await t.commit();
        
        logger.info('MoMo deposit: Successfully credited', {
            transactionId,
            userId: user.id,
            username: user.fullName,
            amount: depositAmount,
            newBalance: balanceAfter
        });
        
        return res.status(200).json({
            success: true,
            message: `GHS ${depositAmount.toFixed(2)} credited to ${user.fullName}`,
            username: user.fullName,
            newBalance: balanceAfter,
            depositId: deposit.id,
            walletTransactionId: walletTransaction.id
        });
        
    } catch (error) {
        await t.rollback();
        
        logger.error('MoMo deposit error', {
            error: error.message,
            stack: error.stack,
            body: req.body
        });
        
        return res.status(500).json({
            success: false,
            error: 'Processing failed',
            message: 'An error occurred while processing the deposit'
        });
    }
};

/**
 * Get deposit history (for admin)
 * GET /api/momo/deposits
 */
const getDeposits = async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        
        const where = {};
        if (status) where.status = status;
        
        const { count, rows: deposits } = await MoMoDeposit.findAndCountAll({
            where,
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'fullName', 'email', 'phone', 'agentCode']
            }],
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit)
        });
        
        res.json({
            success: true,
            deposits,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        logger.error('Get deposits error', { error: error.message });
        res.status(500).json({ error: 'Failed to get deposits' });
    }
};

/**
 * Manually credit an unmatched deposit to a user (admin only)
 * POST /api/momo/deposits/:id/credit
 */
const manualCredit = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        if (!userId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }
        
        const deposit = await MoMoDeposit.findByPk(id, { transaction: t });
        
        if (!deposit) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: 'Deposit not found'
            });
        }
        
        if (deposit.status === 'credited') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'Deposit already credited'
            });
        }
        
        const user = await User.findByPk(userId, { transaction: t });
        
        if (!user) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Get wallet
        let wallet = await Wallet.findOne({
            where: { userId: user.id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        
        if (!wallet) {
            wallet = await Wallet.create({
                userId: user.id,
                balance: 0,
                currency: 'GHS'
            }, { transaction: t });
        }
        
        const balanceBefore = wallet.balance;
        const balanceAfter = balanceBefore + deposit.amount;
        
        // Update wallet
        await wallet.update({
            balance: balanceAfter,
            totalTopups: wallet.totalTopups + deposit.amount,
            version: wallet.version + 1
        }, { transaction: t });
        
        // Create transaction
        const walletTransaction = await Transaction.create({
            userId: user.id,
            type: 'credit',
            amount: deposit.amount,
            balanceBefore,
            balanceAfter,
            description: `MoMo Deposit - Manual Credit (${deposit.transactionId})`,
            reference: `MOMO-MANUAL-${deposit.transactionId}`,
            paymentMethod: 'manual',
            status: 'completed',
            metadata: {
                momoTransactionId: deposit.transactionId,
                manualCredit: true,
                creditedBy: req.admin?.username || 'admin'
            }
        }, { transaction: t });
        
        // Update deposit
        await deposit.update({
            userId: user.id,
            status: 'credited',
            statusMessage: `Manually credited to ${user.fullName} by admin`,
            walletTransactionId: walletTransaction.id
        }, { transaction: t });
        
        await t.commit();
        
        logger.info('MoMo deposit: Manual credit', {
            depositId: id,
            transactionId: deposit.transactionId,
            userId: user.id,
            amount: deposit.amount,
            creditedBy: req.admin?.username
        });
        
        res.json({
            success: true,
            message: `GHS ${deposit.amount.toFixed(2)} credited to ${user.fullName}`,
            newBalance: balanceAfter
        });
        
    } catch (error) {
        await t.rollback();
        logger.error('Manual credit error', { error: error.message });
        res.status(500).json({ error: 'Failed to credit deposit' });
    }
};

/**
 * Normalize Ghana phone number
 */
function normalizeGhanaPhone(phone) {
    if (!phone) return null;
    
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');
    
    // Convert to local format (0XXXXXXXXX)
    if (cleaned.startsWith('233') && cleaned.length === 12) {
        cleaned = '0' + cleaned.substring(3);
    } else if (cleaned.startsWith('+233')) {
        cleaned = cleaned.replace('+233', '0');
    }
    
    // Validate Ghana phone format
    if (/^0[235]\d{8}$/.test(cleaned)) {
        return cleaned;
    }
    
    return null;
}

module.exports = {
    authenticateListener,
    processDeposit,
    getDeposits,
    manualCredit
};

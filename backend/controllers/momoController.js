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
const SMS_LISTENER_TOKEN = process.env.SMS_LISTENER_TOKEN || 'dE4sy_m0m0_L1st3n3r_S3cr3t_T0k3n_2026_GH';

// ============================================
// ANTI-FRAUD CONFIGURATION
// ============================================

// MTN Ghana transaction IDs are typically 10-12 digits
const VALID_TRANSACTION_ID_PATTERN = /^\d{10,12}$/;

// Maximum deposit amount (suspicious if higher)
const MAX_DEPOSIT_AMOUNT = 50000; // GHS 50,000

// Minimum deposit amount
const MIN_DEPOSIT_AMOUNT = 0.01; // GHS 0.01

// Maximum age of SMS (reject if older than 24 hours)
const MAX_SMS_AGE_MS = 24 * 60 * 60 * 1000;

// Rate limiting: max deposits per device per hour
const MAX_DEPOSITS_PER_HOUR = 50;

// In-memory rate limit store (consider Redis for production clusters)
const rateLimitStore = new Map();

/**
 * Validate MTN Transaction ID format
 * MTN Ghana IDs are 10-12 digit numbers
 */
function isValidTransactionIdFormat(transactionId) {
    if (!transactionId || typeof transactionId !== 'string') {
        return false;
    }
    // Must be 10-12 digits only
    return VALID_TRANSACTION_ID_PATTERN.test(transactionId.trim());
}

/**
 * Check rate limit for a device/IP
 */
function checkRateLimit(identifier) {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    // Clean old entries
    const existing = rateLimitStore.get(identifier) || [];
    const recent = existing.filter(ts => ts > hourAgo);
    
    if (recent.length >= MAX_DEPOSITS_PER_HOUR) {
        return false; // Rate limited
    }
    
    recent.push(now);
    rateLimitStore.set(identifier, recent);
    return true;
}

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
        
        // ============================================
        // ANTI-FRAUD VALIDATION
        // ============================================
        
        // 1. Rate limiting by IP
        const clientIdentifier = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        if (!checkRateLimit(clientIdentifier)) {
            await t.rollback();
            logger.warn('MoMo deposit: Rate limit exceeded', { ip: clientIdentifier });
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please try again later.'
            });
        }
        
        // 2. Validate Transaction ID format (MTN Ghana: 10-12 digits)
        if (!transactionId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'Transaction ID is required'
            });
        }
        
        const cleanTransactionId = transactionId.toString().trim();
        if (!isValidTransactionIdFormat(cleanTransactionId)) {
            await t.rollback();
            logger.warn('MoMo deposit: Invalid transaction ID format', { 
                transactionId: cleanTransactionId,
                ip: clientIdentifier
            });
            return res.status(400).json({
                success: false,
                error: 'Invalid transaction ID format. Must be 10-12 digits.'
            });
        }
        
        // 3. Validate amount
        if (!amount || parseFloat(amount) <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: 'Valid amount is required'
            });
        }
        
        const depositAmount = parseFloat(amount);
        
        // 4. Amount reasonability check
        if (depositAmount < MIN_DEPOSIT_AMOUNT) {
            await t.rollback();
            logger.warn('MoMo deposit: Amount too small', { amount: depositAmount });
            return res.status(400).json({
                success: false,
                error: `Minimum deposit is GHS ${MIN_DEPOSIT_AMOUNT}`
            });
        }
        
        if (depositAmount > MAX_DEPOSIT_AMOUNT) {
            await t.rollback();
            logger.warn('MoMo deposit: Suspicious large amount', { 
                amount: depositAmount,
                transactionId: cleanTransactionId,
                ip: clientIdentifier
            });
            return res.status(400).json({
                success: false,
                error: 'Amount exceeds maximum allowed. Contact support for large deposits.'
            });
        }
        
        // 5. Timestamp validation (not too old)
        if (receivedAt) {
            const smsAge = Date.now() - parseInt(receivedAt, 10);
            if (smsAge > MAX_SMS_AGE_MS) {
                await t.rollback();
                logger.warn('MoMo deposit: SMS too old', { 
                    receivedAt,
                    ageHours: (smsAge / (60 * 60 * 1000)).toFixed(1),
                    transactionId: cleanTransactionId
                });
                return res.status(400).json({
                    success: false,
                    error: 'SMS is too old. Deposits must be submitted within 24 hours.'
                });
            }
        }
        
        // 6. Raw message validation (must contain transaction ID)
        if (rawMessage && !rawMessage.includes(cleanTransactionId)) {
            await t.rollback();
            logger.warn('MoMo deposit: Transaction ID not found in raw message', { 
                transactionId: cleanTransactionId,
                ip: clientIdentifier
            });
            return res.status(400).json({
                success: false,
                error: 'Invalid SMS format'
            });
        }
        
        logger.info('MoMo deposit received', {
            transactionId: cleanTransactionId,
            amount: depositAmount,
            senderPhone,
            reference
        });
        
        // Check for duplicate transaction
        const existingDeposit = await MoMoDeposit.findOne({
            where: { transactionId: cleanTransactionId },
            transaction: t
        });
        
        if (existingDeposit) {
            await t.rollback();
            logger.info('MoMo deposit: Duplicate transaction (idempotent)', { transactionId: cleanTransactionId });
            // Return 200 OK for idempotency - client can mark as success
            return res.status(200).json({
                success: true,
                duplicate: true,
                message: 'Transaction already processed',
                depositId: existingDeposit.id,
                status: existingDeposit.status
            });
        }
        
        // Create deposit record
        const deposit = await MoMoDeposit.create({
            transactionId: cleanTransactionId,
            amount: depositAmount,
            senderPhone: senderPhone || 'Unknown',
            reference: reference || null,
            rawMessage: rawMessage || null,
            smsReceivedAt: receivedAt ? new Date(parseInt(receivedAt, 10)) : null,
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
            
            // Return success: true because the deposit WAS successfully received and saved
            // The Android app should mark this as SUCCESS (deposit recorded for manual review)
            return res.status(200).json({
                success: true,
                matched: false,
                error: 'User not found',
                message: `Deposit saved. No user found with reference: ${reference || 'none'}. Saved for manual review.`,
                depositId: deposit.id,
                status: 'unmatched'
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
        
        // Return detailed error for debugging (remove in production later)
        return res.status(500).json({
            success: false,
            error: 'Processing failed',
            message: error.message,
            debugStack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
    }
};

/**
 * Get deposit history (for admin)
 * GET /api/momo/deposits
 * Query params: status, page, limit, startDate, endDate
 */
const getDeposits = async (req, res) => {
    try {
        const { status, page = 1, limit = 50, startDate, endDate } = req.query;
        
        const where = {};
        if (status) where.status = status;
        
        // Date filtering
        if (startDate || endDate) {
            const { Op } = require('sequelize');
            where.createdAt = {};
            
            if (startDate) {
                // Start of the day
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                where.createdAt[Op.gte] = start;
            }
            
            if (endDate) {
                // End of the day
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = end;
            }
        }
        
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
        
        // Calculate stats for the filtered data
        const stats = await MoMoDeposit.findAll({
            where,
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
                [sequelize.fn('COUNT', sequelize.literal("CASE WHEN status = 'credited' THEN 1 END")), 'credited'],
                [sequelize.fn('COUNT', sequelize.literal("CASE WHEN status = 'unmatched' THEN 1 END")), 'unmatched'],
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'credited' THEN amount ELSE 0 END")), 'totalAmount']
            ],
            raw: true
        });
        
        res.json({
            success: true,
            deposits,
            stats: {
                total: parseInt(stats[0].total) || 0,
                credited: parseInt(stats[0].credited) || 0,
                unmatched: parseInt(stats[0].unmatched) || 0,
                totalAmount: parseFloat(stats[0].totalAmount) || 0
            },
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

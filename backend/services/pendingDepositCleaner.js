/**
 * Pending Deposit Cleaner Service
 * Automatically verifies and credits successful payments, expires truly abandoned ones
 * 
 * This handles edge cases where:
 * - User closed browser before frontend verification completed
 * - Network disconnection during payment verification
 * - Webhook URL is shared with another site (not received here)
 * - Paystack didn't send charge.failed webhook
 */

const { Op } = require('sequelize');
const { Transaction, Wallet } = require('../models');
const { sequelize } = require('../config/database');
const { verifyTransaction } = require('../config/paystack');
const logger = require('../utils/logger');

// Configuration
const VERIFY_AFTER_MINUTES = 2; // Start verifying pending deposits after 2 minutes
const EXPIRY_MINUTES = 30; // Expire truly abandoned deposits after 30 minutes
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // Run every 2 minutes

let cleanupInterval = null;

/**
 * Verify pending deposits with Paystack API and credit if successful
 */
async function verifyAndProcessPendingDeposits() {
    try {
        const verifyTime = new Date(Date.now() - VERIFY_AFTER_MINUTES * 60 * 1000);
        const expiryTime = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);
        
        // Find pending topup transactions older than verify threshold
        const pendingTransactions = await Transaction.findAll({
            where: {
                status: 'pending',
                type: 'credit',
                reference: {
                    [Op.like]: 'TOPUP-%' // Only topup transactions
                },
                createdAt: {
                    [Op.lt]: verifyTime
                }
            }
        });

        if (pendingTransactions.length === 0) {
            return;
        }

        logger.info(`Checking ${pendingTransactions.length} pending deposits with Paystack`);

        for (const transaction of pendingTransactions) {
            try {
                // Check with Paystack API if payment was actually successful
                const verification = await verifyTransaction(transaction.reference);
                
                if (verification.status && verification.data?.status === 'success') {
                    // Payment succeeded! Credit the wallet
                    await creditSuccessfulDeposit(transaction, verification.data);
                } else if (transaction.createdAt < expiryTime) {
                    // Old enough and not successful - expire it
                    await expireDeposit(transaction, verification.data?.gateway_response || 'Payment not completed');
                } else {
                    // Not yet expired, payment might still be in progress
                    logger.debug(`Deposit ${transaction.reference} still pending in Paystack, waiting...`);
                }
            } catch (verifyError) {
                // Paystack API is down / unreachable — never expire based on an API failure.
                // Use a 4-hour grace window so we don't lose valid payments during outages.
                const apiErrorGrace = new Date(Date.now() - 4 * 60 * 60 * 1000);
                if (transaction.createdAt < apiErrorGrace) {
                    await expireDeposit(transaction, `Verification failed after extended grace period: ${verifyError.message}`);
                } else {
                    logger.warn(`Could not verify ${transaction.reference} (API error, will retry): ${verifyError.message}`);
                }
            }
        }
    } catch (error) {
        logger.error('Error in pending deposit verification:', { error: error.message });
    }
}

/**
 * Credit wallet for a successful Paystack payment
 */
async function creditSuccessfulDeposit(transaction, paystackData) {
    const t = await sequelize.transaction();
    
    try {
        // Re-fetch with lock to prevent race conditions
        const lockedTx = await Transaction.findOne({
            where: { id: transaction.id },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        
        // Double-check it's still pending
        if (lockedTx.status !== 'pending') {
            await t.rollback();
            return;
        }
        
        // Get wallet with lock
        const wallet = await Wallet.findOne({
            where: { userId: lockedTx.userId },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        
        if (!wallet) {
            await t.rollback();
            logger.error(`Wallet not found for user ${lockedTx.userId}`);
            return;
        }
        
        // Credit the wallet (use the amount stored in transaction, not Paystack amount)
        const creditAmount = parseFloat(lockedTx.amount);
        await wallet.credit(creditAmount, { transaction: t });
        
        // Update transaction
        lockedTx.status = 'completed';
        lockedTx.balanceAfter = wallet.balance;
        lockedTx.metadata = JSON.stringify({
            ...JSON.parse(lockedTx.metadata || '{}'),
            creditedByPoller: true,
            creditedAt: new Date().toISOString(),
            paystackVerification: {
                amount: paystackData.amount,
                paidAt: paystackData.paid_at,
                channel: paystackData.channel
            }
        });
        await lockedTx.save({ transaction: t });
        
        await t.commit();
        
        logger.info(`✅ Auto-credited deposit: ${lockedTx.reference}`, {
            userId: lockedTx.userId,
            amount: creditAmount,
            newBalance: wallet.balance
        });
    } catch (error) {
        await t.rollback();
        logger.error(`Failed to auto-credit ${transaction.reference}:`, { error: error.message });
    }
}

/**
 * Expire a deposit that was never completed
 */
async function expireDeposit(transaction, reason) {
    transaction.status = 'failed';
    transaction.metadata = JSON.stringify({
        ...JSON.parse(transaction.metadata || '{}'),
        expiredBySystem: true,
        expiredAt: new Date().toISOString(),
        reason: reason || `Auto-expired after ${EXPIRY_MINUTES} minutes`
    });
    await transaction.save();
    
    logger.info(`Expired pending deposit: ${transaction.reference}`, {
        userId: transaction.userId,
        amount: transaction.amount,
        reason
    });
}

/**
 * Start the cleanup scheduler
 */
function start() {
    if (cleanupInterval) {
        logger.warn('Pending deposit cleaner already running');
        return;
    }

    logger.info(`Starting pending deposit verifier (runs every ${CLEANUP_INTERVAL_MS / 60000} minutes, verifies after ${VERIFY_AFTER_MINUTES} min, expires after ${EXPIRY_MINUTES} min)`);
    
    // Run immediately on start
    verifyAndProcessPendingDeposits();
    
    // Then run periodically
    cleanupInterval = setInterval(verifyAndProcessPendingDeposits, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup scheduler
 */
function stop() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Pending deposit verifier stopped');
    }
}

module.exports = {
    start,
    stop,
    verifyAndProcessPendingDeposits // Export for manual triggering if needed
};

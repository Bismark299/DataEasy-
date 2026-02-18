/**
 * Pending Deposit Cleaner Service
 * Automatically expires pending deposit transactions older than a threshold
 * 
 * This handles edge cases where:
 * - User closed browser without closing Paystack popup
 * - Network disconnection during payment
 * - Paystack didn't send charge.failed webhook
 */

const { Op } = require('sequelize');
const { Transaction } = require('../models');
const logger = require('../utils/logger');

// Configuration
const EXPIRY_MINUTES = 30; // Expire pending deposits after 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Run every 5 minutes

let cleanupInterval = null;

/**
 * Expire old pending deposit transactions
 */
async function expirePendingDeposits() {
    try {
        const expiryTime = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);
        
        // Find all pending topup transactions older than threshold
        const pendingTransactions = await Transaction.findAll({
            where: {
                status: 'pending',
                type: 'credit',
                reference: {
                    [Op.like]: 'TOPUP-%' // Only topup transactions
                },
                createdAt: {
                    [Op.lt]: expiryTime
                }
            }
        });

        if (pendingTransactions.length === 0) {
            return;
        }

        logger.info(`Found ${pendingTransactions.length} stale pending deposits to expire`);

        // Mark them as expired/failed
        for (const transaction of pendingTransactions) {
            transaction.status = 'failed';
            transaction.metadata = JSON.stringify({
                ...JSON.parse(transaction.metadata || '{}'),
                expiredBySystem: true,
                expiredAt: new Date().toISOString(),
                reason: `Auto-expired after ${EXPIRY_MINUTES} minutes of inactivity`
            });
            await transaction.save();
            
            logger.info(`Expired pending deposit: ${transaction.reference}`, {
                userId: transaction.userId,
                amount: transaction.amount,
                createdAt: transaction.createdAt
            });
        }

        logger.info(`Successfully expired ${pendingTransactions.length} pending deposits`);
    } catch (error) {
        logger.error('Error expiring pending deposits:', { error: error.message });
    }
}

/**
 * Start the cleanup scheduler
 */
function start() {
    if (cleanupInterval) {
        logger.warn('Pending deposit cleaner already running');
        return;
    }

    logger.info(`Starting pending deposit cleaner (runs every ${CLEANUP_INTERVAL_MS / 60000} minutes, expires after ${EXPIRY_MINUTES} minutes)`);
    
    // Run immediately on start
    expirePendingDeposits();
    
    // Then run periodically
    cleanupInterval = setInterval(expirePendingDeposits, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup scheduler
 */
function stop() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('Pending deposit cleaner stopped');
    }
}

module.exports = {
    start,
    stop,
    expirePendingDeposits // Export for manual triggering if needed
};

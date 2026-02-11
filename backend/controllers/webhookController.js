/**
 * Webhook Controller
 * Handles Paystack webhooks for payment verification
 * Updated for PostgreSQL/Sequelize
 * With proper signature verification and atomic transactions
 */

const crypto = require('crypto');
const { Wallet, Transaction, User } = require('../models');
const { sequelize } = require('../config/database');
const { verifyWebhookSignature, verifyTransaction } = require('../config/paystack');

/**
 * Handle Paystack webhook events
 * POST /api/webhooks/paystack
 * 
 * IMPORTANT: This endpoint must receive raw body for signature verification
 * Configure with app.use('/api/webhooks/paystack', express.raw({type: 'application/json'}))
 */
exports.handlePaystack = async (req, res) => {
    try {
        // Get signature from headers
        const signature = req.headers['x-paystack-signature'];
        
        if (!signature) {
            console.error('Webhook missing signature header');
            return res.status(400).json({ error: 'Missing signature' });
        }

        // Use raw body for signature verification (must be the exact bytes received)
        // req.rawBody should be set by express.raw() middleware
        const rawBody = req.rawBody || req.body;
        const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : 
                       (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));

        if (!verifyWebhookSignature(payload, signature)) {
            console.error('Webhook signature verification failed');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        // Parse the event
        const event = typeof rawBody === 'string' || Buffer.isBuffer(rawBody) 
            ? JSON.parse(payload) 
            : rawBody;
            
        console.log('Paystack webhook event:', event.event);

        switch (event.event) {
            case 'charge.success':
                await handleChargeSuccess(event.data);
                break;
            
            case 'transfer.success':
                await handleTransferSuccess(event.data);
                break;
            
            case 'transfer.failed':
                await handleTransferFailed(event.data);
                break;
            
            default:
                console.log('Unhandled webhook event:', event.event);
        }

        // Always return 200 to acknowledge receipt
        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        // Still return 200 to prevent retries for processing errors
        res.status(200).json({ received: true });
    }
};

/**
 * Handle successful charge (wallet top-up) with atomic transaction
 */
async function handleChargeSuccess(data) {
    const t = await sequelize.transaction();
    
    try {
        const { reference, amount, customer, metadata } = data;
        
        // Check if already processed (with row lock)
        const existingTx = await Transaction.findOne({ 
            where: {
                reference,
                status: 'completed'
            },
            transaction: t
        });

        if (existingTx) {
            await t.rollback();
            console.log('Transaction already processed:', reference);
            return;
        }

        // Verify with Paystack API
        const verification = await verifyTransaction(reference);
        if (!verification.success || verification.data.status !== 'success') {
            await t.rollback();
            console.error('Payment verification failed for:', reference);
            return;
        }

        // Find the pending transaction with row lock
        const transaction = await Transaction.findOne({
            where: { reference },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        if (!transaction) {
            await t.rollback();
            console.error('Transaction not found for reference:', reference);
            return;
        }

        // Double-check status after acquiring lock
        if (transaction.status === 'completed') {
            await t.rollback();
            console.log('Transaction already completed (race condition prevented):', reference);
            return;
        }

        // Get user's wallet with row lock
        const wallet = await Wallet.findOne({ 
            where: { userId: transaction.userId },
            lock: t.LOCK.UPDATE,
            transaction: t
        });

        if (!wallet) {
            await t.rollback();
            console.error('Wallet not found for user:', transaction.userId);
            return;
        }

        // Credit wallet atomically (amount from Paystack is in kobo/pesewas)
        const creditAmount = amount / 100;
        await wallet.credit(creditAmount, { transaction: t });

        // Update transaction
        transaction.status = 'completed';
        transaction.balanceAfter = wallet.balance;
        await transaction.save({ transaction: t });

        // Commit all changes
        await t.commit();

        console.log('Wallet credited successfully:', {
            reference,
            amount: creditAmount,
            newBalance: wallet.balance
        });
    } catch (error) {
        await t.rollback();
        console.error('handleChargeSuccess error:', error);
    }
}

/**
 * Handle successful transfer
 */
async function handleTransferSuccess(data) {
    try {
        const { reference, amount } = data;
        console.log('Transfer successful:', reference, amount);
        // Implement transfer success logic if needed
    } catch (error) {
        console.error('handleTransferSuccess error:', error);
    }
}

/**
 * Handle failed transfer
 */
async function handleTransferFailed(data) {
    try {
        const { reference, reason } = data;
        console.log('Transfer failed:', reference, reason);
        // Implement transfer failure logic if needed
    } catch (error) {
        console.error('handleTransferFailed error:', error);
    }
}

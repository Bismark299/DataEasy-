/**
 * Order Status Poller Service
 * Polls MCBIS API for order completion status
 * 
 * Flow:
 * 1. Order placed with MCBIS → status: "pending"
 * 2. Poller checks status every few seconds
 * 3. When MCBIS returns "success" → update order to "Delivered"
 * 4. Notify admin and client of completion
 */

const logger = require('../utils/logger');
const mcbisProvider = require('./mcbisProvider');
const { Order, Setting, Wallet, Transaction } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

// Track active polling jobs
const activePolls = new Map();

// Configuration
const FAST_POLL_INTERVAL = 20000;    // Check every 20 seconds initially
const SLOW_POLL_INTERVAL = 60000;    // Check every 60 seconds after fast phase
const FAST_POLL_DURATION = 5 * 60 * 1000;  // Fast polling for first 5 minutes
const INITIAL_DELAY = 5000;          // Wait 5 seconds before first check
// NO MAX ATTEMPTS - poll until final status received

/**
 * Start polling for an order item's delivery status
 * @param {Object} params - Polling parameters
 * @param {string} params.orderId - Database order ID (UUID)
 * @param {number} params.itemIndex - Index of item in order
 * @param {string} params.reference - MCBIS order reference
 * @param {string} params.displayOrderId - Display order ID (e.g., "0001")
 */
async function startPolling({ orderId, itemIndex, reference, displayOrderId }) {
    if (!reference) {
        logger.error('startPolling called without reference, skipping', { orderId, itemIndex, displayOrderId });
        return;
    }
    const pollKey = `${orderId}-${itemIndex}`;
    
    // Don't start duplicate polling
    if (activePolls.has(pollKey)) {
        logger.info('Polling already active', { pollKey, reference });
        return;
    }

    logger.info('Starting order status polling', {
        orderId,
        displayOrderId,
        itemIndex,
        reference
    });

    const pollState = {
        attempts: 0,
        reference,
        orderId,
        itemIndex,
        displayOrderId,
        startTime: Date.now()
    };

    activePolls.set(pollKey, pollState);

    // Wait initial delay before first check
    await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY));

    // Start polling loop
    pollLoop(pollKey);
}

/**
 * Polling loop - checks status and updates order
 */
async function pollLoop(pollKey) {
    const pollState = activePolls.get(pollKey);
    
    if (!pollState) {
        logger.info('Polling cancelled', { pollKey });
        return;
    }

    pollState.attempts++;

    try {
        // Check status with MCBIS
        const statusResult = await mcbisProvider.checkOrderStatus(pollState.reference);
        
        logger.info('Poll status check', {
            pollKey,
            attempt: pollState.attempts,
            rawStatus: statusResult.status,
            orderStatus: statusResult.order?.status,
            reference: pollState.reference
        });

        // mcbisProvider.checkOrderStatus() already extracts the correct status from data.order.status
        // statusResult.status contains the ACTUAL order status (completed/pending/failed)
        // statusResult.order contains the full order object from MCBIS
        
        const mcbisStatus = (statusResult.status || 'unknown').toLowerCase().trim();
        
        logger.info('Extracted order status', { 
            mcbisStatus, 
            rawStatus: statusResult.status,
            orderData: statusResult.order,
            fullResult: statusResult
        });
        
        // Log what status we got for debugging
        logger.info('Status comparison', {
            mcbisStatus,
            isSuccess: mcbisStatus === 'success' || mcbisStatus === 'completed' || mcbisStatus === 'delivered' || mcbisStatus === 'successful',
            isFailed: mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error',
            isPending: mcbisStatus === 'pending' || mcbisStatus === 'processing' || mcbisStatus === 'initiated'
        });
        
        // Status mapping based on MCBIS documentation (ad.html reference):
        // COMPLETED: success, completed, delivered, successful
        // FAILED: failed, fail, error
        // PROCESSING: pending, processing, initiated
        
        if (mcbisStatus === 'success' || mcbisStatus === 'completed' || 
            mcbisStatus === 'delivered' || mcbisStatus === 'successful') {
            // SUCCESS - Update order to Delivered
            await updateOrderItemStatus(
                pollState.orderId, 
                pollState.itemIndex, 
                'Delivered',
                pollState.reference
            );
            
            logger.info('Order delivery confirmed by MCBIS', {
                orderId: pollState.displayOrderId,
                itemIndex: pollState.itemIndex,
                reference: pollState.reference,
                mcbisStatus: mcbisStatus,
                attempts: pollState.attempts,
                duration: `${(Date.now() - pollState.startTime) / 1000}s`
            });

            // Stop polling
            activePolls.delete(pollKey);
            return;

        } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error' || mcbisStatus === 'cancelled' || mcbisStatus === 'rejected' || mcbisStatus === 'not_found') {
            // FAILED - Update order and stop polling
            const failReason = mcbisStatus === 'not_found' 
                ? 'Order reference not found on provider (404)' 
                : (statusResult.error || 'Delivery failed by provider');
            
            await updateOrderItemStatus(
                pollState.orderId,
                pollState.itemIndex,
                'Failed',
                pollState.reference,
                failReason
            );

            logger.error('Order delivery failed', {
                orderId: pollState.displayOrderId,
                itemIndex: pollState.itemIndex,
                reference: pollState.reference,
                mcbisStatus: mcbisStatus,
                error: failReason
            });

            activePolls.delete(pollKey);
            return;
        }

        // Still pending - continue polling (NO TIME LIMIT)
        // Use adaptive polling: fast for first 2 minutes, then slower
        const elapsedTime = Date.now() - pollState.startTime;
        const pollInterval = elapsedTime < FAST_POLL_DURATION ? FAST_POLL_INTERVAL : SLOW_POLL_INTERVAL;
        
        logger.info('Order still pending, continuing to poll', {
            orderId: pollState.displayOrderId,
            attempts: pollState.attempts,
            elapsedTime: `${Math.round(elapsedTime / 1000)}s`,
            nextPollIn: `${pollInterval / 1000}s`
        });

        // Schedule next poll - NEVER STOP until final status
        setTimeout(() => pollLoop(pollKey), pollInterval);

    } catch (error) {
        const httpStatus = error.response?.status || error.httpStatus;
        const isNotFound = httpStatus === 404 || error.notFound === true;

        logger.error('Error in status poll', {
            pollKey,
            error: error.message,
            attempt: pollState.attempts,
            httpStatus
        });

        // Stop polling if MCBIS says the reference doesn't exist (404)
        if (isNotFound) {
            logger.warn('MCBIS reference not found (404), marking order as Failed and stopping poll', {
                pollKey,
                reference: pollState.reference,
                orderId: pollState.orderId
            });
            await updateOrderItemStatus(
                pollState.orderId,
                pollState.itemIndex,
                'Failed',
                pollState.reference,
                'Order reference not found on provider (404)'
            ).catch(e => logger.error('Failed to mark 404 order as failed', { error: e.message }));
            activePolls.delete(pollKey);
            return;
        }

        // Continue polling on transient errors (network issues, etc.)
        const elapsedTime = Date.now() - pollState.startTime;
        const pollInterval = elapsedTime < FAST_POLL_DURATION ? FAST_POLL_INTERVAL : SLOW_POLL_INTERVAL;
        setTimeout(() => pollLoop(pollKey), pollInterval);
    }
}

/**
 * Update order item delivery status in database.
 * Uses a row-level lock to prevent concurrent JSONB overwrites when multiple
 * items in the same order resolve at the same time.
 * Automatically refunds the wallet when an item is permanently marked Failed.
 */
async function updateOrderItemStatus(orderId, itemIndex, status, reference, errorMsg = null) {
    const t = await sequelize.transaction();
    try {
        // Lock the order row so concurrent calls for the same order serialize
        const order = await Order.findByPk(orderId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            await t.rollback();
            logger.error('Order not found for status update', { orderId });
            return false;
        }

        const items = [...(order.items || [])];
        if (!items[itemIndex]) {
            await t.rollback();
            logger.error('Order item not found', { orderId, itemIndex });
            return false;
        }

        const previousStatus = items[itemIndex].deliveryStatus;

        // Update specific item
        items[itemIndex] = {
            ...items[itemIndex],
            deliveryStatus: status,
            providerReference: reference,
            deliveredAt: status === 'Delivered' ? new Date().toISOString() : items[itemIndex].deliveredAt,
            deliveryError: errorMsg
        };

        // Calculate overall order status
        const allDelivered = items.every(item => item.deliveryStatus === 'Delivered');
        const anyFailed    = items.some(item => item.deliveryStatus === 'Failed');
        const allTerminal  = items.every(item =>
            item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed'
        );
        const allPending   = items.every(item =>
            item.deliveryStatus === 'Pending' || item.deliveryStatus === 'Processing'
        );

        let overallStatus = 'Processing';
        if (allDelivered) {
            overallStatus = 'Delivered';
        } else if (anyFailed && allTerminal) {
            overallStatus = 'Failed';
        } else if (anyFailed) {
            overallStatus = 'Partially Delivered';
        }

        await order.update({
            items,
            deliveryStatus: overallStatus,
            processedAt: allDelivered ? new Date() : order.processedAt
        }, { transaction: t });

        // ── Automatic refund on permanent failure ──────────────────────────
        // Only refund if this item is newly transitioning to Failed
        // (not already Failed — prevents double-refund on duplicate calls)
        if (status === 'Failed' && previousStatus !== 'Failed') {
            const refundAmount = Math.round(parseFloat(items[itemIndex].price || 0) * 100) / 100;

            if (refundAmount > 0) {
                try {
                    // Lock user's wallet row before crediting
                    const wallet = await Wallet.findOne({
                        where: { userId: order.userId },
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });

                    if (wallet) {
                        await wallet.credit(refundAmount, { transaction: t });

                        await Transaction.create({
                            userId: order.userId,
                            type: 'credit',
                            amount: refundAmount,
                            balanceBefore: wallet.balance - refundAmount,
                            balanceAfter: wallet.balance,
                            description: `Refund for failed delivery — Order #${order.orderId} item ${itemIndex + 1}`,
                            reference: `REFUND-${order.orderId}-${itemIndex}`,
                            paymentMethod: 'wallet',
                            status: 'completed',
                            orderId: order.id
                        }, { transaction: t });

                        logger.info('Wallet refund issued for failed delivery', {
                            orderId: order.orderId,
                            itemIndex,
                            refundAmount,
                            userId: order.userId
                        });
                    } else {
                        logger.error('Wallet not found for refund', { userId: order.userId, orderId: order.orderId });
                    }
                } catch (refundErr) {
                    // Log but don't block the status update commit
                    logger.error('Refund failed — status will still be marked Failed', {
                        orderId: order.orderId, itemIndex, error: refundErr.message
                    });
                }
            }
        }

        await t.commit();

        logger.info('Order status updated', {
            orderId: order.orderId,
            itemIndex,
            itemStatus: status,
            overallStatus
        });

        return true;

    } catch (err) {
        await t.rollback();
        logger.error('Failed to update order status', {
            orderId,
            itemIndex,
            error: err.message
        });
        return false;
    }
}

/**
 * Stop polling for a specific order item
 */
function stopPolling(orderId, itemIndex) {
    const pollKey = `${orderId}-${itemIndex}`;
    if (activePolls.has(pollKey)) {
        activePolls.delete(pollKey);
        logger.info('Polling stopped', { pollKey });
        return true;
    }
    return false;
}

/**
 * Get active polling jobs
 */
function getActivePolls() {
    const polls = [];
    for (const [key, state] of activePolls) {
        polls.push({
            key,
            orderId: state.displayOrderId,
            itemIndex: state.itemIndex,
            reference: state.reference,
            attempts: state.attempts,
            duration: `${Math.round((Date.now() - state.startTime) / 1000)}s`
        });
    }
    return polls;
}

/**
 * Check if polling is active for an order item
 */
function isPolling(orderId, itemIndex) {
    return activePolls.has(`${orderId}-${itemIndex}`);
}

/**
 * Background sync service for processing orders
 * Runs periodically to sync status of orders that may have timed out during initial polling
 */
let backgroundSyncInterval = null;
let recoveryInterval = null;
const BACKGROUND_SYNC_INTERVAL = 5 * 60 * 1000; // Every 5 minutes
const RECOVERY_INTERVAL = 3 * 60 * 1000; // Every 3 minutes — retry pending orders
const MIN_ORDER_AGE = 60 * 1000; // Don't retry orders less than 60 seconds old (let initial attempt finish)
const MAX_RECOVERY_AGE = 7 * 24 * 60 * 60 * 1000; // Stop retrying orders older than 7 days

async function startBackgroundSync() {
    if (backgroundSyncInterval) {
        logger.info('Background sync already running');
        return;
    }

    logger.info('Starting background MCBIS sync service');
    
    // Run immediately on startup
    await syncProcessingOrders();
    
    // Run recovery after a short delay to let server settle
    setTimeout(() => recoverPendingOrders(), 10000);
    
    // Then run periodically
    backgroundSyncInterval = setInterval(syncProcessingOrders, BACKGROUND_SYNC_INTERVAL);
    recoveryInterval = setInterval(recoverPendingOrders, RECOVERY_INTERVAL);
}

async function stopBackgroundSync() {
    if (backgroundSyncInterval) {
        clearInterval(backgroundSyncInterval);
        backgroundSyncInterval = null;
    }
    if (recoveryInterval) {
        clearInterval(recoveryInterval);
        recoveryInterval = null;
    }
    logger.info('Background sync stopped');
}

async function syncProcessingOrders() {
    try {
        // Find all orders that are still Processing and have MCBIS references
        const processingOrders = await Order.findAll({
            where: {
                deliveryStatus: 'Processing'
            }
        });

        if (processingOrders.length === 0) {
            return;
        }

        logger.info('Background sync: checking processing orders', { count: processingOrders.length });

        for (const order of processingOrders) {
            for (let i = 0; i < order.items.length; i++) {
                const item = order.items[i];
                
                // Skip items without MCBIS reference or already processed
                if (!item.providerReference || item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') {
                    continue;
                }

                // Skip if this item is being actively polled
                if (isPolling(order.id, i)) {
                    continue;
                }

                try {
                    const statusResult = await mcbisProvider.checkOrderStatus(item.providerReference);
                    const mcbisStatus = (statusResult.status || '').toLowerCase().trim();

                    logger.info('Background sync status check', {
                        orderId: order.orderId,
                        itemIndex: i,
                        reference: item.providerReference,
                        mcbisStatus
                    });

                    if (mcbisStatus === 'success' || mcbisStatus === 'completed' || 
                        mcbisStatus === 'delivered' || mcbisStatus === 'successful') {
                        await updateOrderItemStatus(order.id, i, 'Delivered', item.providerReference);
                        logger.info('Background sync: order marked delivered', { orderId: order.orderId, itemIndex: i });
                    } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error' || mcbisStatus === 'not_found') {
                        const reason = mcbisStatus === 'not_found' ? 'Order reference not found on provider (404)' : 'Failed by provider';
                        await updateOrderItemStatus(order.id, i, 'Failed', item.providerReference, reason);
                        logger.info('Background sync: order marked failed', { orderId: order.orderId, itemIndex: i, reason });
                    }

                    // Delay between API calls — queue already throttles but add extra gap
                    await new Promise(resolve => setTimeout(resolve, 1500));
                } catch (error) {
                    logger.error('Background sync error for item', {
                        orderId: order.orderId,
                        itemIndex: i,
                        error: error.message
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Background sync error', { error: error.message });
    }
}

/**
 * Recovery service for stuck Pending orders
 * 
 * Runs every 1 minute. Handles orders that never got sent to MCBIS
 * (e.g., insufficient balance at order time, MCBIS disabled, server crash).
 * 
 * Flow:
 * 1. Find all Pending orders (oldest first — FIFO)
 * 2. Skip orders < 30 seconds old (let initial delivery attempt finish)
 * 3. For items WITH providerReference: only re-check status (NEVER re-send)
 * 4. For items WITHOUT providerReference (never sent):
 *    a. Check MCBIS balance ONCE upfront
 *    b. Process oldest orders first
 *    c. STOP entire batch if balance runs out mid-way
 * 
 * DUPLICATE PREVENTION:
 * - providerReference present → already sent, only check status
 * - No providerReference + no sentToProviderAt → never sent, safe to send
 */
async function recoverPendingOrders() {
    try {
        const now = Date.now();
        const cutoffDate = new Date(now - MAX_RECOVERY_AGE);
        const minAgeDate = new Date(now - MIN_ORDER_AGE);

        // Find stuck orders — oldest first (FIFO)
        const pendingOrders = await Order.findAll({
            where: {
                deliveryStatus: { [Op.in]: ['Pending', 'Processing'] },
                paymentStatus: 'Completed',
                createdAt: { 
                    [Op.gte]: cutoffDate,
                    [Op.lte]: minAgeDate  // Must be at least 30 seconds old
                }
            },
            order: [['createdAt', 'ASC']]  // Oldest first — first come, first served
        });

        if (pendingOrders.length === 0) {
            return;
        }

        logger.info('Recovery sweep: checking stuck orders', { count: pendingOrders.length });

        // ── PHASE 1: Re-check status of items that HAVE a providerReference ──
        // These were already sent to MCBIS but their poller may have died (e.g., server restart)
        // Safe: we only check status, never re-send
        for (const order of pendingOrders) {
            const items = order.items || [];
            let itemsUpdated = false;
            const updatedItems = [...items];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];

                if (item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') continue;
                if (isPolling(order.id, i)) continue;
                if (!item.providerReference) continue; // Phase 2 handles these

                try {
                    const statusResult = await mcbisProvider.checkOrderStatus(item.providerReference);
                    const mcbisStatus = (statusResult.status || '').toLowerCase().trim();

                    if (mcbisStatus === 'success' || mcbisStatus === 'completed' ||
                        mcbisStatus === 'delivered' || mcbisStatus === 'successful') {
                        await updateOrderItemStatus(order.id, i, 'Delivered', item.providerReference);
                        logger.info('Recovery: item delivered (status re-check)', {
                            orderId: order.orderId, itemIndex: i, reference: item.providerReference
                        });
                    } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error' || mcbisStatus === 'not_found') {
                        const reason = mcbisStatus === 'not_found' ? 'Order reference not found on provider (404)' : 'Failed by provider';
                        await updateOrderItemStatus(order.id, i, 'Failed', item.providerReference, reason);
                        logger.info('Recovery: item failed (status re-check)', {
                            orderId: order.orderId, itemIndex: i, reason
                        });
                    } else {
                        // Still processing — re-launch poller to keep tracking
                        startPolling({
                            orderId: order.id, itemIndex: i,
                            reference: item.providerReference, displayOrderId: order.orderId
                        });
                        logger.info('Recovery: re-launched poller for processing item', {
                            orderId: order.orderId, itemIndex: i, reference: item.providerReference
                        });
                    }
                } catch (err) {
                    const httpStatus = err.response?.status || err.httpStatus;
                    if (httpStatus === 404 || err.notFound === true) {
                        // MCBIS doesn't know this reference — mark as Failed and stop
                        await updateOrderItemStatus(order.id, i, 'Failed', item.providerReference, 'Order reference not found on provider (404)')
                            .catch(e => logger.error('Recovery: failed to mark 404 item as failed', { error: e.message }));
                        logger.warn('Recovery: 404 from MCBIS, marked as Failed', {
                            orderId: order.orderId, itemIndex: i, reference: item.providerReference
                        });
                    } else {
                        logger.error('Recovery: status check failed', {
                            orderId: order.orderId, itemIndex: i, error: err.message
                        });
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        // ── PHASE 2: Send items that were NEVER sent to MCBIS ──
        // These have no providerReference and no sentToProviderAt
        // Check balance ONCE upfront, then process oldest first, STOP when balance runs out

        // Collect all unsent items across all orders (oldest order first)
        const unsentItems = [];
        for (const order of pendingOrders) {
            const items = order.items || [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') continue;
                if (item.providerReference) continue; // Already sent — handled in Phase 1
                if (isPolling(order.id, i)) continue;
                unsentItems.push({ order, itemIndex: i, item });
            }
        }

        if (unsentItems.length === 0) {
            return;
        }

        // Check MCBIS wallet balance ONCE before processing the batch
        let currentBalance = 0;
        try {
            const balanceResult = await mcbisProvider.getWalletBalance();
            if (!balanceResult.success || !balanceResult.configured) {
                logger.warn('Recovery: MCBIS not configured or balance check failed, skipping unsent items');
                return;
            }
            currentBalance = parseFloat(balanceResult.balance || 0);
            logger.info('Recovery: MCBIS balance check', { currentBalance, unsentItemCount: unsentItems.length });

            if (currentBalance < 1) {
                logger.info('Recovery: MCBIS balance too low, waiting for top-up', { currentBalance });
                return;
            }
        } catch (err) {
            logger.error('Recovery: balance check error', { error: err.message });
            return;
        }

        // Process unsent items — oldest first, stop when balance runs out
        let recovered = 0;
        for (const { order, itemIndex, item } of unsentItems) {
            // Check if MCBIS is enabled for this network
            const shouldDeliver = await Setting.shouldDeliverViaMcbis(order.network);
            if (!shouldDeliver) continue;

            // Estimate cost — stop batch if balance is too low
            const itemCost = parseFloat(item.costPrice || item.price || 0);
            if (itemCost > 0 && currentBalance < itemCost) {
                logger.info('Recovery: MCBIS balance exhausted mid-batch, stopping. Will retry next cycle.', {
                    currentBalance, needed: itemCost, remainingItems: unsentItems.length - recovered
                });
                break; // STOP — don't try remaining items, wait for next cycle after top-up
            }

            try {
                logger.info('Recovery: sending stuck order to MCBIS', {
                    orderId: order.orderId, itemIndex, network: order.network
                });

                const deliveryResult = await mcbisProvider.deliverBundle({
                    orderId: order.id,
                    itemIndex,
                    network: order.network,
                    phoneNumber: item.phoneNumber,
                    dataAmount: item.data,
                    price: item.costPrice || item.price,
                    existingReference: null
                });

                // Reload order to get fresh items (in case another process updated it)
                await order.reload();
                const freshItems = [...(order.items || [])];

                if (deliveryResult.status === 'InsufficientBalance') {
                    // Balance ran out at MCBIS level — stop the entire batch
                    freshItems[itemIndex] = {
                        ...freshItems[itemIndex],
                        deliveryError: deliveryResult.error
                    };
                    await order.update({ items: freshItems });
                    logger.info('Recovery: MCBIS says insufficient balance, stopping batch', {
                        orderId: order.orderId
                    });
                    break;

                } else if (deliveryResult.reference && deliveryResult.status !== 'Failed') {
                    // Successfully sent — mark as Processing, start polling
                    freshItems[itemIndex] = {
                        ...freshItems[itemIndex],
                        deliveryStatus: 'Processing',
                        providerReference: deliveryResult.reference,
                        sentToProviderAt: new Date().toISOString(),
                        deliveryError: null
                    };

                    const anyProcessing = freshItems.some(it => it.deliveryStatus === 'Processing');
                    await order.update({
                        items: freshItems,
                        deliveryStatus: anyProcessing ? 'Processing' : order.deliveryStatus
                    });

                    startPolling({
                        orderId: order.id, itemIndex,
                        reference: deliveryResult.reference, displayOrderId: order.orderId
                    });

                    // Deduct estimated cost from our running balance tracker
                    if (itemCost > 0) currentBalance -= itemCost;
                    recovered++;

                    logger.info('Recovery: order sent to MCBIS, now Processing', {
                        orderId: order.orderId, itemIndex, reference: deliveryResult.reference
                    });
                } else {
                    // Failed — log but continue with next item
                    freshItems[itemIndex] = {
                        ...freshItems[itemIndex],
                        deliveryError: deliveryResult.error || 'Recovery delivery failed'
                    };
                    await order.update({ items: freshItems });
                    logger.warn('Recovery: delivery attempt failed', {
                        orderId: order.orderId, itemIndex, error: deliveryResult.error
                    });
                }
            } catch (err) {
                logger.error('Recovery: delivery error', {
                    orderId: order.orderId, itemIndex, error: err.message
                });
            }

            // Small delay between MCBIS API calls
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (recovered > 0) {
            logger.info('Recovery sweep completed', { recovered, totalUnsent: unsentItems.length });
        }
    } catch (error) {
        logger.error('Recovery sweep error', { error: error.message });
    }
}

module.exports = {
    startPolling,
    stopPolling,
    getActivePolls,
    isPolling,
    updateOrderItemStatus,
    startBackgroundSync,
    stopBackgroundSync,
    syncProcessingOrders,
    recoverPendingOrders
};

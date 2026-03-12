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
const { Order } = require('../models');

// Track active polling jobs
const activePolls = new Map();

// Configuration
const FAST_POLL_INTERVAL = 5000;     // Check every 5 seconds initially
const SLOW_POLL_INTERVAL = 30000;    // Check every 30 seconds after fast phase
const FAST_POLL_DURATION = 2 * 60 * 1000;  // Fast polling for first 2 minutes
const INITIAL_DELAY = 3000;          // Wait 3 seconds before first check
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

        } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error' || mcbisStatus === 'cancelled' || mcbisStatus === 'rejected') {
            // FAILED - Update order and stop polling
            await updateOrderItemStatus(
                pollState.orderId,
                pollState.itemIndex,
                'Failed',
                pollState.reference,
                statusResult.error || 'Delivery failed by provider'
            );

            logger.error('Order delivery failed', {
                orderId: pollState.displayOrderId,
                itemIndex: pollState.itemIndex,
                reference: pollState.reference,
                mcbisStatus: mcbisStatus,
                error: statusResult.error
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
        logger.error('Error in status poll', {
            pollKey,
            error: error.message,
            attempt: pollState.attempts
        });

        // Continue polling on error (network issues, etc.) - NEVER STOP
        const elapsedTime = Date.now() - pollState.startTime;
        const pollInterval = elapsedTime < FAST_POLL_DURATION ? FAST_POLL_INTERVAL : SLOW_POLL_INTERVAL;
        setTimeout(() => pollLoop(pollKey), pollInterval);
    }
}

/**
 * Update order item delivery status in database
 */
async function updateOrderItemStatus(orderId, itemIndex, status, reference, error = null) {
    try {
        const order = await Order.findByPk(orderId);
        if (!order) {
            logger.error('Order not found for status update', { orderId });
            return false;
        }

        const items = [...(order.items || [])];
        if (!items[itemIndex]) {
            logger.error('Order item not found', { orderId, itemIndex });
            return false;
        }

        // Update specific item
        items[itemIndex] = {
            ...items[itemIndex],
            deliveryStatus: status,
            providerReference: reference,
            deliveredAt: status === 'Delivered' ? new Date().toISOString() : null,
            deliveryError: error
        };

        // Calculate overall order status
        const allDelivered = items.every(item => item.deliveryStatus === 'Delivered');
        const anyFailed = items.some(item => item.deliveryStatus === 'Failed');
        const allPending = items.every(item => 
            item.deliveryStatus === 'Pending' || item.deliveryStatus === 'Processing'
        );

        let overallStatus = 'Processing';
        if (allDelivered) {
            overallStatus = 'Delivered';
        } else if (anyFailed && !allPending) {
            overallStatus = 'Partial'; // Some delivered, some failed
        } else if (anyFailed && allPending) {
            overallStatus = 'Failed';
        }

        await order.update({
            items,
            deliveryStatus: overallStatus,
            processedAt: allDelivered ? new Date() : order.processedAt
        });

        logger.info('Order status updated', {
            orderId: order.orderId,
            itemIndex,
            itemStatus: status,
            overallStatus
        });

        return true;

    } catch (error) {
        logger.error('Failed to update order status', {
            orderId,
            itemIndex,
            error: error.message
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
const BACKGROUND_SYNC_INTERVAL = 2 * 60 * 1000; // Every 2 minutes

async function startBackgroundSync() {
    if (backgroundSyncInterval) {
        logger.info('Background sync already running');
        return;
    }

    logger.info('Starting background MCBIS sync service');
    
    // Run immediately on startup
    await syncProcessingOrders();
    
    // Then run periodically
    backgroundSyncInterval = setInterval(syncProcessingOrders, BACKGROUND_SYNC_INTERVAL);
}

async function stopBackgroundSync() {
    if (backgroundSyncInterval) {
        clearInterval(backgroundSyncInterval);
        backgroundSyncInterval = null;
        logger.info('Background sync stopped');
    }
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
                    } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error') {
                        await updateOrderItemStatus(order.id, i, 'Failed', item.providerReference, 'Failed by provider');
                        logger.info('Background sync: order marked failed', { orderId: order.orderId, itemIndex: i });
                    }

                    // Small delay between API calls
                    await new Promise(resolve => setTimeout(resolve, 500));
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

module.exports = {
    startPolling,
    stopPolling,
    getActivePolls,
    isPolling,
    updateOrderItemStatus,
    startBackgroundSync,
    stopBackgroundSync,
    syncProcessingOrders
};

/**
 * Store Order Delivery Service
 *
 * Mirrors the normal bundle delivery flow (orderController + orderStatusPoller)
 * but for StoreOrders, which are paid by external customers via Paystack.
 *
 * Flow:
 * 1. Customer pays via the store link → Paystack confirmed → StoreOrder.status = 'paid'.
 * 2. dispatchStoreOrder() sends each item to MCBIS (deliveryStatus: Processing).
 * 3. A background sweep polls MCBIS for completion and updates the StoreOrder.
 * 4. When all items are Delivered → deliveryStatus 'Delivered' and status 'fulfilled'.
 *
 * NOTE: Store orders are paid via Paystack (NOT a wallet). When MCBIS reports a
 * delivery as CANCELLED, the customer is automatically refunded via the Paystack
 * refund API (see refundCancelledItem). Other failures (failed/error/404) are
 * left as deliveryStatus 'Failed' for the admin to reconcile/refund manually.
 */

const logger = require('../utils/logger');
const mcbisProvider = require('./mcbisProvider');
const dispatchLock = require('./dispatchLock');
const { StoreOrder, Setting } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const ledgerService = require('./ledgerService');
const { refundTransaction, listRefunds } = require('../config/paystack');

// A refund claim ('processing') older than this is considered stale (crashed
// mid-refund) and may be retried after reconciling against Paystack.
const REFUND_CLAIM_TTL = 10 * 60 * 1000; // 10 minutes

const DELIVERED_STATUSES = ['success', 'completed', 'delivered', 'successful'];
const FAILED_STATUSES = ['failed', 'fail', 'error', 'cancelled', 'rejected', 'not_found'];

function computeOverall(items) {
    if (!items.length) return 'Pending';
    const allDelivered = items.every(i => i.deliveryStatus === 'Delivered');
    const anyFailed = items.some(i => i.deliveryStatus === 'Failed');
    const allTerminal = items.every(i => i.deliveryStatus === 'Delivered' || i.deliveryStatus === 'Failed');
    if (allDelivered) return 'Delivered';
    if (anyFailed && allTerminal) return 'Failed';
    if (anyFailed) return 'Partially Delivered';
    return 'Processing';
}

function recipientPhone(order, item) {
    return item.recipientPhone || item.phoneNumber || order.customerPhone || '';
}

/**
 * Apply a patch to a single order item and recompute the overall delivery status.
 * Uses a row-level lock so concurrent updates can't clobber the JSONB items array.
 */
async function updateItem(storeOrderId, itemIndex, patch) {
    const t = await sequelize.transaction();
    try {
        const order = await StoreOrder.findByPk(storeOrderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) { await t.rollback(); return null; }

        const items = [...(order.items || [])];
        if (!items[itemIndex]) { await t.rollback(); return null; }

        items[itemIndex] = { ...items[itemIndex], ...patch };
        const overall = computeOverall(items);

        const updates = { items, deliveryStatus: overall };
        const isFulfilling = overall === 'Delivered' && order.status === 'paid';
        if (isFulfilling) {
            updates.status = 'fulfilled';
            updates.fulfilledAt = new Date();
        }

        await order.update(updates, { transaction: t });

        // Credit the owner's profit/settlement once the order is fully delivered.
        if (isFulfilling) {
            await ledgerService.recordSale(order.storeId, {
                orderId: order.orderId,
                subtotal: order.subtotal,
                commission: order.commission,
                netAmount: order.netAmount,
                totalCost: order.totalCost
            }, { transaction: t });
        }

        await t.commit();
        return overall;
    } catch (e) {
        await t.rollback();
        logger.error('Store delivery: updateItem failed', { storeOrderId, itemIndex, error: e.message });
        return null;
    }
}

/**
 * Send a single not-yet-dispatched item to MCBIS.
 */
async function deliverItem(order, itemIndex) {
    const item = (order.items || [])[itemIndex];
    if (!item) return;
    if (item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') return;
    if (item.providerReference) return; // already sent — handled by polling

    const phone = recipientPhone(order, item);
    if (!phone) {
        await updateItem(order.id, itemIndex, { deliveryStatus: 'Failed', deliveryError: 'No recipient phone number' });
        return;
    }

    const enabled = await Setting.shouldDeliverViaMcbis(item.network);
    if (!enabled) {
        await updateItem(order.id, itemIndex, { deliveryStatus: 'Pending', deliveryError: 'Auto-delivery disabled for network' });
        return;
    }

    if (!dispatchLock.claim(order.id, itemIndex)) return;
    try {
        const result = await mcbisProvider.deliverBundle({
            orderId: order.id,
            itemIndex,
            network: item.network,
            phoneNumber: phone,
            dataAmount: item.data,
            price: item.costPrice,
            existingReference: item.providerReference
        }, { skipBalanceCheck: false });

        if (result.status === 'InsufficientBalance' || result.status === 'BalanceCheckFailed') {
            await updateItem(order.id, itemIndex, { deliveryStatus: 'Pending', deliveryError: result.error });
            logger.warn('Store delivery: insufficient MCBIS balance, item stays Pending', { orderId: order.orderId, itemIndex });
        } else if (result.reference && result.status !== 'Failed') {
            const patch = {
                deliveryStatus: result.status === 'Delivered' ? 'Delivered' : 'Processing',
                providerReference: result.reference,
                sentToProviderAt: new Date().toISOString(),
                deliveryError: null
            };
            if (result.status === 'Delivered') patch.deliveredAt = new Date().toISOString();
            await updateItem(order.id, itemIndex, patch);
            logger.info('Store delivery: sent to MCBIS', { orderId: order.orderId, itemIndex, reference: result.reference, status: result.status });
        } else {
            await updateItem(order.id, itemIndex, { deliveryStatus: 'Failed', deliveryError: result.error || 'MCBIS dispatch returned no reference' });
            logger.error('Store delivery: dispatch failed', { orderId: order.orderId, itemIndex, error: result.error });
        }
    } catch (e) {
        logger.error('Store delivery: deliverItem error', { orderId: order.orderId, itemIndex, error: e.message });
        await updateItem(order.id, itemIndex, { deliveryStatus: 'Failed', deliveryError: e.message });
    } finally {
        dispatchLock.release(order.id, itemIndex);
    }
}

/**
 * Automatically refund a customer (via Paystack) for an item MCBIS cancelled.
 *
 * Two-phase to prevent double refunds:
 *  1. Atomically claim the refund under a row lock (refundStatus: 'processing').
 *  2. Call the Paystack refund API, then persist 'refunded' or 'failed'.
 *
 * When every item in the order ends up Failed + refunded, the order status
 * moves to 'refunded'.
 */
async function refundCancelledItem(storeOrderId, itemIndex, reason) {
    // ── Phase 1: claim the refund atomically ──
    let paymentReference = null;
    let amount = 0;
    let orderId = null;
    let wasStaleReclaim = false;
    const t = await sequelize.transaction();
    try {
        const order = await StoreOrder.findByPk(storeOrderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order || !order.paymentReference || !['paid', 'fulfilled'].includes(order.status)) {
            await t.rollback();
            return;
        }
        const items = [...(order.items || [])];
        const item = items[itemIndex];
        if (!item || item.refundStatus === 'refunded') {
            await t.rollback();
            return; // already refunded
        }
        if (item.refundStatus === 'processing') {
            // In flight — only re-claim if the claim is stale (crash mid-refund)
            const claimedAt = item.refundClaimedAt ? new Date(item.refundClaimedAt).getTime() : 0;
            if (Date.now() - claimedAt < REFUND_CLAIM_TTL) {
                await t.rollback();
                return;
            }
            wasStaleReclaim = true;
        }
        amount = Math.round(parseFloat(item.lineTotal || (parseFloat(item.unitPrice || item.price || 0) * (item.quantity || 1)) || 0) * 100) / 100;
        if (amount <= 0) { await t.rollback(); return; }

        items[itemIndex] = { ...item, refundStatus: 'processing', refundClaimedAt: new Date().toISOString() };
        await order.update({ items }, { transaction: t });
        await t.commit();
        paymentReference = order.paymentReference;
        orderId = order.orderId;
    } catch (e) {
        await t.rollback();
        logger.error('Store refund: failed to claim refund', { storeOrderId, itemIndex, error: e.message });
        return;
    }

    // ── Phase 2: call Paystack, then persist the outcome ──
    let refundOk = false;
    let refundError = null;
    const merchantNote = `Auto-refund: ${reason} — order ${orderId} item ${itemIndex + 1}`;
    try {
        // On a stale re-claim (previous attempt may have crashed after Paystack
        // succeeded but before we persisted the result), reconcile with Paystack
        // first so we never issue the same refund twice.
        if (wasStaleReclaim) {
            const existing = await listRefunds(paymentReference);
            const match = (existing.data || []).find(r =>
                (r.merchant_note || '').includes(`order ${orderId} item ${itemIndex + 1}`) &&
                ['pending', 'processing', 'processed'].includes((r.status || '').toLowerCase())
            );
            if (match) {
                refundOk = true;
                logger.info('Store refund: found existing Paystack refund during reconciliation', { orderId, itemIndex });
            }
        }
        if (!refundOk) await refundTransaction({
            transaction: paymentReference,
            amount,
            merchant_note: merchantNote
        });
        refundOk = true;
        logger.info('Store refund: Paystack refund issued', { orderId, itemIndex, amount });
    } catch (e) {
        refundError = e.message;
        logger.error('Store refund: Paystack refund FAILED — admin must refund manually', {
            orderId, itemIndex, amount, error: e.message
        });
    }

    const t2 = await sequelize.transaction();
    try {
        const order = await StoreOrder.findByPk(storeOrderId, { transaction: t2, lock: t2.LOCK.UPDATE });
        if (!order) { await t2.rollback(); return; }
        const items = [...(order.items || [])];
        if (!items[itemIndex]) { await t2.rollback(); return; }

        items[itemIndex] = {
            ...items[itemIndex],
            refundStatus: refundOk ? 'refunded' : 'failed',
            refundedAt: refundOk ? new Date().toISOString() : undefined,
            refundAmount: refundOk ? amount : undefined,
            refundError: refundOk ? null : refundError
        };

        const updates = { items };
        const allRefunded = items.every(i => i.refundStatus === 'refunded');
        if (refundOk && allRefunded && order.status === 'paid') {
            updates.status = 'refunded';
        }
        await order.update(updates, { transaction: t2 });
        await t2.commit();
    } catch (e) {
        await t2.rollback();
        logger.error('Store refund: failed to persist refund result', { storeOrderId, itemIndex, refundOk, error: e.message });
    }
}

/**
 * Poll MCBIS for the status of an already-dispatched item.
 */
async function pollItem(order, itemIndex) {
    const item = (order.items || [])[itemIndex];
    if (!item || !item.providerReference) return;
    if (item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') return;

    try {
        const statusResult = await mcbisProvider.checkOrderStatus(item.providerReference);
        const s = (statusResult.status || '').toLowerCase().trim();

        if (DELIVERED_STATUSES.includes(s)) {
            await updateItem(order.id, itemIndex, { deliveryStatus: 'Delivered', deliveredAt: new Date().toISOString(), deliveryError: null });
            logger.info('Store delivery: confirmed delivered', { orderId: order.orderId, itemIndex });
        } else if (FAILED_STATUSES.includes(s)) {
            const reason = s === 'not_found' ? 'Provider reference not found on provider (404)'
                : s === 'cancelled' ? 'Cancelled by provider'
                : 'Delivery failed by provider';
            await updateItem(order.id, itemIndex, { deliveryStatus: 'Failed', deliveryError: reason });
            logger.error('Store delivery: marked failed', { orderId: order.orderId, itemIndex, reason });
            // Auto-refund the customer when MCBIS cancels the delivery
            if (s === 'cancelled') {
                await refundCancelledItem(order.id, itemIndex, 'Delivery cancelled by provider');
            }
        }
        // else still processing — leave for the next sweep
    } catch (e) {
        const httpStatus = e.response?.status || e.httpStatus;
        if (httpStatus === 404 || e.notFound === true) {
            await updateItem(order.id, itemIndex, { deliveryStatus: 'Failed', deliveryError: 'Provider reference not found (404)' });
        }
        // transient errors — retry on next sweep
    }
}

/**
 * Dispatch a freshly-paid store order to MCBIS immediately (fire-and-forget after payment).
 */
async function dispatchStoreOrder(storeOrderId) {
    try {
        let order = await StoreOrder.findByPk(storeOrderId);
        if (!order) return;
        if (order.status !== 'paid') return;
        if (order.deliveryStatus === 'Delivered') return;

        const count = (order.items || []).length;
        for (let i = 0; i < count; i++) {
            await deliverItem(order, i);
            order = await order.reload();
            if (i < count - 1) await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        logger.error('dispatchStoreOrder failed', { storeOrderId, error: e.message });
    }
}

// ── Background sweep: poll Processing items + dispatch un-sent Pending items ──
let sweepRunning = false;
let sweepInterval = null;
const SWEEP_INTERVAL = 45 * 1000;       // every 45 seconds
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // ignore orders older than 7 days

async function sweepStoreOrders() {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
        const orders = await StoreOrder.findAll({
            where: {
                status: 'paid',
                deliveryStatus: { [Op.in]: ['Pending', 'Processing'] },
                createdAt: { [Op.gte]: new Date(Date.now() - MAX_AGE) }
            },
            order: [['createdAt', 'ASC']],
            limit: 100
        });

        if (!orders.length) return;
        logger.info('Store delivery sweep: checking orders', { count: orders.length });

        for (let order of orders) {
            const count = (order.items || []).length;
            for (let i = 0; i < count; i++) {
                const item = order.items[i];
                if (item.deliveryStatus === 'Delivered' || item.deliveryStatus === 'Failed') continue;
                // A 'Processing' item with no provider reference was set manually by an
                // admin (the copy → process → complete flow). Don't auto-dispatch it
                // (would double-deliver) or reset it to Pending — leave it for the admin.
                if (item.deliveryStatus === 'Processing' && !item.providerReference) continue;

                if (item.providerReference) {
                    await pollItem(order, i);
                } else {
                    await deliverItem(order, i);
                }
                order = await order.reload();
                await new Promise(r => setTimeout(r, 1200));
            }
        }
    } catch (e) {
        logger.error('Store delivery sweep failed', { error: e.message });
    } finally {
        sweepRunning = false;
    }

    // Retry refunds that crashed mid-flight (refundStatus stuck at 'processing').
    try {
        await retryStuckRefunds();
    } catch (e) {
        logger.error('Store refund retry sweep failed', { error: e.message });
    }
}

/**
 * Find items whose auto-refund claim went stale (server crashed between the
 * claim and the Paystack call / result persistence) and retry them.
 * refundCancelledItem itself reconciles against Paystack, so this is
 * double-refund safe.
 */
async function retryStuckRefunds() {
    const orders = await StoreOrder.findAll({
        where: {
            status: { [Op.in]: ['paid', 'fulfilled'] },
            deliveryStatus: { [Op.in]: ['Failed', 'Partially Delivered'] },
            createdAt: { [Op.gte]: new Date(Date.now() - MAX_AGE) }
        },
        order: [['createdAt', 'ASC']],
        limit: 100
    });

    for (const order of orders) {
        const items = order.items || [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.refundStatus !== 'processing') continue;
            const claimedAt = item.refundClaimedAt ? new Date(item.refundClaimedAt).getTime() : 0;
            if (Date.now() - claimedAt < REFUND_CLAIM_TTL) continue;

            logger.warn('Store refund: retrying stale refund claim', { orderId: order.orderId, itemIndex: i });
            await refundCancelledItem(order.id, i, 'Delivery cancelled by provider');
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function startStoreDeliverySweep() {
    if (sweepInterval) return;
    logger.info('Starting store-order delivery sweep service');
    setTimeout(sweepStoreOrders, 15000); // first run shortly after boot
    sweepInterval = setInterval(sweepStoreOrders, SWEEP_INTERVAL);
}

function stopStoreDeliverySweep() {
    if (sweepInterval) {
        clearInterval(sweepInterval);
        sweepInterval = null;
    }
}

module.exports = {
    dispatchStoreOrder,
    sweepStoreOrders,
    startStoreDeliverySweep,
    stopStoreDeliverySweep,
    updateItem,
    computeOverall
};

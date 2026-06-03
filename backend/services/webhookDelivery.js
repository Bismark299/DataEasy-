/**
 * Webhook Delivery Service
 * Fires HTTP POST callbacks to developer-supplied URLs when order item
 * delivery status changes to Delivered or Failed.
 *
 * Retries up to 3 times with exponential back-off (1s → 2s → done).
 * Always fire-and-forget — never blocks the caller.
 */

const axios = require('axios');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS   = 10_000; // 10s per attempt

/**
 * Attempt to POST payload to callbackUrl with retries.
 * @returns {Promise<boolean>} true if any attempt succeeded
 */
async function deliverWebhook(callbackUrl, payload, context = {}) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await axios.post(callbackUrl, payload, {
                timeout: TIMEOUT_MS,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'DataEasyPlus-Webhook/1.0',
                    'X-DataEasy-Event': payload.event
                },
                maxRedirects: 3,
                validateStatus: status => status >= 200 && status < 300
            });
            logger.info('Webhook delivered', { ...context, attempt, event: payload.event });
            return true;
        } catch (err) {
            const willRetry = attempt < MAX_ATTEMPTS;
            logger.warn('Webhook delivery failed', {
                ...context,
                attempt,
                error: err.message,
                httpStatus: err.response?.status,
                willRetry
            });
            if (willRetry) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            }
        }
    }
    logger.error('Webhook delivery gave up after all attempts', { ...context, maxAttempts: MAX_ATTEMPTS });
    return false;
}

/**
 * Fire a webhook for a single order item status change.
 * Non-blocking — errors are logged but never thrown to the caller.
 *
 * @param {string}  callbackUrl  - Developer-supplied HTTPS callback URL
 * @param {Object}  params
 * @param {string}  params.orderId       - Human-readable order ID (e.g. "0042")
 * @param {string}  params.orderUuid     - DB UUID of the order
 * @param {number}  params.itemIndex     - Index of the item in order.items
 * @param {Object}  params.item          - The updated item object
 * @param {string}  params.overallStatus - New overall order deliveryStatus
 */
function fireItemWebhook(callbackUrl, { orderId, orderUuid, itemIndex, item, overallStatus }) {
    if (!callbackUrl) return;

    const event = item.deliveryStatus === 'Delivered'
        ? 'order.item.delivered'
        : 'order.item.failed';

    const payload = {
        event,
        orderId,
        orderUuid,
        itemIndex,
        item: {
            phoneNumber:       item.phoneNumber,
            data:              item.data,
            packageId:         item.packageId,
            deliveryStatus:    item.deliveryStatus,
            providerReference: item.providerReference || null,
            deliveredAt:       item.deliveredAt       || null,
            deliveryError:     item.deliveryError      || null
        },
        orderStatus: overallStatus,
        timestamp:   new Date().toISOString()
    };

    deliverWebhook(callbackUrl, payload, { orderId, itemIndex, event }).catch(() => {});
}

module.exports = { fireItemWebhook, deliverWebhook };

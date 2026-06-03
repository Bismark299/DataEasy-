/**
 * In-process dispatch lock — prevents concurrent duplicate dispatches of the
 * same order item across all paths (new order, developer API, recovery sweep).
 *
 * Since Node.js is single-threaded, any two async operations interleave only
 * at `await` points.  A simple Set is enough to serialize them within one
 * process.  The lock is NOT persisted — after a restart the DB-level
 * providerReference check handles previously-dispatched items.
 */

const inFlight = new Set();

/**
 * Try to claim exclusive dispatch rights for an order item.
 * @param {number|string} orderId  - DB primary key of the order
 * @param {number}        itemIndex - Index of the item inside order.items
 * @returns {boolean} true if the claim succeeded (caller may dispatch),
 *                    false if another dispatch is already in flight (caller must skip)
 */
function claim(orderId, itemIndex) {
    const key = `${orderId}:${itemIndex}`;
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    return true;
}

/**
 * Release the lock for an order item.  Always call this in a `finally` block
 * so the lock is freed even when dispatch throws.
 */
function release(orderId, itemIndex) {
    inFlight.delete(`${orderId}:${itemIndex}`);
}

module.exports = { claim, release };

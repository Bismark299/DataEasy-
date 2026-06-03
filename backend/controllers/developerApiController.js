/**
 * Developer API Controller
 * Public endpoints for external websites using API keys
 * Mirrors the core order flow but authenticated via X-API-Key
 */

const { Order, Wallet, Transaction, Setting, User, Package } = require('../models');
const { sequelize } = require('../config/database');
const { getAllPackagesForRole, findPackage, getNetworkFromPackageId, getPriceForRole } = require('../config/packages');
const logger = require('../utils/logger');
const dispatchLock = require('../services/dispatchLock');

// Lazy load services
let mcbisProvider = null;
let orderStatusPoller = null;

const getMcbisProvider = () => {
    if (!mcbisProvider) mcbisProvider = require('../services/mcbisProvider');
    return mcbisProvider;
};

const getOrderStatusPoller = () => {
    if (!orderStatusPoller) orderStatusPoller = require('../services/orderStatusPoller');
    return orderStatusPoller;
};

let _orderSeqInitialized = false;

/**
 * Generate unique sequential order ID using PostgreSQL sequence
 * Safe for concurrent access — no row locking needed
 */
async function generateOrderId(transaction) {
    if (!_orderSeqInitialized) {
        // Create sequence if it doesn't exist
        await sequelize.query(
            `CREATE SEQUENCE IF NOT EXISTS order_id_seq START WITH 1 INCREMENT BY 1`,
            { transaction }
        );
        
        // Sync sequence with existing orders
        const [maxResult] = await sequelize.query(
            `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace("orderId", '[^0-9]', '', 'g'), '') AS INTEGER)), 0) as max_id FROM "orders"`,
            { transaction }
        );
        const currentMax = maxResult[0]?.max_id || 0;
        
        const [seqResult] = await sequelize.query(
            `SELECT last_value, is_called FROM order_id_seq`,
            { transaction }
        );
        const seqVal = seqResult[0]?.is_called ? parseInt(seqResult[0]?.last_value) : 0;
        
        if (currentMax >= seqVal) {
            await sequelize.query(
                `SELECT setval('order_id_seq', ${currentMax + 1}, false)`,
                { transaction }
            );
        }
        _orderSeqInitialized = true;
    }
    
    const [nextVal] = await sequelize.query(
        `SELECT nextval('order_id_seq') as next_id`,
        { transaction }
    );
    
    return String(nextVal[0].next_id).padStart(4, '0');
}

/**
 * GET /api/v1/packages
 * List available data packages with prices for the API key owner's role
 */
exports.getPackages = async (req, res) => {
    try {
        const userRole = req.user.role || 'agent';
        const { network } = req.query;

        const allPackages = await getAllPackagesForRole(userRole);
        const networkAvailability = await Setting.getNetworkAvailability();

        let result = allPackages;
        if (network) {
            const upper = network.charAt(0).toUpperCase() + network.slice(1);
            result = { [upper]: allPackages[upper] || [] };
        }

        res.json({
            success: true,
            packages: result,
            networkAvailability,
            pricingRole: userRole
        });
    } catch (error) {
        logger.error('Developer API: Failed to fetch packages', { error: error.message });
        res.status(503).json({ success: false, error: 'Unable to load packages.' });
    }
};

/**
 * POST /api/v1/orders
 * Create a data bundle order (debits the API key owner's wallet)
 *
 * Body: {
 *   network: "MTN",
 *   items: [
 *     { packageId: "mtn-5gb", phoneNumber: "0241234567" }
 *   ]
 * }
 */
exports.createOrder = async (req, res) => {
    const MAX_RETRIES = 3;
    
    // Validate input before starting any transaction
    const { items, network } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items array is required.' });
    }

    if (!network) {
        return res.status(400).json({ success: false, error: 'network is required (MTN, AirtelTigo, Telecel).' });
    }

    if (items.length > 10) {
        return res.status(400).json({ success: false, error: 'Maximum 10 items per order.' });
    }

    const userRole = req.user.role || 'agent';

    const phoneRegex = /^0[2-59]\d{8}$/;
    for (const item of items) {
        if (!item.phoneNumber || !phoneRegex.test(item.phoneNumber)) {
            return res.status(400).json({ success: false, error: `Invalid phone number: ${item.phoneNumber || '(missing)'}. Use Ghana format e.g. 0241234567` });
        }
        if (!item.packageId) {
            return res.status(400).json({ success: false, error: 'Each item requires a packageId.' });
        }
    }

    const itemNetworks = items.map(item => getNetworkFromPackageId(item.packageId));
    const uniqueNetworks = [...new Set(itemNetworks)];
    if (uniqueNetworks.length > 1) {
        return res.status(400).json({ success: false, error: 'All items must be from the same network.' });
    }
    if (uniqueNetworks[0] !== network) {
        return res.status(400).json({ success: false, error: 'Network mismatch between items and specified network.' });
    }

    // Build order items with price snapshots (no DB transaction needed)
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
        const pkg = await findPackage(item.packageId, userRole);
        if (!pkg) {
            return res.status(400).json({ success: false, error: `Invalid package: ${item.packageId}` });
        }
        if (pkg.priceSource !== 'database') {
            return res.status(500).json({ success: false, error: 'Pricing system error.' });
        }

        const itemPrice = Math.round(parseFloat(pkg.price) * 100) / 100;
        if (isNaN(itemPrice) || itemPrice <= 0) {
            return res.status(500).json({ success: false, error: 'Pricing error. Contact support.' });
        }

        const itemCost = pkg.costPrice ? Math.round(parseFloat(pkg.costPrice) * 100) / 100 : null;

        orderItems.push({
            packageId: pkg.id,
            packageName: pkg.name,
            data: pkg.data,
            price: itemPrice,
            costPrice: itemCost,
            priceLockedAt: new Date().toISOString(),
            priceSource: 'database',
            userRole,
            phoneNumber: item.phoneNumber,
            deliveryStatus: 'Pending'
        });

        subtotal += itemPrice;
    }

    subtotal = Math.round(subtotal * 100) / 100;
    const total = subtotal;

    // Retry loop for concurrent transaction conflicts
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const t = await sequelize.transaction();
        try {
            // Wallet debit (atomic with row lock)
            const wallet = await Wallet.findOne({
                where: { userId: req.user.id },
                lock: t.LOCK.UPDATE,
                transaction: t
            });

            if (!wallet) {
                await t.rollback();
                return res.status(400).json({ success: false, error: 'Wallet not found.' });
            }

            if (wallet.balance < total) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    error: 'Insufficient wallet balance.',
                    required: total,
                    available: parseFloat(wallet.balance)
                });
            }

            const balanceBefore = wallet.balance;
            await wallet.debit(total, { transaction: t });

            const orderId = await generateOrderId(t);

            const order = await Order.create({
                orderId,
                userId: req.user.id,
                items: orderItems,
                network,
                subtotal,
                total,
                paymentStatus: 'Completed',
                paymentMethod: 'wallet',
                deliveryStatus: 'Processing'
            }, { transaction: t });

            await Transaction.create({
                userId: req.user.id,
                type: 'debit',
                amount: total,
                balanceBefore,
                balanceAfter: wallet.balance,
                description: `API Order #${order.orderId} - ${orderItems.length} item(s)`,
                reference: `ORDER-${order.orderId}`,
                paymentMethod: 'order',
                status: 'completed',
                orderId: order.id
            }, { transaction: t });

            await t.commit();

            // Auto-delivery via MCBIS (fire-and-forget after response)
            (async () => {
                try {
                    const shouldAutoDeliver = await Setting.shouldDeliverViaMcbis(network);
                    if (!shouldAutoDeliver) return;

                    const provider = getMcbisProvider();
                    const poller = getOrderStatusPoller();

                    // Pre-check MCBIS balance once for the whole batch
                    let batchSkipBalanceCheck = false;
                    try {
                        const balResult = await provider.getWalletBalance();
                        const bal = parseFloat(balResult.balance || 0);
                        if (balResult.balanceParsed && bal < 1) {
                            // Balance too low — mark all items Pending and bail out
                            const pendingItems = orderItems.map(it => ({ ...it, deliveryStatus: 'Pending', deliveryError: `MCBIS balance too low: ₵${bal.toFixed(2)}` }));
                            await order.update({ items: pendingItems, deliveryStatus: 'Pending' });
                            logger.warn('API order: MCBIS balance too low, all items marked Pending', { orderId: order.orderId, balance: bal });
                            return;
                        }
                        batchSkipBalanceCheck = true; // Balance confirmed OK, skip per-item checks
                    } catch (balErr) {
                        logger.warn('API order: balance pre-check failed, proceeding anyway', { orderId: order.orderId, error: balErr.message });
                    }

                    // Dispatch items sequentially to respect MCBIS rate limit
                    const dispatched = [...orderItems];
                    for (let i = 0; i < orderItems.length; i++) {
                        const item = orderItems[i];

                        // Claim exclusive dispatch rights for this item
                        if (!dispatchLock.claim(order.id, i)) {
                            logger.warn('API dispatch: lock already held for item, skipping', {
                                orderId: order.orderId, itemIndex: i
                            });
                            dispatched[i] = { ...dispatched[i], deliveryStatus: 'Processing' };
                            continue;
                        }

                        try {
                            const deliveryResult = await provider.deliverBundle({
                                orderId: order.id,
                                itemIndex: i,
                                network,
                                phoneNumber: item.phoneNumber,
                                dataAmount: item.data,
                                price: item.costPrice || item.price,
                                existingReference: item.providerReference || null
                            }, { skipBalanceCheck: batchSkipBalanceCheck });

                            if (deliveryResult.status === 'InsufficientBalance') {
                                dispatched[i] = { ...dispatched[i], deliveryStatus: 'Pending', deliveryError: deliveryResult.error };
                            } else if (deliveryResult.status === 'Failed' || !deliveryResult.reference) {
                                dispatched[i] = { ...dispatched[i], deliveryStatus: 'Failed', deliveryError: deliveryResult.error };
                            } else {
                                // Successfully submitted — mark Processing and start poller
                                dispatched[i] = {
                                    ...dispatched[i],
                                    deliveryStatus: 'Processing',
                                    providerReference: deliveryResult.reference,
                                    sentToProviderAt: new Date().toISOString()
                                };
                                poller.startPolling({
                                    orderId: order.id,
                                    itemIndex: i,
                                    reference: deliveryResult.reference,
                                    displayOrderId: order.orderId
                                });
                            }
                        } catch (itemErr) {
                            logger.error('API order auto-delivery failed for item', { orderId: order.orderId, itemIndex: i, error: itemErr.message });
                            dispatched[i] = { ...dispatched[i], deliveryStatus: 'Failed', deliveryError: itemErr.message };
                        } finally {
                            dispatchLock.release(order.id, i);
                        }

                        // 500ms gap between placeOrder calls to respect MCBIS rate limit
                        if (i < orderItems.length - 1) {
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }

                    // Write updated item statuses back to DB
                    const anyProcessing = dispatched.some(it => it.deliveryStatus === 'Processing');
                    const allPending = dispatched.every(it => it.deliveryStatus === 'Pending');
                    const allFailed = dispatched.every(it => it.deliveryStatus === 'Failed');
                    await order.update({
                        items: dispatched,
                        deliveryStatus: anyProcessing ? 'Processing' : allPending ? 'Pending' : allFailed ? 'Failed' : 'Processing'
                    });

                    logger.info('API order dispatch complete', {
                        orderId: order.orderId,
                        processing: dispatched.filter(it => it.deliveryStatus === 'Processing').length,
                        pending: dispatched.filter(it => it.deliveryStatus === 'Pending').length,
                        failed: dispatched.filter(it => it.deliveryStatus === 'Failed').length
                    });
                } catch (autoDeliveryError) {
                    logger.error('API order auto-delivery error', { orderId: order.orderId, error: autoDeliveryError.message });
                }
            })();

            return res.status(201).json({
                success: true,
                order: {
                    id: order.id,
                    orderId: order.orderId,
                    network,
                    items: orderItems.map(item => ({
                        packageId: item.packageId,
                        packageName: item.packageName,
                        data: item.data,
                        price: item.price,
                        phoneNumber: item.phoneNumber,
                        deliveryStatus: item.deliveryStatus
                    })),
                    total,
                    paymentStatus: 'Completed',
                    deliveryStatus: 'Processing',
                    createdAt: order.createdAt
                },
                walletBalance: parseFloat(wallet.balance)
            });
        } catch (error) {
            try { await t.rollback(); } catch (_) {}
            
            const isRetryable = error.message.includes('modified by another transaction') ||
                error.message.includes('deadlock') ||
                error.message.includes('could not serialize') ||
                error.message.includes('lock timeout') ||
                error.parent?.code === '40P01' || // PostgreSQL deadlock
                error.parent?.code === '40001';   // PostgreSQL serialization failure
            
            if (isRetryable && attempt < MAX_RETRIES) {
                const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
                logger.warn(`API order retry attempt ${attempt}/${MAX_RETRIES}`, { userId: req.user?.id, error: error.message, delay });
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            logger.error('Developer API create order error', { error: error.message, userId: req.user?.id, attempt });
            return res.status(500).json({ success: false, error: 'Failed to create order.' });
        }
    }
};

/**
 * GET /api/v1/orders
 * List orders placed by the API key owner
 */
exports.getOrders = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const offset = (page - 1) * limit;

        const where = { userId: req.user.id };
        if (status) where.deliveryStatus = status;

        const { count, rows: orders } = await Order.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit: Math.min(parseInt(limit), 100),
            offset
        });

        res.json({
            success: true,
            orders: orders.map(o => ({
                id: o.id,
                orderId: o.orderId,
                network: o.network,
                items: o.items.map(item => ({
                    packageId: item.packageId,
                    data: item.data,
                    price: item.price,
                    phoneNumber: item.phoneNumber,
                    deliveryStatus: item.deliveryStatus
                })),
                total: parseFloat(o.total),
                paymentStatus: o.paymentStatus,
                deliveryStatus: o.deliveryStatus,
                createdAt: o.createdAt
            })),
            pagination: {
                total: count,
                page: parseInt(page),
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch orders.' });
    }
};

/**
 * GET /api/v1/orders/:orderId
 * Get a specific order's details and delivery status
 */
exports.getOrder = async (req, res) => {
    try {
        const paramId = req.params.orderId;
        let order = null;

        // Only query by UUID primary key if the param is a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(paramId)) {
            order = await Order.findOne({
                where: { id: paramId, userId: req.user.id }
            });
        }

        // Fall back to orderId (the sequential/custom one)
        if (!order) {
            order = await Order.findOne({
                where: { orderId: paramId, userId: req.user.id }
            });
        }

        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found.' });
        }

        res.json({ success: true, order: formatOrder(order) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch order.' });
    }
};

/**
 * GET /api/v1/balance
 * Get the API key owner's wallet balance
 */
exports.getBalance = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        res.json({
            success: true,
            balance: wallet ? parseFloat(wallet.balance) : 0,
            currency: 'GHS'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch balance.' });
    }
};

/**
 * GET /api/v1/account
 * Get basic account info of the API key owner
 */
exports.getAccount = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        res.json({
            success: true,
            account: {
                id: req.user.id,
                name: req.user.fullName,
                email: req.user.email,
                role: req.user.role,
                agentCode: req.user.agentCode,
                walletBalance: wallet ? parseFloat(wallet.balance) : 0,
                currency: 'GHS'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch account.' });
    }
};

function formatOrder(o) {
    return {
        id: o.id,
        orderId: o.orderId,
        network: o.network,
        items: o.items.map(item => ({
            packageId: item.packageId,
            packageName: item.packageName,
            data: item.data,
            price: item.price,
            phoneNumber: item.phoneNumber,
            deliveryStatus: item.deliveryStatus
        })),
        total: parseFloat(o.total),
        paymentStatus: o.paymentStatus,
        deliveryStatus: o.deliveryStatus,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt
    };
}

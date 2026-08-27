/**
 * Order Controller
 * Create and manage data topup orders
 * Updated for PostgreSQL/Sequelize
 * With atomic transactions for financial operations
 */

const { Order, Wallet, Transaction, Setting, User } = require('../models');
const { sequelize } = require('../config/database');
const { packages, getPackages, getAllPackages, getAllPackagesForClient, getAllPackagesForRole, findPackage, findPackageSync, getNetworkFromPackageId, getPriceForRole } = require('../config/packages');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const dispatchLock = require('../services/dispatchLock');

// Lazy load services to avoid circular dependency
let mcbisProvider = null;
let orderStatusPoller = null;

const getMcbisProvider = () => {
    if (!mcbisProvider) {
        mcbisProvider = require('../services/mcbisProvider');
    }
    return mcbisProvider;
};

const getOrderStatusPoller = () => {
    if (!orderStatusPoller) {
        orderStatusPoller = require('../services/orderStatusPoller');
    }
    return orderStatusPoller;
};

/**
 * Get all packages (for clients - includes out of stock items)
 * GET /api/orders/packages
 * 
 * ⚠️ NO FALLBACK: Returns error if database unavailable
 * Frontend should show error message, not cached/static prices
 * 
 * Prices are role-based:
 * - Authenticated users see prices for their role
 * - Unauthenticated users see agent (default) prices
 */
exports.getPackages = async (req, res) => {
    try {
        // Determine user role (if authenticated)
        let userRole = 'agent'; // Default for guests
        
        if (req.user && req.user.id) {
            // User is authenticated, get their role
            const user = await User.findByPk(req.user.id);
            if (user && user.role) {
                userRole = user.role;
            }
        }
        
        // Get packages with role-appropriate pricing
        const allPackages = await getAllPackagesForRole(userRole);
        
        // Get network availability settings
        const networkAvailability = await Setting.getNetworkAvailability();
        
        // Get client UI settings
        const uiSettings = await Setting.getClientUISettings();
        
        res.json({
            success: true,
            packages: allPackages,
            networkAvailability,
            uiSettings,
            userRole // Include so client knows which pricing they're seeing
        });
    } catch (error) {
        logger.error('Failed to fetch packages from database', { error: error.message });
        // FAIL CLOSED: No fallback to static prices
        res.status(503).json({
            success: false,
            error: 'Unable to load packages. Please try again.',
            code: 'PACKAGES_UNAVAILABLE'
        });
    }
};

/**
 * Get packages by network (for clients - includes out of stock items)
 * GET /api/orders/packages/:network
 * 
 * ⚠️ NO FALLBACK: Returns error if database unavailable
 * Prices are role-based (same as getPackages)
 */
exports.getPackagesByNetwork = async (req, res) => {
    const { network } = req.params;
    
    try {
        // Determine user role (if authenticated)
        let userRole = 'agent';
        if (req.user && req.user.id) {
            const user = await User.findByPk(req.user.id);
            if (user && user.role) {
                userRole = user.role;
            }
        }
        
        const allPackages = await getAllPackagesForRole(userRole);
        const networkPackages = allPackages[network] || allPackages.MTN || [];
        
        res.json({
            success: true,
            network,
            packages: networkPackages,
            userRole
        });
    } catch (error) {
        logger.error('Failed to fetch packages from database', { error: error.message, network });
        // FAIL CLOSED: No fallback to static prices
        res.status(503).json({
            success: false,
            error: 'Unable to load packages. Please try again.',
            code: 'PACKAGES_UNAVAILABLE'
        });
    }
};

let _orderSeqInitialized = false;

/**
 * Generate unique sequential order ID using PostgreSQL sequence
 * Safe for concurrent access — no row locking needed
 * @param {Transaction} transaction - Sequelize transaction object
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

// Exported so store orders can share the same sequential order-number system.
exports.generateOrderId = generateOrderId;

/**
 * Create new order with atomic transaction
 * POST /api/orders
 */
exports.createOrder = async (req, res) => {
    // Start a database transaction for atomic operations
    const t = await sequelize.transaction();
    
    try {
        const { items, network, paymentMethod = 'wallet' } = req.body;

        // Get user's role for pricing
        const userRole = req.user.role || 'agent';

        // Fetch all packages from DB upfront (authoritative network + price source)
        const fetchedPackages = await Promise.all(
            items.map(item => findPackage(item.packageId, userRole))
        );

        // FAIL CLOSED: every item must resolve to a real DB package
        for (let i = 0; i < items.length; i++) {
            if (!fetchedPackages[i]) {
                await t.rollback();
                logger.error('Order rejected: Package not found in database', {
                    packageId: items[i].packageId,
                    userId: req.user.id
                });
                return res.status(400).json({ error: `Invalid package: ${items[i].packageId}` });
            }
        }

        // Validate all items belong to same network (use DB network field, not ID prefix)
        const itemNetworks = fetchedPackages.map(pkg => pkg.network);
        const uniqueNetworks = [...new Set(itemNetworks)];

        if (uniqueNetworks.length > 1) {
            await t.rollback();
            return res.status(400).json({ error: 'All items must be from the same network' });
        }

        if (uniqueNetworks[0] !== network) {
            await t.rollback();
            return res.status(400).json({ error: 'Network mismatch in order' });
        }

        // Calculate order details - PRICES FROM DATABASE ONLY
        const orderItems = [];
        let subtotal = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            // Reuse already-fetched package (from DB)
            const pkg = fetchedPackages[i];

            // DEFENSIVE CHECK: Validate price source
            if (pkg.priceSource !== 'database') {
                await t.rollback();
                logger.error('CRITICAL: Price not from database', {
                    packageId: item.packageId,
                    priceSource: pkg.priceSource
                });
                return res.status(500).json({ error: 'Pricing system error. Please try again.' });
            }

            // DEFENSIVE CHECK: Price must be positive
            const itemPrice = Math.round(parseFloat(pkg.price) * 100) / 100;
            if (isNaN(itemPrice) || itemPrice <= 0) {
                await t.rollback();
                logger.error('CRITICAL: Invalid price value', {
                    packageId: item.packageId,
                    price: pkg.price
                });
                return res.status(500).json({ error: 'Pricing error. Please contact support.' });
            }

            const itemCost = pkg.costPrice ? Math.round(parseFloat(pkg.costPrice) * 100) / 100 : null;
            
            // CREATE IMMUTABLE PRICE SNAPSHOT
            // These values are locked at order creation time
            orderItems.push({
                packageId: pkg.id,
                packageName: pkg.name,
                data: pkg.data,
                // IMMUTABLE PRICE SNAPSHOT - cannot change after order creation
                price: itemPrice,
                costPrice: itemCost,
                priceLockedAt: new Date().toISOString(), // Audit timestamp
                priceSource: 'database', // Audit: confirms price came from DB
                userRole, // Audit: which role's pricing was used
                phoneNumber: item.phoneNumber,
                deliveryStatus: 'Pending'
            });

            // AUDIT LOG: Price used for this order item
            logger.info('Order item price locked', {
                packageId: pkg.id,
                price: itemPrice,
                costPrice: itemCost,
                userRole,
                phoneNumber: item.phoneNumber,
                userId: req.user.id,
                priceSource: 'database',
                priceFetchedAt: pkg.priceFetchedAt
            });

            subtotal += itemPrice;
        }

        // Round totals to 2 decimal places
        subtotal = Math.round(subtotal * 100) / 100;
        const total = subtotal;

        // Get wallet with row lock (FOR UPDATE)
        const wallet = await Wallet.findOne({ 
            where: { userId: req.user.id },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        
        if (!wallet) {
            await t.rollback();
            return res.status(400).json({ 
                error: 'Wallet not found',
                required: total,
                available: 0
            });
        }

        if (wallet.balance < total) {
            await t.rollback();
            return res.status(400).json({ 
                error: 'Insufficient wallet balance',
                required: total,
                available: wallet.balance
            });
        }

        // Store balance before for transaction record
        const balanceBefore = wallet.balance;

        // Debit wallet atomically (within transaction)
        await wallet.debit(total, { transaction: t });

        // Create one order per item — each phone number is its own order.
        // This prevents "Partially Delivered" from ever occurring and makes
        // every order visible individually on the admin dashboard.
        const createdOrders = [];
        for (const item of orderItems) {
            const oid = await generateOrderId(t);
            const singleOrder = await Order.create({
                orderId: oid,
                userId: req.user.id,
                items: [item],
                network,
                subtotal: Math.round(item.price * 100) / 100,
                total:    Math.round(item.price * 100) / 100,
                paymentStatus: 'Completed',
                paymentMethod: 'wallet',
                deliveryStatus: 'Processing'
            }, { transaction: t });
            createdOrders.push(singleOrder);
        }

        // One wallet transaction for the full batch amount.
        // Use the internal UUID (createdOrders[0].id) — not the sequential orderId —
        // so the reference is always unique even after pending orders are purged and
        // the sequence is reset by the generateOrderId init block.
        const orderIdList = createdOrders.map(o => `#${o.orderId}`).join(', ');
        const descriptionText = `Order${createdOrders.length > 1 ? 's' : ''} ${orderIdList} - ${createdOrders.length} item(s)`;
        await Transaction.create({
            userId: req.user.id,
            type: 'debit',
            amount: total,
            balanceBefore,
            balanceAfter: wallet.balance,
            description: descriptionText.substring(0, 255),
            reference: `ORDER-${createdOrders[0].id}`,
            paymentMethod: 'order',
            status: 'completed',
            orderId: createdOrders[0].id
        }, { transaction: t });

        // Commit the transaction - all operations succeed together
        await t.commit();

        // Respond to client immediately
        res.status(201).json({
            success: true,
            message: 'Order placed successfully',
            order: {
                orderId: createdOrders[0].orderId,
                items: createdOrders.length,
                total,
                network,
                deliveryStatus: 'Processing'
            },
            orders: createdOrders.map(o => ({
                orderId: o.orderId,
                total: o.total,
                network: o.network,
                deliveryStatus: o.deliveryStatus,
                item: o.items[0]
            })),
            newBalance: wallet.balance
        });

        // ===== AUTO-DELIVERY VIA MCBIS (background, after response) =====
        (async () => {
            try {
                const shouldAutoDeliver = await Setting.shouldDeliverViaMcbis(network);
                if (!shouldAutoDeliver) {
                    logger.info('Auto-delivery not enabled for network', { network });
                    for (const ord of createdOrders) {
                        const it = ord.items[0];
                        await ord.update({
                            items: [{ ...it, deliveryStatus: 'Pending', deliveryError: 'MCBIS auto-delivery is disabled' }],
                            deliveryStatus: 'Pending'
                        });
                    }
                    return;
                }

                const provider = getMcbisProvider();
                const poller = getOrderStatusPoller();

                // Check MCBIS balance ONCE before the batch
                let batchBalanceOk = true;
                try {
                    const balanceResult = await provider.getWalletBalance();
                    const bal = parseFloat(balanceResult.balance || 0);
                    if (!balanceResult.success || !balanceResult.balanceParsed) {
                        batchBalanceOk = false;
                        logger.warn('Auto-delivery: MCBIS balance unavailable, marking all orders Pending', {
                            error: balanceResult.error
                        });
                        for (const ord of createdOrders) {
                            const it = ord.items[0];
                            await ord.update({
                                items: [{ ...it, deliveryStatus: 'Pending', deliveryError: balanceResult.error || 'Unable to verify MCBIS balance' }],
                                deliveryStatus: 'Pending'
                            });
                        }
                        return;
                    }
                    if (bal < 1) {
                        batchBalanceOk = false;
                        logger.warn('Auto-delivery: MCBIS balance too low, marking all orders Pending', { balance: bal });
                        for (const ord of createdOrders) {
                            const it = ord.items[0];
                            await ord.update({
                                items: [{ ...it, deliveryStatus: 'Pending', deliveryError: `MCBIS balance too low: ₵${bal.toFixed(2)}` }],
                                deliveryStatus: 'Pending'
                            });
                        }
                        return;
                    }
                } catch (balErr) {
                    logger.warn('Auto-delivery: balance pre-check failed, marking all orders Pending', { error: balErr.message });
                    for (const ord of createdOrders) {
                        const it = ord.items[0];
                        await ord.update({
                            items: [{ ...it, deliveryStatus: 'Pending', deliveryError: balErr.message }],
                            deliveryStatus: 'Pending'
                        });
                    }
                    return;
                }

                // Dispatch each order sequentially — one item each, 500ms apart
                for (let i = 0; i < createdOrders.length; i++) {
                    const ord = createdOrders[i];
                    const item = ord.items[0];

                    if (!dispatchLock.claim(ord.id, 0)) {
                        logger.warn('Dispatch lock already held for order, skipping', { orderId: ord.orderId });
                        continue;
                    }

                    try {
                        const deliveryResult = await provider.deliverBundle({
                            orderId: ord.id,
                            itemIndex: 0,
                            network,
                            phoneNumber: item.phoneNumber,
                            dataAmount: item.data,
                            price: item.costPrice || item.price,
                            existingReference: item.providerReference
                        }, { skipBalanceCheck: batchBalanceOk });

                        let updatedItem, updatedStatus;
                        let terminalFailure = null;
                        if (deliveryResult.retryable || deliveryResult.status === 'InsufficientBalance' || deliveryResult.status === 'BalanceCheckFailed') {
                            const uncertainReference = deliveryResult.submissionUncertain
                                ? deliveryResult.attemptedReference
                                : null;
                            updatedItem = {
                                ...item,
                                deliveryStatus: 'Pending',
                                deliveryError: deliveryResult.error,
                                ...(uncertainReference ? {
                                    providerReference: uncertainReference,
                                    sentToProviderAt: new Date().toISOString(),
                                    submissionUncertain: true
                                } : {})
                            };
                            updatedStatus = 'Pending';
                            logger.warn('Retryable MCBIS dispatch issue, order stays Pending', { orderId: ord.orderId, error: deliveryResult.error });
                            if (uncertainReference) {
                                poller.startPolling({
                                    orderId: ord.id,
                                    itemIndex: 0,
                                    reference: uncertainReference,
                                    displayOrderId: ord.orderId
                                });
                            }
                        } else if (deliveryResult.reference && deliveryResult.status !== 'Failed') {
                            updatedItem = { ...item, deliveryStatus: 'Processing', providerReference: deliveryResult.reference, sentToProviderAt: new Date().toISOString() };
                            updatedStatus = 'Processing';
                            poller.startPolling({ orderId: ord.id, itemIndex: 0, reference: deliveryResult.reference, displayOrderId: ord.orderId });
                        } else if (deliveryResult.reference && deliveryResult.status === 'Failed') {
                            // Persist the provider evidence first, then use the
                            // authoritative locked transition below so the
                            // per-item wallet refund is recorded atomically.
                            updatedItem = {
                                ...item,
                                deliveryStatus: 'Processing',
                                providerReference: deliveryResult.reference,
                                sentToProviderAt: new Date().toISOString()
                            };
                            updatedStatus = 'Processing';
                            terminalFailure = deliveryResult.error || 'Delivery failed by provider';
                        } else {
                            // No provider reference means there is no proof MCBIS
                            // accepted or terminally rejected this item.
                            updatedItem = { ...item, deliveryStatus: 'Pending', deliveryError: deliveryResult.error || 'MCBIS dispatch returned no confirmed reference' };
                            updatedStatus = 'Pending';
                        }

                        await ord.update({ items: [updatedItem], deliveryStatus: updatedStatus });
                        if (terminalFailure) {
                            await poller.updateOrderItemStatus(
                                ord.id,
                                0,
                                'Failed',
                                deliveryResult.reference,
                                terminalFailure
                            );
                            updatedStatus = 'Failed';
                        }
                        logger.info('Sent to MCBIS', { orderId: ord.orderId, reference: deliveryResult.reference, status: deliveryResult.status });
                    } catch (itemError) {
                        logger.error('Failed to send order to MCBIS', { orderId: ord.orderId, error: itemError.message });
                        const it = ord.items[0];
                        await ord.update({
                            items: [{ ...it, deliveryStatus: 'Pending', deliveryError: itemError.message }],
                            deliveryStatus: 'Pending'
                        });
                    } finally {
                        dispatchLock.release(ord.id, 0);
                    }

                    if (i < createdOrders.length - 1) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                logger.info('Background MCBIS delivery complete', {
                    orderCount: createdOrders.length,
                    network,
                    processing: createdOrders.filter(o => o.deliveryStatus === 'Processing').length
                });
            } catch (deliveryError) {
                logger.error('Background auto-delivery process failed', { error: deliveryError.message });
            }
        })();
    } catch (error) {
        // Rollback on any error - all operations fail together
        await t.rollback();
        
        logger.error('Create order error', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            sql: error.sql,
            constraint: error.parent?.constraint || error.original?.constraint
        });
        
        // Handle optimistic lock error
        if (error.message.includes('modified by another transaction')) {
            return res.status(409).json({ 
                error: 'Transaction conflict. Please try again.',
                code: 'CONFLICT'
            });
        }
        
        res.status(500).json({ error: 'Failed to create order' });
    }
};

/**
 * Get user's orders
 * GET /api/orders
 */
exports.getOrders = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, network } = req.query;

        const where = { userId: req.user.id };
        if (status) where.deliveryStatus = status;
        if (network) where.network = network;

        const { count, rows: orders } = await Order.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            orders,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Failed to get orders' });
    }
};

/**
 * Get single order
 * GET /api/orders/:orderId
 */
exports.getOrder = async (req, res) => {
    try {
        const order = await Order.findOne({
            where: {
                orderId: req.params.orderId,
                userId: req.user.id
            }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({
            success: true,
            order
        });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: 'Failed to get order' });
    }
};

/**
 * Get order status
 * GET /api/orders/:orderId/status
 */
exports.getOrderStatus = async (req, res) => {
    try {
        const order = await Order.findOne({
            where: {
                orderId: req.params.orderId,
                userId: req.user.id
            },
            attributes: ['orderId', 'deliveryStatus', 'items', 'updatedAt']
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const stats = order.getDeliveryStats();

        res.json({
            success: true,
            orderId: order.orderId,
            status: order.deliveryStatus,
            stats,
            lastUpdated: order.updatedAt
        });
    } catch (error) {
        console.error('Get order status error:', error);
        res.status(500).json({ error: 'Failed to get order status' });
    }
};

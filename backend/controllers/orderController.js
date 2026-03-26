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

/**
 * Generate unique sequential order ID starting from 0001
 * MUST be called within a transaction with proper locking to prevent race conditions
 * @param {Transaction} transaction - Sequelize transaction object
 */
async function generateOrderId(transaction) {
    // Use row locking within the transaction to prevent race conditions
    const lastOrder = await Order.findOne({
        order: [['createdAt', 'DESC']],
        lock: transaction.LOCK.UPDATE,
        transaction: transaction
    });
    
    let nextNumber = 1;
    if (lastOrder && lastOrder.orderId) {
        // Extract number from existing orderId (handles both old BTU- and new numeric format)
        const match = lastOrder.orderId.match(/(\d+)/);
        if (match) {
            const num = parseInt(match[match.length - 1] || match[0]);
            // If it's a 4-digit sequential number, increment it
            if (num < 10000) {
                nextNumber = num + 1;
            } else {
                // For old format, start fresh
                const count = await Order.count({ transaction });
                nextNumber = count + 1;
            }
        }
    }
    
    return String(nextNumber).padStart(4, '0');
}

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

        // Validate all items belong to same network
        const itemNetworks = items.map(item => getNetworkFromPackageId(item.packageId));
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

        for (const item of items) {
            // CRITICAL: findPackage fetches from DATABASE ONLY
            // Pass user role for role-based pricing
            const pkg = await findPackage(item.packageId, userRole);
            
            // FAIL CLOSED: No package = No order
            if (!pkg) {
                await t.rollback();
                logger.error('Order rejected: Package not found in database', {
                    packageId: item.packageId,
                    userId: req.user.id
                });
                return res.status(400).json({ error: `Invalid package: ${item.packageId}` });
            }

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

        // Generate sequential order ID within transaction with row locking
        const orderId = await generateOrderId(t);

        // Create order (within transaction)
        const order = await Order.create({
            orderId: orderId,
            userId: req.user.id,
            items: orderItems,
            network,
            subtotal,
            total,
            paymentStatus: 'Completed',
            paymentMethod: 'wallet',
            deliveryStatus: 'Processing'
        }, { transaction: t });

        // Create transaction record (within transaction)
        await Transaction.create({
            userId: req.user.id,
            type: 'debit',
            amount: total,
            balanceBefore,
            balanceAfter: wallet.balance,
            description: `Order #${order.orderId} - ${orderItems.length} item(s)`,
            reference: `ORDER-${order.orderId}`,
            paymentMethod: 'order',
            status: 'completed',
            orderId: order.id
        }, { transaction: t });

        // Commit the transaction - all operations succeed together
        await t.commit();

        // Respond to client immediately - order is created and paid
        res.status(201).json({
            success: true,
            message: 'Order placed successfully',
            order: {
                orderId: order.orderId,
                items: order.items.length,
                total: order.total,
                network: order.network,
                deliveryStatus: order.deliveryStatus
            },
            newBalance: wallet.balance
        });

        // ===== AUTO-DELIVERY VIA MCBIS (background, after response) =====
        // Fire-and-forget: send items to MCBIS without blocking the client
        (async () => {
            try {
                const shouldAutoDeliver = await Setting.shouldDeliverViaMcbis(network);
                
                if (!shouldAutoDeliver) {
                    logger.info('Auto-delivery not enabled for network', { network });
                    return;
                }

                logger.info('Auto-delivery enabled, sending to MCBIS in background', { network, orderId: order.orderId, itemCount: orderItems.length });
                const provider = getMcbisProvider();
                const poller = getOrderStatusPoller();
                
                // Send all items to MCBIS concurrently for speed
                const deliveryPromises = orderItems.map(async (item, i) => {
                    try {
                        const deliveryResult = await provider.deliverBundle({
                            orderId: order.id,
                            itemIndex: i,
                            network: network,
                            phoneNumber: item.phoneNumber,
                            dataAmount: item.data,
                            price: item.costPrice || item.price,
                            existingReference: item.providerReference
                        });
                        
                        orderItems[i].deliveryStatus = 'Processing';
                        orderItems[i].providerReference = deliveryResult.reference;
                        orderItems[i].sentToProviderAt = new Date().toISOString();
                        
                        if (deliveryResult.reference && deliveryResult.status !== 'Failed') {
                            poller.startPolling({
                                orderId: order.id,
                                itemIndex: i,
                                reference: deliveryResult.reference,
                                displayOrderId: order.orderId
                            });
                        } else if (deliveryResult.status === 'InsufficientBalance' || deliveryResult.status === 'BalanceCheckFailed') {
                            orderItems[i].deliveryStatus = 'Pending';
                            orderItems[i].deliveryError = deliveryResult.error;
                            logger.warn('Insufficient MCBIS balance, order stays Pending', {
                                orderId: order.orderId, itemIndex: i, error: deliveryResult.error
                            });
                        } else if (deliveryResult.error) {
                            orderItems[i].deliveryStatus = 'Failed';
                            orderItems[i].deliveryError = deliveryResult.error;
                        }
                        
                        logger.info('Sent to MCBIS', {
                            orderId: order.orderId, itemIndex: i,
                            reference: deliveryResult.reference, status: deliveryResult.status
                        });
                    } catch (itemError) {
                        logger.error('Failed to send item to MCBIS', {
                            orderId: order.orderId, itemIndex: i, error: itemError.message
                        });
                        orderItems[i].deliveryStatus = 'Failed';
                        orderItems[i].deliveryError = itemError.message;
                    }
                });

                await Promise.all(deliveryPromises);
                
                // Update order with delivery statuses
                const anyProcessing = orderItems.some(i => i.deliveryStatus === 'Processing');
                const allPending = orderItems.every(i => i.deliveryStatus === 'Pending');
                await order.update({
                    items: orderItems,
                    deliveryStatus: allPending ? 'Pending' : anyProcessing ? 'Processing' : 'Pending'
                });
                
                logger.info('Background MCBIS delivery complete', {
                    orderId: order.orderId,
                    processing: orderItems.filter(i => i.deliveryStatus === 'Processing').length,
                    failed: orderItems.filter(i => i.deliveryStatus === 'Failed').length
                });
            } catch (deliveryError) {
                logger.error('Background auto-delivery process failed', {
                    orderId: order.orderId, error: deliveryError.message
                });
            }
        })();
    } catch (error) {
        // Rollback on any error - all operations fail together
        await t.rollback();
        
        console.error('Create order error:', error);
        
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

/**
 * Developer API Controller
 * Public endpoints for external websites using API keys
 * Mirrors the core order flow but authenticated via X-API-Key
 */

const { Order, Wallet, Transaction, Setting, User, Package } = require('../models');
const { sequelize } = require('../config/database');
const { getAllPackagesForRole, findPackage, getNetworkFromPackageId, getPriceForRole } = require('../config/packages');
const logger = require('../utils/logger');

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

/**
 * Generate unique sequential order ID (same as orderController)
 */
async function generateOrderId(transaction) {
    const lastOrder = await Order.findOne({
        order: [['createdAt', 'DESC']],
        lock: transaction.LOCK.UPDATE,
        transaction
    });
    let nextNumber = 1;
    if (lastOrder && lastOrder.orderId) {
        const match = lastOrder.orderId.match(/(\d+)/);
        if (match) {
            const num = parseInt(match[match.length - 1] || match[0]);
            if (num < 10000) {
                nextNumber = num + 1;
            } else {
                const count = await Order.count({ transaction });
                nextNumber = count + 1;
            }
        }
    }
    return String(nextNumber).padStart(4, '0');
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
    const t = await sequelize.transaction();

    try {
        const { items, network } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, error: 'items array is required.' });
        }

        if (!network) {
            await t.rollback();
            return res.status(400).json({ success: false, error: 'network is required (MTN, AirtelTigo, Telecel).' });
        }

        if (items.length > 10) {
            await t.rollback();
            return res.status(400).json({ success: false, error: 'Maximum 10 items per order.' });
        }

        const userRole = req.user.role || 'agent';

        // Validate phone numbers
        const phoneRegex = /^0[2-59]\d{8}$/;
        for (const item of items) {
            if (!item.phoneNumber || !phoneRegex.test(item.phoneNumber)) {
                await t.rollback();
                return res.status(400).json({ success: false, error: `Invalid phone number: ${item.phoneNumber || '(missing)'}. Use Ghana format e.g. 0241234567` });
            }
            if (!item.packageId) {
                await t.rollback();
                return res.status(400).json({ success: false, error: 'Each item requires a packageId.' });
            }
        }

        // Validate networks match
        const itemNetworks = items.map(item => getNetworkFromPackageId(item.packageId));
        const uniqueNetworks = [...new Set(itemNetworks)];
        if (uniqueNetworks.length > 1) {
            await t.rollback();
            return res.status(400).json({ success: false, error: 'All items must be from the same network.' });
        }
        if (uniqueNetworks[0] !== network) {
            await t.rollback();
            return res.status(400).json({ success: false, error: 'Network mismatch between items and specified network.' });
        }

        // Build order items with price snapshots
        const orderItems = [];
        let subtotal = 0;

        for (const item of items) {
            const pkg = await findPackage(item.packageId, userRole);
            if (!pkg) {
                await t.rollback();
                return res.status(400).json({ success: false, error: `Invalid package: ${item.packageId}` });
            }
            if (pkg.priceSource !== 'database') {
                await t.rollback();
                return res.status(500).json({ success: false, error: 'Pricing system error.' });
            }

            const itemPrice = Math.round(parseFloat(pkg.price) * 100) / 100;
            if (isNaN(itemPrice) || itemPrice <= 0) {
                await t.rollback();
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

        // Auto-delivery via MCBIS (same as core order flow)
        try {
            const shouldAutoDeliver = await Setting.shouldDeliverViaMcbis(network);
            if (shouldAutoDeliver) {
                const provider = getMcbisProvider();
                const poller = getOrderStatusPoller();

                for (let i = 0; i < orderItems.length; i++) {
                    try {
                        const deliveryResult = await provider.deliverBundle({
                            orderId: order.id,
                            itemIndex: i,
                            network,
                            phoneNumber: orderItems[i].phoneNumber,
                            dataAmount: orderItems[i].data,
                            price: orderItems[i].costPrice || orderItems[i].price,
                            existingReference: orderItems[i].providerReference
                        });
                        if (deliveryResult.reference) {
                            poller.startPolling({
                                orderId: order.id,
                                itemIndex: i,
                                reference: deliveryResult.reference,
                                displayOrderId: order.orderId
                            });
                        }
                    } catch (deliveryError) {
                        logger.error('API order auto-delivery failed for item', { orderId: order.orderId, itemIndex: i, error: deliveryError.message });
                    }
                }
            }
        } catch (autoDeliveryError) {
            logger.error('API order auto-delivery error', { orderId: order.orderId, error: autoDeliveryError.message });
        }

        res.status(201).json({
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
        logger.error('Developer API create order error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ success: false, error: 'Failed to create order.' });
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
        const order = await Order.findOne({
            where: { id: req.params.orderId, userId: req.user.id }
        });

        if (!order) {
            // Also try by orderId (the sequential one)
            const orderBySeqId = await Order.findOne({
                where: { orderId: req.params.orderId, userId: req.user.id }
            });
            if (!orderBySeqId) {
                return res.status(404).json({ success: false, error: 'Order not found.' });
            }
            return res.json({ success: true, order: formatOrder(orderBySeqId) });
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

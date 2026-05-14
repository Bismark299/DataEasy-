/**
 * Admin Controller
 * Dashboard, order management, user management
 * Updated for PostgreSQL/Sequelize
 * With audit logging and wallet adjustment limits
 */

const { User, Order, Wallet, Transaction, AdminAuditLog, Package, Setting, sequelize } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { packages, clearPackagesCache } = require('../config/packages');
const logger = require('../utils/logger');
const { invalidateCache } = require('../middleware/cache');

// Configuration constants

const REQUIRE_DESCRIPTION_ABOVE = 100; // Require description for amounts > GH₵100

/**
 * Helper to get client IP address
 */
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.ip;
}

/**
 * Get dashboard statistics
 * GET /api/admin/stats
 */
exports.getStats = async (req, res) => {
    try {
        // Use Ghana time (GMT/UTC+0) for "today" calculation
        const now = new Date();
        // Ghana is GMT+0, so we use UTC directly
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

        // Get total wallet balance across all users
        const totalWalletBalance = await Wallet.sum('balance') || 0;

        // Get today's orders (all statuses)
        const todayAllOrders = await Order.findAll({
            where: { 
                createdAt: { 
                    [Op.gte]: todayStart,
                    [Op.lte]: todayEnd
                }
            }
        });

        // Calculate today's stats
        let itemsToday = 0;
        let amountToday = 0;
        let bundleToday = 0;
        let profitToday = 0;
        let completedItemsToday = 0;
        let completedAmountToday = 0;
        let completedBundleToday = 0;
        
        // Per-network stats for today
        let networkStatsToday = {
            MTN: { items: 0, amount: 0, bundle: 0, pending: 0, completed: 0 },
            Telecel: { items: 0, amount: 0, bundle: 0, pending: 0, completed: 0 },
            AirtelTigo: { items: 0, amount: 0, bundle: 0, pending: 0, completed: 0 }
        };

        todayAllOrders.forEach(order => {
            const items = order.items || [];
            const network = order.network || 'MTN';
            
            items.forEach(item => {
                const itemPrice = parseFloat(item.price) || 0;
                const itemCost = parseFloat(item.costPrice) || 0;
                const itemStatus = (item.deliveryStatus || order.deliveryStatus || 'Pending').toLowerCase();
                
                // Parse bundle capacity
                let itemBundle = 0;
                const match = (item.packageName || item.data || '').match(/(\d+)\s*(GB|MB)/i);
                if (match) {
                    itemBundle = match[2].toUpperCase() === 'GB' 
                        ? parseFloat(match[1]) 
                        : parseFloat(match[1]) / 1024;
                }
                
                // Count all items for today
                itemsToday++;
                amountToday += itemPrice;
                bundleToday += itemBundle;
                
                // Network-specific counts
                if (networkStatsToday[network]) {
                    networkStatsToday[network].items++;
                    networkStatsToday[network].amount += itemPrice;
                    networkStatsToday[network].bundle += itemBundle;
                    
                    if (itemStatus === 'pending') {
                        networkStatsToday[network].pending++;
                    } else if (itemStatus === 'delivered' || itemStatus === 'completed') {
                        networkStatsToday[network].completed++;
                    }
                }
                
                // Completed items stats
                if (itemStatus === 'delivered' || itemStatus === 'completed') {
                    completedItemsToday++;
                    completedAmountToday += itemPrice;
                    completedBundleToday += itemBundle;
                    profitToday += (itemPrice - itemCost);
                }
            });
        });

        const [
            totalUsers,
            totalOrders,
            pendingOrders,
            processingOrders
        ] = await Promise.all([
            User.count(),
            Order.count(),
            Order.count({ where: { deliveryStatus: 'Pending' } }),
            Order.count({ where: { deliveryStatus: 'Processing' } })
        ]);

        res.json({
            success: true,
            stats: {
                // Totals
                totalUsers,
                totalOrders,
                totalWalletBalance: Math.round(parseFloat(totalWalletBalance) * 100) / 100,
                pendingOrders,
                processingOrders,
                
                // Today's stats (all orders placed today)
                itemsToday,
                amountToday: Math.round(amountToday * 100) / 100,
                bundleToday: Math.round(bundleToday * 100) / 100,
                
                // Today's completed only
                completedItemsToday,
                completedAmountToday: Math.round(completedAmountToday * 100) / 100,
                completedBundleToday: Math.round(completedBundleToday * 100) / 100,
                profitToday: Math.round(profitToday * 100) / 100,
                
                // Per-network today
                networkStatsToday,
                
                // Ghana date for display
                ghanaDate: todayStart.toISOString().split('T')[0]
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
};

/**
 * Get dashboard data (stats + recent orders)
 * GET /api/admin/dashboard
 */
exports.getDashboard = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalUsers, todayOrders, pendingDeliveries, todayRevenue, recentOrders, statusStats] = await Promise.all([
            User.count(),
            Order.count({ where: { createdAt: { [Op.gte]: today } } }),
            Order.count({ where: { deliveryStatus: { [Op.in]: ['Pending', 'Processing'] } } }),
            Order.sum('total', { where: { createdAt: { [Op.gte]: today } } }),
            Order.findAll({
                include: [{ model: User, as: 'user', attributes: ['fullName', 'email', 'agentCode'] }],
                order: [['createdAt', 'DESC']],
                limit: 10
            }),
            Order.findAll({
                attributes: ['deliveryStatus', [fn('COUNT', col('id')), 'count']],
                group: ['deliveryStatus'],
                raw: true
            })
        ]);

        const ordersByStatus = {};
        statusStats.forEach(item => {
            if (item.deliveryStatus) ordersByStatus[item.deliveryStatus] = parseInt(item.count);
        });

        res.json({
            success: true,
            stats: {
                totalUsers,
                todayOrders,
                pendingDeliveries,
                todayRevenue: todayRevenue || 0
            },
            recentOrders: recentOrders.map(order => ({
                id: order.id,
                orderId: order.orderId,
                userId: order.userId,
                customer: order.user?.fullName || 'Unknown',
                user: order.user ? {
                    fullName: order.user.fullName,
                    email: order.user.email,
                    agentCode: order.user.agentCode
                } : null,
                email: order.user?.email,
                network: order.network,
                total: order.total,
                items: order.items, // Full items array for expanded display
                itemCount: order.items.length,
                paymentStatus: order.paymentStatus,
                deliveryStatus: order.deliveryStatus,
                createdAt: order.createdAt
            })),
            ordersByStatus
        });
    } catch (error) {
        console.error('Get dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
};

/**
 * Get all orders (admin)
 * GET /api/admin/orders
 */
exports.getAllOrders = async (req, res) => {
    try {
        const { page = 1, limit = 50, status, network, search, dateFrom, dateTo, paymentStatus, userId } = req.query;

        const where = {};
        if (status && status !== 'all') where.deliveryStatus = status;
        if (network && network !== 'all') where.network = network;
        if (search) where.orderId = { [Op.iLike]: `%${search}%` };
        if (paymentStatus && paymentStatus !== 'all') where.paymentStatus = paymentStatus;
        if (userId) where.userId = userId;

        // Server-side date filtering
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) {
                where.createdAt[Op.gte] = new Date(dateFrom);
            }
            if (dateTo) {
                const to = new Date(dateTo);
                to.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = to;
            }
        }

        const { count, rows: orders } = await Order.findAndCountAll({
            where,
            include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'email', 'phone', 'agentCode'] }],
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            orders: orders.map(order => ({
                id: order.id,
                orderId: order.orderId,
                userId: order.userId,
                user: order.user ? {
                    id: order.user.id,
                    fullName: order.user.fullName,
                    name: order.user.fullName,
                    email: order.user.email,
                    phone: order.user.phone,
                    agentCode: order.user.agentCode
                } : null,
                customer: {
                    name: order.user?.fullName || 'Unknown',
                    email: order.user?.email,
                    phone: order.user?.phone
                },
                network: order.network,
                items: order.items,
                itemCount: order.items.length,
                total: order.total,
                paymentStatus: order.paymentStatus,
                deliveryStatus: order.deliveryStatus,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get all orders error:', error);
        res.status(500).json({ error: 'Failed to get orders' });
    }
};

/**
 * Get single order (admin)
 * GET /api/admin/orders/:orderId
 */
exports.getOrder = async (req, res) => {
    try {
        const order = await Order.findOne({
            where: { orderId: req.params.orderId },
            include: [{ model: User, as: 'user', attributes: ['fullName', 'email', 'phone'] }]
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
 * Update order status (with audit logging)
 * PUT /api/admin/orders/:orderId/status
 */
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Delivered', 'Failed'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const order = await Order.findOne({ where: { orderId: req.params.orderId } });
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const previousStatus = order.deliveryStatus;

        // Update all items status
        const items = order.items.map(item => ({
            ...item,
            deliveryStatus: status,
            deliveredAt: status === 'Delivered' ? new Date() : item.deliveredAt
        }));

        order.items = items;
        order.deliveryStatus = status;
        order.processedBy = req.admin?.username || 'admin';
        order.processedAt = new Date();
        await order.save();
        invalidateCache('/admin/orders');

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_ORDER_STATUS',
            targetType: 'order',
            targetId: order.orderId,
            previousValue: { deliveryStatus: previousStatus },
            newValue: { deliveryStatus: status },
            description: `Changed order ${order.orderId} status from ${previousStatus} to ${status}`
        });

        res.json({
            success: true,
            message: `Order #${order.orderId} updated to ${status}`,
            order: {
                orderId: order.orderId,
                deliveryStatus: order.deliveryStatus
            }
        });
    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
};

/**
 * Update individual item status
 * PUT /api/admin/orders/:orderId/item/:itemIndex/status
 */
exports.updateItemStatus = async (req, res) => {
    try {
        const { status, failureReason } = req.body;
        const { orderId, itemIndex } = req.params;
        const validStatuses = ['Pending', 'Processing', 'Delivered', 'Failed'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        // Search by primary key (id) which is a UUID
        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const idx = parseInt(itemIndex);
        if (idx < 0 || idx >= order.items.length) {
            return res.status(404).json({ error: 'Item not found' });
        }

        // Update the specific item
        const items = [...order.items];
        items[idx] = {
            ...items[idx],
            deliveryStatus: status,
            deliveredAt: status === 'Delivered' ? new Date() : items[idx].deliveredAt,
            failureReason: status === 'Failed' ? failureReason : items[idx].failureReason
        };

        order.items = items;
        await order.updateDeliveryStatus();
        invalidateCache('/admin/orders');

        res.json({
            success: true,
            message: `Item updated to ${status}`,
            orderStatus: order.deliveryStatus
        });
    } catch (error) {
        console.error('Update item status error:', error);
        res.status(500).json({ error: 'Failed to update item' });
    }
};

/**
 * Match orders by phone + data size and mark as Delivered
 * PUT /api/admin/orders/match-complete
 * Body: { entries: [{ phone: "0555546229", data: "2" }, ...] }
 */
exports.matchAndCompleteOrders = async (req, res) => {
    try {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'No entries provided' });
        }

        // Get all non-terminal orders (Pending or Processing)
        const orders = await Order.findAll({
            where: {
                deliveryStatus: { [Op.in]: ['Pending', 'Processing'] }
            },
            order: [['createdAt', 'DESC']]
        });

        let matched = 0;
        const updatedOrders = new Set();

        for (const entry of entries) {
            const phone = (entry.phone || '').replace(/\s+/g, '').replace(/^\+233/, '0');
            const dataSize = (entry.data || '').toString().trim();
            if (!phone || !dataSize) continue;

            let found = false;

            for (const order of orders) {
                const items = order.items || [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const itemStatus = (item.deliveryStatus || 'Pending').toLowerCase();
                    if (itemStatus !== 'pending' && itemStatus !== 'processing') continue;

                    const itemPhone = (item.phoneNumber || '').replace(/\s+/g, '').replace(/^\+233/, '0');
                    if (itemPhone !== phone) continue;

                    // Extract numeric data size from item.data (e.g., "2GB" -> "2", "10GB" -> "10")
                    const itemDataMatch = (item.data || item.packageName || '').match(/(\d+(?:\.\d+)?)\s*(?:GB|MB)?/i);
                    const itemDataNum = itemDataMatch ? itemDataMatch[1] : '';

                    if (itemDataNum === dataSize) {
                        items[i] = {
                            ...item,
                            deliveryStatus: 'Delivered',
                            deliveredAt: new Date()
                        };
                        matched++;
                        found = true;
                        updatedOrders.add(order);
                        break; // One match per entry
                    }
                }
                if (found) break;
            }

        }

        // Save all updated orders
        for (const order of updatedOrders) {
            order.items = order.items.map(item => ({ ...item }));
            order.changed('items', true);
            await order.updateDeliveryStatus();
        }

        res.json({ success: true, matched });
    } catch (error) {
        console.error('Match and complete error:', error);
        res.status(500).json({ error: 'Failed to match and complete orders' });
    }
};

/**
 * Bulk update item statuses across multiple orders
 * PUT /api/admin/orders/bulk-item-status
 * Body: { items: [{ orderId, itemIndex }], status }
 */
exports.bulkUpdateItemStatus = async (req, res) => {
    try {
        const { items, status, failureReason } = req.body;
        const validStatuses = ['Pending', 'Processing', 'Delivered', 'Failed'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }

        // Group items by orderId to minimize DB queries
        const byOrder = {};
        for (const item of items) {
            if (!byOrder[item.orderId]) byOrder[item.orderId] = [];
            byOrder[item.orderId].push(parseInt(item.itemIndex));
        }

        let updated = 0;
        let failed = 0;

        for (const [orderId, indices] of Object.entries(byOrder)) {
            try {
                const order = await Order.findByPk(orderId);
                if (!order) { failed += indices.length; continue; }

                const orderItems = [...order.items];
                for (const idx of indices) {
                    if (idx >= 0 && idx < orderItems.length) {
                        orderItems[idx] = {
                            ...orderItems[idx],
                            deliveryStatus: status,
                            deliveredAt: status === 'Delivered' ? new Date() : orderItems[idx].deliveredAt,
                            failureReason: status === 'Failed' ? failureReason : orderItems[idx].failureReason
                        };
                        updated++;
                    } else {
                        failed++;
                    }
                }

                order.items = orderItems;
                await order.updateDeliveryStatus();
            } catch (err) {
                console.error('Bulk update error for order', orderId, err);
                failed += indices.length;
            }
        }

        res.json({ success: true, updated, failed });
    } catch (error) {
        console.error('Bulk item status error:', error);
        res.status(500).json({ error: 'Failed to bulk update items' });
    }
};

/**
 * Get all users (admin)
 * GET /api/admin/users
 * OPTIMIZED: Uses aggregated queries instead of N+1 pattern
 */
exports.getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 50, search, status, role, name, phone, email, agentCode } = req.query;

        const where = {};
        if (search) {
            where[Op.or] = [
                { fullName: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
                { phone: { [Op.iLike]: `%${search}%` } },
                { agentCode: { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (name) where.fullName = { [Op.iLike]: `%${name}%` };
        if (phone) where.phone = { [Op.iLike]: `%${phone}%` };
        if (email) where.email = { [Op.iLike]: `%${email}%` };
        if (agentCode) where.agentCode = { [Op.iLike]: `%${agentCode}%` };
        if (role) where.role = role;
        if (status === 'active') where.isActive = true;
        if (status === 'inactive') where.isActive = false;

        // Get users with wallet in single query
        const { count, rows: users } = await User.findAndCountAll({
            where,
            include: [{ model: Wallet, as: 'wallet', attributes: ['balance'] }],
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit),
            attributes: { exclude: ['password'] }
        });

        if (users.length === 0) {
            return res.json({
                success: true,
                users: [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: count,
                    pages: Math.ceil(count / limit)
                }
            });
        }

        const userIds = users.map(u => u.id);

        // OPTIMIZED: Batch query for total loads (Paystack deposits + admin credits + MoMo) per user
        const loadsResult = await Transaction.findAll({
            attributes: [
                'userId',
                [fn('SUM', col('amount')), 'totalLoads']
            ],
            where: { 
                userId: { [Op.in]: userIds }, 
                type: 'credit', 
                status: 'completed',
                paymentMethod: { [Op.in]: ['paystack', 'manual', 'momo'] }  // Deposits + admin credits + MoMo
            },
            group: ['userId'],
            raw: true
        });
        const loadsMap = {};
        loadsResult.forEach(r => { loadsMap[r.userId] = parseFloat(r.totalLoads) || 0; });

        // OPTIMIZED: Batch query for total orders (sum) per user
        const ordersResult = await Order.findAll({
            attributes: [
                'userId',
                [fn('SUM', col('total')), 'totalOrders']
            ],
            where: { userId: { [Op.in]: userIds } },
            group: ['userId'],
            raw: true
        });
        const ordersMap = {};
        ordersResult.forEach(r => { ordersMap[r.userId] = parseFloat(r.totalOrders) || 0; });

        // OPTIMIZED: Batch query for completed orders (for profit calculation)
        const completedOrders = await Order.findAll({
            where: { 
                userId: { [Op.in]: userIds },
                deliveryStatus: 'Delivered'
            },
            attributes: ['userId', 'items', 'total'],
            raw: true
        });

        // Get package cost map (single query)
        const allPackages = await Package.findAll({ attributes: ['id', 'costPrice'], raw: true });
        const packageCostMap = {};
        allPackages.forEach(pkg => { packageCostMap[pkg.id] = parseFloat(pkg.costPrice || 0); });

        // Pre-calculate stats per user from completed orders
        const userStats = {};
        userIds.forEach(id => {
            userStats[id] = { totalDataGB: 0, totalCost: 0, totalRevenue: 0 };
        });

        completedOrders.forEach(order => {
            const items = order.items || [];
            items.forEach(item => {
                const itemStatus = (item.deliveryStatus || '').toLowerCase();
                if (itemStatus === 'delivered' || itemStatus === 'completed') {
                    // Data capacity
                    const dataMatch = item.data?.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
                    if (dataMatch) {
                        const amount = parseFloat(dataMatch[1]);
                        const unit = dataMatch[2].toUpperCase();
                        userStats[order.userId].totalDataGB += unit === 'GB' ? amount : amount / 1024;
                    }
                    
                    // Revenue
                    userStats[order.userId].totalRevenue += parseFloat(item.price || 0);
                    
                    // Cost
                    const itemCost = item.costPrice ? parseFloat(item.costPrice) : (packageCostMap[item.packageId] || 0);
                    userStats[order.userId].totalCost += itemCost;
                }
            });
        });

        // Build response with pre-calculated stats
        const usersWithStats = users.map(user => {
            const stats = userStats[user.id] || { totalDataGB: 0, totalCost: 0, totalRevenue: 0 };
            const profit = stats.totalRevenue - stats.totalCost;

            return {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                agentCode: user.agentCode,
                role: user.role || 'agent',
                isActive: user.isActive,
                isVerified: user.isVerified,
                walletBalance: user.wallet?.balance || 0,
                wallet: user.wallet ? { balance: user.wallet.balance } : { balance: 0 },
                totalLoads: loadsMap[user.id] || 0,
                totalOrders: ordersMap[user.id] || 0,
                totalDataGB: Math.round(stats.totalDataGB * 100) / 100,
                totalCost: Math.round(stats.totalCost * 100) / 100,
                profit: Math.round(profit * 100) / 100,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin
            };
        });

        res.json({
            success: true,
            users: usersWithStats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
};

/**
 * Get single user (admin)
 * GET /api/admin/users/:userId
 */
exports.getUser = async (req, res) => {
    try {
        const user = await User.findByPk(req.params.userId, {
            include: [
                { model: Wallet, as: 'wallet' },
                { model: Order, as: 'orders', limit: 10, order: [['createdAt', 'DESC']] }
            ],
            attributes: { exclude: ['password'] }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
};

/**
 * Update user details (admin) with audit logging
 * PUT /api/admin/users/:userId
 */
exports.updateUser = async (req, res) => {
    try {
        const { fullName, email, phone, role, isActive, password } = req.body;
        const validRoles = ['super-dealer', 'dealer', 'super-agent', 'agent'];

        const user = await User.findByPk(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const previousValues = {
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isActive: user.isActive
        };

        // Update fields if provided
        if (fullName) user.fullName = fullName;
        if (email) user.email = email;
        if (phone) user.phone = phone;
        if (role && validRoles.includes(role)) user.role = role;
        if (typeof isActive === 'boolean') user.isActive = isActive;
        if (password && password.length >= 6) user.password = password;

        await user.save();

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_USER',
            targetType: 'user',
            targetId: user.id,
            previousValue: previousValues,
            newValue: { fullName: user.fullName, email: user.email, phone: user.phone, role: user.role, isActive: user.isActive },
            description: `Updated user ${user.email}`
        });

        res.json({
            success: true,
            message: 'User updated successfully',
            user: user.toSafeObject()
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
};

/**
 * Update user status (admin) with audit logging
 * PUT /api/admin/users/:userId/status
 */
exports.updateUserStatus = async (req, res) => {
    try {
        const { isActive } = req.body;

        const user = await User.findByPk(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const previousStatus = user.isActive;
        user.isActive = isActive;
        await user.save();

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_USER_STATUS',
            targetType: 'user',
            targetId: user.id,
            previousValue: { isActive: previousStatus },
            newValue: { isActive: isActive },
            description: `${isActive ? 'Activated' : 'Deactivated'} user ${user.email}`
        });

        res.json({
            success: true,
            message: `User ${isActive ? 'activated' : 'deactivated'}`,
            user: user.toSafeObject()
        });
    } catch (error) {
        console.error('Update user status error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
};

/**
 * Adjust user wallet (admin) with limits and audit logging
 * POST /api/admin/users/:userId/wallet
 */
exports.adjustWallet = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { type, description } = req.body;
        // Round amount to 2 decimal places
        const amount = Math.round(parseFloat(req.body.amount) * 100) / 100;

        // Validate amount
        if (!amount || amount <= 0 || isNaN(amount)) {
            await t.rollback();
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const user = await User.findByPk(req.params.userId, { transaction: t });
        if (!user) {
            await t.rollback();
            return res.status(404).json({ error: 'User not found' });
        }

        let wallet = await Wallet.findOne({ 
            where: { userId: user.id },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        
        if (!wallet) {
            wallet = await Wallet.create({ userId: user.id }, { transaction: t });
        }

        const balanceBefore = wallet.balance;

        if (type === 'credit') {
            await wallet.credit(amount, { transaction: t });
        } else if (type === 'debit') {
            if (wallet.balance < amount) {
                await t.rollback();
                return res.status(400).json({ error: 'Insufficient balance' });
            }
            await wallet.debit(amount, { transaction: t });
        } else {
            await t.rollback();
            return res.status(400).json({ error: 'Invalid type' });
        }

        // Create transaction record
        await Transaction.create({
            userId: user.id,
            type,
            amount,
            balanceBefore,
            balanceAfter: wallet.balance,
            description: description || `Manual ${type} by admin`,
            reference: `ADMIN-${Date.now()}`,
            paymentMethod: 'manual',
            status: 'completed'
        }, { transaction: t });

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'WALLET_ADJUSTMENT',
            targetType: 'wallet',
            targetId: wallet.id,
            previousValue: { balance: balanceBefore },
            newValue: { balance: wallet.balance, adjustment: amount, type },
            description: description || `Manual ${type} of GH₵${amount.toFixed(2)} for user ${user.email}`
        });

        // Commit transaction
        await t.commit();

        res.json({
            success: true,
            message: `Wallet ${type}ed with GH₵${amount.toFixed(2)}`,
            newBalance: wallet.balance
        });
    } catch (error) {
        await t.rollback();
        console.error('Adjust wallet error:', error);
        res.status(500).json({ error: 'Failed to adjust wallet' });
    }
};

/**
 * Get all transactions (admin)
 * GET /api/admin/transactions
 */
exports.getAllTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 50, type, status, userId, paymentMethod, dateFrom, dateTo } = req.query;

        const where = {};
        if (type) where.type = type;
        if (status) where.status = status;
        if (userId) where.userId = userId;
        if (paymentMethod) where.paymentMethod = paymentMethod;
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
            if (dateTo) {
                const to = new Date(dateTo);
                to.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = to;
            }
        }

        const { count, rows: transactions } = await Transaction.findAndCountAll({
            where,
            include: [{ model: User, as: 'user', attributes: ['fullName', 'email', 'agentCode'] }],
            order: [['createdAt', 'DESC']],
            offset: (page - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            transactions: transactions.map(tx => ({
                id: tx.id,
                user: {
                    name: tx.user?.fullName || 'Unknown',
                    email: tx.user?.email,
                    agentCode: tx.user?.agentCode || 'N/A'
                },
                type: tx.type,
                amount: tx.amount,
                balanceBefore: tx.balanceBefore,
                balanceAfter: tx.balanceAfter,
                description: tx.description,
                reference: tx.reference,
                paymentMethod: tx.paymentMethod,
                status: tx.status,
                createdAt: tx.createdAt
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get all transactions error:', error);
        res.status(500).json({ error: 'Failed to get transactions' });
    }
};

/**
 * Get packages (admin)
 * GET /api/admin/packages
 */
exports.getPackages = async (req, res) => {
    try {
        const { network } = req.query;
        
        // Try to get from database first
        let dbPackages = await Package.getAllForAdmin(network);
        
        // If no packages in DB, seed defaults
        if (dbPackages.length === 0) {
            await Package.seedDefaults();
            dbPackages = await Package.getAllForAdmin(network);
        }

        // Group by network for frontend
        const grouped = {
            MTN: [],
            AirtelTigo: [],
            Telecel: []
        };

        dbPackages.forEach(pkg => {
            if (grouped[pkg.network]) {
                grouped[pkg.network].push({
                    id: pkg.id,
                    name: pkg.name,
                    data: pkg.data,
                    validity: pkg.validity,
                    price: parseFloat(pkg.price),
                    costPrice: pkg.costPrice ? parseFloat(pkg.costPrice) : null,
                    superDealerPrice: pkg.superDealerPrice ? parseFloat(pkg.superDealerPrice) : null,
                    dealerPrice: pkg.dealerPrice ? parseFloat(pkg.dealerPrice) : null,
                    superAgentPrice: pkg.superAgentPrice ? parseFloat(pkg.superAgentPrice) : null,
                    popular: pkg.popular,
                    isActive: pkg.isActive,
                    sortOrder: pkg.sortOrder
                });
            }
        });

        res.json({
            success: true,
            packages: grouped,
            total: dbPackages.length
        });
    } catch (error) {
        logger.error('Get packages error', { error: error.message });
        // Fallback to static packages
        res.json({
            success: true,
            packages,
            source: 'static'
        });
    }
};

/**
 * Update package price (admin)
 * PUT /api/admin/packages/:id
 * 
 * ⚠️ CRITICAL: This updates the AUTHORITATIVE price source
 * All cache is invalidated after update
 */
exports.updatePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const { price, costPrice, superDealerPrice, dealerPrice, superAgentPrice, popular, isActive, validity, sortOrder } = req.body;

        const pkg = await Package.findByPk(id);
        if (!pkg) {
            return res.status(404).json({ error: 'Package not found' });
        }

        // Store previous values for audit trail
        const previousValue = {
            price: parseFloat(pkg.price),
            costPrice: pkg.costPrice ? parseFloat(pkg.costPrice) : null,
            superDealerPrice: pkg.superDealerPrice ? parseFloat(pkg.superDealerPrice) : null,
            dealerPrice: pkg.dealerPrice ? parseFloat(pkg.dealerPrice) : null,
            superAgentPrice: pkg.superAgentPrice ? parseFloat(pkg.superAgentPrice) : null,
            popular: pkg.popular,
            isActive: pkg.isActive
        };

        // Track if price changed for enhanced logging
        let priceChanged = false;
        let costPriceChanged = false;

        // Update fields if provided
        if (price !== undefined) {
            if (price < 0) {
                return res.status(400).json({ error: 'Price cannot be negative' });
            }
            if (parseFloat(price) !== parseFloat(pkg.price)) {
                priceChanged = true;
                logger.info('PRICE CHANGE DETECTED', {
                    packageId: id,
                    oldPrice: parseFloat(pkg.price),
                    newPrice: parseFloat(price),
                    adminId: req.user?.id,
                    adminEmail: req.user?.email,
                    timestamp: new Date().toISOString()
                });
            }
            pkg.price = price;
        }
        if (costPrice !== undefined) {
            const oldCost = pkg.costPrice ? parseFloat(pkg.costPrice) : null;
            const newCost = costPrice ? parseFloat(costPrice) : null;
            if (oldCost !== newCost) {
                costPriceChanged = true;
                logger.info('COST PRICE CHANGE DETECTED', {
                    packageId: id,
                    oldCostPrice: oldCost,
                    newCostPrice: newCost,
                    adminId: req.user?.id,
                    adminEmail: req.user?.email,
                    timestamp: new Date().toISOString()
                });
            }
            pkg.costPrice = costPrice;
        }
        // Update role-based prices
        if (superDealerPrice !== undefined) {
            pkg.superDealerPrice = superDealerPrice;
            logger.info('SUPER_DEALER_PRICE CHANGE', {
                packageId: id,
                oldPrice: previousValue.superDealerPrice,
                newPrice: parseFloat(superDealerPrice)
            });
        }
        if (dealerPrice !== undefined) {
            pkg.dealerPrice = dealerPrice;
            logger.info('DEALER_PRICE CHANGE', {
                packageId: id,
                oldPrice: previousValue.dealerPrice,
                newPrice: parseFloat(dealerPrice)
            });
        }
        if (superAgentPrice !== undefined) {
            pkg.superAgentPrice = superAgentPrice;
            logger.info('SUPER_AGENT_PRICE CHANGE', {
                packageId: id,
                oldPrice: previousValue.superAgentPrice,
                newPrice: parseFloat(superAgentPrice)
            });
        }
        if (popular !== undefined) pkg.popular = popular;
        if (isActive !== undefined) pkg.isActive = isActive;
        if (validity !== undefined) pkg.validity = validity;
        if (sortOrder !== undefined) pkg.sortOrder = sortOrder;

        await pkg.save();

        // CRITICAL: Clear cache IMMEDIATELY after price update
        // This ensures all subsequent orders use the new price
        clearPackagesCache();
        invalidateCache('packages'); // Also clear API response cache
        logger.info('Package cache invalidated after update', { packageId: id });

        // Log admin action with detailed audit trail
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_PACKAGE',
            targetType: 'package',
            targetId: pkg.id,
            previousValue,
            newValue: {
                price: parseFloat(pkg.price),
                costPrice: pkg.costPrice ? parseFloat(pkg.costPrice) : null,
                superDealerPrice: pkg.superDealerPrice ? parseFloat(pkg.superDealerPrice) : null,
                dealerPrice: pkg.dealerPrice ? parseFloat(pkg.dealerPrice) : null,
                superAgentPrice: pkg.superAgentPrice ? parseFloat(pkg.superAgentPrice) : null,
                popular: pkg.popular,
                isActive: pkg.isActive
            },
            description: `Updated package ${pkg.name} (${pkg.network}): price GH₵${pkg.price}${priceChanged ? ' [PRICE CHANGED]' : ''}${costPriceChanged ? ' [COST CHANGED]' : ''}`
        });

        res.json({
            success: true,
            message: `Package ${pkg.name} updated successfully`,
            package: {
                id: pkg.id,
                network: pkg.network,
                name: pkg.name,
                data: pkg.data,
                validity: pkg.validity,
                price: parseFloat(pkg.price),
                costPrice: pkg.costPrice ? parseFloat(pkg.costPrice) : null,
                popular: pkg.popular,
                isActive: pkg.isActive,
                sortOrder: pkg.sortOrder
            },
            priceChanged,
            costPriceChanged
        });
    } catch (error) {
        logger.error('Update package error', { error: error.message, packageId: req.params.id });
        res.status(500).json({ error: 'Failed to update package' });
    }
};

/**
 * Bulk update package prices (admin)
 * PUT /api/admin/packages/bulk
 */
exports.bulkUpdatePackages = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { updates } = req.body;
        
        if (!Array.isArray(updates) || updates.length === 0) {
            await t.rollback();
            return res.status(400).json({ error: 'No updates provided' });
        }

        const results = [];
        const changes = [];

        for (const update of updates) {
            const { id, price, costPrice, popular, isActive } = update;
            
            const pkg = await Package.findByPk(id, { transaction: t });
            if (!pkg) {
                results.push({ id, success: false, error: 'Not found' });
                continue;
            }

            const previousPrice = pkg.price;
            
            if (price !== undefined && price >= 0) pkg.price = price;
            if (costPrice !== undefined) pkg.costPrice = costPrice;
            if (popular !== undefined) pkg.popular = popular;
            if (isActive !== undefined) pkg.isActive = isActive;

            await pkg.save({ transaction: t });
            
            results.push({ id, success: true, newPrice: pkg.price });
            changes.push({
                id: pkg.id,
                name: pkg.name,
                network: pkg.network,
                previousPrice,
                newPrice: pkg.price
            });
        }

        await t.commit();

        // Clear cache
        clearPackagesCache();
        invalidateCache('packages'); // Also clear API response cache

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_PACKAGE',
            targetType: 'package',
            targetId: 'bulk',
            previousValue: { count: updates.length },
            newValue: { changes },
            description: `Bulk updated ${updates.length} packages`
        });

        res.json({
            success: true,
            message: `Updated ${results.filter(r => r.success).length} packages`,
            results
        });
    } catch (error) {
        await t.rollback();
        logger.error('Bulk update packages error', { error: error.message });
        res.status(500).json({ error: 'Failed to bulk update packages' });
    }
};

/**
 * Create a new package (admin)
 * POST /api/admin/packages
 */
exports.createPackage = async (req, res) => {
    try {
        const { id, network, name, data, validity, price, costPrice, popular, sortOrder } = req.body;

        // Validate required fields
        if (!id || !network || !name || !data || price === undefined) {
            return res.status(400).json({ error: 'Missing required fields: id, network, name, data, price' });
        }

        // Check if package ID already exists
        const existing = await Package.findByPk(id);
        if (existing) {
            return res.status(400).json({ error: 'Package ID already exists' });
        }

        // Validate network
        if (!['MTN', 'AirtelTigo', 'Telecel'].includes(network)) {
            return res.status(400).json({ error: 'Invalid network. Must be MTN, AirtelTigo, or Telecel' });
        }

        const pkg = await Package.create({
            id,
            network,
            name,
            data,
            validity: validity || 'Non-Expiry',
            price,
            costPrice: costPrice || null,
            popular: popular || false,
            sortOrder: sortOrder || 0,
            isActive: true
        });

        // Clear cache
        clearPackagesCache();
        invalidateCache('packages'); // Also clear API response cache

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'CREATE_PACKAGE',
            targetType: 'package',
            targetId: pkg.id,
            previousValue: null,
            newValue: { id: pkg.id, network, name, price },
            description: `Created new package ${name} (${network}) at GH₵${price}`
        });

        res.status(201).json({
            success: true,
            message: `Package ${name} created successfully`,
            package: {
                id: pkg.id,
                network: pkg.network,
                name: pkg.name,
                data: pkg.data,
                validity: pkg.validity,
                price: parseFloat(pkg.price),
                costPrice: pkg.costPrice ? parseFloat(pkg.costPrice) : null,
                popular: pkg.popular,
                isActive: pkg.isActive,
                sortOrder: pkg.sortOrder
            }
        });
    } catch (error) {
        logger.error('Create package error', { error: error.message });
        res.status(500).json({ error: 'Failed to create package' });
    }
};

/**
 * Delete a package (admin)
 * DELETE /api/admin/packages/:id
 */
exports.deletePackage = async (req, res) => {
    try {
        const { id } = req.params;

        const pkg = await Package.findByPk(id);
        if (!pkg) {
            return res.status(404).json({ error: 'Package not found' });
        }

        const pkgData = {
            id: pkg.id,
            network: pkg.network,
            name: pkg.name,
            price: pkg.price
        };

        await pkg.destroy();

        // Clear cache
        clearPackagesCache();
        invalidateCache('packages'); // Also clear API response cache

        // Log admin action
        await AdminAuditLog.logAction(req, {
            action: 'DELETE_PACKAGE',
            targetType: 'package',
            targetId: id,
            previousValue: pkgData,
            newValue: null,
            description: `Deleted package ${pkgData.name} (${pkgData.network})`
        });

        res.json({
            success: true,
            message: `Package ${pkgData.name} deleted successfully`
        });
    } catch (error) {
        logger.error('Delete package error', { error: error.message, packageId: req.params.id });
        res.status(500).json({ error: 'Failed to delete package' });
    }
};

// ============================================
// DATA PROVIDER (MCBIS) INTEGRATION
// ============================================

const mcbisProvider = require('../services/mcbisProvider');

/**
 * Get provider wallet balance
 * GET /api/admin/provider/balance
 */
exports.getProviderBalance = async (req, res) => {
    try {
        const result = await mcbisProvider.getWalletBalance();
        
        // Handle unconfigured API
        if (result.configured === false) {
            return res.json({
                success: false,
                balance: 0,
                provider: 'MCBIS',
                configured: false,
                message: result.error || 'MCBIS API not configured',
                timestamp: new Date().toISOString()
            });
        }
        
        res.json({
            success: true,
            balance: result.balance,
            provider: 'MCBIS',
            configured: true,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get provider balance error', { error: error.message });
        res.status(500).json({ error: 'Failed to get provider balance' });
    }
};

/**
 * Get available products from provider
 * GET /api/admin/provider/products
 */
exports.getProviderProducts = async (req, res) => {
    try {
        const products = await mcbisProvider.getProducts();
        res.json({
            success: true,
            products,
            provider: 'MCBIS',
            count: Array.isArray(products) ? products.length : 0
        });
    } catch (error) {
        logger.error('Get provider products error', { error: error.message });
        res.status(500).json({ error: 'Failed to get provider products' });
    }
};

/**
 * Check order status from provider
 * GET /api/admin/provider/status/:reference
 */
exports.getProviderOrderStatus = async (req, res) => {
    try {
        const { reference } = req.params;
        const result = await mcbisProvider.checkOrderStatus(reference);
        res.json({
            success: result.success,
            status: result.status,
            order: result.order,
            provider: 'MCBIS'
        });
    } catch (error) {
        logger.error('Check provider order status error', { error: error.message });
        res.status(500).json({ error: 'Failed to check order status' });
    }
};

/**
 * Deliver an order item via provider
 * POST /api/admin/provider/deliver
 * Body: { orderId, itemIndex }
 */
exports.deliverOrder = async (req, res) => {
    const t = await sequelize.transaction();
    
    try {
        const { orderId, itemIndex } = req.body;

        if (!orderId) {
            await t.rollback();
            return res.status(400).json({ error: 'Order ID is required' });
        }

        // Find the order
        const order = await Order.findByPk(orderId, { transaction: t });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ error: 'Order not found' });
        }

        // Get the item to deliver
        const items = order.items || [];
        const idx = parseInt(itemIndex, 10) || 0;
        const item = items[idx];

        if (!item) {
            await t.rollback();
            return res.status(404).json({ error: 'Order item not found' });
        }

        // Check if already delivered
        if (item.deliveryStatus === 'Delivered') {
            await t.rollback();
            return res.status(400).json({ error: 'Item already delivered' });
        }

        // DUPLICATE CHECK: Check if item already has provider reference
        if (item.providerReference) {
            await t.rollback();
            logger.warn('Attempted duplicate delivery', {
                orderId,
                itemIndex: idx,
                existingReference: item.providerReference
            });
            return res.status(400).json({ 
                error: 'Item already sent to provider',
                existingReference: item.providerReference,
                message: 'This order has already been submitted to MCBIS. Check order status instead.'
            });
        }

        // Check if MCBIS can process this order (API enabled, network enabled, balance check)
        const canProcess = await mcbisProvider.canProcessOrder(order.network, parseFloat(item.price || 0));
        if (!canProcess.canProcess) {
            await t.rollback();
            logger.warn('Cannot process order via MCBIS', {
                orderId,
                itemIndex: idx,
                reason: canProcess.reason,
                code: canProcess.code
            });
            return res.status(400).json({ 
                error: canProcess.reason,
                code: canProcess.code,
                currentBalance: canProcess.currentBalance,
                requiredAmount: canProcess.requiredAmount
            });
        }

        // Extract data for delivery (include price and existingReference for safety checks)
        const deliveryData = {
            network: order.network,
            phoneNumber: item.phoneNumber || item.phone,
            dataAmount: item.data || item.packageName,
            orderId: order.id,
            itemIndex: idx,
            price: item.price || item.costPrice || 0,
            existingReference: item.providerReference // Will be null/undefined for new orders
        };

        logger.info('Initiating delivery via MCBIS', deliveryData);

        // Call the provider
        const deliveryResult = await mcbisProvider.deliverBundle(deliveryData);

        // Handle special failure cases (duplicate, insufficient balance)
        if (deliveryResult.status === 'Duplicate') {
            await t.rollback();
            return res.status(400).json({
                error: deliveryResult.error,
                status: 'Duplicate',
                existingReference: deliveryResult.reference,
                existingStatus: deliveryResult.existingStatus
            });
        }

        if (deliveryResult.status === 'InsufficientBalance') {
            await t.rollback();
            return res.status(400).json({
                error: deliveryResult.error,
                status: 'InsufficientBalance',
                currentBalance: deliveryResult.currentBalance,
                requiredAmount: deliveryResult.requiredAmount
            });
        }

        if (deliveryResult.status === 'BalanceCheckFailed') {
            await t.rollback();
            return res.status(500).json({
                error: deliveryResult.error,
                status: 'BalanceCheckFailed'
            });
        }

        // Update the item status
        items[idx] = {
            ...item,
            deliveryStatus: deliveryResult.status,
            providerReference: deliveryResult.reference,
            deliveredAt: deliveryResult.success ? new Date().toISOString() : null,
            providerResponse: deliveryResult.providerResponse
        };

        // Check if all items are delivered
        const allDelivered = items.every(i => i.deliveryStatus === 'Delivered');
        const anyFailed = items.some(i => i.deliveryStatus === 'Failed');

        await order.update({
            items,
            deliveryStatus: allDelivered ? 'Delivered' : (anyFailed ? 'Partial' : 'Processing'),
            processedBy: req.admin?.username || 'admin',
            processedAt: new Date()
        }, { transaction: t });

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'DELIVER_ORDER',
            targetType: 'order',
            targetId: orderId,
            previousValue: { itemIndex: idx, status: item.deliveryStatus },
            newValue: { 
                itemIndex: idx, 
                status: deliveryResult.status,
                reference: deliveryResult.reference 
            },
            description: `Delivered item ${idx} of order ${orderId} via MCBIS - Status: ${deliveryResult.status}`
        });

        await t.commit();

        res.json({
            success: deliveryResult.success,
            status: deliveryResult.status,
            reference: deliveryResult.reference,
            message: deliveryResult.success 
                ? 'Order delivered successfully' 
                : `Delivery status: ${deliveryResult.status}`,
            order: {
                id: order.id,
                deliveryStatus: allDelivered ? 'Delivered' : (anyFailed ? 'Partial' : 'Processing')
            }
        });
    } catch (error) {
        await t.rollback();
        logger.error('Deliver order error', { error: error.message, body: req.body });
        res.status(500).json({ error: 'Failed to deliver order' });
    }
};

// ==================== NETWORK AVAILABILITY SETTINGS ====================

/**
 * Get network availability settings
 * GET /api/admin/network-availability
 */
exports.getNetworkAvailability = async (req, res) => {
    try {
        const availability = await Setting.getNetworkAvailability();
        res.json({ success: true, availability });
    } catch (error) {
        logger.error('Get network availability error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get network availability' });
    }
};

/**
 * Update network availability settings
 * PUT /api/admin/network-availability
 */
exports.updateNetworkAvailability = async (req, res) => {
    try {
        const { MTN, Telecel, AirtelTigo } = req.body;

        // Get previous settings for audit
        const previousAvailability = await Setting.getNetworkAvailability();

        // Update each network setting
        if (MTN !== undefined) {
            await Setting.setValue('network_mtn_available', MTN, 'boolean', 'MTN network availability (client can see/select)');
        }
        if (Telecel !== undefined) {
            await Setting.setValue('network_telecel_available', Telecel, 'boolean', 'Telecel network availability (client can see/select)');
        }
        if (AirtelTigo !== undefined) {
            await Setting.setValue('network_airteltigo_available', AirtelTigo, 'boolean', 'AirtelTigo network availability (client can see/select)');
        }

        // Get new settings
        const newAvailability = await Setting.getNetworkAvailability();

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'SETTINGS_UPDATE',
            targetType: 'settings',
            targetId: 'network_availability',
            previousValue: previousAvailability,
            newValue: newAvailability,
            description: `Updated network availability: MTN=${newAvailability.MTN}, Telecel=${newAvailability.Telecel}, AirtelTigo=${newAvailability.AirtelTigo}`
        });

        logger.info('Network availability updated', { 
            admin: req.admin?.username,
            availability: newAvailability 
        });

        res.json({ 
            success: true, 
            message: 'Network availability updated successfully',
            availability: newAvailability 
        });
    } catch (error) {
        logger.error('Update network availability error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to update network availability' });
    }
};

// ==================== MCBIS SETTINGS ====================

/**
 * Get MCBIS settings
 * GET /api/admin/mcbis/settings
 */
exports.getMcbisSettings = async (req, res) => {
    try {
        const settings = await Setting.getMcbisSettings();
        res.json({ success: true, settings });
    } catch (error) {
        logger.error('Get MCBIS settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get MCBIS settings' });
    }
};

/**
 * Update MCBIS settings
 * PUT /api/admin/mcbis/settings
 */
exports.updateMcbisSettings = async (req, res) => {
    try {
        const {
            mcbisEnabled,
            mcbis_mtnAPI,
            mcbis_telecelAPI,
            mcbis_airteltigoAPI,
            mcbisAutoSync
        } = req.body;

        // Get previous settings for audit
        const previousSettings = await Setting.getMcbisSettings();

        // Update each setting
        if (mcbisEnabled !== undefined) {
            await Setting.setValue('mcbisEnabled', mcbisEnabled, 'boolean', 'Master MCBIS API toggle');
        }
        if (mcbis_mtnAPI !== undefined) {
            await Setting.setValue('mcbis_mtnAPI', mcbis_mtnAPI, 'boolean', 'Enable MCBIS for MTN orders');
        }
        if (mcbis_telecelAPI !== undefined) {
            await Setting.setValue('mcbis_telecelAPI', mcbis_telecelAPI, 'boolean', 'Enable MCBIS for Telecel orders');
        }
        if (mcbis_airteltigoAPI !== undefined) {
            await Setting.setValue('mcbis_airteltigoAPI', mcbis_airteltigoAPI, 'boolean', 'Enable MCBIS for AirtelTigo orders (AT Premium)');
        }
        if (mcbisAutoSync !== undefined) {
            await Setting.setValue('mcbisAutoSync', mcbisAutoSync, 'boolean', 'Auto-sync order status from MCBIS');
        }

        // Get new settings
        const newSettings = await Setting.getMcbisSettings();

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_SETTINGS',
            targetType: 'settings',
            targetId: 'mcbis',
            previousValue: previousSettings,
            newValue: newSettings,
            description: 'Updated MCBIS API settings'
        });

        logger.info('MCBIS settings updated', { 
            admin: req.admin?.username,
            settings: newSettings 
        });

        res.json({ 
            success: true, 
            message: 'MCBIS settings updated successfully',
            settings: newSettings 
        });
    } catch (error) {
        logger.error('Update MCBIS settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to update MCBIS settings' });
    }
};

/**
 * Get topup fee settings
 * GET /api/admin/fee-settings
 */
exports.getFeeSettings = async (req, res) => {
    try {
        const settings = await Setting.getTopupFeeSettings();
        res.json({ success: true, settings });
    } catch (error) {
        logger.error('Get fee settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get fee settings' });
    }
};

/**
 * Update topup fee settings
 * PUT /api/admin/fee-settings
 */
exports.updateFeeSettings = async (req, res) => {
    try {
        const {
            topup_fees_enabled,
            topup_fee_percentage,
            topup_minimum_fee
        } = req.body;

        // Get previous settings for audit
        const previousSettings = await Setting.getTopupFeeSettings();

        // Update each setting
        if (topup_fees_enabled !== undefined) {
            await Setting.setValue('topup_fees_enabled', topup_fees_enabled, 'boolean', 'Enable topup fees');
        }
        if (topup_fee_percentage !== undefined) {
            const percentage = parseFloat(topup_fee_percentage);
            if (percentage < 0 || percentage > 100) {
                return res.status(400).json({ success: false, error: 'Fee percentage must be between 0 and 100' });
            }
            await Setting.setValue('topup_fee_percentage', percentage, 'number', 'Topup fee percentage');
        }
        if (topup_minimum_fee !== undefined) {
            const minFee = parseFloat(topup_minimum_fee);
            if (minFee < 0) {
                return res.status(400).json({ success: false, error: 'Minimum fee cannot be negative' });
            }
            await Setting.setValue('topup_minimum_fee', minFee, 'number', 'Minimum topup fee');
        }

        // Get new settings
        const newSettings = await Setting.getTopupFeeSettings();

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_SETTINGS',
            targetType: 'settings',
            targetId: 'topup_fees',
            previousValue: previousSettings,
            newValue: newSettings,
            description: `Updated topup fee settings: ${newSettings.feePercentage}%`
        });

        logger.info('Topup fee settings updated', { 
            admin: req.admin?.username,
            settings: newSettings 
        });

        res.json({ 
            success: true, 
            message: 'Topup fee settings updated successfully',
            settings: newSettings 
        });
    } catch (error) {
        logger.error('Update fee settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to update fee settings' });
    }
};

/**
 * Get general app settings
 * GET /api/admin/app-settings
 */
exports.getAppSettings = async (req, res) => {
    try {
        const appSettings = await Setting.getAppSettings();
        const depositLimits = await Setting.getDepositLimits();
        const securitySettings = await Setting.getSecuritySettings();
        
        res.json({ 
            success: true, 
            settings: {
                ...appSettings,
                ...depositLimits,
                ...securitySettings
            }
        });
    } catch (error) {
        logger.error('Get app settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get app settings' });
    }
};

/**
 * Update general app settings
 * PUT /api/admin/app-settings
 */
exports.updateAppSettings = async (req, res) => {
    try {
        const {
            appName,
            supportEmail,
            supportPhone,
            maintenanceMode,
            minDeposit,
            maxLoginAttempts,
            lockoutMinutes,
            sessionTimeoutHours,
            sendClaimVisible,
            storeVisible,
            momoDetailsVisible
        } = req.body;

        const updates = [];

        // App info settings
        if (appName !== undefined) {
            await Setting.setValue('app_name', appName, 'string', 'Application name');
            updates.push('appName');
        }
        if (supportEmail !== undefined) {
            await Setting.setValue('support_email', supportEmail, 'string', 'Support email');
            updates.push('supportEmail');
        }
        if (supportPhone !== undefined) {
            await Setting.setValue('support_phone', supportPhone, 'string', 'Support phone');
            updates.push('supportPhone');
        }
        
        // Maintenance mode
        if (maintenanceMode !== undefined) {
            await Setting.setValue('maintenance_mode', maintenanceMode, 'boolean', 'Maintenance mode');
            updates.push('maintenanceMode');
            
            // Clear maintenance cache
            const { clearMaintenanceCache } = require('../middleware/maintenance');
            clearMaintenanceCache();
            
            logger.security(`Maintenance mode ${maintenanceMode ? 'ENABLED' : 'DISABLED'}`, {
                admin: req.admin?.username
            });
        }

        // Client UI settings - save BEFORE validation-heavy fields to prevent
        // early returns from blocking these saves
        if (sendClaimVisible !== undefined) {
            await Setting.setValue('send_claim_visible', sendClaimVisible, 'boolean', 'Show Send & Claim section on client pages');
            updates.push('sendClaimVisible');
            logger.info(`Send & Claim visibility ${sendClaimVisible ? 'ENABLED' : 'DISABLED'}`, {
                admin: req.admin?.username
            });
        }

        if (storeVisible !== undefined) {
            await Setting.setValue('store_visible', storeVisible, 'boolean', 'Show Store link on client pages');
            updates.push('storeVisible');
            logger.info(`Store visibility ${storeVisible ? 'ENABLED' : 'DISABLED'}`, {
                admin: req.admin?.username
            });
        }

        if (momoDetailsVisible !== undefined) {
            await Setting.setValue('momo_details_visible', momoDetailsVisible, 'boolean', 'Show MoMo payment details on client sidebar');
            updates.push('momoDetailsVisible');
            logger.info(`MoMo details visibility ${momoDetailsVisible ? 'ENABLED' : 'DISABLED'}`, {
                admin: req.admin?.username
            });
        }

        // MoMo payment settings
        if (req.body.momoEnabled !== undefined) {
            await Setting.setValue('momo_enabled', req.body.momoEnabled, 'boolean', 'Enable MoMo deposit option');
            updates.push('momoEnabled');
        }
        if (req.body.momoNumber !== undefined) {
            await Setting.setValue('momo_number', req.body.momoNumber, 'string', 'MoMo phone number');
            updates.push('momoNumber');
        }
        if (req.body.momoName !== undefined) {
            await Setting.setValue('momo_name', req.body.momoName, 'string', 'MoMo account name');
            updates.push('momoName');
        }

        // Deposit limits
        if (minDeposit !== undefined) {
            const min = parseFloat(minDeposit);
            if (min < 5) {
                return res.status(400).json({ success: false, error: 'Minimum deposit must be at least GH₵5' });
            }
            await Setting.setValue('min_deposit', min, 'number', 'Minimum deposit amount');
            updates.push('minDeposit');
        }


        // Security settings
        if (maxLoginAttempts !== undefined) {
            const attempts = parseInt(maxLoginAttempts);
            if (attempts < 1 || attempts > 20) {
                return res.status(400).json({ success: false, error: 'Max login attempts must be between 1 and 20' });
            }
            await Setting.setValue('max_login_attempts', attempts, 'number', 'Max failed login attempts before lockout');
            updates.push('maxLoginAttempts');
        }
        if (lockoutMinutes !== undefined) {
            const mins = parseInt(lockoutMinutes);
            if (mins < 1 || mins > 1440) {
                return res.status(400).json({ success: false, error: 'Lockout duration must be between 1 and 1440 minutes' });
            }
            await Setting.setValue('lockout_minutes', mins, 'number', 'Account lockout duration in minutes');
            updates.push('lockoutMinutes');
        }
        if (sessionTimeoutHours !== undefined) {
            const hours = parseInt(sessionTimeoutHours);
            if (hours < 1 || hours > 168) {
                return res.status(400).json({ success: false, error: 'Session timeout must be between 1 and 168 hours' });
            }
            await Setting.setValue('session_timeout_hours', hours, 'number', 'Session timeout in hours');
            updates.push('sessionTimeoutHours');
        }

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'UPDATE_SETTINGS',
            targetType: 'settings',
            targetId: 'app_settings',
            newValue: req.body,
            description: `Updated app settings: ${updates.join(', ')}`
        });

        logger.info('App settings updated', { 
            admin: req.admin?.username,
            updates 
        });

        res.json({ 
            success: true, 
            message: 'Settings updated successfully',
            updated: updates
        });
    } catch (error) {
        logger.error('Update app settings error', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
};

/**
 * Check if order should be auto-delivered via MCBIS
 * Used internally by order processing
 */
exports.shouldAutoDeliverViaMcbis = async (network) => {
    return await Setting.shouldDeliverViaMcbis(network);
};

// ==================== SECURE PROVIDER ENDPOINTS ====================

const secureProvider = require('../services/secureProviderService');

/**
 * Securely deliver an order item via provider (with full safeguards)
 * POST /api/admin/provider/secure-deliver
 */
exports.secureDeliverOrder = async (req, res) => {
    try {
        const { orderId, itemIndex } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        // Find the order
        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Get the item to deliver
        const items = order.items || [];
        const idx = parseInt(itemIndex, 10) || 0;
        const item = items[idx];

        if (!item) {
            return res.status(404).json({ error: 'Order item not found' });
        }

        // Check if already delivered
        if (item.deliveryStatus === 'Delivered') {
            return res.status(400).json({ error: 'Item already delivered' });
        }

        // Use the secure delivery service
        const result = await secureProvider.secureDeliverBundle({
            orderId: order.id,
            itemIndex: idx,
            userId: order.userId,
            network: order.network,
            phoneNumber: item.phoneNumber || item.phone,
            dataAmount: item.data || item.packageName,
            price: parseFloat(item.price || 0),
            costPrice: parseFloat(item.costPrice || 0),
            packageId: item.packageId
        });

        // Update order item with result
        if (result.success || result.status === 'Processing') {
            items[idx] = {
                ...item,
                deliveryStatus: result.status === 'Processing' ? 'Processing' : 'Delivered',
                providerReference: result.reference,
                deliveredAt: result.success ? new Date().toISOString() : null
            };

            const allDelivered = items.every(i => i.deliveryStatus === 'Delivered');
            const anyFailed = items.some(i => i.deliveryStatus === 'Failed');

            await order.update({
                items,
                deliveryStatus: allDelivered ? 'Delivered' : (anyFailed ? 'Partial' : 'Processing'),
                processedBy: req.admin?.username || 'admin',
                processedAt: new Date()
            });
        } else if (result.status === 'PROVIDER_DISABLED' && (result.code === 'INSUFFICIENT_BALANCE' || result.code === 'LOW_BALANCE')) {
            // Insufficient MCBIS balance - keep item as Pending
            items[idx] = {
                ...item,
                deliveryStatus: 'Pending',
                deliveryError: result.error
            };
            await order.update({ items });
        }

        // Log the action
        await AdminAuditLog.logAction(req, {
            action: 'SECURE_DELIVER_ORDER',
            targetType: 'order',
            targetId: orderId,
            previousValue: { itemIndex: idx, status: item.deliveryStatus },
            newValue: { 
                itemIndex: idx, 
                status: result.status,
                reference: result.reference,
                requiresReview: result.requiresReview
            },
            description: `Secure delivery of item ${idx} - Status: ${result.status}`
        });

        res.json({
            success: result.success,
            status: result.status,
            reference: result.reference,
            requiresReview: result.requiresReview,
            validation: result.validation,
            message: result.success 
                ? 'Order delivered successfully' 
                : result.error || `Delivery status: ${result.status}`
        });
    } catch (error) {
        logger.error('Secure deliver order error', { error: error.message });
        res.status(500).json({ error: 'Failed to deliver order' });
    }
};

/**
 * Get circuit breaker status
 * GET /api/admin/provider/circuit-breaker
 */
exports.getCircuitBreakerStatus = async (req, res) => {
    try {
        const status = secureProvider.getCircuitBreakerStatus();
        res.json({ success: true, circuitBreaker: status });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get circuit breaker status' });
    }
};

/**
 * Reset circuit breaker
 * POST /api/admin/provider/circuit-breaker/reset
 */
exports.resetCircuitBreaker = async (req, res) => {
    try {
        secureProvider.resetCircuitBreaker();
        
        await AdminAuditLog.logAction(req, {
            action: 'RESET_CIRCUIT_BREAKER',
            targetType: 'settings',
            targetId: 'circuit-breaker',
            description: 'Manually reset circuit breaker'
        });
        
        res.json({ success: true, message: 'Circuit breaker reset' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset circuit breaker' });
    }
};

/**
 * Emergency stop - disable all provider activity
 * POST /api/admin/provider/emergency-stop
 */
exports.emergencyStop = async (req, res) => {
    try {
        const { reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({ error: 'Reason is required for emergency stop' });
        }
        
        const result = await secureProvider.emergencyStop(
            req.admin?.username || 'unknown',
            reason
        );
        
        await AdminAuditLog.logAction(req, {
            action: 'EMERGENCY_STOP',
            targetType: 'settings',
            targetId: 'provider',
            newValue: { reason, timestamp: result.timestamp },
            description: `EMERGENCY STOP: ${reason}`
        });
        
        res.json(result);
    } catch (error) {
        logger.error('Emergency stop error', { error: error.message });
        res.status(500).json({ error: 'Failed to execute emergency stop' });
    }
};

/**
 * Run reconciliation check
 * POST /api/admin/provider/reconciliation
 */
exports.runReconciliation = async (req, res) => {
    try {
        const report = await secureProvider.runReconciliation();
        
        await AdminAuditLog.logAction(req, {
            action: 'RUN_RECONCILIATION',
            targetType: 'settings',
            targetId: 'reconciliation',
            newValue: { 
                mismatches: report.mismatches.length,
                unreconciledCount: report.unreconciledCount 
            },
            description: `Reconciliation run - ${report.mismatches.length} mismatches found`
        });
        
        res.json({ success: true, report });
    } catch (error) {
        logger.error('Reconciliation error', { error: error.message });
        res.status(500).json({ error: 'Failed to run reconciliation' });
    }
};

/**
 * Get provider transactions for review
 * GET /api/admin/provider/transactions/review
 */
exports.getTransactionsForReview = async (req, res) => {
    try {
        const { ProviderTransaction } = require('../models');
        const transactions = await ProviderTransaction.getRequiringReview();
        
        res.json({ 
            success: true, 
            count: transactions.length,
            transactions 
        });
    } catch (error) {
        logger.error('Get transactions for review error', { error: error.message });
        res.status(500).json({ error: 'Failed to get transactions' });
    }
};

/**
 * Get provider transactions with mismatches
 * GET /api/admin/provider/transactions/mismatches
 */
exports.getTransactionMismatches = async (req, res) => {
    try {
        const { ProviderTransaction } = require('../models');
        const transactions = await ProviderTransaction.getMismatches();
        
        res.json({ 
            success: true, 
            count: transactions.length,
            transactions 
        });
    } catch (error) {
        logger.error('Get mismatches error', { error: error.message });
        res.status(500).json({ error: 'Failed to get mismatches' });
    }
};

/**
 * Get daily provider summary
 * GET /api/admin/provider/summary
 */
exports.getProviderSummary = async (req, res) => {
    try {
        const { ProviderTransaction } = require('../models');
        const { date } = req.query;
        
        const summary = await ProviderTransaction.getDailySummary(
            date ? new Date(date) : new Date()
        );
        
        // Also get circuit breaker status
        const circuitBreaker = secureProvider.getCircuitBreakerStatus();
        
        // Get MCBIS balance
        let mcbisBalance = null;
        try {
            const balanceResult = await mcbisProvider.getWalletBalance();
            mcbisBalance = balanceResult.balance;
        } catch (e) {
            mcbisBalance = 'Error fetching';
        }
        
        res.json({ 
            success: true, 
            summary,
            circuitBreaker,
            mcbisBalance
        });
    } catch (error) {
        logger.error('Get provider summary error', { error: error.message });
        res.status(500).json({ error: 'Failed to get summary' });
    }
};

/**
 * Process refund for failed delivery
 * POST /api/admin/provider/refund
 */
exports.processProviderRefund = async (req, res) => {
    try {
        const { orderId, itemIndex, amount, reason } = req.body;
        
        if (!orderId || amount === undefined || !reason) {
            return res.status(400).json({ 
                error: 'orderId, amount, and reason are required' 
            });
        }
        
        const result = await secureProvider.processRefund(
            orderId,
            parseInt(itemIndex, 10) || 0,
            parseFloat(amount),
            reason
        );
        
        if (result.success) {
            await AdminAuditLog.logAction(req, {
                action: 'PROVIDER_REFUND',
                targetType: 'order',
                targetId: orderId,
                newValue: { 
                    itemIndex, 
                    amount, 
                    reason,
                    refundTxId: result.refundTransactionId
                },
                description: `Refund for failed delivery: ${reason}`
            });
        }
        
        res.json(result);
    } catch (error) {
        logger.error('Process refund error', { error: error.message });
        res.status(500).json({ error: 'Failed to process refund' });
    }
};

/**
 * Review and resolve a flagged provider transaction
 * POST /api/admin/provider/transactions/:id/review
 */
exports.reviewProviderTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution, notes } = req.body;
        
        const { ProviderTransaction } = require('../models');
        const tx = await ProviderTransaction.findByPk(id);
        
        if (!tx) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        await tx.update({
            requiresReview: false,
            reviewedBy: req.admin?.username || 'admin',
            reviewedAt: new Date(),
            reviewNotes: (tx.reviewNotes || '') + `\n[${new Date().toISOString()}] Resolution: ${resolution}. Notes: ${notes}`
        });
        
        await AdminAuditLog.logAction(req, {
            action: 'REVIEW_PROVIDER_TX',
            targetType: 'provider_transaction',
            targetId: id,
            newValue: { resolution, notes },
            description: `Reviewed provider transaction: ${resolution}`
        });
        
        res.json({ success: true, message: 'Transaction reviewed' });
    } catch (error) {
        logger.error('Review transaction error', { error: error.message });
        res.status(500).json({ error: 'Failed to review transaction' });
    }
};

// ==================== ORDER STATUS POLLING ====================

const orderStatusPoller = require('../services/orderStatusPoller');

/**
 * Get active polling jobs
 * GET /api/admin/provider/active-polls
 */
exports.getActivePolls = async (req, res) => {
    try {
        const polls = orderStatusPoller.getActivePolls();
        res.json({
            success: true,
            activePolls: polls,
            count: polls.length
        });
    } catch (error) {
        logger.error('Get active polls error', { error: error.message });
        res.status(500).json({ error: 'Failed to get active polls' });
    }
};

/**
 * Manually retry polling for an order
 * POST /api/admin/provider/retry-poll
 */
exports.retryPoll = async (req, res) => {
    try {
        const { orderId, itemIndex = 0 } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ error: 'Order ID required' });
        }
        
        // Find order and get reference
        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        const item = order.items[itemIndex];
        if (!item) {
            return res.status(404).json({ error: 'Order item not found' });
        }
        
        if (!item.providerReference) {
            return res.status(400).json({ error: 'No provider reference for this item' });
        }
        
        // Start polling
        await orderStatusPoller.startPolling({
            orderId: order.id,
            itemIndex,
            reference: item.providerReference,
            displayOrderId: order.orderId
        });
        
        res.json({
            success: true,
            message: 'Polling started',
            reference: item.providerReference
        });
    } catch (error) {
        logger.error('Retry poll error', { error: error.message });
        res.status(500).json({ error: 'Failed to start polling' });
    }
};

/**
 * Sync order status with MCBIS
 * POST /api/admin/provider/sync-status
 * Body: { orderId, itemIndex } - or sync all if not provided
 * 
 * Checks MCBIS for order status and updates our database
 */
exports.syncOrderStatus = async (req, res) => {
    try {
        const { orderId, itemIndex } = req.body;
        const results = [];
        
        if (orderId) {
            // Sync specific order
            const order = await Order.findByPk(orderId);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }
            
            const items = order.items || [];
            const itemsToSync = itemIndex !== undefined 
                ? [{ item: items[itemIndex], index: itemIndex }]
                : items.map((item, index) => ({ item, index }));
                
            for (const { item, index } of itemsToSync) {
                if (item && item.providerReference && item.deliveryStatus === 'Processing') {
                    const result = await syncSingleItem(order, index, item);
                    results.push(result);
                }
            }
        } else {
            // Sync ALL pending orders
            const pendingOrders = await Order.findAll({
                where: { deliveryStatus: 'Processing' }
            });
            
            logger.info('Syncing status for pending orders', { count: pendingOrders.length });
            
            for (const order of pendingOrders) {
                const items = order.items || [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.providerReference && item.deliveryStatus === 'Processing') {
                        const result = await syncSingleItem(order, i, item);
                        results.push(result);
                    }
                }
            }
        }
        
        const updated = results.filter(r => r.updated).length;
        const delivered = results.filter(r => r.newStatus === 'Delivered').length;
        const failed = results.filter(r => r.newStatus === 'Failed').length;
        
        res.json({
            success: true,
            message: `Synced ${results.length} items: ${delivered} delivered, ${failed} failed, ${results.length - updated} unchanged`,
            results
        });
    } catch (error) {
        logger.error('Sync order status error', { error: error.message });
        res.status(500).json({ error: 'Failed to sync order status' });
    }
};

/**
 * Helper: Sync a single order item with MCBIS
 */
async function syncSingleItem(order, itemIndex, item) {
    try {
        const statusResult = await mcbisProvider.checkOrderStatus(item.providerReference);
        
        // mcbisProvider.checkOrderStatus() already extracts data.order.status into statusResult.status
        const mcbisStatus = (statusResult.status || '').toLowerCase();
        let newStatus = item.deliveryStatus;
        let updated = false;
        
        if (mcbisStatus === 'success' || mcbisStatus === 'completed' || 
            mcbisStatus === 'delivered' || mcbisStatus === 'successful') {
            newStatus = 'Delivered';
        } else if (mcbisStatus === 'failed' || mcbisStatus === 'fail' || mcbisStatus === 'error') {
            newStatus = 'Failed';
        }
        
        if (newStatus !== item.deliveryStatus) {
            // Update the order item
            const items = [...order.items];
            items[itemIndex] = {
                ...items[itemIndex],
                deliveryStatus: newStatus,
                deliveredAt: newStatus === 'Delivered' ? new Date().toISOString() : null,
                deliveryError: newStatus === 'Failed' ? 'Failed by provider' : null
            };
            
            // Calculate overall status
            const allDelivered = items.every(i => i.deliveryStatus === 'Delivered');
            const anyFailed = items.some(i => i.deliveryStatus === 'Failed');
            const overallStatus = allDelivered ? 'Delivered' : anyFailed ? 'Partial' : 'Processing';
            
            await order.update({
                items,
                deliveryStatus: overallStatus,
                processedAt: allDelivered ? new Date() : order.processedAt
            });
            
            updated = true;
            logger.info('Order status synced from MCBIS', {
                orderId: order.orderId,
                itemIndex,
                reference: item.providerReference,
                oldStatus: item.deliveryStatus,
                newStatus,
                mcbisStatus
            });
        }
        
        return {
            orderId: order.orderId,
            itemIndex,
            reference: item.providerReference,
            mcbisStatus,
            newStatus,
            updated
        };
    } catch (error) {
        logger.error('Failed to sync item status', {
            orderId: order.orderId,
            itemIndex,
            error: error.message
        });
        return {
            orderId: order.orderId,
            itemIndex,
            reference: item.providerReference,
            error: error.message,
            updated: false
        };
    }
}

/**
 * User Controller
 * Profile and user data management
 * Updated for PostgreSQL/Sequelize
 */

const { User, Order, Wallet, Transaction, sequelize } = require('../models');
const { Op, fn, col, literal } = require('sequelize');

/**
 * Get user profile
 * GET /api/users/profile
 */
exports.getProfile = async (req, res) => {
    try {
        const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        
        res.json({
            success: true,
            user: req.user.toSafeObject(),
            wallet: {
                balance: wallet?.balance || 0,
                totalTopups: wallet?.totalTopups || 0,
                totalSpent: wallet?.totalSpent || 0
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
};

/**
 * Update user profile
 * PUT /api/users/profile
 */
exports.updateProfile = async (req, res) => {
    try {
        const allowedFields = ['fullName', 'phone', 'avatar', 'settings'];
        const updates = {};

        Object.keys(req.body).forEach(key => {
            if (allowedFields.includes(key)) {
                updates[key] = req.body[key];
            }
        });

        // Check phone uniqueness if updating
        if (updates.phone) {
            const existingPhone = await User.findOne({
                where: {
                    phone: updates.phone,
                    id: { [Op.ne]: req.user.id }
                }
            });
            if (existingPhone) {
                return res.status(400).json({ error: 'Phone number already in use' });
            }
        }

        await req.user.update(updates);

        res.json({
            success: true,
            message: 'Profile updated',
            user: req.user.toSafeObject()
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
};

/**
 * Get user's orders
 * GET /api/users/orders
 */
exports.getUserOrders = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;

        const where = { userId: req.user.id };
        if (status) {
            where.deliveryStatus = status;
        }

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
        console.error('Get user orders error:', error);
        res.status(500).json({ error: 'Failed to get orders' });
    }
};

/**
 * Get user statistics
 * GET /api/users/stats
 */
exports.getUserStats = async (req, res) => {
    try {
        const [orderStats, wallet, recentOrders] = await Promise.all([
            Order.findOne({
                where: { userId: req.user.id },
                attributes: [
                    [fn('COUNT', col('id')), 'totalOrders'],
                    [fn('SUM', col('total')), 'totalSpent'],
                    [fn('SUM', literal("CASE WHEN \"deliveryStatus\" = 'Delivered' THEN 1 ELSE 0 END")), 'delivered']
                ],
                raw: true
            }),
            Wallet.findOne({ where: { userId: req.user.id } }),
            Order.findAll({
                where: { userId: req.user.id },
                order: [['createdAt', 'DESC']],
                limit: 5
            })
        ]);

        res.json({
            success: true,
            stats: {
                totalOrders: parseInt(orderStats?.totalOrders) || 0,
                totalSpent: parseFloat(orderStats?.totalSpent) || 0,
                deliveredOrders: parseInt(orderStats?.delivered) || 0,
                walletBalance: wallet?.balance || 0,
                totalTopups: wallet?.totalTopups || 0
            },
            recentOrders
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
};

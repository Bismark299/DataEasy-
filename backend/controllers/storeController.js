/**
 * Store Controller
 * Agent-facing store management, orders, packages, payouts, and financial statements
 */

const { Store, StoreProduct, StoreOrder, SettlementAccount, LedgerEntry, Payout, ReconciliationRecord, User, Package } = require('../models');
const { sequelize } = require('../config/database');
const { initializeTransaction, verifyTransaction } = require('../config/paystack');
const { getAllPackagesForRole, getPriceForRole } = require('../config/packages');
const ledgerService = require('../services/ledgerService');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

// ==========================================
// HELPER: resolve store by UUID or agentCode
// ==========================================
function slugify(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function findStoreByRef(ref, includeOwner = false) {
    const include = includeOwner ? [{ model: User, as: 'owner', attributes: ['role'] }] : [];
    // Try UUID first — but only if ref is a valid UUID, otherwise Postgres throws
    // "invalid input syntax for type uuid" and the slug/agentCode fallbacks never run.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ref));
    if (isUuid) {
        const byId = await Store.findByPk(ref, { include });
        if (byId) return byId;
    }
    // Try agentCode
    const user = await User.findOne({ where: { agentCode: ref }, attributes: ['id'] });
    if (user) {
        const byAgent = await Store.findOne({ where: { userId: user.id }, include });
        if (byAgent) return byAgent;
    }
    // Try store name slug
    const allStores = await Store.findAll({ where: { isActive: true }, include });
    return allStores.find(s => slugify(s.name) === ref) || null;
}

// ==========================================
// STORE MANAGEMENT
// ==========================================

/**
 * Create or get agent's store
 * POST /api/store
 */
exports.createStore = async (req, res) => {
    try {
        // Check if agent already has a store
        const existing = await Store.findOne({ where: { userId: req.user.id } });
        if (existing) {
            return res.status(400).json({ error: 'You already have a store' });
        }

        const { name, description, location, phone, bankName, bankAccountNumber, bankAccountName, momoNumber, momoProvider } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Store name is required (min 2 characters)' });
        }

        const result = await sequelize.transaction(async (t) => {
            const store = await Store.create({
                userId: req.user.id,
                name: name.trim(),
                description: description || null,
                location: location || null,
                phone: phone || null,
                bankName: bankName || null,
                bankAccountNumber: bankAccountNumber || null,
                bankAccountName: bankAccountName || null,
                momoNumber: momoNumber || null,
                momoProvider: momoProvider || null
            }, { transaction: t });

            // Create settlement account
            await SettlementAccount.create({
                storeId: store.id
            }, { transaction: t });

            return store;
        });

        const store = await Store.findByPk(result.id, {
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });

        res.status(201).json({ success: true, store });
    } catch (error) {
        logger.error('Create store error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to create store' });
    }
};

/**
 * Get agent's store with settlement info
 * GET /api/store
 */
exports.getStore = async (req, res) => {
    try {
        const store = await Store.findOne({
            where: { userId: req.user.id },
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });

        if (!store) {
            return res.status(404).json({ error: 'Store not found. Create a store first.' });
        }

        res.json({ success: true, store });
    } catch (error) {
        logger.error('Get store error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to get store' });
    }
};

/**
 * Update store details
 * PUT /api/store
 */
exports.updateStore = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) {
            return res.status(404).json({ error: 'Store not found' });
        }

        const allowedFields = ['name', 'description', 'location', 'phone', 'whatsapp', 'bankName', 'bankAccountNumber', 'bankAccountName', 'momoNumber', 'momoProvider'];
        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        // Merge whitelisted metadata (e.g. color theme) without clobbering existing keys
        if (req.body.metadata && typeof req.body.metadata === 'object') {
            const VALID_THEMES = ['blue', 'amber', 'red', 'green', 'purple', 'orange', 'teal'];
            const merged = { ...(store.metadata || {}) };
            if (VALID_THEMES.includes(req.body.metadata.theme)) {
                merged.theme = req.body.metadata.theme;
            }
            updates.metadata = merged;
        }

        await store.update(updates);
        const updated = await Store.findByPk(store.id, {
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });

        res.json({ success: true, store: updated });
    } catch (error) {
        logger.error('Update store error', { error: error.message, userId: req.user?.id });
        res.status(500).json({ error: 'Failed to update store' });
    }
};

// ==========================================
// DATA PACKAGES (Platform packages - MTN, Telecel, AirtelTigo)
// ==========================================

/**
 * Get available data packages for the agent's role
 * Includes agent's custom selling prices from store.pricing
 * GET /api/store/packages
 */
exports.getPackages = async (req, res) => {
    try {
        const userRole = req.user.role || 'agent';
        const packages = await getAllPackagesForRole(userRole);

        // Load agent's pricing
        const store = await Store.findOne({ where: { userId: req.user.id } });
        const pricing = (store && store.pricing) || {};

        // Merge pricing into packages
        const result = {};
        for (const [network, pkgs] of Object.entries(packages)) {
            result[network] = pkgs.map(p => {
                const agentPricing = pricing[p.id];
                return {
                    ...p,
                    costPrice: p.price, // agent's role-based cost
                    sellingPrice: agentPricing ? agentPricing.sellingPrice : null,
                    inStore: agentPricing ? agentPricing.active !== false : false
                };
            });
        }

        res.json({ success: true, packages: result });
    } catch (error) {
        logger.error('Get packages error', { error: error.message });
        res.status(500).json({ error: 'Failed to get packages' });
    }
};

/**
 * Save agent's selling prices for packages
 * PUT /api/store/packages/pricing
 * Body: { pricing: [{ packageId, sellingPrice, active }] }
 */
exports.savePricing = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { pricing: pricingUpdates } = req.body;
        if (!Array.isArray(pricingUpdates)) {
            return res.status(400).json({ error: 'pricing must be an array' });
        }

        const userRole = req.user.role || 'agent';
        // Shallow-clone so Sequelize detects the JSONB change (mutating the
        // existing reference would be skipped on save).
        const currentPricing = { ...(store.pricing || {}) };
        const errors = [];

        for (const item of pricingUpdates) {
            if (!item.packageId || item.sellingPrice === undefined) {
                errors.push(`Missing packageId or sellingPrice`);
                continue;
            }

            // Verify package exists and get cost price
            const pkg = await Package.findByPk(item.packageId);
            if (!pkg) {
                errors.push(`Package not found: ${item.packageId}`);
                continue;
            }

            const costPrice = getPriceForRole(pkg, userRole);
            const sellingPrice = Math.round(parseFloat(item.sellingPrice) * 100) / 100;

            if (isNaN(sellingPrice) || sellingPrice < costPrice) {
                errors.push(`${pkg.network} ${pkg.name}: Selling price ₵${sellingPrice} cannot be below cost ₵${costPrice.toFixed(2)}`);
                continue;
            }

            currentPricing[item.packageId] = {
                sellingPrice,
                active: item.active !== false
            };
        }

        await store.update({ pricing: currentPricing });

        if (errors.length) {
            return res.json({ success: true, pricing: currentPricing, warnings: errors });
        }

        res.json({ success: true, pricing: currentPricing });
    } catch (error) {
        logger.error('Save pricing error', { error: error.message });
        res.status(500).json({ error: 'Failed to save pricing' });
    }
};

// ==========================================
// STORE ORDERS (Customer Payments via Paystack)
// ==========================================

/**
 * Create a store order and initialize Paystack payment
 * Items reference platform data packages (MTN, Telecel, AirtelTigo)
 * POST /api/store/orders
 */
exports.createOrder = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (!store.isActive) return res.status(400).json({ error: 'Store is not active' });

        const { customerName, customerPhone, customerEmail, items, notes } = req.body;

        if (!customerName || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Customer name and at least one item are required' });
        }

        if (!customerEmail) {
            return res.status(400).json({ error: 'Customer email is required for Paystack payment' });
        }

        const userRole = req.user.role || 'agent';
        const savedPricing = store.pricing || {};

        // Validate and calculate items using platform packages
        const orderItems = [];
        let subtotal = 0;
        let totalCost = 0;

        for (const item of items) {
            // Find the package from DB
            const pkg = await Package.findByPk(item.packageId);
            if (!pkg) {
                return res.status(400).json({ error: `Package not found: ${item.packageId}` });
            }
            if (!pkg.isActive) {
                return res.status(400).json({ error: `Package is out of stock: ${pkg.name} (${pkg.network})` });
            }

            const qty = parseInt(item.quantity) || 1;
            // Agent's cost = their role-based price from DB
            const costPrice = getPriceForRole(pkg, userRole);
            // Use saved selling price from store.pricing, or explicit sellingPrice, or fall back to cost
            const agentPricing = savedPricing[item.packageId];
            let sellingPrice;
            if (item.sellingPrice) {
                sellingPrice = Math.round(parseFloat(item.sellingPrice) * 100) / 100;
            } else if (agentPricing && agentPricing.sellingPrice) {
                sellingPrice = agentPricing.sellingPrice;
            } else {
                sellingPrice = costPrice;
            }

            if (sellingPrice < costPrice) {
                return res.status(400).json({ error: `Selling price for ${pkg.name} (${pkg.network}) cannot be below your cost price ₵${costPrice.toFixed(2)}` });
            }

            const lineTotal = Math.round(sellingPrice * qty * 100) / 100;
            const lineCost = Math.round(costPrice * qty * 100) / 100;

            orderItems.push({
                packageId: pkg.id,
                productName: `${pkg.network} ${pkg.name} Data`,
                network: pkg.network,
                data: pkg.data,
                validity: pkg.validity,
                quantity: qty,
                unitPrice: sellingPrice,
                costPrice: costPrice,
                lineTotal
            });

            subtotal += lineTotal;
            totalCost += lineCost;
        }

        subtotal = Math.round(subtotal * 100) / 100;
        totalCost = Math.round(totalCost * 100) / 100;
        const commission = Math.round(subtotal * (store.commissionRate / 100) * 100) / 100;
        const netAmount = Math.round((subtotal - commission) * 100) / 100;

        const orderId = `SO-${Date.now()}-${uuidv4().split('-')[0]}`;
        const paymentReference = `STORE-${Date.now()}-${uuidv4().split('-')[0]}`;

        // Create order
        const storeOrder = await StoreOrder.create({
            orderId,
            storeId: store.id,
            customerName: customerName.trim(),
            customerPhone: customerPhone || null,
            customerEmail: customerEmail.trim(),
            items: orderItems,
            subtotal,
            totalCost,
            commission,
            netAmount,
            paymentReference,
            notes: notes || null,
            status: 'pending'
        });

        // Initialize Paystack payment
        const paystackResponse = await initializeTransaction({
            email: customerEmail.trim(),
            amount: subtotal,
            reference: paymentReference,
            metadata: {
                store_order_id: orderId,
                store_id: store.id,
                store_name: store.name,
                customer_name: customerName,
                type: 'store_payment'
            }
        });

        res.status(201).json({
            success: true,
            order: storeOrder,
            payment: {
                reference: paymentReference,
                authorizationUrl: paystackResponse.data.authorization_url,
                accessCode: paystackResponse.data.access_code
            }
        });
    } catch (error) {
        logger.error('Create store order error', { error: error.message });
        res.status(500).json({ error: 'Failed to create order' });
    }
};

/**
 * Verify store order payment
 * GET /api/store/orders/:reference/verify
 */
exports.verifyOrderPayment = async (req, res) => {
    try {
        const { reference } = req.params;
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const order = await StoreOrder.findOne({
            where: { paymentReference: reference, storeId: store.id }
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (order.status === 'paid' || order.status === 'fulfilled') {
            return res.json({ success: true, message: 'Payment already verified', order });
        }

        // Verify with Paystack
        const verification = await verifyTransaction(reference);

        if (verification.data.status !== 'success') {
            return res.status(400).json({ error: 'Payment not successful', paystackStatus: verification.data.status });
        }

        // Verify amount matches (Paystack returns amount in pesewas)
        const paidAmount = verification.data.amount / 100;
        if (Math.abs(paidAmount - order.subtotal) > 0.01) {
            logger.error('Payment amount mismatch', { expected: order.subtotal, received: paidAmount, reference });
            return res.status(400).json({ error: 'Payment amount mismatch' });
        }

        // Mark as paid only. Profit/settlement is credited later, once the
        // order is actually delivered/fulfilled (see recordSale on fulfillment).
        await order.update({ status: 'paid', paidAt: new Date() });

        const updatedOrder = await StoreOrder.findByPk(order.id);
        res.json({ success: true, message: 'Payment verified and recorded', order: updatedOrder });

        // Auto-deliver the bundle(s) via MCBIS in the background (mirrors normal bundle flow)
        try {
            const { dispatchStoreOrder } = require('../services/storeOrderDelivery');
            dispatchStoreOrder(order.id).catch(err => logger.error('Store auto-delivery dispatch error', { orderId: order.orderId, error: err.message }));
        } catch (e) {
            logger.error('Store auto-delivery hook failed', { error: e.message });
        }
    } catch (error) {
        logger.error('Verify store payment error', { error: error.message });
        res.status(500).json({ error: 'Failed to verify payment' });
    }
};

/**
 * Mark order as fulfilled
 * PUT /api/store/orders/:orderId/fulfill
 */
exports.fulfillOrder = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const order = await StoreOrder.findOne({
            where: { orderId: req.params.orderId, storeId: store.id }
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status !== 'paid') {
            return res.status(400).json({ error: 'Only paid orders can be fulfilled' });
        }

        // Fulfilling the order credits the owner's profit/settlement. Re-check the
        // status under a row lock so a concurrent auto-delivery fulfill can't make
        // us record the sale twice.
        await sequelize.transaction(async (t) => {
            const locked = await StoreOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!locked || locked.status !== 'paid') return; // already fulfilled elsewhere
            await locked.update({ status: 'fulfilled', fulfilledAt: new Date() }, { transaction: t });
            await ledgerService.recordSale(store.id, {
                orderId: locked.orderId,
                subtotal: locked.subtotal,
                commission: locked.commission,
                netAmount: locked.netAmount,
                totalCost: locked.totalCost
            }, { transaction: t });
        });

        const fresh = await StoreOrder.findByPk(order.id);
        res.json({ success: true, order: fresh });
    } catch (error) {
        logger.error('Fulfill order error', { error: error.message });
        res.status(500).json({ error: 'Failed to fulfill order' });
    }
};

/**
 * Get store orders
 * GET /api/store/orders
 */
exports.getOrders = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { page = 1, limit = 20, status, dateFrom, dateTo } = req.query;
        const where = { storeId: store.id };
        if (status) where.status = status;

        // Optional date range filter (keeps the main orders page load bounded)
        if (dateFrom || dateTo) {
            const dateFilter = {};
            if (dateFrom) dateFilter[Op.gte] = new Date(`${dateFrom}T00:00:00`);
            if (dateTo) dateFilter[Op.lte] = new Date(`${dateTo}T23:59:59`);
            where.createdAt = dateFilter;
        }

        const { count, rows: orders } = await StoreOrder.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            orders,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Get store orders error', { error: error.message });
        res.status(500).json({ error: 'Failed to get orders' });
    }
};

// ==========================================
// PAYOUT MANAGEMENT
// ==========================================

/**
 * Request payout (withdrawal)
 * POST /api/store/payouts
 */
exports.requestPayout = async (req, res) => {
    try {
        const store = await Store.findOne({
            where: { userId: req.user.id },
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { amount, method, momoNumber, momoProvider } = req.body;
        const payoutAmount = Math.round(parseFloat(amount) * 100) / 100;

        if (!amount || payoutAmount < 1) {
            return res.status(400).json({ error: 'Valid payout amount is required' });
        }

        // Payouts are mobile money only.
        if (method !== 'momo') {
            return res.status(400).json({ error: 'Payouts are only available via mobile money.' });
        }

        const settlement = store.settlementAccount;
        if (!settlement) return res.status(400).json({ error: 'Settlement account not found' });

        if (payoutAmount < store.payoutThreshold) {
            return res.status(400).json({ 
                error: `Minimum payout amount is GH₵${store.payoutThreshold}` 
            });
        }

        if (payoutAmount > settlement.availableBalance) {
            return res.status(400).json({ 
                error: `Insufficient balance. Available: GH₵${settlement.availableBalance.toFixed(2)}` 
            });
        }

        // Resolve mobile money destination: request body overrides saved store settings.
        const payoutMomoNumber = (momoNumber && String(momoNumber).trim()) || store.momoNumber;
        const payoutMomoProvider = (momoProvider && String(momoProvider).trim()) || store.momoProvider;

        // Validate payout destination details exist
        if (method === 'bank_transfer' && (!store.bankAccountNumber || !store.bankName)) {
            return res.status(400).json({ error: 'Bank account details not configured. Update your store settings.' });
        }
        if (method === 'momo' && !payoutMomoNumber) {
            return res.status(400).json({ error: 'Mobile money number is required.' });
        }
        if (method === 'momo' && !payoutMomoProvider) {
            return res.status(400).json({ error: 'Select your mobile money network.' });
        }

        // Persist the latest mobile money details to the store for next time.
        if (method === 'momo' && (payoutMomoNumber !== store.momoNumber || payoutMomoProvider !== store.momoProvider)) {
            await store.update({ momoNumber: payoutMomoNumber, momoProvider: payoutMomoProvider });
        }

        const payoutId = `PO-${Date.now()}-${uuidv4().split('-')[0]}`;
        const fee = 0; // Can be configured later
        const netAmount = Math.round((payoutAmount - fee) * 100) / 100;

        // Place hold on the amount
        await sequelize.transaction(async (t) => {
            await settlement.placeHold(payoutAmount, { transaction: t });

            await Payout.create({
                payoutId,
                storeId: store.id,
                userId: req.user.id,
                amount: payoutAmount,
                fee,
                netAmount,
                method,
                bankName: method === 'bank_transfer' ? store.bankName : payoutMomoProvider,
                accountNumber: method === 'bank_transfer' ? store.bankAccountNumber : payoutMomoNumber,
                accountName: method === 'bank_transfer' ? store.bankAccountName : store.name,
                status: 'pending',
                metadata: method === 'momo' ? { network: payoutMomoProvider } : {},
                balanceBefore: settlement.availableBalance + payoutAmount, // Before hold
                balanceAfter: settlement.availableBalance, // After hold
                transferReference: `TRF-${Date.now()}-${uuidv4().split('-')[0]}`
            }, { transaction: t });
        });

        res.status(201).json({ 
            success: true, 
            message: 'Payout request submitted for approval',
            payoutId 
        });
    } catch (error) {
        logger.error('Request payout error', { error: error.message });
        res.status(500).json({ error: error.message || 'Failed to request payout' });
    }
};

/**
 * Get payout history
 * GET /api/store/payouts
 */
exports.getPayouts = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { page = 1, limit = 20, status } = req.query;
        const where = { storeId: store.id };
        if (status) where.status = status;

        const { count, rows: payouts } = await Payout.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            payouts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Get payouts error', { error: error.message });
        res.status(500).json({ error: 'Failed to get payouts' });
    }
};

// ==========================================
// FINANCIAL STATEMENTS
// ==========================================

/**
 * Get Income Statement (Profit & Loss)
 * GET /api/store/financials/income-statement
 */
exports.getIncomeStatement = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { startDate, endDate } = req.query;
        const dateFilter = {};
        if (startDate) dateFilter[Op.gte] = new Date(startDate);
        if (endDate) dateFilter[Op.lte] = new Date(endDate);

        const dateWhere = Object.keys(dateFilter).length > 0 
            ? { createdAt: dateFilter } 
            : {};

        // Get revenue (credit entries to REVENUE account)
        const revenueResult = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'REVENUE', type: 'credit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Get COGS from store orders. Revenue is recognized at fulfillment
        // (recordSale runs on the paid->fulfilled transition), so COGS must match:
        // only count fulfilled orders, dated by when they were fulfilled.
        const cogsResult = await StoreOrder.findOne({
            where: { 
                storeId: store.id, 
                status: 'fulfilled',
                ...(Object.keys(dateFilter).length > 0 ? { fulfilledAt: dateFilter } : {})
            },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('totalCost')), 0), 'total']],
            raw: true
        });

        // Get commission paid
        const commissionResult = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'PLATFORM_COMMISSION', type: 'credit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Get refunds
        const refundResult = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'REFUND_EXPENSE', type: 'debit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        const grossRevenue = parseFloat(revenueResult?.total || 0);
        const cogs = parseFloat(cogsResult?.total || 0);
        const grossProfit = Math.round((grossRevenue - cogs) * 100) / 100;
        const commissions = parseFloat(commissionResult?.total || 0);
        const refunds = parseFloat(refundResult?.total || 0);
        const netProfit = Math.round((grossProfit - commissions - refunds) * 100) / 100;

        res.json({
            success: true,
            statement: 'Income Statement (Profit & Loss)',
            period: {
                startDate: startDate || 'All time',
                endDate: endDate || 'Present'
            },
            data: {
                grossRevenue,
                costOfGoodsSold: cogs,
                grossProfit,
                expenses: {
                    platformCommissions: commissions,
                    refunds
                },
                totalExpenses: Math.round((commissions + refunds) * 100) / 100,
                netProfit
            }
        });
    } catch (error) {
        logger.error('Income statement error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate income statement' });
    }
};

/**
 * Get Balance Sheet
 * GET /api/store/financials/balance-sheet
 */
exports.getBalanceSheet = async (req, res) => {
    try {
        const store = await Store.findOne({
            where: { userId: req.user.id },
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const settlement = store.settlementAccount;

        // Inventory value - N/A for digital data packages
        const inventoryValue = 0;

        // Pending receivables (pending orders not yet paid)
        const pendingReceivables = await StoreOrder.findOne({
            where: { storeId: store.id, status: 'pending' },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('subtotal')), 0), 'total']],
            raw: true
        });

        // Pending payouts
        const pendingPayouts = await Payout.findOne({
            where: { storeId: store.id, status: { [Op.in]: ['pending', 'approved', 'processing'] } },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        const receivables = parseFloat(pendingReceivables?.total || 0);
        const totalAssets = Math.round((settlement.availableBalance + settlement.holdAmount + receivables) * 100) / 100;
        const payoutLiabilities = parseFloat(pendingPayouts?.total || 0);
        const totalLiabilities = Math.round((payoutLiabilities + settlement.holdAmount) * 100) / 100;
        const equity = Math.round((totalAssets - totalLiabilities) * 100) / 100;

        res.json({
            success: true,
            statement: 'Balance Sheet',
            date: new Date().toISOString(),
            data: {
                assets: {
                    cashAndEquivalents: settlement.availableBalance,
                    heldFunds: settlement.holdAmount,
                    inventoryValue,
                    accountsReceivable: receivables,
                    totalAssets
                },
                liabilities: {
                    pendingPayouts: payoutLiabilities,
                    fundsOnHold: settlement.holdAmount,
                    totalLiabilities
                },
                equity: {
                    retainedEarnings: equity,
                    totalEquity: equity
                }
            }
        });
    } catch (error) {
        logger.error('Balance sheet error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate balance sheet' });
    }
};

/**
 * Get Cash Flow Statement
 * GET /api/store/financials/cash-flow
 */
exports.getCashFlow = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { startDate, endDate } = req.query;
        const dateFilter = {};
        if (startDate) dateFilter[Op.gte] = new Date(startDate);
        if (endDate) dateFilter[Op.lte] = new Date(endDate);

        const dateWhere = Object.keys(dateFilter).length > 0 
            ? { createdAt: dateFilter } 
            : {};

        // Inflows: credits to SETTLEMENT
        const inflowResult = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'SETTLEMENT', type: 'credit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Outflows: debits from SETTLEMENT
        const outflowResult = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'SETTLEMENT', type: 'debit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Payouts completed
        const payoutsResult = await Payout.findOne({
            where: { 
                storeId: store.id, 
                status: 'completed',
                ...(Object.keys(dateFilter).length > 0 ? { completedAt: dateFilter } : {})
            },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        // Refunds
        const refundOutflow = await LedgerEntry.findOne({
            where: { storeId: store.id, account: 'REFUND_EXPENSE', type: 'debit', ...dateWhere },
            attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('amount')), 0), 'total']],
            raw: true
        });

        const inflows = parseFloat(inflowResult?.total || 0);
        const payouts = parseFloat(payoutsResult?.total || 0);
        const refunds = parseFloat(refundOutflow?.total || 0);
        const totalOutflows = Math.round((payouts + refunds) * 100) / 100;
        const netCashFlow = Math.round((inflows - totalOutflows) * 100) / 100;

        res.json({
            success: true,
            statement: 'Cash Flow Statement',
            period: {
                startDate: startDate || 'All time',
                endDate: endDate || 'Present'
            },
            data: {
                inflows: {
                    customerPayments: inflows,
                    totalInflows: inflows
                },
                outflows: {
                    payoutsToAgent: payouts,
                    refundsIssued: refunds,
                    totalOutflows
                },
                netCashFlow
            }
        });
    } catch (error) {
        logger.error('Cash flow error', { error: error.message });
        res.status(500).json({ error: 'Failed to generate cash flow statement' });
    }
};

/**
 * Get Ledger History (transaction log)
 * GET /api/store/financials/ledger
 */
exports.getLedger = async (req, res) => {
    try {
        const store = await Store.findOne({ where: { userId: req.user.id } });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { page = 1, limit = 50, account, type } = req.query;
        const where = { storeId: store.id };
        if (account) where.account = account;
        if (type) where.type = type;

        const { count, rows: entries } = await LedgerEntry.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            offset: (parseInt(page) - 1) * parseInt(limit),
            limit: parseInt(limit)
        });

        res.json({
            success: true,
            entries,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                pages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        logger.error('Ledger error', { error: error.message });
        res.status(500).json({ error: 'Failed to get ledger' });
    }
};

/**
 * Get store dashboard summary
 * GET /api/store/dashboard
 */
exports.getDashboard = async (req, res) => {
    try {
        const store = await Store.findOne({
            where: { userId: req.user.id },
            include: [{ model: SettlementAccount, as: 'settlementAccount' }]
        });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const settlement = store.settlementAccount;

        // Today's stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todaySales = await StoreOrder.findOne({
            where: { 
                storeId: store.id, 
                status: { [Op.in]: ['paid', 'fulfilled'] },
                paidAt: { [Op.gte]: today }
            },
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('subtotal')), 0), 'total']
            ],
            raw: true
        });

        // Total orders
        const totalOrders = await StoreOrder.count({
            where: { storeId: store.id, status: { [Op.in]: ['paid', 'fulfilled'] } }
        });

        // Active packages (ones the agent has priced for their store)
        const pricing = store.pricing || {};
        const activePackages = Object.values(pricing).filter(p => p.active !== false && p.sellingPrice).length;

        // Pending payouts
        const pendingPayouts = await Payout.count({
            where: { storeId: store.id, status: { [Op.in]: ['pending', 'approved', 'processing'] } }
        });

        res.json({
            success: true,
            dashboard: {
                store: {
                    name: store.name,
                    isActive: store.isActive,
                    commissionRate: store.commissionRate
                },
                settlement: {
                    ledgerBalance: settlement.ledgerBalance,
                    availableBalance: settlement.availableBalance,
                    holdAmount: settlement.holdAmount,
                    totalRevenue: settlement.totalRevenue,
                    totalCommissionPaid: settlement.totalCommissionPaid,
                    totalPayouts: settlement.totalPayouts,
                    totalCostOfGoods: settlement.totalCostOfGoods,
                    lastPayoutDate: settlement.lastPayoutDate
                },
                today: {
                    salesCount: parseInt(todaySales?.count || 0),
                    salesTotal: parseFloat(todaySales?.total || 0)
                },
                totalOrders,
                activePackages,
                pendingPayouts
            }
        });
    } catch (error) {
        logger.error('Store dashboard error', { error: error.message });
        res.status(500).json({ error: 'Failed to get dashboard' });
    }
};

// ==========================================
// PUBLIC STORE (No auth required - customer facing)
// ==========================================

/**
 * Get public store info
 * GET /api/store/public/:storeId
 */
exports.getPublicStore = async (req, res) => {
    try {
        const store = await findStoreByRef(req.params.storeId);
        if (!store || !store.isActive) {
            return res.status(404).json({ error: 'Store not found' });
        }

        res.json({
            success: true,
            store: {
                id: store.id,
                name: store.name,
                description: store.description,
                location: store.location,
                phone: store.phone,
                whatsapp: store.whatsapp,
                theme: (store.metadata && store.metadata.theme) || 'blue'
            }
        });
    } catch (error) {
        logger.error('Get public store error', { error: error.message });
        res.status(500).json({ error: 'Failed to get store' });
    }
};

/**
 * Get public store packages with agent's selling prices
 * GET /api/store/public/:storeId/packages
 */
exports.getPublicPackages = async (req, res) => {
    try {
        const store = await findStoreByRef(req.params.storeId, true);
        if (!store || !store.isActive) {
            return res.status(404).json({ error: 'Store not found' });
        }

        const userRole = store.owner?.role || 'agent';
        const allPackages = await getAllPackagesForRole(userRole);
        const pricing = store.pricing || {};

        // Show ALL active packages.
        // Use the owner's custom selling price when set, otherwise fall back to
        // the agent's own role-based cost price (so unpriced bundles still sell).
        const result = {};
        for (const [network, pkgs] of Object.entries(allPackages)) {
            const activePkgs = pkgs
                .filter(p => {
                    if (!p.isActive) return false;
                    const ap = pricing[p.id];
                    // Hide only bundles the owner has explicitly disabled.
                    if (ap && ap.active === false) return false;
                    return true;
                })
                .map(p => {
                    const ap = pricing[p.id];
                    const sellingPrice = (ap && ap.sellingPrice) ? ap.sellingPrice : getPriceForRole(p, userRole);
                    return {
                        id: p.id,
                        name: p.name,
                        network: p.network,
                        data: p.data,
                        validity: p.validity,
                        price: sellingPrice,
                        popular: p.popular
                    };
                });
            if (activePkgs.length) result[network] = activePkgs;
        }

        res.json({ success: true, packages: result, storeName: store.name });
    } catch (error) {
        logger.error('Get public packages error', { error: error.message });
        res.status(500).json({ error: 'Failed to get packages' });
    }
};

/**
 * Create customer order (public, no auth)
 * POST /api/store/public/:storeId/orders
 */
exports.createPublicOrder = async (req, res) => {
    try {
        const store = await findStoreByRef(req.params.storeId, true);
        if (!store || !store.isActive) {
            return res.status(404).json({ error: 'Store not found' });
        }

        const { customerName, customerPhone, customerEmail, items, notes } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required' });
        }

        if (!customerPhone) {
            return res.status(400).json({ error: 'Phone number is required for data delivery' });
        }

        // Name and email are optional on the public store form. Derive sensible
        // fallbacks (Paystack requires a valid email to initialize payment).
        const phone = String(customerPhone).trim();
        const finalName = (customerName && customerName.trim()) || `Customer ${phone}`;
        const finalEmail = (customerEmail && customerEmail.trim()) || `${phone.replace(/\D/g, '') || 'customer'}@store.dataeasyplus.com`;

        const userRole = store.owner?.role || 'agent';
        const pricing = store.pricing || {};

        const orderItems = [];
        let subtotal = 0;
        let totalCost = 0;

        for (const item of items) {
            const pkg = await Package.findByPk(item.packageId);
            if (!pkg || !pkg.isActive) {
                return res.status(400).json({ error: `Package not available: ${item.packageId}` });
            }

            const agentPricing = pricing[item.packageId];
            // Block only bundles the owner has explicitly disabled.
            if (agentPricing && agentPricing.active === false) {
                return res.status(400).json({ error: `Package not available in this store: ${pkg.name}` });
            }

            const qty = parseInt(item.quantity) || 1;
            const costPrice = getPriceForRole(pkg, userRole);
            // Use the owner's selling price when set, otherwise fall back to their cost price.
            const sellingPrice = (agentPricing && agentPricing.sellingPrice) ? agentPricing.sellingPrice : costPrice;

            const lineTotal = Math.round(sellingPrice * qty * 100) / 100;
            const lineCost = Math.round(costPrice * qty * 100) / 100;

            orderItems.push({
                packageId: pkg.id,
                productName: `${pkg.network} ${pkg.name} Data`,
                network: pkg.network,
                data: pkg.data,
                validity: pkg.validity,
                quantity: qty,
                unitPrice: sellingPrice,
                costPrice,
                lineTotal,
                recipientPhone: customerPhone
            });

            subtotal += lineTotal;
            totalCost += lineCost;
        }

        subtotal = Math.round(subtotal * 100) / 100;
        totalCost = Math.round(totalCost * 100) / 100;
        const commission = Math.round(subtotal * (store.commissionRate / 100) * 100) / 100;
        const netAmount = Math.round((subtotal - commission) * 100) / 100;

        const orderId = `SO-${Date.now()}-${uuidv4().split('-')[0]}`;
        const paymentReference = `STORE-${Date.now()}-${uuidv4().split('-')[0]}`;

        const storeOrder = await StoreOrder.create({
            orderId,
            storeId: store.id,
            customerName: finalName,
            customerPhone: phone,
            customerEmail: finalEmail,
            items: orderItems,
            subtotal,
            totalCost,
            commission,
            netAmount,
            paymentReference,
            notes: notes || null,
            status: 'pending'
        });

        // Redirect the customer back to this store's page after Paystack payment.
        const baseUrl = (process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
        const callbackUrl = `${baseUrl}/store/shop.html?store=${encodeURIComponent(store.id)}`;

        const paystackResponse = await initializeTransaction({
            email: finalEmail,
            amount: subtotal,
            reference: paymentReference,
            callback_url: callbackUrl,
            metadata: {
                store_order_id: orderId,
                store_id: store.id,
                store_name: store.name,
                customer_name: finalName,
                type: 'store_payment'
            }
        });

        res.status(201).json({
            success: true,
            order: {
                orderId: storeOrder.orderId,
                subtotal: storeOrder.subtotal,
                items: storeOrder.items
            },
            payment: {
                reference: paymentReference,
                authorizationUrl: paystackResponse.data.authorization_url,
                accessCode: paystackResponse.data.access_code
            }
        });
    } catch (error) {
        logger.error('Create public order error', { error: error.message });
        res.status(500).json({ error: 'Failed to create order' });
    }
};

/**
 * Verify public order payment (no auth)
 * GET /api/store/public/orders/:reference/verify
 */
exports.verifyPublicPayment = async (req, res) => {
    try {
        const { reference } = req.params;

        const order = await StoreOrder.findOne({
            where: { paymentReference: reference }
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (order.status === 'paid' || order.status === 'fulfilled') {
            return res.json({ success: true, message: 'Payment verified', status: order.status });
        }

        const verification = await verifyTransaction(reference);

        if (verification.data.status !== 'success') {
            return res.status(400).json({ error: 'Payment not successful', paystackStatus: verification.data.status });
        }

        const paidAmount = verification.data.amount / 100;
        if (Math.abs(paidAmount - order.subtotal) > 0.01) {
            return res.status(400).json({ error: 'Amount mismatch' });
        }

        // Mark as paid only. Profit/settlement is credited later, once the
        // order is actually delivered/fulfilled (see recordSale on fulfillment).
        await order.update({ status: 'paid', paidAt: new Date(), paymentMethod: 'paystack' });

        res.json({ success: true, message: 'Payment successful! Your data will be delivered shortly.', status: 'paid' });

        // Auto-deliver the bundle(s) via MCBIS in the background (mirrors normal bundle flow)
        try {
            const { dispatchStoreOrder } = require('../services/storeOrderDelivery');
            dispatchStoreOrder(order.id).catch(err => logger.error('Store auto-delivery dispatch error', { orderId: order.orderId, error: err.message }));
        } catch (e) {
            logger.error('Store auto-delivery hook failed', { error: e.message });
        }
    } catch (error) {
        logger.error('Verify public payment error', { error: error.message });
        res.status(500).json({ error: 'Failed to verify payment' });
    }
};

/**
 * Public order tracking (no auth)
 * Customers look up their most recent order using only the recipient phone number.
 * GET /api/store/public/track?phone=024...
 */
exports.trackPublicOrder = async (req, res) => {
    try {
        const phone = String(req.query.phone || '').replace(/\D/g, '');
        // Match on the last 9 digits so any local/international format works (024..., 233...)
        const last9 = phone.slice(-9);

        if (!phone || last9.length < 9) {
            return res.status(400).json({ error: 'A valid recipient phone number is required' });
        }

        // Return the customer's most recent order for that phone number
        const order = await StoreOrder.findOne({
            where: { customerPhone: { [Op.iLike]: `%${last9}` } },
            include: [{ model: Store, as: 'store', attributes: ['name'] }],
            order: [['createdAt', 'DESC']]
        });

        if (!order) {
            return res.status(404).json({ error: 'No order found for that phone number' });
        }

        res.json({
            success: true,
            order: {
                orderId: order.orderId,
                storeName: order.store ? order.store.name : null,
                status: order.status,
                deliveryStatus: order.deliveryStatus,
                customerPhone: order.customerPhone,
                subtotal: order.subtotal,
                items: (order.items || []).map(it => ({
                    network: it.network || '',
                    data: it.data || it.productName || '',
                    quantity: it.quantity || 1
                })),
                createdAt: order.createdAt,
                paidAt: order.paidAt,
                fulfilledAt: order.fulfilledAt
            }
        });
    } catch (error) {
        logger.error('Track public order error', { error: error.message });
        res.status(500).json({ error: 'Failed to track order' });
    }
};

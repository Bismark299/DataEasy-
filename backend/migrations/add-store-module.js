/**
 * Migration: Add Store Module Tables
 * Creates tables for: stores, store_products, store_orders,
 *   ledger_entries, settlement_accounts, payouts, reconciliation_records
 *
 * Run: node backend/migrations/add-store-module.js
 * Rollback: node backend/migrations/add-store-module.js --down
 */

const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

async function up() {
    const qi = sequelize.getQueryInterface();

    // 1. stores
    console.log('Creating stores table...');
    await qi.createTable('stores', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: 'users', key: 'id' } },
        name: { type: DataTypes.STRING, allowNull: false },
        description: { type: DataTypes.TEXT },
        phone: { type: DataTypes.STRING },
        location: { type: DataTypes.STRING },
        logo: { type: DataTypes.STRING },
        isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
        bankName: { type: DataTypes.STRING },
        bankAccountNumber: { type: DataTypes.STRING },
        bankAccountName: { type: DataTypes.STRING },
        momoNumber: { type: DataTypes.STRING },
        momoProvider: { type: DataTypes.STRING },
        commissionRate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 5.00 },
        payoutThreshold: { type: DataTypes.DECIMAL(12, 2), defaultValue: 50.00 },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('stores', ['userId'], { unique: true, name: 'stores_user_id_unique' });
    console.log('✅ stores');

    // 2. store_products
    console.log('Creating store_products table...');
    await qi.createTable('store_products', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        storeId: { type: DataTypes.UUID, allowNull: false, references: { model: 'stores', key: 'id' } },
        name: { type: DataTypes.STRING, allowNull: false },
        description: { type: DataTypes.TEXT },
        sku: { type: DataTypes.STRING },
        category: { type: DataTypes.STRING, defaultValue: 'general' },
        costPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        sellingPrice: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        stock: { type: DataTypes.INTEGER, defaultValue: 0 },
        isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('store_products', ['storeId'], { name: 'store_products_store_id' });
    await qi.addIndex('store_products', ['storeId', 'sku'], {
        unique: true,
        where: { sku: { [require('sequelize').Op.ne]: null } },
        name: 'store_products_store_sku_unique'
    });
    console.log('✅ store_products');

    // 3. store_orders
    console.log('Creating store_orders table...');
    await qi.createTable('store_orders', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        orderId: { type: DataTypes.STRING, allowNull: false, unique: true },
        storeId: { type: DataTypes.UUID, allowNull: false, references: { model: 'stores', key: 'id' } },
        customerName: { type: DataTypes.STRING, allowNull: false },
        customerPhone: { type: DataTypes.STRING },
        customerEmail: { type: DataTypes.STRING },
        items: { type: DataTypes.JSONB, allowNull: false },
        subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        totalCost: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        commission: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        paymentReference: { type: DataTypes.STRING },
        paymentUrl: { type: DataTypes.TEXT },
        status: { type: DataTypes.ENUM('pending', 'paid', 'fulfilled', 'cancelled', 'refunded'), defaultValue: 'pending' },
        notes: { type: DataTypes.TEXT },
        paidAt: { type: DataTypes.DATE },
        fulfilledAt: { type: DataTypes.DATE },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('store_orders', ['storeId'], { name: 'store_orders_store_id' });
    await qi.addIndex('store_orders', ['orderId'], { unique: true, name: 'store_orders_order_id_unique' });
    await qi.addIndex('store_orders', ['paymentReference'], { name: 'store_orders_payment_ref' });
    await qi.addIndex('store_orders', ['status'], { name: 'store_orders_status' });
    console.log('✅ store_orders');

    // 4. settlement_accounts
    console.log('Creating settlement_accounts table...');
    await qi.createTable('settlement_accounts', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        storeId: { type: DataTypes.UUID, allowNull: false, unique: true, references: { model: 'stores', key: 'id' } },
        ledgerBalance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        availableBalance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        holdAmount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        totalRevenue: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        totalCommissionPaid: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        totalPayouts: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        totalCostOfGoods: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        lastPayoutDate: { type: DataTypes.DATE },
        version: { type: DataTypes.INTEGER, defaultValue: 0 },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('settlement_accounts', ['storeId'], { unique: true, name: 'settlement_accounts_store_id_unique' });
    console.log('✅ settlement_accounts');

    // 5. ledger_entries
    console.log('Creating ledger_entries table...');
    await qi.createTable('ledger_entries', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        storeId: { type: DataTypes.UUID, allowNull: false, references: { model: 'stores', key: 'id' } },
        counterEntryId: { type: DataTypes.UUID },
        type: { type: DataTypes.ENUM('debit', 'credit'), allowNull: false },
        account: {
            type: DataTypes.ENUM('REVENUE', 'COST_OF_GOODS', 'PLATFORM_COMMISSION', 'SETTLEMENT', 'ACCOUNTS_RECEIVABLE', 'PAYOUT', 'REFUND_EXPENSE', 'HOLD', 'ADJUSTMENT'),
            allowNull: false
        },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        balanceBefore: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        balanceAfter: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        description: { type: DataTypes.STRING, allowNull: false },
        reference: { type: DataTypes.STRING },
        referenceType: { type: DataTypes.STRING },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('ledger_entries', ['storeId'], { name: 'ledger_entries_store_id' });
    await qi.addIndex('ledger_entries', ['storeId', 'account'], { name: 'ledger_entries_store_account' });
    await qi.addIndex('ledger_entries', ['reference'], { name: 'ledger_entries_reference' });
    await qi.addIndex('ledger_entries', ['createdAt'], { name: 'ledger_entries_created_at' });
    console.log('✅ ledger_entries');

    // 6. payouts
    console.log('Creating payouts table...');
    await qi.createTable('payouts', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        payoutId: { type: DataTypes.STRING, allowNull: false, unique: true },
        storeId: { type: DataTypes.UUID, allowNull: false, references: { model: 'stores', key: 'id' } },
        userId: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        fee: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        netAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
        method: { type: DataTypes.ENUM('bank_transfer', 'momo'), allowNull: false },
        recipientCode: { type: DataTypes.STRING },
        transferCode: { type: DataTypes.STRING },
        transferReference: { type: DataTypes.STRING },
        status: { type: DataTypes.ENUM('pending', 'approved', 'processing', 'completed', 'failed', 'rejected'), defaultValue: 'pending' },
        approvedBy: { type: DataTypes.UUID },
        approvedAt: { type: DataTypes.DATE },
        completedAt: { type: DataTypes.DATE },
        rejectionReason: { type: DataTypes.TEXT },
        balanceBefore: { type: DataTypes.DECIMAL(12, 2) },
        balanceAfter: { type: DataTypes.DECIMAL(12, 2) },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('payouts', ['storeId'], { name: 'payouts_store_id' });
    await qi.addIndex('payouts', ['userId'], { name: 'payouts_user_id' });
    await qi.addIndex('payouts', ['payoutId'], { unique: true, name: 'payouts_payout_id_unique' });
    await qi.addIndex('payouts', ['status'], { name: 'payouts_status' });
    console.log('✅ payouts');

    // 7. reconciliation_records
    console.log('Creating reconciliation_records table...');
    await qi.createTable('reconciliation_records', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        storeId: { type: DataTypes.UUID, allowNull: false, references: { model: 'stores', key: 'id' } },
        periodStart: { type: DataTypes.DATE, allowNull: false },
        periodEnd: { type: DataTypes.DATE, allowNull: false },
        expectedRevenue: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        actualRevenue: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        expectedPayouts: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        actualPayouts: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        expectedCommission: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        actualCommission: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        expectedBalance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        actualBalance: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        discrepancy: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
        status: { type: DataTypes.ENUM('balanced', 'discrepancy', 'resolved', 'investigating'), defaultValue: 'balanced' },
        resolvedBy: { type: DataTypes.UUID },
        resolvedAt: { type: DataTypes.DATE },
        resolutionNotes: { type: DataTypes.TEXT },
        details: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex('reconciliation_records', ['storeId'], { name: 'reconciliation_records_store_id' });
    await qi.addIndex('reconciliation_records', ['status'], { name: 'reconciliation_records_status' });
    console.log('✅ reconciliation_records');

    console.log('\n✅ All store module tables created successfully!');
}

async function down() {
    const qi = sequelize.getQueryInterface();
    const tables = ['reconciliation_records', 'payouts', 'ledger_entries', 'settlement_accounts', 'store_orders', 'store_products', 'stores'];
    for (const t of tables) {
        console.log(`Dropping ${t}...`);
        await qi.dropTable(t, { cascade: true });
    }
    console.log('✅ All store module tables dropped');
}

async function run() {
    try {
        await sequelize.authenticate();
        console.log('Database connected');
        if (process.argv.includes('--down')) {
            await down();
        } else {
            await up();
        }
        console.log('Migration completed');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

run();

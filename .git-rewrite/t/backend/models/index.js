/**
 * Models Index
 * Sets up Sequelize associations
 */

const { sequelize } = require('../config/database');
const User = require('./User');
const Wallet = require('./Wallet');
const Transaction = require('./Transaction');
const Order = require('./Order');
const AdminAuditLog = require('./AdminAuditLog');
const IdempotencyKey = require('./IdempotencyKey');
const Package = require('./Package');
const Setting = require('./Setting')(sequelize);
const ProviderTransaction = require('./ProviderTransaction');
const MoMoDeposit = require('./MoMoDeposit');
const Store = require('./Store');
const StoreProduct = require('./StoreProduct');
const StoreOrder = require('./StoreOrder');
const LedgerEntry = require('./LedgerEntry');
const SettlementAccount = require('./SettlementAccount');
const Payout = require('./Payout');
const ReconciliationRecord = require('./ReconciliationRecord');
const ApiKey = require('./ApiKey');

// Define associations

// User has one Wallet
User.hasOne(Wallet, {
    foreignKey: 'userId',
    as: 'wallet',
    onDelete: 'CASCADE'
});
Wallet.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// User has many Transactions
User.hasMany(Transaction, {
    foreignKey: 'userId',
    as: 'transactions',
    onDelete: 'CASCADE'
});
Transaction.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// User has many Orders
User.hasMany(Order, {
    foreignKey: 'userId',
    as: 'orders',
    onDelete: 'CASCADE'
});
Order.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// Order has many Transactions (for refunds, etc.)
Order.hasMany(Transaction, {
    foreignKey: 'orderId',
    as: 'transactions'
});
Transaction.belongsTo(Order, {
    foreignKey: 'orderId',
    as: 'order'
});

// IdempotencyKey - no longer has foreign key since it can belong to users or admins
// The userId field stores either user UUID or admin username

// ProviderTransaction associations
Order.hasMany(ProviderTransaction, {
    foreignKey: 'orderId',
    as: 'providerTransactions'
});
ProviderTransaction.belongsTo(Order, {
    foreignKey: 'orderId',
    as: 'order'
});

User.hasMany(ProviderTransaction, {
    foreignKey: 'userId',
    as: 'providerTransactions'
});
ProviderTransaction.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// User has many MoMoDeposits
User.hasMany(MoMoDeposit, {
    foreignKey: 'userId',
    as: 'momoDeposits'
});
MoMoDeposit.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// ==========================================
// STORE MODULE ASSOCIATIONS
// ==========================================

// User has one Store
User.hasOne(Store, {
    foreignKey: 'userId',
    as: 'store',
    onDelete: 'CASCADE'
});
Store.belongsTo(User, {
    foreignKey: 'userId',
    as: 'owner'
});

// Store has many StoreProducts
Store.hasMany(StoreProduct, {
    foreignKey: 'storeId',
    as: 'products',
    onDelete: 'CASCADE'
});
StoreProduct.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// Store has many StoreOrders
Store.hasMany(StoreOrder, {
    foreignKey: 'storeId',
    as: 'storeOrders',
    onDelete: 'CASCADE'
});
StoreOrder.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// Store has one SettlementAccount
Store.hasOne(SettlementAccount, {
    foreignKey: 'storeId',
    as: 'settlementAccount',
    onDelete: 'CASCADE'
});
SettlementAccount.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// Store has many LedgerEntries
Store.hasMany(LedgerEntry, {
    foreignKey: 'storeId',
    as: 'ledgerEntries',
    onDelete: 'CASCADE'
});
LedgerEntry.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// Store has many Payouts
Store.hasMany(Payout, {
    foreignKey: 'storeId',
    as: 'payouts',
    onDelete: 'CASCADE'
});
Payout.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// User has many Payouts
User.hasMany(Payout, {
    foreignKey: 'userId',
    as: 'payouts'
});
Payout.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

// Store has many ReconciliationRecords
Store.hasMany(ReconciliationRecord, {
    foreignKey: 'storeId',
    as: 'reconciliations'
});
ReconciliationRecord.belongsTo(Store, {
    foreignKey: 'storeId',
    as: 'store'
});

// User has many ApiKeys
User.hasMany(ApiKey, {
    foreignKey: 'userId',
    as: 'apiKeys',
    onDelete: 'CASCADE'
});
ApiKey.belongsTo(User, {
    foreignKey: 'userId',
    as: 'owner'
});

module.exports = {
    sequelize,
    User,
    Wallet,
    Transaction,
    Order,
    AdminAuditLog,
    IdempotencyKey,
    Package,
    Setting,
    ProviderTransaction,
    MoMoDeposit,
    Store,
    StoreProduct,
    StoreOrder,
    LedgerEntry,
    SettlementAccount,
    Payout,
    ReconciliationRecord,
    ApiKey
};

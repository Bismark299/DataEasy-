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
    ProviderTransaction
};

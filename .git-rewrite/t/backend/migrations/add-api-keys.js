/**
 * Migration: Add API Keys table
 * Enables external developers to integrate with DataEasy+ API
 *
 * Run: node backend/migrations/add-api-keys.js
 * Rollback: node backend/migrations/add-api-keys.js --down
 */

const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

async function up() {
    const qi = sequelize.getQueryInterface();

    console.log('Creating api_keys table...');
    await qi.createTable('api_keys', {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE'
        },
        name: { type: DataTypes.STRING(100), allowNull: false },
        keyPrefix: { type: DataTypes.STRING(12), allowNull: false },
        keyHash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
        permissions: { type: DataTypes.JSONB, defaultValue: ['packages:read', 'orders:create', 'orders:read'] },
        allowedIPs: { type: DataTypes.JSONB, defaultValue: [] },
        allowedDomains: { type: DataTypes.JSONB, defaultValue: [] },
        isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
        lastUsedAt: { type: DataTypes.DATE, allowNull: true },
        lastUsedIP: { type: DataTypes.STRING(45), allowNull: true },
        requestCount: { type: DataTypes.INTEGER, defaultValue: 0 },
        rateLimit: { type: DataTypes.INTEGER, defaultValue: 60 },
        expiresAt: { type: DataTypes.DATE, allowNull: true },
        metadata: { type: DataTypes.JSONB, defaultValue: {} },
        createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    });

    await qi.addIndex('api_keys', ['userId'], { name: 'api_keys_user_id' });
    await qi.addIndex('api_keys', ['keyHash'], { unique: true, name: 'api_keys_key_hash_unique' });
    await qi.addIndex('api_keys', ['isActive'], { name: 'api_keys_is_active' });

    console.log('✅ api_keys table created');
}

async function down() {
    const qi = sequelize.getQueryInterface();
    console.log('Dropping api_keys table...');
    await qi.dropTable('api_keys');
    console.log('✅ api_keys table dropped');
}

// Run migration
(async () => {
    try {
        await sequelize.authenticate();
        console.log('📦 Database connected');

        const isDown = process.argv.includes('--down');
        if (isDown) {
            await down();
        } else {
            await up();
        }

        console.log('✅ Migration complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
})();

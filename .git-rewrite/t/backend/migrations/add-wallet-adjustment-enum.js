/**
 * Migration: Add WALLET_ADJUSTMENT action and wallet targetType to AdminAuditLog
 */

require('dotenv').config();
const { sequelize } = require('../config/database');

async function up() {
    try {
        // Add WALLET_ADJUSTMENT to action enum
        await sequelize.query(`
            ALTER TYPE "enum_admin_audit_logs_action" ADD VALUE IF NOT EXISTS 'WALLET_ADJUSTMENT';
        `);
        console.log('Added WALLET_ADJUSTMENT to action enum');
        
        // Add 'wallet' to targetType enum
        await sequelize.query(`
            ALTER TYPE "enum_admin_audit_logs_targetType" ADD VALUE IF NOT EXISTS 'wallet';
        `);
        console.log('Added wallet to targetType enum');
        
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    }
}

// Run migration
if (require.main === module) {
    up()
        .then(() => {
            console.log('Migration completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { up };

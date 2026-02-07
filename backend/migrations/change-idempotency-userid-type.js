/**
 * Migration: Change IdempotencyKey userId from UUID to STRING
 * This allows admin operations to use username instead of UUID
 */

require('dotenv').config();
const { sequelize } = require('../config/database');

async function up() {
    try {
        // First drop the foreign key constraint
        await sequelize.query(`
            ALTER TABLE "idempotency_keys" 
            DROP CONSTRAINT IF EXISTS "idempotency_keys_userId_fkey";
        `);
        console.log('Dropped foreign key constraint');
        
        // Change userId column from UUID to VARCHAR
        await sequelize.query(`
            ALTER TABLE "idempotency_keys" 
            ALTER COLUMN "userId" TYPE VARCHAR(255) USING "userId"::VARCHAR(255);
        `);
        
        console.log('Successfully changed idempotency_keys.userId to VARCHAR');
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    }
}

async function down() {
    try {
        // This might fail if there are non-UUID values
        await sequelize.query(`
            ALTER TABLE "IdempotencyKeys" 
            ALTER COLUMN "userId" TYPE UUID USING "userId"::UUID;
        `);
        
        console.log('Successfully reverted IdempotencyKeys.userId to UUID');
    } catch (error) {
        console.error('Rollback error:', error);
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

module.exports = { up, down };

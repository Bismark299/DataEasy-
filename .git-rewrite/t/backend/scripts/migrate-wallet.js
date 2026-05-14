/**
 * Migration: Add optimistic locking columns to wallets table
 */

require('dotenv').config();
const { sequelize } = require('../config/database');

async function migrate() {
    try {
        console.log('Running wallet migration...');
        
        // Add version column if not exists
        await sequelize.query(`
            ALTER TABLE wallets 
            ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 0 NOT NULL
        `);
        console.log('✅ Added version column');
        
        // Add lockedUntil column if not exists
        await sequelize.query(`
            ALTER TABLE wallets 
            ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE
        `);
        console.log('✅ Added lockedUntil column');
        
        // Update existing rows to have version = 0
        await sequelize.query(`
            UPDATE wallets SET version = 0 WHERE version IS NULL
        `);
        console.log('✅ Initialized version for existing rows');
        
        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        // If column already exists, that's fine
        if (error.message.includes('already exists')) {
            console.log('✅ Columns already exist, skipping');
            process.exit(0);
        }
        console.error('Migration error:', error);
        process.exit(1);
    }
}

migrate();

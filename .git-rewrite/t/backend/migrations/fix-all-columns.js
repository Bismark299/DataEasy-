/**
 * Migration: Fix All Missing Columns
 * Run this on Render to ensure all columns exist
 * 
 * Run: node migrations/fix-all-columns.js
 */

require('dotenv').config();
const { sequelize } = require('../config/database');

async function runMigration() {
    console.log('🔧 Running column fix migration...\n');
    
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected\n');
        
        // List of ALTER TABLE statements to add missing columns
        const alterStatements = [
            // Users table
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "agentCode" VARCHAR(20) UNIQUE`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP WITH TIME ZONE`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'agent'`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT false`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)`,
            
            // Wallets table
            `ALTER TABLE wallets ADD COLUMN IF NOT EXISTS "reservedBalance" DECIMAL(10,2) DEFAULT 0`,
            
            // Orders table - ensure all columns exist
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "processedBy" VARCHAR(100)`,
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP WITH TIME ZONE`,
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT`,
            
            // Transactions table
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "orderId" UUID`,
            
            // Packages table - role prices
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(10,2)`,
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "superDealerPrice" DECIMAL(10,2)`,
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "dealerPrice" DECIMAL(10,2)`,
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "superAgentPrice" DECIMAL(10,2)`,
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS popular BOOLEAN DEFAULT false`,
            `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER DEFAULT 0`,
        ];
        
        for (const sql of alterStatements) {
            try {
                await sequelize.query(sql);
                console.log(`✅ ${sql.substring(0, 60)}...`);
            } catch (err) {
                if (err.message.includes('already exists')) {
                    console.log(`⏭️  Column already exists, skipping...`);
                } else {
                    console.log(`⚠️  ${err.message}`);
                }
            }
        }
        
        console.log('\n✅ Migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();

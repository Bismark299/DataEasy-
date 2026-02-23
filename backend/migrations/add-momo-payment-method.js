/**
 * Migration: Add 'momo' to paymentMethod enum in transactions table
 * Run: node migrations/add-momo-payment-method.js
 */

const { sequelize } = require('../config/database');

async function migrate() {
    try {
        console.log('Adding momo to paymentMethod enum...');
        
        // Add 'momo' to the enum type
        await sequelize.query(`
            ALTER TYPE "enum_transactions_paymentMethod" ADD VALUE IF NOT EXISTS 'momo';
        `);
        
        console.log('✓ Added momo to paymentMethod enum');
        
        // Update existing MoMo transactions to use 'momo' instead of 'manual'
        const [results] = await sequelize.query(`
            UPDATE transactions 
            SET "paymentMethod" = 'momo' 
            WHERE "paymentMethod" = 'manual' 
            AND (description LIKE 'MoMo%' OR reference LIKE 'MOMO-%');
        `);
        
        console.log(`✓ Updated existing MoMo transactions`);
        
        console.log('\n✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    }
}

migrate();

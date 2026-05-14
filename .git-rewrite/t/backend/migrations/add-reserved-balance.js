/**
 * Migration: Add reservedBalance column to wallets table
 * Purpose: Support two-phase commit for loss prevention
 */

// Load environment variables
require('dotenv').config();

const { sequelize } = require('../config/database');

async function migrate() {
    try {
        console.log('Starting migration: add reservedBalance column...');
        
        // Check if column exists first
        const [results] = await sequelize.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'wallets' AND column_name = 'reservedBalance'
        `);
        
        if (results.length > 0) {
            console.log('Column reservedBalance already exists. Skipping...');
            return;
        }
        
        // Add the column
        await sequelize.query(`
            ALTER TABLE wallets 
            ADD COLUMN "reservedBalance" DECIMAL(12, 2) DEFAULT 0 NOT NULL
        `);
        
        console.log('✓ Successfully added reservedBalance column to wallets table');
        
    } catch (error) {
        console.error('Migration failed:', error.message);
        throw error;
    } finally {
        await sequelize.close();
    }
}

// Run migration
migrate()
    .then(() => {
        console.log('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });

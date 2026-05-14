/**
 * Migration: Add role column to users table
 * Run this once to add the role column
 */

require('dotenv').config({ path: '../.env' });

const { sequelize } = require('../config/database');

async function migrate() {
    try {
        console.log('🔄 Starting migration: Add role column...');
        
        // Check if column exists
        const [results] = await sequelize.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'role'
        `);
        
        if (results.length > 0) {
            console.log('✅ Role column already exists, skipping.');
            return;
        }
        
        // Add the role column
        await sequelize.query(`
            ALTER TABLE users 
            ADD COLUMN role VARCHAR(20) DEFAULT 'agent'
        `);
        
        console.log('✅ Migration complete: role column added');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
    } finally {
        await sequelize.close();
        process.exit(0);
    }
}

migrate();

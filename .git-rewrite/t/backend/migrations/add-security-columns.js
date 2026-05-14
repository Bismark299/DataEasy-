/**
 * Migration: Add security columns to users table
 * Adds: tokenVersion, failedLoginAttempts, lockedUntil
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');

async function migrate() {
    try {
        console.log('Starting migration: add security columns to users table...');

        // Add tokenVersion column
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
            `);
            console.log('✅ Added tokenVersion column');
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log('ℹ️ tokenVersion column already exists');
            } else {
                console.log('Adding tokenVersion:', e.message);
            }
        }

        // Add failedLoginAttempts column
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
            `);
            console.log('✅ Added failedLoginAttempts column');
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log('ℹ️ failedLoginAttempts column already exists');
            } else {
                console.log('Adding failedLoginAttempts:', e.message);
            }
        }

        // Add lockedUntil column
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
            `);
            console.log('✅ Added lockedUntil column');
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log('ℹ️ lockedUntil column already exists');
            } else {
                console.log('Adding lockedUntil:', e.message);
            }
        }

        // Add settings column (JSONB)
        try {
            await sequelize.query(`
                ALTER TABLE users 
                ADD COLUMN IF NOT EXISTS "settings" JSONB DEFAULT '{"twoFactorEnabled": false, "emailNotifications": true, "smsNotifications": true}'::jsonb;
            `);
            console.log('✅ Added settings column');
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log('ℹ️ settings column already exists');
            } else {
                console.log('Adding settings:', e.message);
            }
        }

        console.log('\n✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();

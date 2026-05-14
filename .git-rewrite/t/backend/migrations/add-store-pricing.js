/**
 * Migration: Add pricing JSONB column to stores table
 * Stores agent's selling prices per package
 */

const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function up() {
    console.log('Adding pricing column to stores table...');

    // Check if column already exists
    const [results] = await sequelize.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'stores' AND column_name = 'pricing'`,
        { type: QueryTypes.SELECT }
    ).catch(() => [[]]);

    if (results && results.column_name) {
        console.log('pricing column already exists, skipping.');
        return;
    }

    await sequelize.query(`
        ALTER TABLE stores 
        ADD COLUMN IF NOT EXISTS pricing JSONB DEFAULT '{}'::jsonb;
    `);

    console.log('✅ pricing column added to stores table');
}

async function down() {
    await sequelize.query(`
        ALTER TABLE stores DROP COLUMN IF EXISTS pricing;
    `);
    console.log('✅ pricing column removed from stores table');
}

// Run if called directly
if (require.main === module) {
    const { connectDB } = require('../config/database');
    connectDB().then(() => up()).then(() => {
        console.log('Migration complete');
        process.exit(0);
    }).catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}

module.exports = { up, down };

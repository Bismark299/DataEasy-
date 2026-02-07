/**
 * Migration: Add role-based pricing columns and UPDATE_USER enum
 * 
 * This adds:
 * - superDealerPrice, dealerPrice, superAgentPrice columns to packages
 * - UPDATE_USER, USER_UPDATE, NETWORK_AVAILABILITY_UPDATE to admin_audit_logs action enum
 */

// Load environment variables from parent directory
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Sequelize } = require('sequelize');

// Create fresh connection
const sequelize = new Sequelize(
    process.env.DB_NAME || 'btopup_gh',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false
    }
);

async function runMigration() {
    console.log('🚀 Starting role-based pricing migration...\n');

    try {
        // Add role-based price columns to packages table
        console.log('📦 Adding role-based price columns to packages table...');
        
        const columnsToAdd = [
            { name: 'superDealerPrice', type: 'DECIMAL(10, 2)' },
            { name: 'dealerPrice', type: 'DECIMAL(10, 2)' },
            { name: 'superAgentPrice', type: 'DECIMAL(10, 2)' }
        ];

        for (const col of columnsToAdd) {
            try {
                await sequelize.query(`
                    ALTER TABLE packages 
                    ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type};
                `);
                console.log(`   ✅ Added column ${col.name}`);
            } catch (err) {
                if (err.message.includes('already exists')) {
                    console.log(`   ⏩ Column ${col.name} already exists, skipping`);
                } else {
                    throw err;
                }
            }
        }

        // Add new enum values to admin_audit_logs action enum
        console.log('\n📋 Adding new action enum values to admin_audit_logs...');
        
        const enumValues = ['UPDATE_USER', 'USER_UPDATE', 'NETWORK_AVAILABILITY_UPDATE'];
        
        for (const enumValue of enumValues) {
            try {
                await sequelize.query(`
                    ALTER TYPE enum_admin_audit_logs_action ADD VALUE IF NOT EXISTS '${enumValue}';
                `);
                console.log(`   ✅ Added enum value: ${enumValue}`);
            } catch (err) {
                if (err.message.includes('already exists')) {
                    console.log(`   ⏩ Enum value ${enumValue} already exists, skipping`);
                } else {
                    console.log(`   ⚠️ Could not add ${enumValue}: ${err.message}`);
                }
            }
        }

        // Set default values: copy from price column where null
        console.log('\n💰 Setting default role prices (copying from agent price)...');
        
        await sequelize.query(`
            UPDATE packages 
            SET "superDealerPrice" = price 
            WHERE "superDealerPrice" IS NULL;
        `);
        await sequelize.query(`
            UPDATE packages 
            SET "dealerPrice" = price 
            WHERE "dealerPrice" IS NULL;
        `);
        await sequelize.query(`
            UPDATE packages 
            SET "superAgentPrice" = price 
            WHERE "superAgentPrice" IS NULL;
        `);
        console.log('   ✅ Default prices set');

        console.log('\n✅ Migration completed successfully!');
        console.log('\n📝 Summary:');
        console.log('   - Added superDealerPrice, dealerPrice, superAgentPrice columns');
        console.log('   - Added UPDATE_USER, USER_UPDATE, NETWORK_AVAILABILITY_UPDATE enum values');
        console.log('   - Set default role prices from agent price');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    runMigration()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = runMigration;

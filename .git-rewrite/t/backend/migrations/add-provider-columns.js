/**
 * Migration to add provider tracking columns to orders table
 * These columns are needed for MCBIS integration
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('Adding provider tracking columns to orders table...');
    
    // Add providerReference column
    await sequelize.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS "providerReference" VARCHAR(255)
    `);
    console.log('✓ Added providerReference column');
    
    // Add deliveryError column
    await sequelize.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS "deliveryError" TEXT
    `);
    console.log('✓ Added deliveryError column');
    
    // Add sentToProviderAt column
    await sequelize.query(`
      ALTER TABLE orders 
      ADD COLUMN IF NOT EXISTS "sentToProviderAt" TIMESTAMP WITH TIME ZONE
    `);
    console.log('✓ Added sentToProviderAt column');
    
    // Add index for faster lookups
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_provider_reference 
      ON orders ("providerReference")
    `);
    console.log('✓ Added index on providerReference');
    
    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

migrate();

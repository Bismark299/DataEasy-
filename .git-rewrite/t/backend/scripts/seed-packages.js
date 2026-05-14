/**
 * Seed Packages Script
 * Populates the packages table with initial data
 * 
 * Run: node scripts/seed-packages.js
 */

require('dotenv').config();
const { sequelize } = require('../config/database');
const Package = require('../models/Package');

// Package data with prices (GH₵)
const packagesData = {
    MTN: [
        { id: 'mtn-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 4.50, costPrice: 4.00 },
        { id: 'mtn-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 9.00, costPrice: 8.00 },
        { id: 'mtn-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 13.00, costPrice: 11.50 },
        { id: 'mtn-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 17.50, costPrice: 15.50 },
        { id: 'mtn-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 22.00, costPrice: 19.50, popular: true },
        { id: 'mtn-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 26.00, costPrice: 23.00 },
        { id: 'mtn-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 35.00, costPrice: 31.00 },
        { id: 'mtn-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 43.00, costPrice: 38.00, popular: true },
        { id: 'mtn-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 64.00, costPrice: 57.00 },
        { id: 'mtn-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 85.00, costPrice: 75.00 },
        { id: 'mtn-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 105.00, costPrice: 93.00 },
        { id: 'mtn-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 125.00, costPrice: 111.00 },
        { id: 'mtn-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 165.00, costPrice: 146.00 },
        { id: 'mtn-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 205.00, costPrice: 182.00 }
    ],
    AirtelTigo: [
        { id: 'at-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 4.50, costPrice: 4.00 },
        { id: 'at-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 9.00, costPrice: 8.00 },
        { id: 'at-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 13.00, costPrice: 11.50 },
        { id: 'at-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 17.50, costPrice: 15.50 },
        { id: 'at-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 22.00, costPrice: 19.50, popular: true },
        { id: 'at-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 26.00, costPrice: 23.00 },
        { id: 'at-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 35.00, costPrice: 31.00 },
        { id: 'at-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 43.00, costPrice: 38.00, popular: true },
        { id: 'at-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 64.00, costPrice: 57.00 },
        { id: 'at-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 85.00, costPrice: 75.00 },
        { id: 'at-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 105.00, costPrice: 93.00 },
        { id: 'at-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 125.00, costPrice: 111.00 },
        { id: 'at-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 165.00, costPrice: 146.00 },
        { id: 'at-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 205.00, costPrice: 182.00 }
    ],
    Telecel: [
        { id: 'tc-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 4.50, costPrice: 4.00 },
        { id: 'tc-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 9.00, costPrice: 8.00 },
        { id: 'tc-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 13.00, costPrice: 11.50 },
        { id: 'tc-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 17.50, costPrice: 15.50 },
        { id: 'tc-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 22.00, costPrice: 19.50, popular: true },
        { id: 'tc-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 26.00, costPrice: 23.00 },
        { id: 'tc-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 35.00, costPrice: 31.00 },
        { id: 'tc-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 43.00, costPrice: 38.00, popular: true },
        { id: 'tc-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 64.00, costPrice: 57.00 },
        { id: 'tc-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 85.00, costPrice: 75.00 },
        { id: 'tc-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 105.00, costPrice: 93.00 },
        { id: 'tc-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 125.00, costPrice: 111.00 },
        { id: 'tc-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 165.00, costPrice: 146.00 },
        { id: 'tc-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 205.00, costPrice: 182.00 }
    ]
};

async function seedPackages() {
    try {
        console.log('🌱 Starting package seeding...');
        
        // Connect to database
        await sequelize.authenticate();
        console.log('✅ Database connected');
        
        // Sync Package model (creates table if not exists)
        await Package.sync();
        
        let created = 0;
        let updated = 0;
        
        for (const [network, packages] of Object.entries(packagesData)) {
            console.log(`\n📦 Processing ${network} packages...`);
            
            for (let i = 0; i < packages.length; i++) {
                const pkg = packages[i];
                
                const [record, wasCreated] = await Package.upsert({
                    id: pkg.id,
                    network: network,
                    name: pkg.name,
                    data: pkg.data,
                    validity: pkg.validity,
                    price: pkg.price,
                    costPrice: pkg.costPrice,
                    popular: pkg.popular || false,
                    isActive: true,
                    sortOrder: i + 1
                });
                
                if (wasCreated) {
                    created++;
                    console.log(`  ✅ Created: ${pkg.id} - GH₵${pkg.price}`);
                } else {
                    updated++;
                    console.log(`  🔄 Updated: ${pkg.id} - GH₵${pkg.price}`);
                }
            }
        }
        
        console.log(`\n✅ Seeding complete!`);
        console.log(`   Created: ${created} packages`);
        console.log(`   Updated: ${updated} packages`);
        console.log(`   Total: ${created + updated} packages`);
        
        // Verify
        const count = await Package.count();
        console.log(`\n📊 Database now has ${count} packages`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

seedPackages();

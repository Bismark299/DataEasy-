/**
 * Database Configuration
 * PostgreSQL Connection with Sequelize
 */

const { Sequelize } = require('sequelize');

// Parse connection string or use individual env vars
const databaseUrl = process.env.DATABASE_URL;

// Slow query threshold (milliseconds)
const SLOW_QUERY_THRESHOLD = parseInt(process.env.SLOW_QUERY_THRESHOLD) || 500;

/**
 * Custom logging function that tracks slow queries
 */
const queryLogger = (sql, timing) => {
    if (process.env.NODE_ENV === 'development') {
        console.log(sql);
    }
    
    // Log slow queries in any environment
    if (timing && timing.duration > SLOW_QUERY_THRESHOLD) {
        console.warn(`⚠️ SLOW QUERY (${timing.duration}ms):`, sql.substring(0, 200));
    }
};

let sequelize;

if (databaseUrl) {
    // Use connection string (for production/Heroku/Railway)
    sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        logging: queryLogger,
        benchmark: true, // Enable timing
        dialectOptions: {
            ssl: process.env.NODE_ENV === 'production' ? {
                require: true,
                rejectUnauthorized: false
            } : false
        },
        pool: {
            max: 10,     // Increased for better concurrency
            min: 2,      // Keep some connections warm
            acquire: 30000,
            idle: 10000
        }
    });
} else {
    // Use individual environment variables
    // SECURITY: No default credentials - must be explicitly set
    if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('DB_USER and DB_PASSWORD must be set in production');
        }
        console.warn('⚠️ Using development database defaults. Set DB_USER/DB_PASSWORD for production.');
    }
    
    sequelize = new Sequelize(
        process.env.DB_NAME || 'dataeasy_plus',
        process.env.DB_USER || 'postgres',
        process.env.DB_PASSWORD || '',
        {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            dialect: 'postgres',
            logging: queryLogger,
            benchmark: true,
            pool: {
                max: 10,
                min: 2,
                acquire: 30000,
                idle: 10000
            }
        }
    );
}

// Test connection function
const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ PostgreSQL Connected Successfully');
        
        // Import models to ensure they're registered
        require('../models');
        
        // Sync strategy based on environment
        if (process.env.NODE_ENV === 'production') {
            // IMPORTANT: Fix columns BEFORE sync to avoid errors
            // This ensures tables have all columns before Sequelize tries to use them
            await fixMissingColumns();
            
            // Now sync (create tables if they don't exist)
            await sequelize.sync({ force: false });
            console.log('✅ Database synchronized (production mode)');
        } else {
            // In development, fix missing columns then sync
            await fixMissingColumns();
            await sequelize.sync();
            console.log('✅ Database synchronized');
        }
        
        // Auto-seed packages if database is empty
        await seedPackagesIfEmpty();
        
        // Auto-seed test user if enabled (for production testing)
        await seedTestUserIfEmpty();
        
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Full error:', error);
        
        // In development, continue without DB (use localStorage fallback)
        if (process.env.NODE_ENV === 'development') {
            console.log('⚠️  Running without database - localStorage fallback active');
            return false;
        }
        
        // In production, exit on DB failure
        console.error('❌ FATAL: Cannot start without database in production');
        process.exit(1);
    }
};

/**
 * Auto-seed packages if database is empty
 */
const seedPackagesIfEmpty = async () => {
    try {
        const Package = require('../models/Package');
        const count = await Package.count();
        
        if (count === 0) {
            console.log('📦 No packages found - auto-seeding...');
            
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
            
            let total = 0;
            for (const [network, packages] of Object.entries(packagesData)) {
                for (let i = 0; i < packages.length; i++) {
                    const pkg = packages[i];
                    await Package.create({
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
                    total++;
                }
            }
            
            console.log(`✅ Auto-seeded ${total} packages`);
        } else {
            console.log(`✅ Found ${count} existing packages`);
        }
    } catch (error) {
        console.error('⚠️ Package seeding error:', error.message);
        // Don't fail startup - packages can be added manually via admin
    }
};

/**
 * Auto-seed a test user if database is empty (for production testing)
 */
const seedTestUserIfEmpty = async () => {
    try {
        const User = require('../models/User');
        const Wallet = require('../models/Wallet');
        const count = await User.count();
        
        if (count === 0 && process.env.SEED_TEST_USER === 'true') {
            console.log('👤 No users found - creating test user...');
            
            // Create test user (password will be hashed by model hook)
            const testUser = await User.create({
                fullName: 'Test User',
                email: 'test@dataeasy.com',
                phone: '0241234567',
                password: 'Test123!'
            });
            
            // Create wallet for test user
            await Wallet.create({ userId: testUser.id });
            
            console.log('✅ Test user created: test@dataeasy.com / Test123!');
        }
    } catch (error) {
        console.error('⚠️ Test user seeding error:', error.message);
        // Don't fail startup
    }
};

/**
 * Fix missing columns in production database
 * This ensures all columns exist even if sync didn't add them
 */
const fixMissingColumns = async () => {
    console.log('🔧 Checking for missing columns...');
    
    // First, ensure tables exist (they might not on first deploy)
    const createTableStatements = [
        `CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            "fullName" VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            phone VARCHAR(15) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS wallets (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            "userId" UUID NOT NULL UNIQUE REFERENCES users(id),
            balance DECIMAL(10,2) DEFAULT 0,
            currency VARCHAR(10) DEFAULT 'GHS',
            "totalTopups" DECIMAL(10,2) DEFAULT 0,
            "totalSpent" DECIMAL(10,2) DEFAULT 0,
            version INTEGER DEFAULT 0,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS packages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            network VARCHAR(50) NOT NULL,
            name VARCHAR(100) NOT NULL,
            data VARCHAR(50) NOT NULL,
            validity VARCHAR(50) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            popular BOOLEAN DEFAULT false,
            "isActive" BOOLEAN DEFAULT true,
            "sortOrder" INTEGER DEFAULT 0,
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS momo_deposits (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            "transactionId" VARCHAR(50) NOT NULL UNIQUE,
            amount DECIMAL(12,2) NOT NULL,
            "senderPhone" VARCHAR(20) NOT NULL,
            reference VARCHAR(100),
            "rawMessage" TEXT,
            "userId" UUID REFERENCES users(id),
            status VARCHAR(20) DEFAULT 'pending',
            "statusMessage" VARCHAR(500),
            "walletTransactionId" UUID,
            "smsReceivedAt" TIMESTAMP WITH TIME ZONE,
            "deviceInfo" JSONB DEFAULT '{}',
            "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )`
    ];
    
    for (const sql of createTableStatements) {
        try {
            await sequelize.query(sql);
        } catch (err) {
            // Table might already exist with different structure, that's ok
        }
    }
    
    const alterStatements = [
        // Users table
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "agentCode" VARCHAR(20)`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'agent'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT false`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(255)`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"twoFactorEnabled":false,"emailNotifications":true,"smsNotifications":true}'::jsonb`,
        
        // Wallets table
        `ALTER TABLE wallets ADD COLUMN IF NOT EXISTS "reservedBalance" DECIMAL(10,2) DEFAULT 0`,
        `ALTER TABLE wallets ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE`,
        
        // Packages table - role prices
        `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(10,2)`,
        `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "superDealerPrice" DECIMAL(10,2)`,
        `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "dealerPrice" DECIMAL(10,2)`,
        `ALTER TABLE packages ADD COLUMN IF NOT EXISTS "superAgentPrice" DECIMAL(10,2)`,
        
        // MoMo deposits table - ensure all columns exist
        `ALTER TABLE momo_deposits ADD COLUMN IF NOT EXISTS "statusMessage" VARCHAR(500)`,
        `ALTER TABLE momo_deposits ADD COLUMN IF NOT EXISTS "smsReceivedAt" TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE momo_deposits ADD COLUMN IF NOT EXISTS "walletTransactionId" UUID`,
        `ALTER TABLE momo_deposits ADD COLUMN IF NOT EXISTS "deviceInfo" JSONB DEFAULT '{}'`,
        
        // Stores table - pricing for agent selling prices
        `ALTER TABLE stores ADD COLUMN IF NOT EXISTS pricing JSONB DEFAULT '{}'::jsonb`,
    ];
    
    let fixed = 0;
    for (const sql of alterStatements) {
        try {
            await sequelize.query(sql);
            fixed++;
        } catch (err) {
            // Ignore errors (column might already exist or table doesn't exist yet)
        }
    }
    
    console.log(`✅ Column check complete (${fixed} statements executed)`);
};

// Graceful shutdown - only in production or when explicitly requested
if (process.env.NODE_ENV === 'production') {
    process.on('SIGINT', async () => {
        await sequelize.close();
        console.log('PostgreSQL connection closed');
        process.exit(0);
    });
}

module.exports = { sequelize, connectDB };

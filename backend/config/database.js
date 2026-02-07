/**
 * Database Configuration
 * PostgreSQL Connection with Sequelize
 */

const { Sequelize } = require('sequelize');

// Parse connection string or use individual env vars
const databaseUrl = process.env.DATABASE_URL;

let sequelize;

if (databaseUrl) {
    // Use connection string (for production/Heroku/Railway)
    sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        dialectOptions: {
            ssl: process.env.NODE_ENV === 'production' ? {
                require: true,
                rejectUnauthorized: false
            } : false
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    });
} else {
    // Use individual environment variables
    sequelize = new Sequelize(
        process.env.DB_NAME || 'btopup_gh',
        process.env.DB_USER || 'postgres',
        process.env.DB_PASSWORD || 'postgres',
        {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5432,
            dialect: 'postgres',
            logging: process.env.NODE_ENV === 'development' ? console.log : false,
            pool: {
                max: 5,
                min: 0,
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
            // In production, use alter: true to safely update schema
            // This adds new columns but doesn't drop existing data
            await sequelize.sync({ alter: true });
            console.log('✅ Database synchronized (production - alter mode)');
        } else {
            // In development, just sync without alter
            await sequelize.sync();
            console.log('✅ Database synchronized');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        
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

// Graceful shutdown - only in production or when explicitly requested
if (process.env.NODE_ENV === 'production') {
    process.on('SIGINT', async () => {
        await sequelize.close();
        console.log('PostgreSQL connection closed');
        process.exit(0);
    });
}

module.exports = { sequelize, connectDB };

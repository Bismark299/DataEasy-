/**
 * Btopup GH - Backend Server
 * Main entry point
 */

console.log('🚀 Booting server...');

// Global error handlers - MUST be first
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - keep server running
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    // Don't exit - keep server running
});

require('dotenv').config();

// Validate critical ENV vars
console.log('📋 Checking environment...');
const isProduction = process.env.NODE_ENV === 'production';

// Critical env vars that MUST be set in production
const criticalEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
const recommendedEnvVars = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'PAYSTACK_SECRET_KEY'];

for (const env of criticalEnvVars) {
    if (!process.env[env]) {
        if (isProduction) {
            console.error(`❌ FATAL: ${env} is required in production`);
            process.exit(1);
        } else {
            console.warn(`⚠️ Warning: ${env} not set (required in production)`);
        }
    }
}

for (const env of recommendedEnvVars) {
    if (!process.env[env]) {
        console.warn(`⚠️ Warning: ${env} not set (recommended for production)`);
    }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { connectDB } = require('./config/database');
const { httpsRedirect, requestTimeout, sanitizeErrors, securityHeaders } = require('./middleware/security');
const { maintenanceMode } = require('./middleware/maintenance');

console.log('📦 Loading routes...');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');

console.log('✅ Routes loaded successfully');

const app = express();

// Connect to Database (don't block server start)
connectDB().catch(err => {
    console.error('❌ Database connection failed:', err.message);
    console.log('⚠️ Server will continue without database');
});

// Security Middleware
app.use(helmet());
app.use(securityHeaders);

// HTTPS redirect in production
app.use(httpsRedirect);

// Request timeout (30 seconds)
app.use(requestTimeout(30000));

// Cookie parser for CSRF
app.use(cookieParser());

// Request Logging - shows HTTP status codes
app.use(morgan('dev'));

// CORS - Allow frontend (both localhost and 127.0.0.1)
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
    process.env.FRONTEND_URL,
    // Add multiple frontend URLs if needed (comma-separated in env)
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
].filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({
    origin: function(origin, callback) {
        // In production, allow requests with no origin for same-origin requests
        // This is needed when frontend and backend are on the same domain
        if (!origin) {
            if (isProduction) {
                // Allow same-origin requests (no origin header for same domain)
                return callback(null, true);
            }
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // In production, be strict about origins
        if (isProduction) {
            console.warn('CORS: Blocked origin:', origin);
            return callback(new Error('Not allowed by CORS'), false);
        }
        return callback(null, false);
    },
    credentials: true
}));

// Maintenance Mode - blocks API when enabled (must be before routes)
app.use('/api/', maintenanceMode);

// Rate Limiting - general API (more generous for admin dashboard usage)
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 300, // 300 requests per minute
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => {
        // Skip rate limiting for admin routes (they have their own limiters for sensitive ops)
        if (req.path.startsWith('/api/admin')) return true;
        // Skip for public read-only endpoints
        if (req.path === '/api/health') return true;
        if (req.path === '/api/orders/packages' && req.method === 'GET') return true;
        return false;
    }
});
app.use('/api/', limiter);

// Admin routes limiter - generous for read operations
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute for admin dashboard
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/admin', adminLimiter);

// Body Parser - except for webhooks (needs raw body)
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health Check - includes database status
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'ok',
        message: 'Btopup GH API is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    };

    // Check database connection
    try {
        const { sequelize } = require('./config/database');
        await sequelize.authenticate();
        health.database = 'connected';
    } catch (error) {
        health.database = 'disconnected';
        health.status = 'degraded';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhook', webhookRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler - sanitizes errors in production
app.use(sanitizeErrors);

// Start Server
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║     Btopup GH API Server                  ║
    ║     Running on port ${PORT}                   ║
    ║     Environment: ${process.env.NODE_ENV || 'development'}            ║
    ╚═══════════════════════════════════════════╝
    `);
    console.log('✅ Server is ready and listening');
    
    // Run price integrity validation on startup
    try {
        const { runStartupValidation } = require('./utils/priceIntegrity');
        await runStartupValidation(false); // Don't fail server, just log warnings
    } catch (error) {
        console.error('⚠️ Price integrity check error:', error.message);
    }

    // Start background MCBIS order sync service
    try {
        const { startBackgroundSync } = require('./services/orderStatusPoller');
        await startBackgroundSync();
        console.log('✅ Background MCBIS sync service started');
    } catch (error) {
        console.error('⚠️ Background sync start error:', error.message);
    }
});

// Handle server errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
    } else {
        console.error('❌ Server error:', err);
    }
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(async () => {
        console.log('✅ HTTP server closed');
        
        try {
            // Close database connection
            const { sequelize } = require('./config/database');
            await sequelize.close();
            console.log('✅ Database connection closed');
        } catch (err) {
            console.error('❌ Error closing database:', err.message);
        }
        
        console.log('👋 Graceful shutdown complete');
        process.exit(0);
    });
    
    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
    }, 30000); // 30 seconds
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Keep alive - prevent idle exit
setInterval(() => {}, 1000 * 60 * 60); // Keep event loop active

module.exports = app;

/**
 * DataEasy+ - Backend Server
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
const compression = require('compression');
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

// Enable gzip compression for all responses (significantly reduces payload size)
app.use(compression({
    level: 6, // Balanced compression level
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
        // Don't compress if client doesn't accept it
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// Database connection status
let dbConnected = false;

// Connect to Database and wait for it
const initDatabase = async () => {
    try {
        const result = await connectDB();
        dbConnected = result !== false;
        return dbConnected;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        console.log('⚠️ Server will continue without database');
        return false;
    }
};

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://cdn.tailwindcss.com",
                "https://js.paystack.co",
                "https://cdnjs.cloudflare.com",
                "https://checkout.paystack.com",
                "https://*.paystack.co",
                "https://*.paystack.com"
            ],
            scriptSrcElem: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.tailwindcss.com",
                "https://js.paystack.co",
                "https://cdnjs.cloudflare.com",
                "https://checkout.paystack.com",
                "https://*.paystack.co",
                "https://*.paystack.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com",
                "https://paystack.com",
                "https://*.paystack.com",
                "https://*.paystack.co"
            ],
            styleSrcElem: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com",
                "https://paystack.com",
                "https://*.paystack.com",
                "https://*.paystack.co"
            ],
            fontSrc: [
                "'self'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.gstatic.com"
            ],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
                "'self'",
                "https://api.paystack.co",
                "https://*.paystack.co",
                "https://*.paystack.com"
            ],
            frameSrc: [
                "https://js.paystack.co",
                "https://checkout.paystack.com",
                "https://*.paystack.com",
                "https://*.paystack.co"
            ]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(securityHeaders);

// HTTPS redirect in production
app.use(httpsRedirect);

// Request timeout (30 seconds)
app.use(requestTimeout(30000));

// Cookie parser for CSRF
app.use(cookieParser());

// Request Logging - shows HTTP status codes
app.use(morgan('dev'));

// CORS Configuration
// In production: Frontend and backend are on SAME origin (single Render service)
// So we allow same-origin requests and also handle cases where Origin header is sent
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5501',
    'http://127.0.0.1:5501',
    'http://localhost:9000',
    'http://127.0.0.1:9000',
    process.env.FRONTEND_URL,
    process.env.RENDER_EXTERNAL_URL,  // Render provides this automatically
    // Add multiple frontend URLs if needed (comma-separated in env)
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
].filter(Boolean);

// Log allowed origins for debugging
console.log('📋 CORS Allowed Origins:', allowedOrigins);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (same-origin, Postman, server-to-server)
        if (!origin) {
            return callback(null, true);
        }
        
        // In production, be more permissive since frontend/backend are same origin
        if (isProduction) {
            // Allow if origin matches any allowed origin
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            // Also allow if origin matches the request's host (same service)
            // This handles Render's URL pattern
            if (origin.includes('onrender.com') || origin.includes('render.com')) {
                console.log('CORS: Allowing Render origin:', origin);
                return callback(null, true);
            }
            // Allow any HTTPS origin in production for now (can tighten later)
            if (origin.startsWith('https://')) {
                console.log('CORS: Allowing HTTPS origin:', origin);
                return callback(null, true);
            }
            console.warn('CORS: Blocked origin:', origin);
            return callback(new Error('Not allowed by CORS'), false);
        }
        
        // In development, allow all origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Allow localhost variants in development
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
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
        message: 'DataEasy+ API is running',
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

// ==========================================
// SERVE STATIC FRONTEND FILES
// ==========================================
const path = require('path');
const frontendPath = path.join(__dirname, '..');

// Cache settings for static files (1 day for assets, improves load time)
const staticOptions = {
    maxAge: isProduction ? '1d' : 0, // Cache for 1 day in production
    etag: true,
    lastModified: true
};

// Serve static assets (CSS, JS, images) with caching
app.use('/assets', express.static(path.join(frontendPath, 'assets'), staticOptions));
app.use('/pages', express.static(path.join(frontendPath, 'pages'), staticOptions));
app.use('/admin', express.static(path.join(frontendPath, 'admin'), staticOptions));

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get('/ad.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'ad.html'));
});

// Serve pages/*.html routes
app.get('/pages/:page', (req, res) => {
    const pagePath = path.join(frontendPath, 'pages', req.params.page);
    res.sendFile(pagePath);
});

// Serve admin/*.html routes
app.get('/admin/:page', (req, res) => {
    const pagePath = path.join(frontendPath, 'admin', req.params.page);
    res.sendFile(pagePath);
});

// Fallback to index.html for SPA-style routing (if needed)
app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) {
        return next();
    }
    // Try to serve the requested file, or fallback to index
    const filePath = path.join(frontendPath, req.path);
    res.sendFile(filePath, (err) => {
        if (err) {
            res.sendFile(path.join(frontendPath, 'index.html'));
        }
    });
});

// 404 Handler (for API routes only now)
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Global Error Handler - sanitizes errors in production
app.use(sanitizeErrors);

// Start Server
const PORT = process.env.PORT || 5000;

// Initialize database before starting server
const startServer = async () => {
    // Wait for database to be ready
    await initDatabase();
    
    const server = app.listen(PORT, async () => {
        console.log(`
    ╔═══════════════════════════════════════════╗
    ║     DataEasy+ API Server                  ║
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
};

// Start the server
startServer();

// Keep alive - prevent idle exit
setInterval(() => {}, 1000 * 60 * 60); // Keep event loop active

module.exports = app;

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

// SECURITY: Validate JWT_SECRET strength
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret) {
    const weakSecrets = [
        'secret', 'password', 'jwt_secret', 'change_me', 'your-secret',
        'btopup_super_secret_key_change_in_production_12345',
        'CHANGE_THIS_GENERATE_64_CHAR_RANDOM_STRING'
    ];
    const isWeak = weakSecrets.some(weak => 
        jwtSecret.toLowerCase().includes(weak.toLowerCase())
    );
    
    if (jwtSecret.length < 32) {
        console.error('❌ SECURITY: JWT_SECRET must be at least 32 characters');
        if (isProduction) process.exit(1);
    } else if (isWeak) {
        console.error('❌ SECURITY: JWT_SECRET appears to be a placeholder. Generate a secure random key!');
        console.error('   Run: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
        if (isProduction) process.exit(1);
    } else {
        console.log('✅ JWT_SECRET strength: OK');
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
const momoRoutes = require('./routes/momo');
const storeRoutes = require('./routes/store');
const developerRoutes = require('./routes/developer');
const v1Routes = require('./routes/v1');
const lookupRoutes = require('./routes/lookup');

console.log('✅ Routes loaded successfully');

const app = express();

// Trust proxy - required for rate limiting behind Render's reverse proxy
// This tells Express to trust X-Forwarded-For headers from the first proxy
app.set('trust proxy', 1);

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
                "https://js.paystack.co",
                "https://cdnjs.cloudflare.com",
                "https://checkout.paystack.com",
                "https://*.paystack.co",
                "https://*.paystack.com"
            ],
            scriptSrcElem: [
                "'self'",
                "'unsafe-inline'",
                "https://js.paystack.co",
                "https://cdnjs.cloudflare.com",
                "https://checkout.paystack.com",
                "https://*.paystack.co",
                "https://*.paystack.com"
            ],
            scriptSrcAttr: [
                "'self'",
                "'unsafe-inline'"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com",
                "https://paystack.com",
                "https://*.paystack.com",
                "https://*.paystack.co"
            ],
            styleSrcElem: [
                "'self'",
                "'unsafe-inline'",
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
    'http://localhost:3000',
    'http://127.0.0.1:3000',
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
        
        // In production, only allow explicitly configured origins + same Render service
        if (isProduction) {
            // Allow if origin matches any allowed origin
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            // Allow same Render service (origin must match RENDER_EXTERNAL_URL)
            const renderUrl = process.env.RENDER_EXTERNAL_URL;
            if (renderUrl && origin === renderUrl) {
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

// Rate Limiting - general API (per-user when authenticated, per-IP otherwise)
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1 * 60 * 1000, // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1200, // 1200 requests per minute
    message: { error: 'Too many requests, please try again later.' },
    keyGenerator: (req) => req.user?.id || req.ip,
    skip: (req) => {
        // Skip rate limiting in development
        if (process.env.NODE_ENV === 'development') return true;
        // Skip rate limiting for admin routes (they have their own limiters for sensitive ops)
        if (req.path.startsWith('/api/admin')) return true;
        // Skip for public read-only endpoints
        if (req.path === '/api/health') return true;
        if (req.path === '/api/orders/packages' && req.method === 'GET') return true;
        return false;
    }
});
app.use('/api/', limiter);

// Admin routes limiter - generous for dashboard operations
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 600, // 600 requests per minute for admin dashboard
    message: { error: 'Too many requests, please try again later.' },
    keyGenerator: (req) => req.admin?.username || req.ip
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
app.use('/api/momo', momoRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/developer', developerRoutes);
app.use('/api/v1', v1Routes);
app.use('/api/lookup', lookupRoutes);

// ==========================================
// SERVE STATIC FRONTEND FILES
// ==========================================
const path = require('path');
const frontendPath = path.join(__dirname, '..');

// Cache settings for static files
// Use aggressive caching for assets with version/hash in URL
const staticOptions = {
    maxAge: isProduction ? '7d' : 0, // Cache for 7 days in production
    etag: true,
    lastModified: true,
    immutable: isProduction, // Tell browser these files won't change
    setHeaders: (res, path) => {
        // Extra-long cache for fonts and images
        if (path.match(/\.(woff2?|ttf|eot|otf|ico|png|jpg|jpeg|gif|svg|webp)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
        }
        // JavaScript and CSS - 7 days
        else if (path.match(/\.(js|css)$/)) {
            res.setHeader('Cache-Control', isProduction ? 'public, max-age=604800' : 'no-cache'); // 7 days
        }
    }
};

// Serve static assets (CSS, JS, images) with caching
app.use('/assets', express.static(path.join(frontendPath, 'assets'), staticOptions));
app.use('/pages', express.static(path.join(frontendPath, 'pages'), staticOptions));
app.use('/admin', express.static(path.join(frontendPath, 'admin'), staticOptions));
app.use('/store', express.static(path.join(frontendPath, 'store'), staticOptions));

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get('/ad', (req, res) => {
    res.sendFile(path.join(frontendPath, 'ad.html'));
});

// Secret standalone lookup page - accessible only via direct URL
app.get('/hstn-lookup', (req, res) => {
    res.sendFile(path.join(frontendPath, 'pages', 'hstn-lookup.html'));
});

// Serve pages/ clean URL routes
app.get('/pages/:page', (req, res) => {
    // Validate page name: only allow alphanumeric, hyphens, underscores
    const page = req.params.page;
    if (!/^[a-zA-Z0-9_-]+$/.test(page)) {
        return res.status(400).send('Invalid page');
    }
    const pagePath = path.join(frontendPath, 'pages', page + '.html');
    res.sendFile(pagePath, (err) => {
        if (err) res.status(404).send('Page not found');
    });
});

// Serve admin/ clean URL routes
app.get('/admin/:page', (req, res) => {
    const page = req.params.page;
    if (!/^[a-zA-Z0-9_-]+$/.test(page)) {
        return res.status(400).send('Invalid page');
    }
    const pagePath = path.join(frontendPath, 'admin', page + '.html');
    res.sendFile(pagePath, (err) => {
        if (err) res.status(404).send('Page not found');
    });
});

app.get('/store/:page', (req, res) => {
    const page = req.params.page;
    if (!/^[a-zA-Z0-9_-]+$/.test(page)) {
        return res.status(400).send('Invalid page');
    }
    const pagePath = path.join(frontendPath, 'store', page + '.html');
    res.sendFile(pagePath, (err) => {
        if (err) res.status(404).send('Page not found');
    });
});

// Fallback to index.html for SPA-style routing (if needed)
app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) {
        return next();
    }
    // Resolve and verify the path stays within frontendPath
    const resolvedPath = path.resolve(frontendPath, '.' + req.path);
    if (!resolvedPath.startsWith(path.resolve(frontendPath))) {
        return res.status(400).send('Invalid path');
    }
    res.sendFile(resolvedPath, (err) => {
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
const PORT = process.env.PORT || 3000;

// Initialize database before starting server
const startServer = async () => {
    // Start listening FIRST so Render detects the port
    const server = app.listen(PORT, '0.0.0.0', async () => {
        console.log(`
    ╔═══════════════════════════════════════════╗
    ║     DataEasy+ API Server                  ║
    ║     Running on port ${PORT}                   ║
    ║     Environment: ${process.env.NODE_ENV || 'development'}            ║
    ╚═══════════════════════════════════════════╝
        `);
        console.log('✅ Server is ready and listening');
        
        // Initialize database AFTER port is open
        await initDatabase();
        
        // Run startup migrations (safe, idempotent)
        try {
            const { sequelize } = require('./config/database');
            
            // Add 'momo' to paymentMethod enum if not exists
            await sequelize.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum 
                        WHERE enumlabel = 'momo' 
                        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_transactions_paymentMethod')
                    ) THEN
                        ALTER TYPE "enum_transactions_paymentMethod" ADD VALUE 'momo';
                    END IF;
                END $$;
            `).catch(() => {}); // Ignore if already exists or type doesn't exist yet
            
            // Update existing MoMo transactions from 'manual' to 'momo'
            await sequelize.query(`
                UPDATE transactions 
                SET "paymentMethod" = 'momo' 
                WHERE "paymentMethod" = 'manual' 
                AND (description LIKE 'MoMo%' OR reference LIKE 'MOMO-%');
            `).catch(() => {});
            
            console.log('✅ Startup migrations completed');
        } catch (error) {
            console.log('⚠️ Startup migrations skipped:', error.message);
        }
        
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

        // Start pending deposit cleaner service
        try {
            const pendingDepositCleaner = require('./services/pendingDepositCleaner');
            pendingDepositCleaner.start();
            console.log('✅ Pending deposit cleaner service started');
        } catch (error) {
            console.error('⚠️ Pending deposit cleaner start error:', error.message);
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
        
        // Stop background services
        try {
            const pendingDepositCleaner = require('./services/pendingDepositCleaner');
            pendingDepositCleaner.stop();
        } catch (err) {
            // Ignore if service wasn't started
        }

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

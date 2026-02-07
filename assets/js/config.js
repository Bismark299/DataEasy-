/**
 * DataEasy+ - Frontend Configuration
 * 
 * This file configures the API endpoint for different environments.
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * For production, update the API_BASE_URL to your Render backend URL:
 * Example: 'https://your-backend-name.onrender.com/api'
 */

(function() {
    'use strict';

    // Detect environment based on hostname
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const isProduction = !isLocalhost;

    // Configure API base URL
    // In production, use same-origin (relative path) since frontend is served from backend
    if (isProduction) {
        // Same origin - frontend and backend served together
        window.API_BASE_URL = window.API_BASE_URL || '/api';
        window.PAYSTACK_PUBLIC_KEY = window.PAYSTACK_PUBLIC_KEY || 'pk_live_YOUR_LIVE_KEY_HERE';
    } else {
        // Development - use local backend
        window.API_BASE_URL = 'http://localhost:9000/api';
        window.PAYSTACK_PUBLIC_KEY = 'pk_test_fa6266bd089971ce550966de52efe3add069fe55';
    }

    // Log configuration (development only)
    if (!isProduction) {
        console.log('🔧 Config loaded:', {
            environment: isProduction ? 'production' : 'development',
            apiBaseUrl: window.API_BASE_URL
        });
    }
})();

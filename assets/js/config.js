/**
 * DataEasy+ - Frontend Configuration
 * 
 * This file configures the API endpoint for different environments.
 * Paystack public key is fetched from backend (set via Render env vars)
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
    } else {
        // Development - use local backend
        window.API_BASE_URL = 'http://localhost:9000/api';
    }
    
    // Paystack key will be fetched from backend (no hardcoded fallback)
    window.PAYSTACK_PUBLIC_KEY = '';
    
    // Fetch config from backend (includes Paystack public key from env vars)
    fetch(`${window.API_BASE_URL}/auth/config`)
        .then(res => res.json())
        .then(data => {
            if (data.success && data.config.paystackPublicKey) {
                window.PAYSTACK_PUBLIC_KEY = data.config.paystackPublicKey;
                console.log('✅ Paystack key loaded from backend');
            }
        })
        .catch(err => {
            console.warn('⚠️ Could not fetch config, using default Paystack key');
        });

    // Log configuration (development only)
    if (!isLocalhost) {
        console.log('🔧 Config loaded:', {
            environment: isProduction ? 'production' : 'development',
            apiBaseUrl: window.API_BASE_URL
        });
    }
})();

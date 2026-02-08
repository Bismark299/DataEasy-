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
    
    // Paystack key - will be fetched from backend
    window.PAYSTACK_PUBLIC_KEY = '';
    window.PAYSTACK_CONFIG_LOADED = false;
    window.PAYSTACK_CONFIGURED = false;
    
    // Promise to wait for config to load
    window.PAYSTACK_CONFIG_PROMISE = fetch(`${window.API_BASE_URL}/auth/config`)
        .then(res => {
            if (!res.ok) {
                throw new Error(`Config fetch failed: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            console.log('📦 Config response:', data);
            if (data.success && data.config.paystackPublicKey) {
                window.PAYSTACK_PUBLIC_KEY = data.config.paystackPublicKey;
                window.PAYSTACK_CONFIG_LOADED = true;
                window.PAYSTACK_CONFIGURED = data.config.paystackConfigured !== false;
                console.log('✅ Paystack key loaded:', window.PAYSTACK_PUBLIC_KEY.substring(0, 15) + '...');
                return true;
            } else {
                console.error('❌ Paystack key not configured in backend. Set PAYSTACK_PUBLIC_KEY environment variable in Render.');
                window.PAYSTACK_CONFIG_LOADED = true;
                window.PAYSTACK_CONFIGURED = false;
                return false;
            }
        })
        .catch(err => {
            console.error('❌ Could not fetch config:', err.message);
            window.PAYSTACK_CONFIG_LOADED = true;
            window.PAYSTACK_CONFIGURED = false;
            return false;
        });

    // Log configuration
    console.log('🔧 Config:', {
        environment: isProduction ? 'production' : 'development',
        apiBaseUrl: window.API_BASE_URL
    });
})();

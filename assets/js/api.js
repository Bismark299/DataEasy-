/**
 * DataEasy+ - API Service Module
 * Handles all communication with the backend API
 */

const DataEasyAPI = (function() {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    // Use same-origin relative path (works for both production and local dev)
    const API_BASE_URL = window.API_BASE_URL || '/api';
    const PAYSTACK_PUBLIC_KEY = window.PAYSTACK_PUBLIC_KEY || '';

    // ==========================================
    // TOKEN MANAGEMENT
    // ==========================================
    function getAuthToken() {
        const session = localStorage.getItem('dataeasy_session');
        if (session) {
            try {
                const parsed = JSON.parse(session);
                return parsed.token;
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function getAdminToken() {
        return localStorage.getItem('dataeasy_admin_token');
    }

    function setAuthToken(token, userData) {
        localStorage.setItem('dataeasy_session', JSON.stringify({
            token,
            userId: userData.id,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }));
        localStorage.setItem('dataeasy_user', JSON.stringify(userData));
    }

    function setAdminToken(token, adminData) {
        localStorage.setItem('dataeasy_admin_token', token);
        localStorage.setItem('dataeasy_admin', JSON.stringify({
            username: adminData.username,
            name: adminData.name || 'Administrator',
            role: adminData.role || 'admin',
            createdAt: new Date().toISOString()
        }));
    }

    function clearTokens() {
        localStorage.removeItem('dataeasy_session');
        localStorage.removeItem('dataeasy_user');
        localStorage.removeItem('dataeasy_admin_token');
        localStorage.removeItem('dataeasy_admin');
    }

    // ==========================================
    // HTTP CLIENT (with idempotency support)
    // ==========================================
    async function request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const token = getAuthToken();
        const adminToken = getAdminToken();

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add idempotency key if provided
        if (options.idempotencyKey) {
            headers['X-Idempotency-Key'] = options.idempotencyKey;
        }

        // Use admin token if adminAuth is requested, otherwise use regular user token
        if (adminToken && options.adminAuth) {
            headers['Authorization'] = `Bearer ${adminToken}`;
        } else if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                // Handle token expiration - only logout on explicit auth failures
                if (response.status === 401) {
                    const errorMsg = (data.error || data.message || '').toLowerCase();
                    // Only clear session if it's a real auth failure (expired/invalid token)
                    if (!options.adminAuth && (errorMsg.includes('expired') || errorMsg.includes('invalid') || errorMsg.includes('unauthorized') || errorMsg.includes('no token'))) {
                        localStorage.removeItem('dataeasy_session');
                        localStorage.removeItem('dataeasy_user');
                        if (typeof DataEasyUtils !== 'undefined') {
                            DataEasyUtils.Toast.error('Session expired. Please login again.');
                        }
                    }
                }
                throw new Error(data.error || data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            throw error;
        }
    }

    // ==========================================
    // AUTH API
    // ==========================================
    const Auth = {
        async register(userData) {
            const response = await request('/auth/register', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
            
            if (response.success && response.token) {
                setAuthToken(response.token, response.user);
                
                // Clear packages cache so fresh role-based prices are fetched
                if (typeof DataEasyCart !== 'undefined' && DataEasyCart.clearPackagesCache) {
                    DataEasyCart.clearPackagesCache();
                }
            }
            
            return response;
        },

        async login(credentials) {
            const response = await request('/auth/login', {
                method: 'POST',
                body: JSON.stringify(credentials)
            });
            
            if (response.success && response.token) {
                setAuthToken(response.token, response.user);
                
                // Clear packages cache so fresh role-based prices are fetched
                if (typeof DataEasyCart !== 'undefined' && DataEasyCart.clearPackagesCache) {
                    DataEasyCart.clearPackagesCache();
                }
            }
            
            return response;
        },

        async adminLogin(credentials) {
            const response = await request('/auth/admin/login', {
                method: 'POST',
                body: JSON.stringify({
                    emailOrPhone: credentials.username || credentials.emailOrPhone,
                    password: credentials.password
                })
            });
            
            if (response.success && response.token) {
                // Store admin info from server response (includes name, role)
                setAdminToken(response.token, response.admin || { 
                    username: credentials.username || credentials.emailOrPhone,
                    name: 'Administrator',
                    role: 'admin'
                });
            }
            
            return response;
        },

        async getMe() {
            return await request('/auth/me');
        },

        async changePassword(currentPassword, newPassword) {
            return await request('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ currentPassword, newPassword })
            });
        },

        logout() {
            clearTokens();
        },

        isAuthenticated() {
            const session = localStorage.getItem('dataeasy_session');
            if (!session) return false;
            
            try {
                const parsed = JSON.parse(session);
                return new Date(parsed.expiresAt) > new Date();
            } catch (e) {
                return false;
            }
        },

        isAdminAuthenticated() {
            return !!getAdminToken();
        }
    };

    // ==========================================
    // USER API
    // ==========================================
    const Users = {
        async getProfile() {
            return await request('/users/profile');
        },

        async updateProfile(data) {
            return await request('/users/profile', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async getOrders(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/users/orders${queryString ? '?' + queryString : ''}`);
        },

        async getStats() {
            return await request('/users/stats');
        }
    };

    // ==========================================
    // ORDERS API (with idempotency support)
    // ==========================================
    const Orders = {
        async getPackages(network = null) {
            if (network) {
                return await request(`/orders/packages/${network}`);
            }
            return await request('/orders/packages');
        },

        async create(orderData, options = {}) {
            return await request('/orders', {
                method: 'POST',
                body: JSON.stringify(orderData),
                idempotencyKey: options.idempotencyKey
            });
        },

        async getAll(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/orders${queryString ? '?' + queryString : ''}`);
        },

        async getById(orderId) {
            return await request(`/orders/${orderId}`);
        },

        async getStatus(orderId) {
            return await request(`/orders/${orderId}/status`);
        }
    };

    // ==========================================
    // WALLET API (with idempotency support)
    // ==========================================
    const Wallet = {
        async getBalance() {
            return await request('/wallet/balance');
        },

        async getHistory(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/wallet/history${queryString ? '?' + queryString : ''}`);
        },

        /**
         * Calculate topup fee before payment
         * @param {number} amount - Amount user wants in wallet
         * @returns {Object} Fee breakdown: { baseAmount, feeAmount, feePercentage, totalAmount }
         */
        async calculateFee(amount) {
            return await request(`/wallet/topup/fee?amount=${amount}`);
        },

        /**
         * Initialize topup - returns fee breakdown
         * @param {number} amount - Amount user wants in wallet (fee added on top)
         */
        async initializeTopup(amount, options = {}) {
            const idempotencyKey = options.idempotencyKey || `topup-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            return await request('/wallet/topup', {
                method: 'POST',
                body: JSON.stringify({ amount }),
                idempotencyKey
            });
        },

        async verifyTopup(reference) {
            return await request(`/wallet/topup/verify/${reference}`);
        },

        /**
         * Cancel a pending topup (called when user closes popup without completing)
         * @param {string} reference - Transaction reference
         */
        async cancelTopup(reference) {
            return await request(`/wallet/topup/cancel/${reference}`, {
                method: 'POST'
            });
        }
    };

    // ==========================================
    // ADMIN API
    // ==========================================
    const Admin = {
        async getStats() {
            return await request('/admin/stats', { adminAuth: true });
        },

        async getDashboard() {
            return await request('/admin/dashboard', { adminAuth: true });
        },

        async getOrders(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/admin/orders${queryString ? '?' + queryString : ''}`, { adminAuth: true });
        },

        async getOrder(orderId) {
            return await request(`/admin/orders/${orderId}`, { adminAuth: true });
        },

        async updateOrderStatus(orderId, status) {
            return await request(`/admin/orders/${orderId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status }),
                adminAuth: true
            });
        },

        async updateItemStatus(orderId, itemId, status, failureReason = null) {
            return await request(`/admin/orders/${orderId}/item/${itemId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status, failureReason }),
                adminAuth: true
            });
        },

        async bulkUpdateItemStatus(items, status) {
            return await request('/admin/orders/bulk-item-status', {
                method: 'PUT',
                body: JSON.stringify({ items, status }),
                adminAuth: true
            });
        },

        async matchAndCompleteOrders(entries) {
            return await request('/admin/orders/match-complete', {
                method: 'PUT',
                body: JSON.stringify({ entries }),
                adminAuth: true
            });
        },

        async getUsers(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/admin/users${queryString ? '?' + queryString : ''}`, { adminAuth: true });
        },

        async getUser(userId) {
            return await request(`/admin/users/${userId}`, { adminAuth: true });
        },

        async updateUser(userId, userData) {
            return await request(`/admin/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify(userData),
                adminAuth: true
            });
        },

        async createUser(userData) {
            return await request('/admin/users', {
                method: 'POST',
                body: JSON.stringify(userData),
                adminAuth: true
            });
        },

        async deleteUser(userId) {
            return await request(`/admin/users/${userId}`, {
                method: 'DELETE',
                adminAuth: true
            });
        },

        async adjustWallet(userId, amountOrData, type, description) {
            // Support both old signature (userId, amount, type, desc) and new ({type, amount, description})
            let amount, adjustType, desc;
            
            if (typeof amountOrData === 'object') {
                // New format: adjustWallet(userId, {type, amount, description})
                amount = amountOrData.amount;
                adjustType = amountOrData.type;
                desc = amountOrData.description;
            } else {
                // Old format: adjustWallet(userId, amount, type, description)
                amount = amountOrData;
                adjustType = type;
                desc = description;
            }
            
            // Generate idempotency key for wallet adjustments
            const idempotencyKey = `wallet-adj-${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            return await request(`/admin/users/${userId}/wallet`, {
                method: 'POST',
                body: JSON.stringify({ amount, type: adjustType, description: desc }),
                adminAuth: true,
                idempotencyKey
            });
        },

        async toggleUserStatus(userId, isActive) {
            return await request(`/admin/users/${userId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ isActive }),
                adminAuth: true
            });
        },

        async getTransactions(params = {}) {
            const queryString = new URLSearchParams(params).toString();
            return await request(`/admin/transactions${queryString ? '?' + queryString : ''}`, { adminAuth: true });
        },

        async getPackages() {
            return await request('/admin/packages', { adminAuth: true });
        },

        async createPackage(packageData) {
            return await request('/admin/packages', {
                method: 'POST',
                body: JSON.stringify(packageData),
                adminAuth: true
            });
        },

        async updatePackage(packageId, packageData) {
            return await request(`/admin/packages/${packageId}`, {
                method: 'PUT',
                body: JSON.stringify(packageData),
                adminAuth: true
            });
        },

        async deletePackage(packageId) {
            return await request(`/admin/packages/${packageId}`, {
                method: 'DELETE',
                adminAuth: true
            });
        },

        async getSettings() {
            return await request('/admin/settings', { adminAuth: true });
        },

        async updateSettings(settings) {
            return await request('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
                adminAuth: true
            });
        },

        async changePassword(newPassword) {
            return await request('/admin/password', {
                method: 'PUT',
                body: JSON.stringify({ newPassword }),
                adminAuth: true
            });
        },

        async fundUserWallet(userId, amount, description = 'Admin wallet credit') {
            const idempotencyKey = `fund-${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            return await request(`/admin/users/${userId}/wallet`, {
                method: 'POST',
                body: JSON.stringify({ amount, type: 'credit', description }),
                adminAuth: true,
                idempotencyKey
            });
        },

        async debitUserWallet(userId, amount, description = 'Admin wallet debit') {
            const idempotencyKey = `debit-${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            return await request(`/admin/users/${userId}/wallet`, {
                method: 'POST',
                body: JSON.stringify({ amount, type: 'debit', description }),
                adminAuth: true,
                idempotencyKey
            });
        },

        // ==========================================
        // DATA PROVIDER (MCBIS) API
        // ==========================================
        
        async getProviderBalance() {
            return await request('/admin/provider/balance', { adminAuth: true });
        },

        async getProviderProducts() {
            return await request('/admin/provider/products', { adminAuth: true });
        },

        async checkProviderOrderStatus(reference) {
            return await request(`/admin/provider/status/${reference}`, { adminAuth: true });
        },

        async deliverOrderViaProvider(orderId, itemIndex = 0) {
            return await request('/admin/provider/deliver', {
                method: 'POST',
                body: JSON.stringify({ orderId, itemIndex }),
                adminAuth: true
            });
        },

        // Network Availability Settings
        async getNetworkAvailability() {
            return await request('/admin/network-availability', { adminAuth: true });
        },

        async updateNetworkAvailability(availability) {
            return await request('/admin/network-availability', {
                method: 'PUT',
                body: JSON.stringify(availability),
                adminAuth: true
            });
        },

        // MCBIS Settings
        async getMcbisSettings() {
            return await request('/admin/mcbis/settings', { adminAuth: true });
        },

        async updateMcbisSettings(settings) {
            return await request('/admin/mcbis/settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
                adminAuth: true
            });
        },

        // Topup Fee Settings
        async getFeeSettings() {
            return await request('/admin/fee-settings', { adminAuth: true });
        },

        async updateFeeSettings(settings) {
            return await request('/admin/fee-settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
                adminAuth: true
            });
        },

        // General App Settings (maintenance mode, limits, security)
        async getAppSettings() {
            return await request('/admin/app-settings', { adminAuth: true });
        },

        async updateAppSettings(settings) {
            return await request('/admin/app-settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
                adminAuth: true
            });
        },

        // ==========================================
        // SECURE PROVIDER API (Loss Prevention)
        // ==========================================

        async secureDeliverOrder(orderId, itemIndex = 0) {
            return await request('/admin/provider/secure-deliver', {
                method: 'POST',
                body: JSON.stringify({ orderId, itemIndex }),
                adminAuth: true
            });
        },

        async getCircuitBreakerStatus() {
            return await request('/admin/provider/circuit-breaker', { adminAuth: true });
        },

        async resetCircuitBreaker() {
            return await request('/admin/provider/circuit-breaker/reset', {
                method: 'POST',
                adminAuth: true
            });
        },

        async emergencyStop(reason) {
            return await request('/admin/provider/emergency-stop', {
                method: 'POST',
                body: JSON.stringify({ reason }),
                adminAuth: true
            });
        },

        async runReconciliation() {
            return await request('/admin/provider/reconciliation', {
                method: 'POST',
                adminAuth: true
            });
        },

        async getProviderSummary(date = null) {
            const query = date ? `?date=${date}` : '';
            return await request(`/admin/provider/summary${query}`, { adminAuth: true });
        },

        async processProviderRefund(orderId, itemIndex, amount, reason) {
            const idempotencyKey = `refund-${orderId}-${itemIndex}-${Date.now()}`;
            return await request('/admin/provider/refund', {
                method: 'POST',
                body: JSON.stringify({ orderId, itemIndex, amount, reason }),
                adminAuth: true,
                idempotencyKey
            });
        },

        async getTransactionsForReview() {
            return await request('/admin/provider/transactions/review', { adminAuth: true });
        },

        async getTransactionMismatches() {
            return await request('/admin/provider/transactions/mismatches', { adminAuth: true });
        },

        async reviewProviderTransaction(txId, resolution, notes) {
            return await request(`/admin/provider/transactions/${txId}/review`, {
                method: 'POST',
                body: JSON.stringify({ resolution, notes }),
                adminAuth: true
            });
        }
    };

    // ==========================================
    // PAYSTACK INTEGRATION
    // ==========================================
    const Paystack = {
        get publicKey() { return window.PAYSTACK_PUBLIC_KEY || ''; },

        /**
         * Open Paystack popup for wallet topup
         * @param {string} email - User's email
         * @param {number} amount - Amount user wants credited to wallet (fee added automatically)
         * @param {function} onSuccess - Callback on successful payment
         * @param {function} onClose - Callback when popup is closed
         */
        async openPopup(email, amount, onSuccess, onClose) {
            // Wait for config to load if not ready
            if (window.PAYSTACK_CONFIG_PROMISE) {
                await window.PAYSTACK_CONFIG_PROMISE;
            }
            
            // Check if Paystack is configured
            if (!window.PAYSTACK_CONFIGURED) {
                throw new Error('Payment system not configured. Admin needs to set PAYSTACK_PUBLIC_KEY in Render environment variables.');
            }
            
            // Check if Paystack key exists
            if (!this.publicKey) {
                throw new Error('Payment system not configured. Please contact support.');
            }
            
            // Validate key format
            if (!this.publicKey.startsWith('pk_')) {
                throw new Error('Invalid payment configuration. Please contact support.');
            }
            
            if (typeof PaystackPop === 'undefined') {
                throw new Error('Payment system not available. Please refresh the page.');
            }

            // First create transaction record on backend to get reference and fee info
            const initResponse = await Wallet.initializeTopup(amount);
            
            if (!initResponse.success) {
                throw new Error(initResponse.error || 'Failed to initialize payment');
            }

            const backendReference = initResponse.reference;
            // Use totalAmount (with fee) for Paystack, user receives baseAmount
            const amountToPay = initResponse.totalAmount || initResponse.baseAmount || amount;
            const feeAmount = initResponse.feeAmount || 0;

            const handler = PaystackPop.setup({
                key: this.publicKey,
                email: email,
                amount: Math.round(amountToPay * 100), // Convert to pesewas (total with fee)
                currency: 'GHS',
                ref: backendReference,
                callback: function(response) {
                    // Verify payment on backend
                    Wallet.verifyTopup(backendReference)
                        .then(function(verification) {
                            if (onSuccess) onSuccess(verification);
                        })
                        .catch(function(error) {
                            if (onSuccess) onSuccess({ success: false, error: error.message });
                        });
                },
                onClose: function() {
                    // Cancel the pending transaction since user didn't complete payment
                    Wallet.cancelTopup(backendReference).catch(() => {});
                    if (onClose) onClose();
                }
            });

            handler.openIframe();
            
            // Return fee info for UI to display
            return {
                reference: backendReference,
                baseAmount: initResponse.baseAmount,
                feeAmount: feeAmount,
                totalAmount: amountToPay
            };
        }
    };

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================
    async function isBackendAvailable() {
        try {
            const response = await fetch(`${API_BASE_URL}/health`, { 
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    // ==========================================
    // DEVELOPER API KEY MANAGEMENT
    // ==========================================
    const Developer = {
        async createKey(data) {
            return request('/developer/keys', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },
        async listKeys() {
            return request('/developer/keys');
        },
        async getKey(keyId) {
            return request(`/developer/keys/${keyId}`);
        },
        async updateKey(keyId, data) {
            return request(`/developer/keys/${keyId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },
        async revokeKey(keyId) {
            return request(`/developer/keys/${keyId}`, {
                method: 'DELETE'
            });
        }
    };

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        Auth,
        Users,
        Orders,
        Wallet,
        Admin,
        admin: Admin,  // Lowercase alias for compatibility with admin pages
        Developer,
        Paystack,
        isBackendAvailable,
        getAuthToken,
        getAdminToken,
        clearTokens,
        API_BASE_URL
    };
})();

// Make globally available
window.DataEasyAPI = DataEasyAPI;

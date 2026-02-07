/**
 * DataEasy+ - Authentication Module
 * User authentication, session management, and security
 * Supports both API backend and localStorage fallback
 */

const DataEasyAuth = (function() {
    'use strict';

    const { Storage, Toast, Format, EventBus, DOM } = DataEasyUtils;
    const { Rules, FormValidator, Sanitize } = DataEasyValidation;

    // ==========================================
    // SESSION CONFIGURATION
    // ==========================================
    const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    const REMEMBER_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days
    let useAPI = false; // Will be set based on backend availability

    // ==========================================
    // USER STATE
    // ==========================================
    let currentUser = null;

    // ==========================================
    // CHECK API AVAILABILITY
    // ==========================================
    async function checkAPIAvailability() {
        if (typeof DataEasyAPI !== 'undefined') {
            try {
                const available = await DataEasyAPI.isBackendAvailable();
                useAPI = available;
                console.log(useAPI ? '✅ Using API backend' : '⚠️ Using localStorage fallback');
            } catch (e) {
                useAPI = false;
            }
        }
        return useAPI;
    }

    // ==========================================
    // AUTHENTICATION FUNCTIONS
    // ==========================================
    
    /**
     * Register a new user
     */
    async function register(userData) {
        const { fullName, email, phone, password } = userData;

        // Validate inputs
        if (!fullName || !email || !phone || !password) {
            Toast.error('Please fill in all fields');
            return { success: false, message: 'Missing required fields' };
        }

        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Auth.register({ fullName, email, phone, password });
                if (response.success) {
                    currentUser = response.user;
                    Toast.success('Account created successfully! Please login.');
                    EventBus.emit('auth:registered', response.user);
                    return { success: true, user: response.user };
                }
                Toast.error(response.message || 'Registration failed');
                return { success: false, message: response.message };
            } catch (error) {
                Toast.error(error.message || 'Registration failed');
                return { success: false, message: error.message };
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users', []);
        const existingUser = users.find(u => 
            u.email.toLowerCase() === email.toLowerCase() || 
            u.phone === phone
        );

        if (existingUser) {
            Toast.error('Email or phone already registered');
            return { success: false, message: 'User already exists' };
        }

        // Create new user
        const newUser = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            fullName: Sanitize.text(fullName),
            email: Sanitize.email(email),
            phone: Sanitize.phone(phone),
            password: hashPassword(password),
            avatar: null,
            createdAt: new Date().toISOString(),
            lastLogin: null,
            isVerified: false,
            settings: {
                twoFactorEnabled: false,
                emailNotifications: true,
                smsNotifications: true
            }
        };

        users.push(newUser);
        Storage.set('users', users);

        // Initialize wallet
        Storage.set('wallet', {
            balance: 0,
            currency: 'GHS',
            transactions: []
        });

        Toast.success('Account created successfully! Please login.');
        EventBus.emit('auth:registered', newUser);

        return { success: true, user: newUser };
    }

    /**
     * Login user
     */
    async function login(credentials, rememberMe = false) {
        const { emailOrPhone, password } = credentials;

        if (!emailOrPhone || !password) {
            Toast.error('Please enter your credentials');
            return { success: false, message: 'Missing credentials' };
        }

        // Check for admin credentials first (works with API too)
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            // Detect if this might be an admin login (not an email or phone number)
            const looksLikeAdminUsername = !emailOrPhone.includes('@') && !/^0[2-59]\d{8}$/.test(emailOrPhone);
            
            // Try admin login first ONLY if it looks like an admin username
            if (looksLikeAdminUsername) {
                try {
                    const adminResponse = await DataEasyAPI.Auth.adminLogin({ 
                        username: emailOrPhone, 
                        password 
                    });
                    if (adminResponse.success) {
                        Toast.success(`Welcome, Administrator!`);
                        return { success: true, isAdmin: true, admin: adminResponse };
                    }
                } catch (e) {
                    // Not admin or admin login failed, continue to user login
                    console.log('Admin login failed, trying user login...');
                }
            }

            // Try user login
            try {
                const response = await DataEasyAPI.Auth.login({ 
                    emailOrPhone, 
                    password 
                });
                if (response.success) {
                    currentUser = response.user;
                    Storage.set('user', response.user);
                    Toast.success(`Welcome back, ${response.user.fullName}!`);
                    EventBus.emit('auth:login', response.user);
                    return { success: true, user: response.user };
                }
                Toast.error(response.message || 'Login failed');
                return { success: false, message: response.message };
            } catch (error) {
                Toast.error(error.message || 'Login failed');
                return { success: false, message: error.message };
            }
        }

        // Fallback: Check for admin credentials
        if (typeof DataEasyAdmin !== 'undefined' && DataEasyAdmin.isAdminCredentials) {
            const admin = DataEasyAdmin.isAdminCredentials(emailOrPhone, password);
            if (admin) {
                DataEasyAdmin.setAdminSession(admin);
                Toast.success(`Welcome, ${admin.name}!`);
                return { success: true, isAdmin: true, admin };
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users', []);
        const user = users.find(u => 
            u.email.toLowerCase() === emailOrPhone.toLowerCase() || 
            u.phone === emailOrPhone.replace(/\D/g, '')
        );

        if (!user) {
            Toast.error('Account not found');
            return { success: false, message: 'User not found' };
        }

        if (!verifyPassword(password, user.password)) {
            Toast.error('Invalid password');
            return { success: false, message: 'Invalid password' };
        }

        user.lastLogin = new Date().toISOString();
        Storage.set('users', users);

        const session = {
            userId: user.id,
            token: generateToken(),
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + (rememberMe ? REMEMBER_DURATION : SESSION_DURATION)).toISOString(),
            rememberMe
        };

        Storage.set('session', session);
        
        const safeUser = { ...user };
        delete safeUser.password;
        Storage.set('user', safeUser);
        currentUser = safeUser;

        Toast.success(`Welcome back, ${user.fullName}!`);
        EventBus.emit('auth:login', safeUser);

        return { success: true, user: safeUser };
    }

    /**
     * Logout user
     */
    function logout() {
        // Clear API tokens if using API
        if (typeof DataEasyAPI !== 'undefined') {
            DataEasyAPI.clearTokens();
        }
        
        Storage.remove('session');
        Storage.remove('user');
        currentUser = null;

        Toast.info('You have been logged out');
        EventBus.emit('auth:logout');

        // Redirect to login
        setTimeout(() => {
            window.location.href = getBasePath() + 'pages/login.html';
        }, 500);
    }

    /**
     * Check if user is authenticated
     */
    function isAuthenticated() {
        // Check API auth first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            return true;
        }
        
        const session = Storage.get('session');
        if (!session) return false;

        // Check expiration
        if (new Date(session.expiresAt) < new Date()) {
            logout();
            return false;
        }

        return true;
    }

    /**
     * Get current user
     */
    async function getUser() {
        if (currentUser) return currentUser;
        
        // Try to get from API
        if (useAPI && typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            try {
                const response = await DataEasyAPI.Auth.getMe();
                if (response.success) {
                    currentUser = response.user;
                    Storage.set('user', response.user);
                    return currentUser;
                }
            } catch (e) {
                console.log('Failed to get user from API');
            }
        }
        
        if (isAuthenticated()) {
            currentUser = Storage.get('user');
            return currentUser;
        }
        
        return null;
    }

    /**
     * Get current user (sync version)
     */
    function getUserSync() {
        if (currentUser) return currentUser;
        
        if (isAuthenticated()) {
            currentUser = Storage.get('user');
            return currentUser;
        }
        
        return null;
    }

    /**
     * Update user profile
     */
    async function updateProfile(updates) {
        const user = getUserSync();
        if (!user) {
            Toast.error('Please login first');
            return { success: false };
        }

        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Users.updateProfile(updates);
                if (response.success) {
                    currentUser = response.user;
                    Storage.set('user', response.user);
                    Toast.success('Profile updated successfully');
                    EventBus.emit('auth:profileUpdated', response.user);
                    return { success: true, user: response.user };
                }
            } catch (error) {
                Toast.error(error.message || 'Failed to update profile');
                return { success: false, message: error.message };
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users', []);
        const index = users.findIndex(u => u.id === user.id);
        
        if (index === -1) {
            Toast.error('User not found');
            return { success: false };
        }

        const allowedFields = ['fullName', 'phone', 'avatar', 'settings'];
        allowedFields.forEach(field => {
            if (updates[field] !== undefined) {
                users[index][field] = updates[field];
            }
        });

        Storage.set('users', users);

        const safeUser = { ...users[index] };
        delete safeUser.password;
        Storage.set('user', safeUser);
        currentUser = safeUser;

        Toast.success('Profile updated successfully');
        EventBus.emit('auth:profileUpdated', safeUser);

        return { success: true, user: safeUser };
    }

    /**
     * Change password
     */
    async function changePassword(currentPassword, newPassword) {
        const user = getUserSync();
        if (!user) {
            Toast.error('Please login first');
            return { success: false };
        }

        // Try API first
        if (useAPI && typeof DataEasyAPI !== 'undefined') {
            try {
                const response = await DataEasyAPI.Auth.changePassword(currentPassword, newPassword);
                if (response.success) {
                    Toast.success('Password changed successfully');
                    EventBus.emit('auth:passwordChanged');
                    return { success: true };
                }
            } catch (error) {
                Toast.error(error.message || 'Failed to change password');
                return { success: false, message: error.message };
            }
        }

        // Fallback to localStorage
        const users = Storage.get('users', []);
        const index = users.findIndex(u => u.id === user.id);
        
        if (index === -1) {
            Toast.error('User not found');
            return { success: false };
        }

        if (!verifyPassword(currentPassword, users[index].password)) {
            Toast.error('Current password is incorrect');
            return { success: false };
        }

        users[index].password = hashPassword(newPassword);
        Storage.set('users', users);

        Toast.success('Password changed successfully');
        EventBus.emit('auth:passwordChanged');

        return { success: true };
    }

    // ==========================================
    // PASSWORD UTILITIES
    // ==========================================
    
    // Simple hash for demo purposes
    // In production, use bcrypt or similar on server
    function hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'hash_' + Math.abs(hash).toString(36) + '_' + password.length;
    }

    function verifyPassword(password, hash) {
        return hashPassword(password) === hash;
    }

    function generateToken() {
        return 'tok_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // ==========================================
    // ROUTE PROTECTION
    // ==========================================
    
    /**
     * Protect page - redirect to login if not authenticated
     */
    function requireAuth() {
        if (!isAuthenticated()) {
            Toast.warning('Please login to continue');
            window.location.href = getBasePath() + 'pages/login.html';
            return false;
        }
        return true;
    }

    /**
     * Redirect authenticated users away from auth pages
     */
    function redirectIfAuthenticated() {
        if (isAuthenticated()) {
            window.location.href = getBasePath() + 'index.html';
            return true;
        }
        return false;
    }

    /**
     * Get base path based on current location
     */
    function getBasePath() {
        const path = window.location.pathname;
        if (path.includes('/pages/')) {
            return '../';
        }
        return '';
    }

    // ==========================================
    // UI HELPERS
    // ==========================================
    
    /**
     * Update UI based on auth state
     */
    function updateAuthUI() {
        const user = getUserSync();
        
        // Format role for display
        const formatRole = (role) => {
            const roleDisplayMap = {
                'super-dealer': 'Super-Dealer',
                'dealer': 'Dealer',
                'super-agent': 'Super-Agent',
                'agent': 'Agent'
            };
            return roleDisplayMap[role] || 'Agent';
        };
        
        // Update user name displays
        document.querySelectorAll('[data-user-name]').forEach(el => {
            el.textContent = user ? user.fullName : 'Guest';
        });

        // Update user agent code displays
        document.querySelectorAll('[data-user-agent-code]').forEach(el => {
            el.textContent = user && user.agentCode ? user.agentCode : '';
        });

        // Update user display name (for account page header)
        document.querySelectorAll('[data-user-display-name]').forEach(el => {
            el.textContent = user ? user.fullName : 'Your Name';
        });

        // Update user role displays
        document.querySelectorAll('[data-user-role]').forEach(el => {
            const roleValue = user ? formatRole(user.role) : 'Agent';
            if (el.tagName === 'INPUT') {
                el.value = roleValue;
            } else {
                el.textContent = roleValue;
            }
        });

        // Update user role with "Account" suffix (e.g., "Super-Dealer Account")
        document.querySelectorAll('[data-user-role-account]').forEach(el => {
            el.textContent = user ? `${formatRole(user.role)} Account` : 'Agent Account';
        });

        // Update user email displays
        document.querySelectorAll('[data-user-email]').forEach(el => {
            el.textContent = user ? user.email : '';
        });

        // Update user phone displays
        document.querySelectorAll('[data-user-phone]').forEach(el => {
            el.textContent = user ? Format.phone(user.phone) : '';
        });

        // Show/hide elements based on auth state
        document.querySelectorAll('[data-auth-show]').forEach(el => {
            el.style.display = user ? '' : 'none';
        });

        document.querySelectorAll('[data-auth-hide]').forEach(el => {
            el.style.display = user ? 'none' : '';
        });

        // Show elements only for guests
        document.querySelectorAll('[data-show-guest]').forEach(el => {
            el.style.display = user ? 'none' : '';
        });

        // Show elements only for authenticated users
        document.querySelectorAll('[data-show-auth]').forEach(el => {
            el.style.display = user ? '' : 'none';
        });

        // Hide logout button for guests
        document.querySelectorAll('[data-logout-btn]').forEach(el => {
            const parentLi = el.closest('li');
            if (parentLi) {
                parentLi.style.display = user ? '' : 'none';
            }
        });

        // Update login/logout buttons
        document.querySelectorAll('[data-logout-btn]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        });
    }

    // ==========================================
    // FORM HANDLERS
    // ==========================================
    
    /**
     * Initialize login form
     */
    function initLoginForm(formSelector = '#login-form') {
        const form = document.querySelector(formSelector);
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = form.querySelector('button[type="submit"]');
            DOM.setLoading(submitBtn, true, 'Signing in...');

            const emailOrPhone = form.querySelector('[name="emailOrPhone"]')?.value;
            const password = form.querySelector('[name="password"]')?.value;
            const rememberMe = form.querySelector('[name="rememberMe"]')?.checked || false;

            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 800));

            const result = await login({ emailOrPhone, password }, rememberMe);

            DOM.setLoading(submitBtn, false);

            if (result.success) {
                // Check if admin login
                if (result.isAdmin) {
                    setTimeout(() => {
                        window.location.href = '../admin/index.html';
                    }, 500);
                    return;
                }

                // Redirect to homepage or intended page for regular users
                const redirect = new URLSearchParams(window.location.search).get('redirect') || '../index.html';
                setTimeout(() => {
                    window.location.href = redirect;
                }, 500);
            }
        });
    }

    /**
     * Initialize registration form
     */
    function initRegisterForm(formSelector = '#register-form') {
        const form = document.querySelector(formSelector);
        if (!form) return;

        // Password strength indicator
        const passwordInput = form.querySelector('[name="password"]');
        const strengthBar = form.querySelector('#password-strength-bar');
        const strengthText = form.querySelector('#password-strength-text');

        if (passwordInput && strengthBar) {
            passwordInput.addEventListener('input', (e) => {
                const strength = Rules.password(e.target.value).strength;
                strengthBar.className = `h-full rounded-full transition-all ${strength.color}`;
                strengthBar.style.width = strength.width;
                if (strengthText) {
                    strengthText.textContent = strength.level.charAt(0).toUpperCase() + strength.level.slice(1);
                    strengthText.className = `text-xs ${strength.level === 'weak' ? 'text-red-400' : strength.level === 'medium' ? 'text-yellow-400' : 'text-green-400'}`;
                }
            });
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = form.querySelector('button[type="submit"]');
            DOM.setLoading(submitBtn, true, 'Creating account...');

            const fullName = form.querySelector('[name="fullName"]')?.value;
            const email = form.querySelector('[name="email"]')?.value;
            const phone = form.querySelector('[name="phone"]')?.value;
            const password = form.querySelector('[name="password"]')?.value;
            const confirmPassword = form.querySelector('[name="confirmPassword"]')?.value;
            const acceptTerms = form.querySelector('[name="acceptTerms"]')?.checked;

            // Validate
            if (!acceptTerms) {
                Toast.error('Please accept the terms and conditions');
                DOM.setLoading(submitBtn, false);
                return;
            }

            if (password !== confirmPassword) {
                Toast.error('Passwords do not match');
                DOM.setLoading(submitBtn, false);
                return;
            }

            const passwordValidation = Rules.password(password);
            if (!passwordValidation.isValid) {
                Toast.error(passwordValidation.message);
                DOM.setLoading(submitBtn, false);
                return;
            }

            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 800));

            const result = await register({ fullName, email, phone, password });

            DOM.setLoading(submitBtn, false);

            if (result.success) {
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1000);
            }
        });
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    async function init() {
        // Check API availability
        await checkAPIAvailability();
        
        // Load current user
        if (isAuthenticated()) {
            currentUser = Storage.get('user');
        }

        // Update UI
        updateAuthUI();

        console.log('✅ DataEasy Auth initialized');
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        register,
        login,
        logout,
        isAuthenticated,
        getUser,
        getUserSync,
        updateProfile,
        changePassword,
        requireAuth,
        redirectIfAuthenticated,
        updateAuthUI,
        initLoginForm,
        initRegisterForm,
        checkAPIAvailability
    };

})();

// Make it globally available
window.DataEasyAuth = DataEasyAuth;

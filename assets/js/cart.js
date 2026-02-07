/**
 * DataEasy+ - Cart Management System
 * Full shopping cart functionality with persistence
 * 
 * ⚠️ PRICING: All prices are fetched from the API (database)
 * The frontend does NOT have hardcoded prices.
 * Prices are synchronized from the backend on page load.
 */

const DataEasyCart = (function() {
    'use strict';

    const { Storage, Toast, Format, EventBus, DOM } = DataEasyUtils;

    // ==========================================
    // CART STATE
    // ==========================================
    let cart = {
        items: [],
        phoneNumbers: [],
        selectedNetwork: 'MTN'
    };

    // ==========================================
    // DATA PACKAGES - FETCHED FROM API
    // ==========================================
    // ⚠️ CRITICAL: NO STATIC PRICES
    // Packages are populated from API on page load via syncPackagesFromAPI()
    // If API fails, packages remain empty and users cannot checkout
    // This ensures database is the SINGLE SOURCE OF TRUTH for pricing
    let packages = {
        MTN: [],
        AirtelTigo: [],
        Telecel: []
    };
    
    // Flag to track if packages have been loaded
    let packagesLoaded = false;
    let packagesLoadError = null;
    
    // Network availability from server (controls which networks clients can select)
    let networkAvailability = {
        MTN: true,
        Telecel: true,
        AirtelTigo: true
    };

    // ==========================================
    // CART OPERATIONS
    // ==========================================
    function loadCart() {
        const saved = Storage.get('cart');
        if (saved) {
            cart = { ...cart, ...saved };
        }
        updateCartUI();
        return cart;
    }

    function saveCart() {
        Storage.set('cart', cart);
        EventBus.emit('cart:updated', cart);
    }

    function addItem(packageId, phoneNumbers = [], quantity = 1, options = {}) {
        const { silent = false } = options;
        
        // Check if packages have been loaded from API
        if (!packagesLoaded) {
            if (!silent) Toast.error('Packages not loaded. Please wait or refresh the page.');
            console.error('Cannot add item: packages not loaded from API');
            return false;
        }
        
        const pkg = findPackage(packageId);
        if (!pkg) {
            if (!silent) Toast.error('Package not found');
            return false;
        }
        
        // Verify package has a valid price from database
        if (typeof pkg.price !== 'number' || pkg.price <= 0) {
            if (!silent) Toast.error('Invalid package price. Please refresh the page.');
            console.error('Invalid price for package:', packageId, pkg.price);
            return false;
        }

        // Check if package is out of stock
        if (pkg.outOfStock === true) {
            if (!silent) Toast.error('This package is currently out of stock');
            return false;
        }

        // Validate phone numbers belong to the correct network
        const network = getNetworkFromPackageId(packageId);
        
        // Check if cart already has items from a different network
        if (cart.items.length > 0) {
            const existingNetworks = [...new Set(cart.items.map(item => item.network))];
            if (existingNetworks.length > 0 && !existingNetworks.includes(network)) {
                if (!silent) Toast.error(`Your cart contains ${existingNetworks[0]} packages. Please clear cart or remove other network items before adding ${network} packages.`);
                return false;
            }
        }

        const validNumbers = phoneNumbers.filter(num => {
            const detected = DataEasyUtils.Network.detect(num);
            return detected === network;
        });

        if (phoneNumbers.length > 0 && validNumbers.length === 0) {
            if (!silent) Toast.error(`Phone numbers must be ${network} numbers`);
            return false;
        }

        const existingItem = cart.items.find(item => 
            item.packageId === packageId && 
            JSON.stringify(item.phoneNumbers.sort()) === JSON.stringify(validNumbers.sort())
        );

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.items.push({
                id: Date.now().toString(36),
                packageId,
                package: pkg,
                network,
                phoneNumbers: validNumbers,
                quantity,
                addedAt: new Date().toISOString()
            });
        }

        saveCart();
        updateCartUI();
        if (!silent) Toast.success(`${pkg.name} added to cart`);
        return true;
    }

    function removeItem(itemId) {
        const index = cart.items.findIndex(item => item.id === itemId);
        if (index > -1) {
            const removed = cart.items.splice(index, 1)[0];
            saveCart();
            updateCartUI();
            Toast.info(`${removed.package.name} removed from cart`);
            return true;
        }
        return false;
    }

    function updateQuantity(itemId, quantity) {
        const item = cart.items.find(item => item.id === itemId);
        if (item) {
            if (quantity <= 0) {
                return removeItem(itemId);
            }
            item.quantity = Math.min(quantity, 100); // Max 100
            saveCart();
            updateCartUI();
            return true;
        }
        return false;
    }

    function clearCart() {
        cart.items = [];
        cart.phoneNumbers = [];
        saveCart();
        updateCartUI();
        Toast.info('Cart cleared');
    }

    function setPhoneNumbers(numbers) {
        cart.phoneNumbers = numbers;
        saveCart();
    }

    function setNetwork(network) {
        cart.selectedNetwork = network;
        saveCart();
    }

    // ==========================================
    // CALCULATIONS
    // ==========================================
    function getSubtotal() {
        return cart.items.reduce((total, item) => {
            const phoneCount = Math.max(item.phoneNumbers.length, 1);
            return total + (item.package.price * item.quantity * phoneCount);
        }, 0);
    }

    function getItemCount() {
        return cart.items.reduce((count, item) => count + item.quantity, 0);
    }

    function getTotalPhones() {
        const uniquePhones = new Set();
        cart.items.forEach(item => {
            item.phoneNumbers.forEach(phone => uniquePhones.add(phone));
        });
        return uniquePhones.size;
    }

    function getTotal() {
        return getSubtotal();
    }

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================
    function findPackage(packageId) {
        for (const network of Object.values(packages)) {
            const pkg = network.find(p => p.id === packageId);
            if (pkg) return pkg;
        }
        return null;
    }

    function getNetworkFromPackageId(packageId) {
        if (packageId.startsWith('mtn-')) return 'MTN';
        if (packageId.startsWith('at-')) return 'AirtelTigo';
        if (packageId.startsWith('tc-')) return 'Telecel';
        return null;
    }

    function getPackages(network = 'MTN') {
        return packages[network] || packages.MTN;
    }

    function getCart() {
        return { ...cart };
    }

    function isEmpty() {
        return cart.items.length === 0;
    }
    
    /**
     * Disable/enable checkout buttons to prevent double-submit
     */
    function disableCheckoutButtons(disabled) {
        const checkoutBtns = document.querySelectorAll('[data-checkout-btn], .checkout-btn, #checkoutBtn, .btn-checkout');
        checkoutBtns.forEach(btn => {
            btn.disabled = disabled;
            if (disabled) {
                btn.dataset.originalText = btn.textContent;
                btn.innerHTML = '<span class="animate-pulse">Processing...</span>';
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                btn.textContent = btn.dataset.originalText || 'Checkout';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        });
    }

    // ==========================================
    // UI UPDATES
    // ==========================================
    function updateCartUI() {
        // Update cart count badge
        const badges = document.querySelectorAll('[data-cart-count]');
        const count = getItemCount();
        
        badges.forEach(badge => {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        });

        // Update cart sidebar if exists
        renderCartSidebar();

        // Update totals displays
        const subtotalEls = document.querySelectorAll('[data-cart-subtotal]');
        const totalEls = document.querySelectorAll('[data-cart-total]');

        subtotalEls.forEach(el => el.textContent = Format.currency(getSubtotal()));
        totalEls.forEach(el => el.textContent = Format.currency(getTotal()));
    }

    function renderCartSidebar() {
        const container = document.getElementById('cart-items-container');
        if (!container) return;

        if (cart.items.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-gray-400">
                    <i class="fas fa-shopping-cart text-4xl mb-4 opacity-50"></i>
                    <p class="text-sm">Your cart is empty</p>
                    <p class="text-xs mt-1">Add some data packages to get started</p>
                </div>
            `;
            return;
        }

        container.innerHTML = cart.items.map(item => `
            <div class="cart-item bg-gray-800/50 rounded-lg p-3 border border-gray-700" data-item-id="${item.id}">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1" style="background-color: ${DataEasyUtils.Network.getColor(item.network).bg}; color: ${DataEasyUtils.Network.getColor(item.network).text}">
                            ${item.network}
                        </span>
                    </div>
                    <button class="text-gray-500 hover:text-red-400 transition" onclick="DataEasyCart.removeItem('${item.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                
                ${item.phoneNumbers.length > 0 ? item.phoneNumbers.map(phone => `
                    <div class="flex justify-between items-center py-1.5 border-b border-gray-700/50 last:border-0">
                        <div>
                            <span class="text-white text-sm">${phone}</span>
                            <span class="text-gray-500 text-xs ml-2">${item.package.data}</span>
                        </div>
                        <span class="text-mtn-yellow text-sm font-medium">${Format.currency(item.package.price)}</span>
                    </div>
                `).join('') : `
                    <div class="flex justify-between items-center py-1.5">
                        <div>
                            <span class="text-gray-400 text-sm">No number specified</span>
                            <span class="text-gray-500 text-xs ml-2">${item.package.data}</span>
                        </div>
                        <span class="text-mtn-yellow text-sm font-medium">${Format.currency(item.package.price)}</span>
                    </div>
                `}
                
                <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-700">
                    <div class="flex items-center gap-2">
                        <button class="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition" onclick="DataEasyCart.updateQuantity('${item.id}', ${item.quantity - 1})">
                            <i class="fas fa-minus text-xs"></i>
                        </button>
                        <span class="text-white font-medium w-8 text-center">${item.quantity}</span>
                        <button class="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition" onclick="DataEasyCart.updateQuantity('${item.id}', ${item.quantity + 1})">
                            <i class="fas fa-plus text-xs"></i>
                        </button>
                    </div>
                    <p class="text-mtn-yellow font-bold">${Format.currency(item.package.price * item.quantity * Math.max(item.phoneNumbers.length, 1))}</p>
                </div>
            </div>
        `).join('');
    }

    // ==========================================
    // CHECKOUT (with double-submit prevention)
    // ==========================================
    let isSubmitting = false;  // Prevent double-submit
    
    async function checkout() {
        // Prevent double-submit
        if (isSubmitting) {
            Toast.warning('Please wait, your order is being processed...');
            return null;
        }
        
        if (isEmpty()) {
            Toast.warning('Your cart is empty');
            return null;
        }

        // Check all items are from the same network
        const networks = [...new Set(cart.items.map(item => item.network))];
        if (networks.length > 1) {
            Toast.error(`Cannot checkout items from different networks (${networks.join(', ')}). Please remove items from other networks.`);
            return null;
        }

        // Check all items have phone numbers
        const itemsWithoutPhone = cart.items.filter(item => item.phoneNumbers.length === 0);
        if (itemsWithoutPhone.length > 0) {
            Toast.error('All items must have a phone number. Please add phone numbers to your cart items.');
            return null;
        }

        // Check user is logged in
        const user = Storage.get('user');
        if (!user) {
            Toast.warning('Please login to continue');
            window.location.href = 'pages/login.html';
            return null;
        }

        const total = getTotal();
        const network = networks[0];

        // Try API first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            // Set submitting flag and disable checkout buttons
            isSubmitting = true;
            disableCheckoutButtons(true);
            
            try {
                // Generate idempotency key to prevent duplicate orders
                const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
                
                // Prepare order items for API
                const orderItems = [];
                cart.items.forEach(item => {
                    if (item.phoneNumbers.length > 0) {
                        item.phoneNumbers.forEach(phone => {
                            orderItems.push({
                                packageId: item.packageId,
                                phoneNumber: phone
                            });
                        });
                    } else {
                        // If no phone numbers specified, add the item directly
                        for (let i = 0; i < item.quantity; i++) {
                            orderItems.push({
                                packageId: item.packageId,
                                phoneNumber: ''  // Will need to be filled in later
                            });
                        }
                    }
                });

                const response = await DataEasyAPI.Orders.create({
                    network,
                    items: orderItems
                }, { idempotencyKey });

                if (response.success) {
                    // Clear cart
                    cart.items = [];
                    cart.phoneNumbers = [];
                    saveCart();
                    updateCartUI();

                    Toast.success('Order placed successfully!');
                    
                    // Build order object for event and return
                    const order = {
                        ...response.order,
                        id: response.order.orderId  // Use orderId as id for redirect
                    };
                    
                    EventBus.emit('order:created', order);

                    return order;
                } else {
                    Toast.error(response.message || 'Failed to place order');
                    return null;
                }
            } catch (error) {
                Toast.error(error.message || 'Failed to place order');
                return null;
            } finally {
                // Always reset submitting state
                isSubmitting = false;
                disableCheckoutButtons(false);
            }
        }

        // Fallback to localStorage
        const wallet = Storage.get('wallet', { balance: 0 });
        
        if (wallet.balance < total) {
            Toast.error('Insufficient wallet balance');
            return null;
        }

        // Create order
        const order = {
            id: Format.orderId(),
            items: [...cart.items],
            network: network,
            subtotal: getSubtotal(),
            total: getTotal(),
            status: 'processing',
            paymentStatus: 'Completed',
            deliveryStatus: 'Processing',
            createdAt: new Date().toISOString(),
            userId: user.id
        };

        // Save order
        const orders = Storage.get('orders', []);
        orders.unshift(order);
        Storage.set('orders', orders);

        // Deduct from wallet
        wallet.balance -= total;
        wallet.transactions = wallet.transactions || [];
        wallet.transactions.unshift({
            id: Date.now().toString(36),
            type: 'debit',
            amount: total,
            description: `Data purchase - ${order.id}`,
            date: new Date().toISOString(),
            orderId: order.id
        });
        Storage.set('wallet', wallet);

        // Clear cart
        cart.items = [];
        cart.phoneNumbers = [];
        saveCart();
        updateCartUI();

        Toast.success('Order placed successfully!');
        EventBus.emit('order:created', order);

        return order;
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    function init() {
        loadCart();
        console.log('✅ DataEasy Cart initialized');
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /**
     * Check if cart has items from mixed networks
     */
    function hasMixedNetworks() {
        const networks = [...new Set(cart.items.map(item => item.network))];
        return networks.length > 1;
    }

    /**
     * Get the current network in cart (if only one)
     */
    function getCartNetwork() {
        const networks = [...new Set(cart.items.map(item => item.network))];
        return networks.length === 1 ? networks[0] : null;
    }

    /**
     * Sync packages from API (updates pricing and availability)
     * ⚠️ CRITICAL: This MUST be called before any cart operations
     * Packages start empty - API is the ONLY source of pricing
     */
    async function syncPackagesFromAPI() {
        try {
            // Use DataEasyAPI if available (includes auth token for role-based pricing)
            if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Orders && DataEasyAPI.Orders.getPackages) {
                const data = await DataEasyAPI.Orders.getPackages();
                
                if (data.success && data.packages) {
                    // Update packages with API data (database prices)
                    for (const [network, pkgList] of Object.entries(data.packages)) {
                        if (Array.isArray(pkgList)) {
                            packages[network] = pkgList;
                        }
                    }
                    
                    // Update network availability from server
                    if (data.networkAvailability) {
                        networkAvailability = { ...networkAvailability, ...data.networkAvailability };
                        console.log('✓ Network availability loaded:', networkAvailability);
                    }
                    
                    packagesLoaded = true;
                    packagesLoadError = null;
                    console.log('✓ Packages synced from API (database prices, role:', data.userRole || 'guest', ')');
                    
                    // Emit event for UI refresh (includes network availability)
                    EventBus.emit('packages:loaded', { packages, networkAvailability });
                    return true;
                } else {
                    throw new Error(data.message || 'Failed to load packages from server');
                }
            }
            
            // Fallback: Use raw fetch with auth token if DataEasyAPI not available
            // SECURITY: Use window.API_BASE_URL from config.js, never hardcode localhost
            const baseUrl = window.API_BASE_URL || (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.API_BASE_URL);
            if (!baseUrl) {
                throw new Error('API configuration not loaded. Please refresh the page.');
            }
            
            // Get auth token for role-based pricing
            const headers = { 'Content-Type': 'application/json' };
            const session = localStorage.getItem('dataeasy_session');
            if (session) {
                try {
                    const parsed = JSON.parse(session);
                    if (parsed.token) {
                        headers['Authorization'] = `Bearer ${parsed.token}`;
                    }
                } catch (e) { /* ignore */ }
            }
            
            const response = await fetch(`${baseUrl}/orders/packages`, { headers });
            const data = await response.json();
            
            if (data.success && data.packages) {
                // Update packages with API data (database prices)
                for (const [network, pkgList] of Object.entries(data.packages)) {
                    if (Array.isArray(pkgList)) {
                        packages[network] = pkgList;
                    }
                }
                
                // Update network availability from server
                if (data.networkAvailability) {
                    networkAvailability = { ...networkAvailability, ...data.networkAvailability };
                    console.log('✓ Network availability loaded:', networkAvailability);
                }
                
                packagesLoaded = true;
                packagesLoadError = null;
                console.log('✓ Packages synced from API (database prices)');
                
                // Emit event for UI refresh (includes network availability)
                EventBus.emit('packages:loaded', { packages, networkAvailability });
                return true;
            } else {
                throw new Error(data.message || 'Failed to load packages from server');
            }
        } catch (error) {
            packagesLoadError = error.message;
            console.error('✗ Failed to load packages from API:', error.message);
            // DO NOT fall back to static data - fail closed
            // Packages remain empty, preventing orders with unknown prices
            Toast.error('Unable to load packages. Please refresh the page.');
        }
        return false;
    }
    
    /**
     * Check if packages have been loaded from API
     */
    function arePackagesLoaded() {
        return packagesLoaded;
    }
    
    /**
     * Get packages load error if any
     */
    function getPackagesLoadError() {
        return packagesLoadError;
    }

    /**
     * Check if a package is out of stock
     */
    function isOutOfStock(packageId) {
        const pkg = findPackage(packageId);
        return pkg ? pkg.outOfStock === true : true;
    }

    /**
     * Get network availability (which networks are available for purchase)
     */
    function getNetworkAvailability() {
        return { ...networkAvailability };
    }

    /**
     * Check if a specific network is available
     */
    function isNetworkAvailable(network) {
        return networkAvailability[network] !== false;
    }

    // Public API
    return {
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        setPhoneNumbers,
        setNetwork,
        getSubtotal,
        getItemCount,
        getTotalPhones,
        getTotal,
        getPackages,
        findPackage,
        getCart,
        isEmpty,
        checkout,
        loadCart,
        updateCartUI,
        hasMixedNetworks,
        getCartNetwork,
        syncPackagesFromAPI,
        isOutOfStock,
        getNetworkAvailability,
        isNetworkAvailable,
        arePackagesLoaded,
        getPackagesLoadError
    };

})();

// Make it globally available
window.DataEasyCart = DataEasyCart;

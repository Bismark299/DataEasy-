/**
 * DataEasy+ - Main Application Logic
 * Page initialization, event handlers, and core functionality
 */

const DataEasyApp = (function() {
    'use strict';

    const { Storage, Toast, Format, EventBus, DOM, Network, Modal, Paystack } = DataEasyUtils;
    const { BulkParser } = DataEasyValidation;

    // ==========================================
    // STATE
    // ==========================================
    let state = {
        currentNetwork: 'MTN',
        parsedNumbers: { valid: [], invalid: [], duplicates: [] },
        selectedPackage: null
    };

    // ==========================================
    // NETWORK TABS
    // ==========================================
    function initNetworkTabs() {
        const tabs = document.querySelectorAll('[data-network-tab]');
        const packagesContainer = document.getElementById('packages-grid');

        if (!tabs.length) return;

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const network = tab.dataset.networkTab;
                
                // Check if network is available
                if (!DataEasyCart.isNetworkAvailable(network)) {
                    Toast.warning(`${network} is currently out of stock`);
                    return;
                }
                
                setActiveNetwork(network);
            });
        });

        // Apply initial network availability styles
        updateNetworkTabAvailability();

        // Set initial network (first available one)
        const availability = DataEasyCart.getNetworkAvailability();
        const defaultNetwork = availability.MTN ? 'MTN' : 
                               availability.Telecel ? 'Telecel' : 
                               availability.AirtelTigo ? 'AirtelTigo' : 'MTN';
        setActiveNetwork(defaultNetwork);
    }

    /**
     * Update network tab styles based on availability
     */
    function updateNetworkTabAvailability() {
        const tabs = document.querySelectorAll('[data-network-tab]');
        const availability = DataEasyCart.getNetworkAvailability();

        tabs.forEach(tab => {
            const network = tab.dataset.networkTab;
            const isAvailable = availability[network] !== false;

            if (!isAvailable) {
                // Mark as out of stock
                tab.classList.add('opacity-50', 'cursor-not-allowed', 'relative');
                tab.style.pointerEvents = 'auto'; // Allow click to show message
                
                // Add "Out of Stock" badge if not already present
                if (!tab.querySelector('.out-of-stock-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'out-of-stock-badge absolute -top-2 -right-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold';
                    badge.textContent = 'OUT';
                    tab.style.position = 'relative';
                    tab.appendChild(badge);
                }
            } else {
                // Remove out of stock styling
                tab.classList.remove('opacity-50', 'cursor-not-allowed');
                const badge = tab.querySelector('.out-of-stock-badge');
                if (badge) badge.remove();
            }
        });
    }

    function setActiveNetwork(network) {
        // Check availability before setting
        if (!DataEasyCart.isNetworkAvailable(network)) {
            Toast.warning(`${network} is currently out of stock`);
            return;
        }
        
        state.currentNetwork = network;
        DataEasyCart.setNetwork(network);

        // Update tab styles
        const tabs = document.querySelectorAll('[data-network-tab]');
        tabs.forEach(tab => {
            const tabNetwork = tab.dataset.networkTab;
            const isActive = tabNetwork === network;
            const isAvailable = DataEasyCart.isNetworkAvailable(tabNetwork);
            
            // Remove all network-specific classes
            tab.classList.remove(
                'bg-mtn-yellow', 'text-black',
                'bg-gradient-to-r', 'from-airtel-blue', 'to-airtel-red', 'text-white',
                'bg-telecel-red', 'text-white',
                'bg-gray-700', 'text-gray-400'
            );

            if (isActive && isAvailable) {
                switch(network) {
                    case 'MTN':
                        tab.classList.add('bg-mtn-yellow', 'text-black');
                        break;
                    case 'AirtelTigo':
                        tab.classList.add('bg-gradient-to-r', 'from-airtel-blue', 'to-airtel-red', 'text-white');
                        break;
                    case 'Telecel':
                        tab.classList.add('bg-telecel-red', 'text-white');
                        break;
                }
            } else {
                tab.classList.add('bg-gray-700', 'text-gray-400');
            }
        });

        // Update packages display
        renderPackages(network);

        // Update cards styling
        updateCardStyles(network);
    }

    function updateCardStyles(network) {
        const cards = document.querySelectorAll('.package-card');
        
        cards.forEach(card => {
            const cardBody = card.querySelector('.card-body');
            const cardFooter = card.querySelector('.card-footer');
            
            if (!cardBody || !cardFooter) return;

            // Remove existing network classes
            cardBody.classList.remove(
                'bg-mtn-yellow', 'bg-airtel-blue', 'bg-telecel-red'
            );
            cardFooter.classList.remove(
                'bg-gray-800', 'bg-airtel-red', 'bg-gray-900', 
                'text-gray-300', 'text-white'
            );

            // Apply network-specific styles
            switch(network) {
                case 'MTN':
                    cardBody.classList.add('bg-mtn-yellow');
                    cardFooter.classList.add('bg-gray-800', 'text-gray-300');
                    break;
                case 'AirtelTigo':
                    cardBody.classList.add('bg-airtel-blue');
                    cardFooter.classList.add('bg-airtel-red', 'text-white');
                    break;
                case 'Telecel':
                    cardBody.classList.add('bg-telecel-red');
                    cardFooter.classList.add('bg-gray-900', 'text-white');
                    break;
            }
        });
    }

    // ==========================================
    // PACKAGES RENDERING
    // ==========================================
    function renderPackages(network) {
        const container = document.getElementById('packages-grid');
        if (!container) return;

        const packages = DataEasyCart.getPackages(network);
        
        container.innerHTML = packages.map(pkg => createPackageCard(pkg, network)).join('');

        // Reattach event listeners (only for non-out-of-stock packages)
        container.querySelectorAll('.package-card[data-package-id]').forEach(card => {
            card.addEventListener('click', () => {
                const packageId = card.dataset.packageId;
                openPackageModal(packageId);
            });
        });
    }

    function createPackageCard(pkg, network) {
        const networkClasses = {
            MTN: 'mtn-card',
            AirtelTigo: 'airtel-card',
            Telecel: 'telecel-card'
        };

        const networkStyles = {
            MTN: { body: 'bg-mtn-yellow', text: 'text-black', badge: 'MTN', badgeColor: 'border-gray-600 text-gray-600' },
            AirtelTigo: { body: 'bg-airtel-blue', text: 'text-white', badge: 'AT', badgeColor: 'border-white text-white' },
            Telecel: { body: 'bg-telecel-red', text: 'text-white', badge: 'T', badgeColor: 'border-white text-white' }
        };

        const style = networkStyles[network] || networkStyles.MTN;
        const cardClass = networkClasses[network] || 'mtn-card';
        
        // Check if out of stock
        const isOutOfStock = pkg.outOfStock === true;
        const outOfStockClass = isOutOfStock ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:shadow-xl transform hover:-translate-y-1';
        const clickAttr = isOutOfStock ? '' : `data-package-id="${pkg.id}"`;

        return `
            <div class="package-card ${cardClass} ${outOfStockClass} rounded-xl overflow-hidden shadow-lg transition-all duration-300 relative" ${clickAttr}>
                ${isOutOfStock ? `
                <div class="absolute inset-0 bg-black/50 z-10 flex items-center justify-center">
                    <span class="bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">OUT OF STOCK</span>
                </div>
                ` : ''}
                <div class="card-body ${style.body} p-4 sm:p-5 text-center relative">
                    <span class="absolute top-3 left-3 border-2 ${style.badgeColor} rounded-full px-3 py-0.5 text-xs font-bold">${style.badge}</span>
                    <p class="${style.text} text-3xl sm:text-4xl font-bold mt-4">${pkg.data}</p>
                </div>
                <div class="card-footer p-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p class="text-sm font-semibold">${Format.currency(pkg.price)}</p>
                        <p class="text-xs text-gray-400">Price</p>
                    </div>
                    <div>
                        <p class="text-sm font-semibold">N/A</p>
                        <p class="text-xs text-gray-400">Rollover</p>
                    </div>
                    <div>
                        <p class="text-sm font-semibold">No Expiry</p>
                        <p class="text-xs text-gray-400">Duration</p>
                    </div>
                </div>
            </div>
        `;
    }

    // ==========================================
    // PACKAGE MODAL
    // ==========================================
    function openPackageModal(packageId) {
        const pkg = DataEasyCart.findPackage(packageId);
        if (!pkg) return;

        state.selectedPackage = pkg;
        const network = packageId.startsWith('mtn-') ? 'MTN' : 
                        packageId.startsWith('at-') ? 'AirtelTigo' : 'Telecel';

        const modal = document.getElementById('package-modal');
        if (!modal) return;

        // Update modal content
        const modalTitle = modal.querySelector('[data-modal-title]');
        const modalNetwork = modal.querySelector('[data-modal-network]');
        const modalData = modal.querySelector('[data-modal-data]');
        const modalValidity = modal.querySelector('[data-modal-validity]');
        const modalPrice = modal.querySelector('[data-modal-price]');
        const modalTotal = modal.querySelector('[data-modal-total]');
        const phoneInput = modal.querySelector('[data-modal-phone]');
        const quantityInput = modal.querySelector('[data-modal-quantity]');

        if (modalTitle) modalTitle.textContent = `${pkg.data} Data Package`;
        if (modalNetwork) {
            modalNetwork.textContent = network;
            modalNetwork.style.backgroundColor = Network.getColor(network).bg;
            modalNetwork.style.color = Network.getColor(network).text;
        }
        if (modalData) modalData.textContent = pkg.data;
        if (modalValidity) modalValidity.textContent = pkg.validity;
        if (modalPrice) modalPrice.textContent = Format.currency(pkg.price);
        if (modalTotal) modalTotal.textContent = Format.currency(pkg.price);
        if (phoneInput) phoneInput.value = '';
        if (quantityInput) quantityInput.value = '1';

        // Update total on quantity change
        if (quantityInput) {
            quantityInput.onchange = quantityInput.oninput = () => {
                const qty = parseInt(quantityInput.value) || 1;
                if (modalTotal) modalTotal.textContent = Format.currency(pkg.price * qty);
            };
        }

        // Show modal
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Focus phone input
        setTimeout(() => phoneInput?.focus(), 100);
    }

    function closePackageModal() {
        const modal = document.getElementById('package-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        state.selectedPackage = null;
    }

    function addToCartFromModal() {
        if (!state.selectedPackage) return;

        const modal = document.getElementById('package-modal');
        const phoneInput = modal?.querySelector('[data-modal-phone]');
        const quantityInput = modal?.querySelector('[data-modal-quantity]');

        const phone = phoneInput?.value?.replace(/\D/g, '') || '';
        const quantity = parseInt(quantityInput?.value) || 1;

        // Phone number is required
        if (!phone) {
            Toast.error('Please enter a phone number');
            DOM.shake(phoneInput);
            phoneInput?.focus();
            return;
        }

        // Validate phone
        const phoneNumbers = [];
        const validation = DataEasyValidation.Rules.ghanaPhone(phone);
        if (!validation.isValid) {
            Toast.error(validation.message);
            DOM.shake(phoneInput);
            return;
        }

        // Check network matches
        const packageNetwork = state.selectedPackage.id.startsWith('mtn-') ? 'MTN' :
                               state.selectedPackage.id.startsWith('at-') ? 'AirtelTigo' : 'Telecel';
        if (validation.network !== packageNetwork) {
            Toast.error(`This number is ${validation.network}, but you selected a ${packageNetwork} package`);
            DOM.shake(phoneInput);
            return;
        }
        phoneNumbers.push(phone);

        // Add to cart
        DataEasyCart.addItem(state.selectedPackage.id, phoneNumbers, quantity);
        closePackageModal();
    }

    // ==========================================
    // BULK ORDERS
    // ==========================================
    function initBulkOrders() {
        const textarea = document.getElementById('bulk-numbers');
        const parseBtn = document.getElementById('parse-numbers-btn');
        const addBtn = document.getElementById('bulk-add-btn');
        const resultsContainer = document.getElementById('bulk-results');

        if (!textarea) return;

        // Real-time parsing with debounce
        textarea.addEventListener('input', DataEasyUtils.debounce(() => {
            parseBulkNumbers();
        }, 500));

        // Parse button click
        if (parseBtn) {
            parseBtn.addEventListener('click', parseBulkNumbers);
        }

        // Add to cart button
        if (addBtn) {
            addBtn.addEventListener('click', addBulkToCart);
        }
    }

    function addBulkToCart() {
        if (!state.parsedNumbers || state.parsedNumbers.valid.length === 0) {
            Toast.error('No valid entries to add. Please check your input.');
            return;
        }

        // Check if all items are from the same network
        const networks = [...new Set(state.parsedNumbers.valid.map(item => item.network))];
        if (networks.length > 1) {
            Toast.error('Cannot add items from different networks. Please separate by network.');
            return;
        }

        // Check max items limit
        if (state.parsedNumbers.valid.length > 100) {
            Toast.error('Maximum 100 items per request. Please reduce your list.');
            return;
        }

        const network = networks[0];
        let addedCount = 0;
        let failedCount = 0;

        state.parsedNumbers.valid.forEach(item => {
            // Build package ID based on network and data size
            const networkPrefix = item.network === 'MTN' ? 'mtn' : (item.network === 'AirtelTigo' ? 'at' : 'tc');
            const packageId = `${networkPrefix}-${item.dataSize}gb`;
            
            // Use silent mode to prevent individual toasts
            const success = DataEasyCart.addItem(packageId, [item.number], 1, { silent: true });
            if (success) {
                addedCount++;
            } else {
                failedCount++;
            }
        });

        // Show single summary toast instead of many individual ones
        if (addedCount > 0) {
            Toast.success(`Added ${addedCount} item${addedCount > 1 ? 's' : ''} to cart!`);
            // Clear textarea after successful add
            const textarea = document.getElementById('bulk-numbers');
            if (textarea) {
                textarea.value = '';
                parseBulkNumbers(); // Clear results
            }
        }
        
        if (failedCount > 0) {
            Toast.warning(`${failedCount} item${failedCount > 1 ? 's' : ''} could not be added.`);
        }
    }

    function parseBulkNumbers() {
        const textarea = document.getElementById('bulk-numbers');
        const resultsContainer = document.getElementById('bulk-results');

        if (!textarea) return;

        const text = textarea.value;
        state.parsedNumbers = BulkParser.parse(text);
        const summary = BulkParser.getSummary(state.parsedNumbers);

        // Update UI
        if (resultsContainer) {
            if (summary.total === 0) {
                resultsContainer.innerHTML = '';
                return;
            }

            resultsContainer.innerHTML = `
                <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <h4 class="text-white font-semibold mb-3 flex items-center gap-2">
                        <i class="fas fa-chart-pie text-blue-400"></i>
                        Analysis Results
                    </h4>
                    
                    <div class="grid grid-cols-4 gap-3 mb-4">
                        <div class="bg-green-500/10 rounded-lg p-3 text-center border border-green-500/30">
                            <p class="text-green-400 text-2xl font-bold">${summary.valid}</p>
                            <p class="text-gray-400 text-xs">Valid</p>
                        </div>
                        <div class="bg-red-500/10 rounded-lg p-3 text-center border border-red-500/30">
                            <p class="text-red-400 text-2xl font-bold">${summary.invalid}</p>
                            <p class="text-gray-400 text-xs">Invalid</p>
                        </div>
                        <div class="bg-yellow-500/10 rounded-lg p-3 text-center border border-yellow-500/30">
                            <p class="text-yellow-400 text-2xl font-bold">${summary.duplicates}</p>
                            <p class="text-gray-400 text-xs">Duplicates</p>
                        </div>
                        <div class="bg-blue-500/10 rounded-lg p-3 text-center border border-blue-500/30">
                            <p class="text-blue-400 text-2xl font-bold">${summary.totalData}GB</p>
                            <p class="text-gray-400 text-xs">Total Data</p>
                        </div>
                    </div>

                    ${Object.keys(summary.networks).length > 0 ? `
                        <div class="space-y-2 mb-3">
                            <p class="text-gray-400 text-sm">By Network:</p>
                            <div class="flex flex-wrap gap-2">
                                ${Object.entries(summary.networks).map(([network, count]) => `
                                    <span class="px-3 py-1 rounded-full text-sm font-medium" style="background-color: ${Network.getColor(network).bg}; color: ${Network.getColor(network).text}">
                                        ${network}: ${count}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${Object.keys(summary.dataSizes || {}).length > 0 ? `
                        <div class="space-y-2 mb-3">
                            <p class="text-gray-400 text-sm">By Data Size:</p>
                            <div class="flex flex-wrap gap-2">
                                ${Object.entries(summary.dataSizes).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).map(([size, count]) => `
                                    <span class="px-3 py-1 rounded-full text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                        ${size}GB: ${count}
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${summary.valid > 0 ? `
                        <div class="mt-3 pt-3 border-t border-gray-700">
                            <p class="text-green-400 text-sm mb-2">
                                <i class="fas fa-check-circle mr-1"></i>
                                Valid Entries:
                            </p>
                            <div class="max-h-32 overflow-y-auto space-y-1">
                                ${state.parsedNumbers.valid.slice(0, 20).map(item => `
                                    <div class="flex justify-between items-center px-2 py-1 bg-green-500/10 rounded text-xs">
                                        <span class="text-gray-300">${item.formatted}</span>
                                        <span class="text-gray-400">${item.network}</span>
                                        <span class="text-green-400 font-medium">${item.dataSize}GB</span>
                                    </div>
                                `).join('')}
                                ${state.parsedNumbers.valid.length > 20 ? `<p class="text-gray-500 text-xs text-center py-1">+${state.parsedNumbers.valid.length - 20} more entries</p>` : ''}
                            </div>
                        </div>
                    ` : ''}

                    ${summary.invalid > 0 ? `
                        <div class="mt-3 pt-3 border-t border-gray-700">
                            <p class="text-red-400 text-sm mb-2">
                                <i class="fas fa-exclamation-triangle mr-1"></i>
                                Invalid Entries:
                            </p>
                            <div class="max-h-32 overflow-y-auto space-y-1">
                                ${state.parsedNumbers.invalid.slice(0, 10).map(item => `
                                    <div class="flex justify-between items-center px-2 py-1 bg-red-500/10 rounded text-xs">
                                        <span class="text-gray-300">${item.original || item.number || 'Empty'}</span>
                                        <span class="text-red-400">${item.reason}</span>
                                    </div>
                                `).join('')}
                                ${state.parsedNumbers.invalid.length > 10 ? `<p class="text-gray-500 text-xs text-center py-1">+${state.parsedNumbers.invalid.length - 10} more</p>` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        // Update valid numbers count display
        const validCountEl = document.getElementById('valid-numbers-count');
        if (validCountEl) {
            validCountEl.textContent = summary.valid;
        }
    }

    // ==========================================
    // SIDEBAR HANDLERS
    // ==========================================
    function initSidebars() {
        // Account sidebar
        const accountBtn = document.getElementById('account-btn');
        const accountBtnMobile = document.getElementById('account-btn-mobile');
        const accountSidebar = document.getElementById('account-sidebar') || document.getElementById('accountSidebar');
        const closeAccountBtn = document.getElementById('close-sidebar') || document.getElementById('close-account-sidebar');
        // Support both old and new backdrop IDs
        const backdrop = document.getElementById('sidebar-backdrop') || document.getElementById('sidebarOverlay');

        // Cart sidebar
        const cartBtn = document.getElementById('cart-btn');
        const cartBtnMobile = document.getElementById('cart-btn-mobile');
        const cartSidebar = document.getElementById('cart-sidebar');
        const closeCartBtn = document.getElementById('close-cart-sidebar');

        function showBackdrop() {
            if (backdrop) {
                backdrop.classList.remove('hidden');
            }
        }

        function hideBackdrop() {
            if (backdrop) {
                backdrop.classList.add('hidden');
            }
        }

        function closeAllSidebars() {
            if (accountSidebar) {
                accountSidebar.classList.add('-translate-x-full');
            }
            if (cartSidebar) {
                cartSidebar.classList.add('translate-x-full');
            }
            hideBackdrop();
        }

        function openAccountSidebar(e) {
            e.preventDefault();
            if (accountSidebar) {
                accountSidebar.classList.remove('-translate-x-full');
                showBackdrop();
            }
        }

        if (accountBtn) {
            accountBtn.addEventListener('click', openAccountSidebar);
        }

        if (accountBtnMobile) {
            accountBtnMobile.addEventListener('click', openAccountSidebar);
        }

        if (closeAccountBtn) {
            closeAccountBtn.addEventListener('click', () => {
                if (accountSidebar) {
                    accountSidebar.classList.add('-translate-x-full');
                }
                hideBackdrop();
            });
        }

        function openCartSidebar(e) {
            e.preventDefault();
            if (cartSidebar) {
                cartSidebar.classList.remove('translate-x-full');
                showBackdrop();
            }
        }

        if (cartBtn) {
            cartBtn.addEventListener('click', openCartSidebar);
        }

        if (cartBtnMobile) {
            cartBtnMobile.addEventListener('click', openCartSidebar);
        }

        if (closeCartBtn) {
            closeCartBtn.addEventListener('click', () => {
                if (cartSidebar) {
                    cartSidebar.classList.add('translate-x-full');
                }
                hideBackdrop();
            });
        }

        // Close sidebars on backdrop click
        if (backdrop) {
            backdrop.addEventListener('click', closeAllSidebars);
        }
    }

    // ==========================================
    // MOBILE MENU
    // ==========================================
    function initMobileMenu() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const mobileMenu = document.getElementById('mobile-menu');
        const closeMenuBtn = document.getElementById('close-mobile-menu');

        if (menuBtn && mobileMenu) {
            menuBtn.addEventListener('click', () => {
                mobileMenu.classList.remove('hidden');
                setTimeout(() => {
                    mobileMenu.querySelector('.menu-content')?.classList.remove('translate-x-full');
                }, 10);
            });
        }

        if (closeMenuBtn && mobileMenu) {
            closeMenuBtn.addEventListener('click', () => {
                mobileMenu.querySelector('.menu-content')?.classList.add('translate-x-full');
                setTimeout(() => mobileMenu.classList.add('hidden'), 300);
            });
        }

        // Close on backdrop click
        mobileMenu?.addEventListener('click', (e) => {
            if (e.target === mobileMenu) {
                mobileMenu.querySelector('.menu-content')?.classList.add('translate-x-full');
                setTimeout(() => mobileMenu.classList.add('hidden'), 300);
            }
        });
    }

    // ==========================================
    // CHECKOUT
    // ==========================================
    function initCheckout() {
        const checkoutBtn = document.getElementById('checkout-btn');
        
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', async () => {
                if (DataEasyCart.isEmpty()) {
                    Toast.warning('Your cart is empty');
                    return;
                }

                if (!DataEasyAuth.isAuthenticated()) {
                    Toast.warning('Please login to continue');
                    const isInPagesFolder = window.location.pathname.includes('/pages/');
                    const loginPath = isInPagesFolder ? 'login.html' : 'pages/login.html';
                    window.location.href = loginPath + '?redirect=' + encodeURIComponent(window.location.href);
                    return;
                }

                // Confirm checkout
                Modal.confirm(
                    'Confirm Order',
                    `Total amount: ${Format.currency(DataEasyCart.getTotal())}. Proceed with payment?`,
                    async () => {
                        DOM.setLoading(checkoutBtn, true, 'Processing...');
                        
                        try {
                            const order = await DataEasyCart.checkout();
                            DOM.setLoading(checkoutBtn, false);
                            
                            if (order) {
                                // Close cart sidebar and backdrop
                                const cartSidebar = document.getElementById('cart-sidebar');
                                const backdrop = document.getElementById('sidebar-backdrop');
                                if (cartSidebar) {
                                    cartSidebar.classList.add('translate-x-full');
                                }
                                if (backdrop) {
                                    backdrop.classList.add('hidden');
                                }

                                // Detect if we're in a subpage and adjust redirect path
                                const isInPagesFolder = window.location.pathname.includes('/pages/');
                                const orderDetailsPath = isInPagesFolder 
                                    ? `order-details.html?id=${order.id}&new=true`
                                    : `pages/order-details.html?id=${order.id}&new=true`;

                                // Show success and redirect
                                setTimeout(() => {
                                    window.location.href = orderDetailsPath;
                                }, 1000);
                            }
                        } catch (error) {
                            DOM.setLoading(checkoutBtn, false);
                            Toast.error(error.message || 'Checkout failed');
                        }
                    }
                );
            });
        }

        // Clear cart button
        const clearCartBtn = document.getElementById('clear-cart-btn');
        if (clearCartBtn) {
            clearCartBtn.addEventListener('click', () => {
                Modal.confirm(
                    'Clear Cart',
                    'Are you sure you want to remove all items from your cart?',
                    () => DataEasyCart.clearCart()
                );
            });
        }
    }

    // ==========================================
    // WALLET DISPLAY
    // ==========================================
    async function updateWalletDisplay() {
        let balance = 0;
        let todayCredit = 0;
        let todayDebit = 0;
        
        // Try API first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            try {
                const response = await DataEasyAPI.Wallet.getBalance();
                if (response.success) {
                    balance = response.balance;
                    // Also update localStorage for offline use
                    const wallet = Storage.get('wallet', { balance: 0, transactions: [] });
                    wallet.balance = balance;
                    Storage.set('wallet', wallet);
                }
                
                // Fetch today's transactions from wallet history
                try {
                    const txResponse = await DataEasyAPI.Wallet.getHistory({ limit: 50 });
                    if (txResponse.success && txResponse.transactions) {
                        const today = new Date().toDateString();
                        txResponse.transactions.forEach(tx => {
                            const txDate = new Date(tx.createdAt).toDateString();
                            if (txDate === today && tx.status === 'completed') {
                                if (tx.type === 'credit') {
                                    todayCredit += parseFloat(tx.amount) || 0;
                                } else if (tx.type === 'debit') {
                                    todayDebit += parseFloat(tx.amount) || 0;
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.log('Could not fetch today transactions');
                }
            } catch (e) {
                // Fallback to localStorage
                const wallet = Storage.get('wallet', { balance: 0 });
                balance = wallet.balance;
            }
        } else {
            const wallet = Storage.get('wallet', { balance: 0, transactions: [] });
            balance = wallet.balance;
            
            // Calculate today's from localStorage
            const today = new Date().toDateString();
            (wallet.transactions || []).forEach(tx => {
                const txDate = new Date(tx.createdAt).toDateString();
                if (txDate === today) {
                    if (tx.type === 'credit') {
                        todayCredit += parseFloat(tx.amount) || 0;
                    } else if (tx.type === 'debit') {
                        todayDebit += parseFloat(tx.amount) || 0;
                    }
                }
            });
        }
        
        document.querySelectorAll('[data-wallet-balance]').forEach(el => {
            el.textContent = Format.currency(balance);
        });
        
        // Update today's stats (sidebar)
        document.querySelectorAll('[data-today-credit]').forEach(el => {
            el.textContent = '+' + Format.currency(todayCredit);
        });
        document.querySelectorAll('[data-today-debit]').forEach(el => {
            el.textContent = '-' + Format.currency(todayDebit);
        });
        
        // Update today's stats (main content - wallet history page)
        document.querySelectorAll('[data-wallet-today-in]').forEach(el => {
            el.textContent = '+' + Format.currency(todayCredit);
        });
        document.querySelectorAll('[data-wallet-today-out]').forEach(el => {
            el.textContent = '-' + Format.currency(todayDebit);
        });
    }

    // ==========================================
    // ORDERS PAGE
    // ==========================================
    async function initOrdersPage() {
        const ordersTableBody = document.getElementById('ordersTableBody');
        const mobileOrdersList = document.getElementById('mobileOrdersList');
        const filterTabs = document.querySelectorAll('.filter-btn[data-filter]');
        const searchInput = document.getElementById('search-query');
        const searchForm = document.getElementById('order-search-form');

        if (!ordersTableBody && !mobileOrdersList) return;

        let currentFilter = 'all';
        let allOrders = [];

        // Fetch orders from API or localStorage
        async function fetchOrders() {
            // Try API first
            if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
                try {
                    const response = await DataEasyAPI.Users.getOrders();
                    if (response.success) {
                        allOrders = response.orders.map(order => ({
                            ...order,
                            id: order.orderId,
                            createdAt: order.createdAt
                        }));
                        return;
                    }
                } catch (e) {
                    console.log('API failed, using localStorage');
                }
            }
            
            // Fallback to localStorage
            allOrders = Storage.get('orders', []);
            const user = Storage.get('user');
            if (user) {
                allOrders = allOrders.filter(o => o.userId === user.id);
            }
        }

        // Initial fetch
        await fetchOrders();

        // Render orders
        function renderOrders(filter = 'all', search = '') {
            let orders = [...allOrders];

            // Sort by newest first
            orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Apply date filter
            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 86400000).toDateString();

            if (filter === 'today') {
                orders = orders.filter(o => new Date(o.createdAt).toDateString() === today);
            } else if (filter === 'yesterday') {
                orders = orders.filter(o => new Date(o.createdAt).toDateString() === yesterday);
            }

            // Apply search
            if (search) {
                const searchLower = search.toLowerCase();
                orders = orders.filter(o => 
                    o.id.toLowerCase().includes(searchLower) ||
                    (o.items && o.items.some(item => 
                        item.phoneNumbers && item.phoneNumbers.some(phone => phone.includes(search))
                    ))
                );
            }

            // Update order count in header
            const orderCountEl = document.getElementById('orders-count');
            if (orderCountEl) {
                orderCountEl.textContent = `Showing ${orders.length} order${orders.length !== 1 ? 's' : ''}`;
            }

            if (orders.length === 0) {
                // Show empty state
                if (ordersTableBody) {
                    ordersTableBody.innerHTML = `
                        <tr class="border-b border-gray-700">
                            <td colspan="6" class="py-12 text-center">
                                <div class="flex flex-col items-center">
                                    <div class="bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                                        <i class="fas fa-receipt text-gray-500 text-2xl"></i>
                                    </div>
                                    <p class="text-gray-400 mb-1">No orders found</p>
                                    <p class="text-gray-500 text-sm">${filter !== 'all' ? 'Try a different filter' : 'Your orders will appear here'}</p>
                                </div>
                            </td>
                        </tr>
                    `;
                }
                if (mobileOrdersList) {
                    mobileOrdersList.innerHTML = `
                        <div class="flex flex-col items-center py-8">
                            <div class="bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                                <i class="fas fa-receipt text-gray-500 text-2xl"></i>
                            </div>
                            <p class="text-gray-400 mb-1">No orders found</p>
                            <p class="text-gray-500 text-sm">${filter !== 'all' ? 'Try a different filter' : 'Your orders will appear here'}</p>
                        </div>
                    `;
                }
                return;
            }

            // Render desktop table
            if (ordersTableBody) {
                ordersTableBody.innerHTML = orders.map(order => {
                    const itemCount = order.items ? order.items.length : 0;
                    const paymentStatus = order.paymentStatus || 'Completed';
                    const deliveryStatus = order.deliveryStatus || 'Processing';
                    
                    // Format date like: February 2, 2026 - 5:11 am
                    const orderDate = new Date(order.createdAt);
                    const dateStr = orderDate.toLocaleDateString('en-US', { 
                        month: 'long', 
                        day: 'numeric', 
                        year: 'numeric' 
                    });
                    const timeStr = orderDate.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    }).toLowerCase();
                    
                    // Use processedAt for delivery time (when it was actually delivered)
                    const deliveredDate = order.processedAt ? new Date(order.processedAt) : orderDate;
                    const deliveredTimeStr = deliveredDate.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    }).toLowerCase();
                    const deliveredDateStr = `${deliveredDate.getDate()}/${deliveredDate.toLocaleString('en-US', {month: 'long'})}/${deliveredDate.getFullYear()}`;
                    
                    // Delivery status display
                    let deliveryDisplay = '';
                    if (deliveryStatus === 'Delivered' || deliveryStatus === 'Submitted') {
                        deliveryDisplay = `<span class="text-green-400">Sent<br><span class="text-xs">${deliveredTimeStr} - ${deliveredDateStr}</span></span>`;
                    } else if (deliveryStatus === 'Processing') {
                        deliveryDisplay = `<span class="text-yellow-400">Processing...</span>`;
                    } else if (deliveryStatus === 'Failed') {
                        deliveryDisplay = `<span class="text-red-400">Failed</span>`;
                    } else {
                        deliveryDisplay = `<span class="text-gray-400">—</span>`;
                    }
                    
                    return `
                        <tr class="border-b border-gray-700 hover:bg-gray-800/30 transition">
                            <td class="py-4 px-3 md:px-4 text-white font-medium">${order.id}</td>
                            <td class="py-4 px-3 md:px-4 text-gray-400 text-sm">${dateStr} - ${timeStr}</td>
                            <td class="py-4 px-3 md:px-4 text-green-400">${paymentStatus}</td>
                            <td class="py-4 px-3 md:px-4 text-white">${Format.currency(order.total)} <span class="text-gray-400 text-sm">for ${itemCount} items</span></td>
                            <td class="py-4 px-3 md:px-4 text-sm">${deliveryDisplay}</td>
                            <td class="py-4 px-3 md:px-4">
                                <a href="order-details.html?id=${order.id}" class="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded transition inline-block">View</a>
                                <button class="bg-gray-600 hover:bg-gray-500 text-white text-xs px-3 py-1.5 rounded transition ml-1" onclick="event.stopPropagation(); exportOrder('${order.id}')">Export</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            // Render mobile cards
            if (mobileOrdersList) {
                mobileOrdersList.innerHTML = orders.map(order => {
                    const itemCount = order.items ? order.items.length : 0;
                    const paymentStatus = order.paymentStatus || 'Completed';
                    const deliveryStatus = order.deliveryStatus || 'Processing';
                    const deliveryTime = order.processedAt ? Format.time(order.processedAt) : Format.time(order.createdAt);
                    const deliveryDate = order.processedAt ? Format.date(order.processedAt) : Format.date(order.createdAt);
                    
                    let deliveryText = deliveryStatus;
                    if (deliveryStatus === 'Delivered' || deliveryStatus === 'Submitted' || deliveryStatus.includes('Submitted')) {
                        deliveryText = `Sent<br>${deliveryTime} - ${deliveryDate}`;
                    }
                    
                    const deliveryClass = (deliveryStatus === 'Delivered' || deliveryStatus === 'Submitted' || deliveryStatus.includes('Submitted')) ? 'text-green-400' :
                                         deliveryStatus === 'Processing' ? 'text-yellow-400' :
                                         deliveryStatus === 'Failed' ? 'text-red-400' : 'text-gray-400';
                    
                    return `
                        <div class="bg-card-bg rounded-lg border border-gray-600 mb-4 overflow-hidden">
                            <div class="divide-y divide-gray-700">
                                <div class="flex justify-between items-center px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">ORDER ID:</span>
                                    <a href="order-details.html?id=${order.id}" class="text-blue-400 hover:text-blue-300 font-medium">${order.id}</a>
                                </div>
                                <div class="flex justify-between items-center px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">DATE:</span>
                                    <span class="text-white text-sm">${Format.date(order.createdAt)} - ${Format.time(order.createdAt)}</span>
                                </div>
                                <div class="flex justify-between items-center px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">PAYMENT STATUS:</span>
                                    <span class="text-white text-sm">${paymentStatus}</span>
                                </div>
                                <div class="flex justify-between items-center px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">TOTAL:</span>
                                    <span class="text-white text-sm">₵${parseFloat(order.total).toFixed(2)} for ${itemCount} items</span>
                                </div>
                                <div class="flex justify-between items-start px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">DELIVERY STATUS:</span>
                                    <span class="${deliveryClass} text-sm text-right">${deliveryText}</span>
                                </div>
                                <div class="flex justify-between items-center px-4 py-2">
                                    <span class="text-gray-400 font-semibold text-sm">ACTIONS:</span>
                                    <div class="flex gap-2">
                                        <a href="order-details.html?id=${order.id}" class="px-4 py-1.5 border border-blue-500 text-blue-400 text-sm rounded hover:bg-blue-500/10 transition">View</a>
                                        <button onclick="event.stopPropagation(); exportOrder('${order.id}')" class="px-4 py-1.5 border border-blue-500 text-blue-400 text-sm rounded hover:bg-blue-500/10 transition">Export</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Filter tabs
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                currentFilter = tab.dataset.filter;
                
                filterTabs.forEach(t => {
                    t.classList.remove('bg-blue-600', 'text-white');
                    t.classList.add('text-gray-400');
                });
                tab.classList.remove('text-gray-400');
                tab.classList.add('bg-blue-600', 'text-white');
                
                renderOrders(currentFilter, searchInput?.value || '');
            });
        });

        // Search form
        if (searchForm) {
            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                renderOrders(currentFilter, searchInput?.value || '');
            });
        }

        // Search input
        if (searchInput) {
            searchInput.addEventListener('input', DataEasyUtils.debounce(() => {
                renderOrders(currentFilter, searchInput.value);
            }, 300));
        }

        // Initial render
        renderOrders();
    }

    // ==========================================
    // EXPORT ORDER
    // ==========================================
    function exportOrder(orderId) {
        const orders = Storage.get('orders', []);
        const order = orders.find(o => o.id === orderId);
        
        if (!order) {
            Toast.error('Order not found');
            return;
        }

        // Build CSV content
        let csv = 'Phone Number,Network,Package,Amount\n';
        
        if (order.items) {
            order.items.forEach(item => {
                const phones = item.phoneNumbers || [];
                phones.forEach(phone => {
                    csv += `${phone},${item.network},${item.package?.data || 'N/A'},${item.package?.price || 0}\n`;
                });
            });
        }

        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `order-${order.id.slice(-7)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        Toast.success('Order exported successfully');
    }

    // Make exportOrder globally available
    window.exportOrder = exportOrder;

    // ==========================================
    // ORDER DETAILS PAGE
    // ==========================================
    async function initOrderDetailsPage() {
        const urlParams = new URLSearchParams(window.location.search);
        const orderId = urlParams.get('id');
        const isNewOrder = urlParams.get('new') === 'true';

        const successBanner = document.getElementById('order-success-banner');
        const orderNotFound = document.getElementById('order-not-found');
        const orderContent = document.getElementById('order-content');

        if (!orderId) {
            if (orderNotFound) orderNotFound.classList.remove('hidden');
            return;
        }

        let order = null;

        // Try API first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            try {
                const response = await DataEasyAPI.Orders.getById(orderId);
                if (response.success && response.order) {
                    order = response.order;
                    order.id = order.orderId;  // Normalize id field
                }
            } catch (e) {
                console.log('API failed, trying localStorage');
            }
        }

        // Fallback to localStorage
        if (!order) {
            const orders = Storage.get('orders', []);
            order = orders.find(o => o.id === orderId || o.orderId === orderId);
        }

        if (!order) {
            if (orderNotFound) orderNotFound.classList.remove('hidden');
            return;
        }

        // Show order content
        if (orderContent) orderContent.classList.remove('hidden');

        // Show success banner for new orders
        if (isNewOrder && successBanner) {
            successBanner.classList.remove('hidden');
        }

        // Parse the order date - format like "February 2, 2026 - 5:11 am"
        const orderDate = new Date(order.createdAt);
        const dateStr = orderDate.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
        });
        const timeStr = orderDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true
        }).toLowerCase();
        const fullDateStr = `${dateStr} - ${timeStr}`;

        // Update page content
        document.querySelectorAll('[data-order-id]').forEach(el => el.textContent = order.id);
        document.querySelectorAll('[data-order-date]').forEach(el => el.textContent = fullDateStr);
        
        // Update payment status
        const paymentStatus = order.paymentStatus || 'Completed';
        document.querySelectorAll('[data-payment-status]').forEach(el => {
            el.textContent = paymentStatus;
            if (paymentStatus === 'Completed') {
                el.className = 'text-green-400 font-medium';
            } else if (paymentStatus === 'Processing' || paymentStatus === 'Pending') {
                el.className = 'text-yellow-400 font-medium';
            } else {
                el.className = 'text-red-400 font-medium';
            }
        });

        // Update delivery status
        const deliveryStatus = order.deliveryStatus || 'Processing';
        document.querySelectorAll('[data-delivery-status]').forEach(el => {
            el.textContent = deliveryStatus;
            if (deliveryStatus === 'Delivered' || deliveryStatus === 'Submitted' || deliveryStatus === 'Completed') {
                el.className = 'text-green-400 font-medium';
            } else if (deliveryStatus === 'Processing') {
                el.className = 'text-yellow-400 font-medium';
            } else if (deliveryStatus === 'Failed') {
                el.className = 'text-red-400 font-medium';
            } else {
                el.className = 'text-gray-400 font-medium';
            }
        });

        // Update totals in footer
        document.querySelectorAll('[data-order-subtotal]').forEach(el => el.textContent = Format.currency(order.subtotal || order.total || 0));
        document.querySelectorAll('[data-order-total]').forEach(el => el.textContent = Format.currency(order.total || 0));

        // Render order items - each phone number as a separate row
        const itemsTbody = document.getElementById('order-items-tbody');
        if (itemsTbody && order.items) {
            let rowsHtml = '';
            
            // Helper function to get item status display - initially hidden until user clicks "Get Delivery Status"
            function getItemStatusHtml(itemStatus, deliveredAt, showStatus = false) {
                // Don't show status until user clicks "Get Delivery Status"
                if (!showStatus) {
                    return `<span class="text-gray-500 text-sm">—</span>`;
                }
                
                const deliveredDate = new Date(deliveredAt);
                const timeStr = deliveredDate.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true
                }).toLowerCase();
                const dateStr = `${deliveredDate.getDate()}/${deliveredDate.toLocaleString('en-US', {month: 'short'})}/${deliveredDate.getFullYear()}`;

                const status = (itemStatus || 'pending').toLowerCase();
                if (status === 'delivered' || status === 'submitted' || status === 'completed') {
                    return `<span class="text-green-400 text-sm">Sent<br><span class="text-xs">${timeStr} - ${dateStr}</span></span>`;
                } else if (status === 'processing') {
                    return `<span class="text-yellow-400 text-sm font-medium">Processing...</span>`;
                } else if (status === 'failed') {
                    return `<span class="text-red-400 text-sm font-medium">Failed</span>`;
                } else {
                    return `<span class="text-gray-400 text-sm">Pending</span>`;
                }
            }
            
            order.items.forEach((item, itemIndex) => {
                // Handle both API format (item.data, item.phoneNumber) and localStorage format (item.package.data, item.phoneNumbers)
                const network = item.network || order.network || 'MTN';
                const packageData = item.data || item.package?.data || 'N/A';
                const packageName = `${packageData} - ${network}`;
                const itemPrice = item.price || item.package?.price || 0;
                const itemStatus = item.deliveryStatus || order.deliveryStatus || 'Pending';
                
                // Get network-specific styling
                const networkClass = network.toLowerCase() === 'mtn' ? 'text-mtn-yellow' : 
                                    network.toLowerCase() === 'at' || network.toLowerCase().includes('airtel') ? 'text-red-400' : 
                                    'text-red-500';
                
                // Get phone number(s) - handle both single phoneNumber and phoneNumbers array
                const phoneNumbers = item.phoneNumbers || (item.phoneNumber ? [item.phoneNumber] : []);
                
                // Create a row for each phone number
                if (phoneNumbers.length > 0) {
                    phoneNumbers.forEach((phone, phoneIndex) => {
                        rowsHtml += `
                            <tr class="hover:bg-gray-800/30 transition">
                                <td class="py-3 px-4 md:px-6 whitespace-nowrap">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 bg-mtn-yellow/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <i class="fas fa-wifi ${networkClass} text-sm"></i>
                                        </div>
                                        <div>
                                            <p class="${networkClass} font-medium text-sm">${packageName}</p>
                                            <p class="text-white text-sm font-bold">${Format.phone(phone)}</p>
                                        </div>
                                    </div>
                                </td>
                                <td class="py-3 px-4 md:px-6 delivery-status-cell" data-item-index="${itemIndex}" data-phone-index="${phoneIndex}">
                                    ${getItemStatusHtml(itemStatus, item.deliveredAt || order.processedAt || order.createdAt, false)}
                                </td>
                            </tr>
                        `;
                    });
                } else {
                    // If no phone numbers, show item with quantity
                    for (let i = 0; i < (item.quantity || 1); i++) {
                        rowsHtml += `
                            <tr class="hover:bg-gray-800/30 transition">
                                <td class="py-3 px-4 md:px-6 whitespace-nowrap">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 bg-mtn-yellow/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <i class="fas fa-wifi ${networkClass} text-sm"></i>
                                        </div>
                                        <div>
                                            <p class="${networkClass} font-medium text-sm">${packageName}</p>
                                            <p class="text-gray-400 text-sm">No number assigned</p>
                                        </div>
                                    </div>
                                </td>
                                <td class="py-3 px-4 md:px-6 delivery-status-cell" data-item-index="${itemIndex}" data-phone-index="${i}">
                                    ${getItemStatusHtml(itemStatus, item.deliveredAt || order.createdAt, false)}
                                </td>
                            </tr>
                        `;
                    }
                }
            });
            
            itemsTbody.innerHTML = rowsHtml;
        }

        // Export button handler
        const exportBtn = document.getElementById('export-order-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                exportOrderDetails(order);
            });
        }

        // Get delivery status button handler
        const getStatusBtn = document.getElementById('get-delivery-status-btn');
        if (getStatusBtn) {
            getStatusBtn.addEventListener('click', () => {
                simulateDeliveryStatus(order);
            });
        }
    }

    /**
     * Export order details to CSV
     */
    function exportOrderDetails(order) {
        if (!order || !order.items) return;

        let csv = 'Phone Number,Data Size,Price\n';
        
        order.items.forEach(item => {
            // Handle both API format (item.data) and localStorage format (item.package.data)
            const dataSize = item.data || item.package?.data || 'N/A';
            const itemPrice = item.price || item.package?.price || 0;
            // Handle both single phoneNumber and phoneNumbers array
            const phones = item.phoneNumbers || (item.phoneNumber ? [item.phoneNumber] : []);
            
            if (phones.length > 0) {
                phones.forEach(phone => {
                    csv += `${phone},${dataSize},${itemPrice.toFixed(2)}\n`;
                });
            } else {
                for (let i = 0; i < (item.quantity || 1); i++) {
                    csv += `N/A,${dataSize},${itemPrice.toFixed(2)}\n`;
                }
            }
        });

        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `order_details_${order.id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        // Show success message
        const successMsg = document.getElementById('export-success-msg');
        if (successMsg) {
            successMsg.classList.remove('hidden');
            setTimeout(() => successMsg.classList.add('hidden'), 3000);
        }

        Toast.success('Order exported successfully');
    }

    /**
     * Get delivery status based on order status
     */
    function simulateDeliveryStatus(order) {
        const loadingEl = document.getElementById('delivery-status-loading');
        const resultEl = document.getElementById('delivery-status-result');
        const statusCells = document.querySelectorAll('.delivery-status-cell');

        if (loadingEl) loadingEl.classList.remove('hidden');
        if (resultEl) resultEl.innerHTML = '';

        // Simulate API delay
        setTimeout(() => {
            if (loadingEl) loadingEl.classList.add('hidden');

            // Get the delivery status from order - should match order status
            const deliveryStatus = order.deliveryStatus || 'Processing';
            // Use processedAt (when delivered) instead of createdAt (when order was made)
            const deliveredDate = order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt);
            const timeStr = deliveredDate.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true
            }).toUpperCase();
            const dateStr = `${deliveredDate.getDate()}/${deliveredDate.toLocaleString('en-US', {month: 'long'})}/${deliveredDate.getFullYear()}`;

            // Determine status display based on deliveryStatus
            let statusHtml = '';
            let statusClass = '';
            
            if (deliveryStatus === 'Delivered' || deliveryStatus === 'Submitted' || deliveryStatus === 'Completed') {
                statusClass = 'text-green-400';
                statusHtml = `<span class="${statusClass} text-sm">Sent<br><span class="text-xs">${timeStr} - ${dateStr}</span></span>`;
            } else if (deliveryStatus === 'Processing') {
                statusClass = 'text-yellow-400';
                statusHtml = `<span class="${statusClass} text-sm font-medium">Processing...</span>`;
            } else if (deliveryStatus === 'Failed') {
                statusClass = 'text-red-400';
                statusHtml = `<span class="${statusClass} text-sm font-medium">Failed</span>`;
            } else {
                statusClass = 'text-gray-400';
                statusHtml = `<span class="${statusClass} text-sm">—</span>`;
            }

            // Update each cell with the actual order delivery status
            statusCells.forEach(cell => {
                cell.innerHTML = statusHtml;
            });

            if (resultEl) {
                const resultClass = deliveryStatus === 'Failed' ? 'text-red-400 bg-red-500/10 border-red-500/30' : 
                                   'text-green-400 bg-green-500/10 border-green-500/30';
                resultEl.innerHTML = `
                    <p class="${resultClass} border rounded-lg px-4 py-2 inline-block">
                        <i class="fas fa-check-circle mr-2"></i>Delivery status loaded successfully!
                    </p>
                `;
            }
        }, 1500);
    }

    // ==========================================
    // WALLET PAGE
    // ==========================================
    async function initWalletPage() {
        await updateWalletDisplay();

        const addMoneyBtn = document.getElementById('add-money-btn');
        const amountInput = document.getElementById('topup-amount');

        if (addMoneyBtn && amountInput) {
            addMoneyBtn.addEventListener('click', () => {
                initiatePaystackPayment(amountInput, addMoneyBtn);
            });
        }

        await renderWalletTransactions();
    }

    /**
     * Initiate Paystack payment for wallet top-up
     */
    async function initiatePaystackPayment(amountInput, button) {
        const amount = parseFloat(amountInput.value);
        
        if (!amount || amount < 1) {
            Toast.error('Please enter a valid amount (minimum GH₵1)');
            return;
        }

        if (amount > 10000) {
            Toast.error('Maximum top-up amount is GH₵10,000');
            return;
        }

        const user = Storage.get('user');
        if (!user || !user.email) {
            Toast.error('Please login to top up your wallet');
            return;
        }

        DOM.setLoading(button, true, 'Connecting...');

        // Try using API if available
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            try {
                await DataEasyAPI.Paystack.openPopup(
                    user.email,
                    amount,
                    async (verification) => {
                        DOM.setLoading(button, false);
                        console.log('Payment verification result:', verification);
                        if (verification && verification.success) {
                            Toast.success(`GH₵${amount.toFixed(2)} added to wallet successfully!`);
                            amountInput.value = '';
                            await updateWalletDisplay();
                            await renderWalletTransactions();
                        } else {
                            Toast.error(verification?.error || 'Payment verification failed');
                        }
                    },
                    () => {
                        DOM.setLoading(button, false);
                        Toast.warning('Payment cancelled');
                    }
                );
                return;
            } catch (error) {
                console.error('API payment error:', error);
                Toast.error(error.message || 'Payment failed');
                DOM.setLoading(button, false);
            }
        }

        // Fallback to localStorage Paystack
        Paystack.pay({
            amount: amount,
            email: user.email,
            metadata: {
                'User ID': user.id,
                'User Name': user.fullName,
                'Transaction Type': 'Wallet Top-up'
            },
            onSuccess: (response) => {
                DOM.setLoading(button, false);
                
                // Credit wallet
                const wallet = Storage.get('wallet', { balance: 0, transactions: [] });
                wallet.balance += amount;
                wallet.transactions = wallet.transactions || [];
                wallet.transactions.unshift({
                    id: Date.now().toString(36),
                    type: 'credit',
                    amount: amount,
                    description: 'Wallet top-up via Paystack',
                    reference: response.reference,
                    date: new Date().toISOString()
                });
                Storage.set('wallet', wallet);

                updateWalletDisplay();
                Toast.success(`GH₵${amount.toFixed(2)} added to wallet successfully!`);
                amountInput.value = '';

                // Re-render transactions
                renderWalletTransactions();
            },
            onCancel: () => {
                DOM.setLoading(button, false);
                Toast.warning('Payment cancelled');
            }
        });
    }

    /**
     * Initialize sidebar wallet top-up (for index page)
     */
    function initSidebarTopup() {
        const sidebarBtn = document.getElementById('sidebar-topup-btn');
        const sidebarAmountInput = document.getElementById('sidebar-topup-amount');

        if (sidebarBtn && sidebarAmountInput) {
            sidebarBtn.addEventListener('click', () => {
                initiatePaystackPayment(sidebarAmountInput, sidebarBtn);
            });
        }
    }

    async function renderWalletTransactions() {
        const desktopContainer = document.getElementById('wallet-transactions') || document.getElementById('transactions-table-body');
        const mobileContainer = document.getElementById('mobile-transactions-container');
        
        if (!desktopContainer && !mobileContainer) return;

        let transactions = [];

        // Try API first
        if (typeof DataEasyAPI !== 'undefined' && DataEasyAPI.Auth.isAuthenticated()) {
            try {
                const response = await DataEasyAPI.Wallet.getHistory({ limit: 20 });
                if (response.success) {
                    transactions = response.transactions.map(tx => ({
                        ...tx,
                        id: tx._id,
                        date: tx.createdAt
                    }));
                }
            } catch (e) {
                console.log('API failed, using localStorage');
            }
        }

        // Fallback to localStorage
        if (transactions.length === 0) {
            const wallet = Storage.get('wallet', { transactions: [] });
            transactions = wallet.transactions || [];
        }

        if (transactions.length === 0) {
            if (desktopContainer) {
                desktopContainer.innerHTML = `
                    <tr>
                        <td colspan="6" class="py-8 text-center text-gray-400">
                            No transactions yet
                        </td>
                    </tr>
                `;
            }
            if (mobileContainer) {
                mobileContainer.innerHTML = `
                    <div class="py-8 text-center text-gray-500">
                        No transactions yet
                    </div>
                `;
            }
            return;
        }

        // Render desktop table
        if (desktopContainer) {
            desktopContainer.innerHTML = transactions.slice(0, 20).map((tx, index) => {
                // Determine status styling
                const status = tx.status || 'completed';
                const isPending = status === 'pending';
                const isFailed = status === 'failed';
                const isCompleted = status === 'completed';
                
                // Amount styling based on status
                let amountClass = tx.type === 'credit' ? 'text-green-400' : 'text-red-400';
                let amountPrefix = tx.type === 'credit' ? '+' : '-';
                
                if (isPending) {
                    amountClass = 'text-yellow-400';
                } else if (isFailed) {
                    amountClass = 'text-gray-500 line-through';
                }
                
                // Status badge
                let statusBadge = '';
                if (isPending) {
                    statusBadge = `<span class="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-400">Pending</span>`;
                } else if (isFailed) {
                    statusBadge = `<span class="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400">Failed</span>`;
                } else {
                    statusBadge = `<span class="px-2 py-1 rounded text-xs ${tx.type === 'credit' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}">${tx.type === 'credit' ? 'Credit' : 'Debit'}</span>`;
                }
                
                return `
                <tr class="border-b border-gray-700 hover:bg-gray-800/30 transition ${isFailed ? 'opacity-60' : ''}">
                    <td class="py-3 px-3 md:px-4 text-gray-400 text-sm">${index + 1}</td>
                    <td class="py-3 px-3 md:px-4 text-white text-sm font-mono">${tx.reference || tx.id || '-'}</td>
                    <td class="py-3 px-3 md:px-4 text-gray-400 text-sm hidden md:table-cell">${tx.balanceBefore !== undefined ? Format.currency(tx.balanceBefore) : '-'}</td>
                    <td class="py-3 px-3 md:px-4">
                        <span class="${amountClass} font-medium">
                            ${amountPrefix}${Format.currency(tx.amount)}
                        </span>
                    </td>
                    <td class="py-3 px-3 md:px-4">
                        ${statusBadge}
                    </td>
                    <td class="py-3 px-3 md:px-4 text-gray-400 text-sm hidden lg:table-cell">${Format.date(tx.date)}</td>
                </tr>
            `}).join('');
        }

        // Render mobile cards
        if (mobileContainer) {
            mobileContainer.innerHTML = transactions.slice(0, 20).map((tx, index) => {
                // Determine status styling
                const status = tx.status || 'completed';
                const isPending = status === 'pending';
                const isFailed = status === 'failed';
                
                // Amount styling based on status
                let amountClass = tx.type === 'credit' ? 'text-green-400' : 'text-red-400';
                let amountPrefix = tx.type === 'credit' ? '+' : '-';
                
                if (isPending) {
                    amountClass = 'text-yellow-400';
                } else if (isFailed) {
                    amountClass = 'text-gray-500 line-through';
                }
                
                // Status badge
                let statusBadge = '';
                if (isPending) {
                    statusBadge = `<span class="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400">Pending</span>`;
                } else if (isFailed) {
                    statusBadge = `<span class="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">Failed</span>`;
                } else {
                    statusBadge = `<span class="px-2 py-0.5 rounded text-xs ${tx.type === 'credit' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}">${tx.type === 'credit' ? 'Credit' : 'Debit'}</span>`;
                }
                
                return `
                <div class="bg-gray-800/50 rounded-lg p-3 mb-3 border border-gray-700 ${isFailed ? 'opacity-60' : ''}">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-gray-400 text-xs">#${index + 1}</span>
                        ${statusBadge}
                    </div>
                    <div class="flex justify-between items-center mb-2">
                        <span class="${amountClass} text-lg font-bold">
                            ${amountPrefix}${Format.currency(tx.amount)}
                        </span>
                    </div>
                    <div class="text-xs text-gray-500 truncate mb-1">
                        Ref: ${tx.reference || tx.id || '-'}
                    </div>
                    <div class="text-xs text-gray-500">
                        ${Format.date(tx.date)}
                    </div>
                </div>
            `}).join('');
        }
    }

    // ==========================================
    // ACCOUNT PAGE
    // ==========================================
    function initAccountPage() {
        const user = DataEasyAuth.getUserSync();
        if (!user) return;

        // Populate form fields
        const nameInput = document.querySelector('[name="fullName"]');
        const emailInput = document.querySelector('[name="email"]');
        const phoneInput = document.querySelector('[name="phone"]');

        if (nameInput) nameInput.value = user.fullName || '';
        if (emailInput) emailInput.value = user.email || '';
        if (phoneInput) phoneInput.value = user.phone || '';

        // Update display name in header
        document.querySelectorAll('[data-user-display-name]').forEach(el => {
            el.textContent = user.fullName || 'Your Name';
        });

        // Edit profile button functionality
        const editBtn = document.getElementById('edit-profile-btn');
        const saveContainer = document.getElementById('save-profile-btn-container');
        
        if (editBtn && nameInput && emailInput && phoneInput) {
            editBtn.addEventListener('click', () => {
                const isEditing = !nameInput.disabled;
                
                if (isEditing) {
                    // Cancel editing
                    nameInput.disabled = true;
                    phoneInput.disabled = true;
                    // Don't allow email edit for security
                    editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
                    if (saveContainer) saveContainer.classList.add('hidden');
                    // Restore original values
                    nameInput.value = user.fullName || '';
                    phoneInput.value = user.phone || '';
                } else {
                    // Start editing
                    nameInput.disabled = false;
                    phoneInput.disabled = false;
                    // Email stays disabled
                    editBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
                    if (saveContainer) saveContainer.classList.remove('hidden');
                }
            });
        }

        // Profile form submission
        const profileForm = document.getElementById('profile-form');
        if (profileForm) {
            profileForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const updates = {
                    fullName: nameInput?.value,
                    phone: phoneInput?.value
                };

                const result = await DataEasyAuth.updateProfile(updates);
                if (result.success) {
                    // Update UI
                    DataEasyAuth.updateAuthUI();
                    // Reset form state
                    if (nameInput) nameInput.disabled = true;
                    if (phoneInput) phoneInput.disabled = true;
                    if (editBtn) editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
                    if (saveContainer) saveContainer.classList.add('hidden');
                }
            });
        }

        // Password change form
        const passwordForm = document.getElementById('password-form');
        const passwordModal = document.getElementById('password-modal');
        const changePasswordBtn = document.getElementById('change-password-btn');
        const closePasswordModal = document.getElementById('close-password-modal');

        // Open password modal
        if (changePasswordBtn && passwordModal) {
            changePasswordBtn.addEventListener('click', () => {
                passwordModal.classList.remove('hidden');
                passwordModal.classList.add('flex');
            });
        }

        // Close password modal
        if (closePasswordModal && passwordModal) {
            closePasswordModal.addEventListener('click', () => {
                passwordModal.classList.add('hidden');
                passwordModal.classList.remove('flex');
                if (passwordForm) passwordForm.reset();
            });
        }

        // Close modal on backdrop click
        if (passwordModal) {
            passwordModal.addEventListener('click', (e) => {
                if (e.target === passwordModal) {
                    passwordModal.classList.add('hidden');
                    passwordModal.classList.remove('flex');
                    if (passwordForm) passwordForm.reset();
                }
            });
        }

        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const currentPassword = passwordForm.querySelector('[name="currentPassword"]')?.value;
                const newPassword = passwordForm.querySelector('[name="newPassword"]')?.value;
                const confirmPassword = passwordForm.querySelector('[name="confirmNewPassword"]')?.value;

                if (newPassword !== confirmPassword) {
                    Toast.error('Passwords do not match');
                    return;
                }

                const validation = DataEasyValidation.Rules.password(newPassword);
                if (!validation.isValid) {
                    Toast.error(validation.message);
                    return;
                }

                const result = await DataEasyAuth.changePassword(currentPassword, newPassword);
                if (result.success) {
                    passwordForm.reset();
                    // Close modal on success
                    if (passwordModal) {
                        passwordModal.classList.add('hidden');
                        passwordModal.classList.remove('flex');
                    }
                }
            });
        }
    }

    // ==========================================
    // GLOBAL INITIALIZATION
    // ==========================================
    async function init() {
        // Detect current page
        const path = window.location.pathname;
        const page = path.split('/').pop().replace('.html', '') || 'index';

        // Sync packages from API (updates pricing and availability)
        await DataEasyCart.syncPackagesFromAPI();

        // Initialize common components
        initSidebars();
        initMobileMenu();
        initSidebarTopup(); // Initialize sidebar Paystack top-up
        initCheckout(); // Initialize checkout on all pages (cart is available everywhere)
        updateWalletDisplay();
        DataEasyAuth.updateAuthUI();

        // Listen for package updates to refresh network availability
        EventBus.on('packages:loaded', () => {
            if (typeof updateNetworkTabAvailability === 'function') {
                updateNetworkTabAvailability();
            }
        });

        // Page-specific initialization
        switch(page) {
            case 'index':
            case '':
                // Require authentication for the main dashboard
                if (!DataEasyAuth.requireAuth()) return;
                initNetworkTabs();
                initBulkOrders();
                break;
            case 'login':
                DataEasyAuth.redirectIfAuthenticated();
                DataEasyAuth.initLoginForm('#login-form');
                break;
            case 'register':
                DataEasyAuth.redirectIfAuthenticated();
                DataEasyAuth.initRegisterForm('#register-form');
                break;
            case 'orders':
                DataEasyAuth.requireAuth();
                initOrdersPage();
                break;
            case 'order-details':
                DataEasyAuth.requireAuth();
                initOrderDetailsPage();
                break;
            case 'wallet-history':
                DataEasyAuth.requireAuth();
                initWalletPage();
                break;
            case 'account-details':
                DataEasyAuth.requireAuth();
                initAccountPage();
                break;
        }

        // Package modal handlers
        const modalClose = document.getElementById('close-package-modal');
        const modalBackdrop = document.getElementById('package-modal');
        const addToCartBtn = document.getElementById('modal-add-to-cart');

        if (modalClose) modalClose.addEventListener('click', closePackageModal);
        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', (e) => {
                if (e.target === modalBackdrop) closePackageModal();
            });
        }
        if (addToCartBtn) addToCartBtn.addEventListener('click', addToCartFromModal);

        // Listen for cart updates
        EventBus.on('cart:updated', updateWalletDisplay);

        // Handle browser back/forward navigation - close any open modals/sidebars
        window.addEventListener('pageshow', function(event) {
            // If coming from bfcache (back button), reset UI state
            if (event.persisted) {
                closePackageModal();
                // Close all sidebars
                const accountSidebar = document.getElementById('account-sidebar');
                const cartSidebar = document.getElementById('cart-sidebar');
                const backdrop = document.getElementById('sidebar-backdrop');
                
                if (accountSidebar) accountSidebar.classList.add('-translate-x-full');
                if (cartSidebar) cartSidebar.classList.add('translate-x-full');
                if (backdrop) backdrop.classList.add('hidden');
            }
        });

        console.log('✅ DataEasy App initialized');
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        setActiveNetwork,
        openPackageModal,
        closePackageModal,
        addToCartFromModal,
        parseBulkNumbers
    };

})();

// Make it globally available
window.DataEasyApp = DataEasyApp;

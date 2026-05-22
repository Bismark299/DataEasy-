/**
 * Admin Common - Shared functions for all admin pages
 * This file contains functions that were previously duplicated across all admin HTML pages.
 * Include this file AFTER api.js and BEFORE page-specific scripts.
 */

const AdminCommon = (function() {
    'use strict';

    // ==========================================
    // AUTHENTICATION
    // ==========================================
    
    /**
     * Check if admin is authenticated, redirect to login if not
     * @returns {boolean} True if authenticated
     */
    function checkAdminAuth() {
        const token = localStorage.getItem('dataeasy_admin_token');
        if (!token) {
            window.location.href = '../pages/login';
            return false;
        }
        return true;
    }

    /**
     * Log out the admin user
     */
    function logout() {
        localStorage.removeItem('dataeasy_admin_token');
        localStorage.removeItem('dataeasy_admin');
        window.location.href = '../pages/login';
    }

    // ==========================================
    // PROFILE & GREETING
    // ==========================================

    /**
     * Set greeting based on time of day
     * @param {string} elementId - ID of element to update (default: 'greetingText')
     */
    function setGreeting(elementId = 'greetingText') {
        const hour = new Date().getHours();
        let greeting = 'Good morning';
        if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
        else if (hour >= 17) greeting = 'Good evening';
        
        const admin = JSON.parse(localStorage.getItem('dataeasy_admin') || '{}');
        const name = admin.name || 'Admin';
        
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = `${greeting}, ${name} 👋`;
        }
    }

    /**
     * Load and display admin profile information
     */
    function loadProfileInfo() {
        const admin = JSON.parse(localStorage.getItem('dataeasy_admin') || '{}');
        const name = admin.name || 'Administrator';
        const email = admin.username || admin.email || 'admin@dataeasyplus.com';
        const role = admin.role || 'Super Admin';
        
        const profileName = document.getElementById('profileName');
        const profileEmail = document.getElementById('profileEmail');
        const profileRole = document.getElementById('profileRole');
        const profileInitial = document.getElementById('profileInitial');
        
        if (profileName) profileName.textContent = name;
        if (profileEmail) profileEmail.textContent = email;
        if (profileRole) profileRole.textContent = role;
        if (profileInitial) profileInitial.textContent = name.charAt(0).toUpperCase();
    }

    /**
     * Toggle profile dropdown visibility
     */
    function toggleProfileDropdown() {
        const dropdown = document.getElementById('profileDropdown');
        if (dropdown) {
            dropdown.classList.toggle('hidden');
        }
    }

    /**
     * Initialize profile dropdown (close on outside click)
     */
    function initProfileDropdown() {
        document.addEventListener('click', function(e) {
            const dropdown = document.getElementById('profileDropdown');
            const profileBtn = document.getElementById('profileBtn');
            if (dropdown && profileBtn && !profileBtn.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('hidden');
            }
        });
    }

    // ==========================================
    // SIDEBAR
    // ==========================================

    /**
     * Initialize sidebar behavior (toggle, collapse, mobile)
     */
    function initSidebar() {
        const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('mainContent');
        const logoutBtn = document.getElementById('logoutBtn');

        // Restore collapsed state on desktop
        const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        if (isCollapsed && window.innerWidth >= 768 && sidebar && mainContent) {
            sidebar.classList.add('sidebar-collapsed');
            mainContent.classList.add('main-collapsed');
        }

        // Toggle button handler
        if (sidebarToggleBtn) {
            sidebarToggleBtn.addEventListener('click', () => {
                if (window.innerWidth < 768) {
                    // Mobile: slide in/out
                    if (sidebar) sidebar.classList.toggle('-translate-x-full');
                    if (sidebarOverlay) sidebarOverlay.classList.toggle('hidden');
                } else {
                    // Desktop: collapse/expand
                    if (sidebar) sidebar.classList.toggle('sidebar-collapsed');
                    if (mainContent) mainContent.classList.toggle('main-collapsed');
                    localStorage.setItem('sidebar_collapsed', sidebar && sidebar.classList.contains('sidebar-collapsed'));
                }
            });
        }

        // Close button handler (mobile)
        function closeMobileSidebar() {
            if (sidebar) sidebar.classList.add('-translate-x-full');
            if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
        }

        if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
        if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeMobileSidebar);

        // Logout button handler
        if (logoutBtn) {
            logoutBtn.addEventListener('click', logout);
        }
    }

    /**
     * Toggle reports submenu visibility
     */
    function toggleReportsMenu() {
        const reportsMenu = document.getElementById('reportsMenu');
        const reportsIcon = document.getElementById('reportsIcon');
        if (reportsMenu) {
            reportsMenu.classList.toggle('hidden');
        }
        if (reportsIcon) {
            reportsIcon.classList.toggle('rotate-180');
        }
    }

    // ==========================================
    // MCBIS BALANCE
    // ==========================================

    /**
     * Check and display MCBIS API balance
     * @param {boolean} showToastOnSuccess - Whether to show toast on success (default: false)
     */
    async function checkMcbisBalance(showToastOnSuccess = false) {
        const refreshIcon = document.getElementById('headerMcbisRefreshIcon');
        if (refreshIcon) refreshIcon.classList.add('fa-spin');
        
        try {
            const response = await DataEasyAPI.admin.getProviderBalance();
            
            if (response.success) {
                const formattedBalance = `₵ ${parseFloat(response.balance).toFixed(2)}`;
                
                // Update header balance display
                const headerMcbisBalance = document.getElementById('headerMcbisBalance');
                if (headerMcbisBalance) {
                    headerMcbisBalance.textContent = formattedBalance;
                }
                
                // Update any other MCBIS balance elements on the page
                const mcbisHeaderBalanceAmount = document.getElementById('mcbisHeaderBalanceAmount');
                if (mcbisHeaderBalanceAmount) {
                    mcbisHeaderBalanceAmount.textContent = formattedBalance;
                }
                
                if (showToastOnSuccess) {
                    showToast('success', '✅ Balance Retrieved', `MCBIS Wallet: ₵${parseFloat(response.balance).toFixed(2)}`);
                }
            } else {
                const errorText = '₵ Error';
                const headerMcbisBalance = document.getElementById('headerMcbisBalance');
                if (headerMcbisBalance) {
                    headerMcbisBalance.textContent = errorText;
                }
            }
        } catch (error) {
            console.error(error);
            const headerMcbisBalance = document.getElementById('headerMcbisBalance');
            if (headerMcbisBalance) {
                headerMcbisBalance.textContent = '₵ --';
            }
        } finally {
            if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        }
    }

    /**
     * Load MCBIS balance on page load (silent, no toast)
     */
    function loadMcbisBalance() {
        checkMcbisBalance(false);
    }

    // ==========================================
    // HEADER STATS
    // ==========================================

    /**
     * Load header stats (users, orders, revenue, profit)
     * Used by all pages except dashboard (which has its own implementation)
     */
    async function loadHeaderStats() {
        try {
            // Use the dedicated stats endpoint — much lighter than fetching all orders
            const statsResponse = await DataEasyAPI.admin.getStats();
            const stats = statsResponse?.stats || {};

            const todayOrders      = stats.itemsToday          || 0;
            const todayRevenue     = stats.completedAmountToday || 0;
            const todayProfit      = stats.profitToday          || 0;

            const statsElements = {
                'headerTodayOrders':  todayOrders,
                'headerTodayRevenue': `₵${parseFloat(todayRevenue).toFixed(2)}`,
                'headerTodayProfit':  `₵${parseFloat(todayProfit).toFixed(2)}`
            };

            for (const [id, value] of Object.entries(statsElements)) {
                const el = document.getElementById(id);
                if (el) el.textContent = value;
            }

            const profitEl = document.getElementById('headerTodayProfit');
            if (profitEl) {
                if (todayProfit < 0) {
                    profitEl.classList.remove('text-green-600');
                    profitEl.classList.add('text-red-600');
                } else {
                    profitEl.classList.remove('text-red-600');
                    profitEl.classList.add('text-green-600');
                }
            }
        } catch (error) {
            console.error('Header stats load failed:', error);
        }
    }

    // ==========================================
    // FORMATTING UTILITIES
    // ==========================================

    /**
     * XSS Protection - escape HTML in user data
     * @param {any} str - String to escape
     * @returns {string} Escaped HTML string
     */
    function esc(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    /**
     * Format price with null safety
     * @param {number|string|null} value - Value to format
     * @param {number} decimals - Decimal places (default: 2)
     * @returns {string} Formatted price string
     */
    function formatPrice(value, decimals = 2) {
        const num = parseFloat(value);
        return isNaN(num) ? '0.00' : num.toFixed(decimals);
    }

    /**
     * Format currency with symbol
     * @param {number|string|null} value - Value to format
     * @param {string} symbol - Currency symbol (default: ₵)
     * @returns {string} Formatted currency string
     */
    function formatCurrency(value, symbol = '₵') {
        return `${symbol}${formatPrice(value)}`;
    }

    /**
     * Format date with ordinal suffix (e.g., "3rd Feb 2026 at 05:36")
     * @param {string|Date} dateStr - Date to format
     * @param {boolean} includeTime - Whether to include time (default: true)
     * @returns {string} Formatted date string
     */
    function formatDateTime(dateStr, includeTime = true) {
        if (!dateStr) return 'N/A';
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';

        const day = date.getDate();
        const suffix = getOrdinalSuffix(day);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        let result = `${day}${suffix} ${months[date.getMonth()]} ${date.getFullYear()}`;
        
        if (includeTime) {
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            result += ` at ${hours}:${minutes}`;
        }
        
        return result;
    }

    /**
     * Format date for display (short format: "3 Feb 2026")
     * @param {string|Date} dateStr - Date to format
     * @returns {string} Formatted date string
     */
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'Invalid Date';

        return date.toLocaleDateString('en-GB', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric' 
        });
    }

    /**
     * Get ordinal suffix for a day number
     * @param {number} day - Day of month
     * @returns {string} Ordinal suffix (st, nd, rd, th)
     */
    function getOrdinalSuffix(day) {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    // ==========================================
    // MODALS
    // ==========================================

    /**
     * Open a modal by ID
     * @param {string} modalId - ID of modal to open
     */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Close a modal by ID
     * @param {string} modalId - ID of modal to close
     */
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }
    }

    // ==========================================
    // ADVANCED DIALOG SYSTEM
    // ==========================================

    /**
     * Create or get the global dialog container
     */
    function getDialogContainer() {
        let container = document.getElementById('adminDialogContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'adminDialogContainer';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Show a confirmation dialog (replaces window.confirm)
     * @param {Object} options - Dialog options
     * @param {string} options.title - Dialog title
     * @param {string} options.message - Dialog message
     * @param {string} options.type - Type: 'info', 'warning', 'danger', 'success'
     * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
     * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
     * @param {string} options.icon - Custom icon class (optional)
     * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise
     */
    function showConfirm(options) {
        return new Promise((resolve) => {
            const config = typeof options === 'string' 
                ? { title: 'Confirm', message: options, type: 'info' }
                : options;

            const {
                title = 'Confirm',
                message = 'Are you sure?',
                type = 'info',
                confirmText = 'Confirm',
                cancelText = 'Cancel',
                icon = null
            } = config;

            const typeConfig = {
                info: { bg: 'bg-blue-100', iconColor: 'text-blue-500', btnBg: 'bg-blue-500 hover:bg-blue-600', icon: 'fa-info-circle' },
                success: { bg: 'bg-green-100', iconColor: 'text-green-500', btnBg: 'bg-green-500 hover:bg-green-600', icon: 'fa-check-circle' },
                warning: { bg: 'bg-yellow-100', iconColor: 'text-yellow-500', btnBg: 'bg-yellow-500 hover:bg-yellow-600', icon: 'fa-exclamation-triangle' },
                danger: { bg: 'bg-red-100', iconColor: 'text-red-500', btnBg: 'bg-red-500 hover:bg-red-600', icon: 'fa-exclamation-circle' }
            };

            const cfg = typeConfig[type] || typeConfig.info;
            const iconClass = icon || cfg.icon;

            const dialogId = 'adminConfirmDialog_' + Date.now();
            const html = `
                <div id="${dialogId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full transform scale-95 transition-transform duration-200" id="${dialogId}_content">
                        <div class="p-6 text-center">
                            <div class="w-16 h-16 ${cfg.bg} rounded-full flex items-center justify-center mx-auto mb-4">
                                <i class="fas ${iconClass} ${cfg.iconColor} text-3xl"></i>
                            </div>
                            <h3 class="text-xl font-bold text-gray-800 mb-2">${esc(title)}</h3>
                            <p class="text-gray-600 mb-6">${esc(message)}</p>
                            <div class="flex gap-3 justify-center">
                                <button id="${dialogId}_cancel" class="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-all duration-200">
                                    ${esc(cancelText)}
                                </button>
                                <button id="${dialogId}_confirm" class="px-6 py-2.5 ${cfg.btnBg} text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl">
                                    ${esc(confirmText)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const container = getDialogContainer();
            container.insertAdjacentHTML('beforeend', html);

            const dialog = document.getElementById(dialogId);
            const content = document.getElementById(`${dialogId}_content`);

            // Animate in
            requestAnimationFrame(() => {
                dialog.classList.remove('opacity-0');
                content.classList.remove('scale-95');
            });

            const cleanup = (result) => {
                dialog.classList.add('opacity-0');
                content.classList.add('scale-95');
                setTimeout(() => dialog.remove(), 200);
                resolve(result);
            };

            document.getElementById(`${dialogId}_cancel`).onclick = () => cleanup(false);
            document.getElementById(`${dialogId}_confirm`).onclick = () => cleanup(true);
            dialog.onclick = (e) => { if (e.target === dialog) cleanup(false); };
        });
    }

    /**
     * Show a prompt dialog (replaces window.prompt)
     * @param {Object} options - Dialog options
     * @param {string} options.title - Dialog title
     * @param {string} options.message - Dialog message
     * @param {string} options.placeholder - Input placeholder
     * @param {string} options.defaultValue - Default input value
     * @param {string} options.type - Type: 'info', 'warning', 'danger'
     * @param {string} options.inputType - Input type: 'text', 'password', 'textarea'
     * @param {boolean} options.required - Whether input is required
     * @returns {Promise<string|null>} Resolves to input value or null if cancelled
     */
    function showPrompt(options) {
        return new Promise((resolve) => {
            const config = typeof options === 'string' 
                ? { title: 'Input Required', message: options, type: 'info' }
                : options;

            const {
                title = 'Input Required',
                message = 'Please enter a value:',
                placeholder = '',
                defaultValue = '',
                type = 'info',
                inputType = 'text',
                required = false,
                confirmText = 'Submit',
                cancelText = 'Cancel'
            } = config;

            const typeConfig = {
                info: { bg: 'bg-blue-100', iconColor: 'text-blue-500', btnBg: 'bg-blue-500 hover:bg-blue-600', icon: 'fa-edit' },
                warning: { bg: 'bg-yellow-100', iconColor: 'text-yellow-500', btnBg: 'bg-yellow-500 hover:bg-yellow-600', icon: 'fa-exclamation-triangle' },
                danger: { bg: 'bg-red-100', iconColor: 'text-red-500', btnBg: 'bg-red-500 hover:bg-red-600', icon: 'fa-exclamation-circle' }
            };

            const cfg = typeConfig[type] || typeConfig.info;

            const dialogId = 'adminPromptDialog_' + Date.now();
            const inputHtml = inputType === 'textarea' 
                ? `<textarea id="${dialogId}_input" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none" rows="3" placeholder="${esc(placeholder)}">${esc(defaultValue)}</textarea>`
                : `<input type="${inputType}" id="${dialogId}_input" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="${esc(placeholder)}" value="${esc(defaultValue)}">`;

            const html = `
                <div id="${dialogId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full transform scale-95 transition-transform duration-200" id="${dialogId}_content">
                        <div class="p-6">
                            <div class="flex items-center gap-4 mb-4">
                                <div class="w-12 h-12 ${cfg.bg} rounded-full flex items-center justify-center flex-shrink-0">
                                    <i class="fas ${cfg.icon} ${cfg.iconColor} text-xl"></i>
                                </div>
                                <div>
                                    <h3 class="text-lg font-bold text-gray-800">${esc(title)}</h3>
                                    <p class="text-sm text-gray-500">${esc(message)}</p>
                                </div>
                            </div>
                            <div class="mb-6">
                                ${inputHtml}
                                ${required ? '<p class="text-xs text-red-500 mt-1 hidden" id="' + dialogId + '_error">This field is required</p>' : ''}
                            </div>
                            <div class="flex gap-3 justify-end">
                                <button id="${dialogId}_cancel" class="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-all duration-200">
                                    ${esc(cancelText)}
                                </button>
                                <button id="${dialogId}_confirm" class="px-5 py-2.5 ${cfg.btnBg} text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl">
                                    ${esc(confirmText)}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const container = getDialogContainer();
            container.insertAdjacentHTML('beforeend', html);

            const dialog = document.getElementById(dialogId);
            const content = document.getElementById(`${dialogId}_content`);
            const input = document.getElementById(`${dialogId}_input`);

            // Animate in and focus
            requestAnimationFrame(() => {
                dialog.classList.remove('opacity-0');
                content.classList.remove('scale-95');
                setTimeout(() => input.focus(), 100);
            });

            const cleanup = (result) => {
                dialog.classList.add('opacity-0');
                content.classList.add('scale-95');
                setTimeout(() => dialog.remove(), 200);
                resolve(result);
            };

            const submit = () => {
                const value = input.value.trim();
                if (required && !value) {
                    const errorEl = document.getElementById(`${dialogId}_error`);
                    if (errorEl) errorEl.classList.remove('hidden');
                    input.classList.add('border-red-500');
                    input.focus();
                    return;
                }
                cleanup(value);
            };

            document.getElementById(`${dialogId}_cancel`).onclick = () => cleanup(null);
            document.getElementById(`${dialogId}_confirm`).onclick = submit;
            input.onkeydown = (e) => { if (e.key === 'Enter' && inputType !== 'textarea') submit(); };
            dialog.onclick = (e) => { if (e.target === dialog) cleanup(null); };
        });
    }

    /**
     * Show an alert dialog (replaces window.alert)
     * @param {Object} options - Dialog options
     * @param {string} options.title - Dialog title
     * @param {string} options.message - Dialog message
     * @param {string} options.type - Type: 'info', 'success', 'warning', 'error'
     * @returns {Promise<void>} Resolves when closed
     */
    function showAlert(options) {
        return new Promise((resolve) => {
            const config = typeof options === 'string' 
                ? { title: 'Notice', message: options, type: 'info' }
                : options;

            const {
                title = 'Notice',
                message = '',
                type = 'info',
                buttonText = 'OK'
            } = config;

            const typeConfig = {
                info: { bg: 'bg-blue-100', iconColor: 'text-blue-500', btnBg: 'bg-blue-500 hover:bg-blue-600', icon: 'fa-info-circle' },
                success: { bg: 'bg-green-100', iconColor: 'text-green-500', btnBg: 'bg-green-500 hover:bg-green-600', icon: 'fa-check-circle' },
                warning: { bg: 'bg-yellow-100', iconColor: 'text-yellow-500', btnBg: 'bg-yellow-500 hover:bg-yellow-600', icon: 'fa-exclamation-triangle' },
                error: { bg: 'bg-red-100', iconColor: 'text-red-500', btnBg: 'bg-red-500 hover:bg-red-600', icon: 'fa-times-circle' }
            };

            const cfg = typeConfig[type] || typeConfig.info;

            const dialogId = 'adminAlertDialog_' + Date.now();
            const html = `
                <div id="${dialogId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200">
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full transform scale-95 transition-transform duration-200" id="${dialogId}_content">
                        <div class="p-6 text-center">
                            <div class="w-16 h-16 ${cfg.bg} rounded-full flex items-center justify-center mx-auto mb-4">
                                <i class="fas ${cfg.icon} ${cfg.iconColor} text-3xl"></i>
                            </div>
                            <h3 class="text-xl font-bold text-gray-800 mb-2">${esc(title)}</h3>
                            <p class="text-gray-600 mb-6 whitespace-pre-line">${esc(message)}</p>
                            <button id="${dialogId}_ok" class="px-8 py-2.5 ${cfg.btnBg} text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl">
                                ${esc(buttonText)}
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const container = getDialogContainer();
            container.insertAdjacentHTML('beforeend', html);

            const dialog = document.getElementById(dialogId);
            const content = document.getElementById(`${dialogId}_content`);

            // Animate in
            requestAnimationFrame(() => {
                dialog.classList.remove('opacity-0');
                content.classList.remove('scale-95');
            });

            const cleanup = () => {
                dialog.classList.add('opacity-0');
                content.classList.add('scale-95');
                setTimeout(() => dialog.remove(), 200);
                resolve();
            };

            document.getElementById(`${dialogId}_ok`).onclick = cleanup;
            dialog.onclick = (e) => { if (e.target === dialog) cleanup(); };
        });
    }

    // ==========================================
    // TOAST NOTIFICATIONS
    // ==========================================

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duration in ms (default: 3000)
     */
    function showToast(message, type = 'info', duration = 3000) {
        // Remove existing toasts
        const existingToasts = document.querySelectorAll('.admin-toast');
        existingToasts.forEach(t => t.remove());

        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        const toast = document.createElement('div');
        toast.className = `admin-toast fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 transform translate-x-full transition-transform duration-300`;
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span>${esc(message)}</span>
        `;

        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-full');
        });

        // Auto remove
        if (duration > 0) {
            setTimeout(() => {
                toast.classList.add('translate-x-full');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        return toast;
    }

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    /**
     * Debounce function to limit execution rate
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in ms
     * @returns {Function} Debounced function
     */
    function debounce(func, wait = 300) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Generate status badge HTML
     * @param {string} status - Status value
     * @returns {string} HTML string for badge
     */
    function getStatusBadge(status) {
        const statusConfig = {
            completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
            pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pending' },
            processing: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Processing' },
            failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
            cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
            active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
            suspended: { bg: 'bg-red-100', text: 'text-red-700', label: 'Suspended' },
            inactive: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Inactive' }
        };

        const config = statusConfig[status?.toLowerCase()] || { bg: 'bg-gray-100', text: 'text-gray-700', label: status || 'Unknown' };
        return `<span class="${config.bg} ${config.text} px-2 py-1 rounded-full text-xs font-medium">${config.label}</span>`;
    }

    /**
     * Initialize all common admin page functionality
     * Call this in DOMContentLoaded for pages that need all common features
     */
    function initAdminPage() {
        if (!checkAdminAuth()) return false;
        
        initSidebar();
        setGreeting();
        loadProfileInfo();
        initProfileDropdown();
        
        // Load MCBIS balance if the element exists on the page
        if (document.getElementById('headerMcbisBalance')) {
            loadMcbisBalance();
        }
        
        return true;
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    return {
        // Authentication
        checkAdminAuth,
        logout,
        
        // Profile & Greeting
        setGreeting,
        loadProfileInfo,
        toggleProfileDropdown,
        initProfileDropdown,
        
        // Sidebar
        initSidebar,
        toggleReportsMenu,
        
        // Header Stats
        loadHeaderStats,
        
        // MCBIS Balance
        checkMcbisBalance,
        loadMcbisBalance,
        
        // Formatting
        esc,
        formatPrice,
        formatCurrency,
        formatDate,
        formatDateTime,
        getOrdinalSuffix,
        
        // Modals
        openModal,
        closeModal,
        
        // Advanced Dialogs
        showConfirm,
        showPrompt,
        showAlert,
        
        // Toast
        showToast,
        
        // Utilities
        debounce,
        getStatusBadge,
        
        // Quick init
        initAdminPage
    };
})();

// Make globally available
window.AdminCommon = AdminCommon;

// Also expose individual functions globally for backwards compatibility with inline scripts
window.checkAdminAuth = AdminCommon.checkAdminAuth;
window.logout = AdminCommon.logout;
window.setGreeting = AdminCommon.setGreeting;
window.loadProfileInfo = AdminCommon.loadProfileInfo;
window.toggleProfileDropdown = AdminCommon.toggleProfileDropdown;
window.initProfileDropdown = AdminCommon.initProfileDropdown;
window.initSidebar = AdminCommon.initSidebar;
window.toggleReportsMenu = AdminCommon.toggleReportsMenu;
window.loadHeaderStats = AdminCommon.loadHeaderStats;
window.checkMcbisBalance = AdminCommon.checkMcbisBalance;
window.loadMcbisBalance = AdminCommon.loadMcbisBalance;
window.esc = AdminCommon.esc;
window.formatPrice = AdminCommon.formatPrice;
window.formatCurrency = AdminCommon.formatCurrency;
window.formatDate = AdminCommon.formatDate;
window.formatDateTime = AdminCommon.formatDateTime;
window.openModal = AdminCommon.openModal;
window.closeModal = AdminCommon.closeModal;
window.showConfirm = AdminCommon.showConfirm;
window.showPrompt = AdminCommon.showPrompt;
window.showAlert = AdminCommon.showAlert;
window.showToast = AdminCommon.showToast;
window.debounce = AdminCommon.debounce;
window.getStatusBadge = AdminCommon.getStatusBadge;
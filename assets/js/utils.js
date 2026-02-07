/**
 * DataEasy+ - Utility Functions
 * Core helper functions used across the application
 */

const DataEasyUtils = (function() {
    'use strict';

    // ==========================================
    // LOCAL STORAGE WRAPPER
    // ==========================================
    const Storage = {
        set(key, value) {
            try {
                localStorage.setItem(`dataeasy_${key}`, JSON.stringify(value));
                return true;
            } catch (e) {
                console.error('Storage set error:', e);
                return false;
            }
        },

        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(`dataeasy_${key}`);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.error('Storage get error:', e);
                return defaultValue;
            }
        },

        remove(key) {
            try {
                localStorage.removeItem(`dataeasy_${key}`);
                return true;
            } catch (e) {
                console.error('Storage remove error:', e);
                return false;
            }
        },

        clear() {
            try {
                Object.keys(localStorage)
                    .filter(key => key.startsWith('dataeasy_'))
                    .forEach(key => localStorage.removeItem(key));
                return true;
            } catch (e) {
                console.error('Storage clear error:', e);
                return false;
            }
        }
    };

    // ==========================================
    // TOAST NOTIFICATIONS
    // ==========================================
    const Toast = {
        container: null,

        init() {
            if (this.container) return;
            
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none';
            document.body.appendChild(this.container);
        },

        show(message, type = 'info', duration = 3000) {
            this.init();

            const icons = {
                success: '<i class="fas fa-check-circle"></i>',
                error: '<i class="fas fa-times-circle"></i>',
                warning: '<i class="fas fa-exclamation-triangle"></i>',
                info: '<i class="fas fa-info-circle"></i>'
            };

            const colors = {
                success: 'bg-green-600',
                error: 'bg-red-600',
                warning: 'bg-yellow-600',
                info: 'bg-blue-600'
            };

            const toast = document.createElement('div');
            toast.className = `toast-item ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300`;
            toast.innerHTML = `
                <span class="text-lg">${icons[type]}</span>
                <p class="flex-1 text-sm font-medium">${message}</p>
                <button class="text-white/80 hover:text-white transition" onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            `;

            this.container.appendChild(toast);

            // Animate in
            requestAnimationFrame(() => {
                toast.classList.remove('translate-x-full', 'opacity-0');
            });

            // Auto remove
            if (duration > 0) {
                setTimeout(() => {
                    toast.classList.add('translate-x-full', 'opacity-0');
                    setTimeout(() => toast.remove(), 300);
                }, duration);
            }

            return toast;
        },

        success(message, duration) {
            return this.show(message, 'success', duration);
        },

        error(message, duration) {
            return this.show(message, 'error', duration);
        },

        warning(message, duration) {
            return this.show(message, 'warning', duration);
        },

        info(message, duration) {
            return this.show(message, 'info', duration);
        }
    };

    // ==========================================
    // MODAL SYSTEM
    // ==========================================
    const Modal = {
        show(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return false;
            
            modal.classList.remove('hidden', 'opacity-0');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
            
            // Animate in
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            }
            
            return true;
        },

        hide(modalId) {
            const modal = document.getElementById(modalId);
            if (!modal) return false;
            
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.classList.add('scale-95', 'opacity-0');
                content.classList.remove('scale-100', 'opacity-100');
            }
            
            setTimeout(() => {
                modal.classList.add('hidden', 'opacity-0');
                modal.classList.remove('flex');
                document.body.style.overflow = '';
            }, 200);
            
            return true;
        },

        confirm(title, message, onConfirm, onCancel) {
            const modalHtml = `
                <div id="confirm-modal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div class="modal-content bg-card-bg rounded-xl p-6 max-w-md w-full border border-gray-700 shadow-2xl transform transition-all">
                        <h3 class="text-white text-lg font-bold mb-2">${title}</h3>
                        <p class="text-gray-400 mb-6">${message}</p>
                        <div class="flex gap-3">
                            <button id="confirm-cancel" class="flex-1 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition">Cancel</button>
                            <button id="confirm-ok" class="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition">Confirm</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
            const modal = document.getElementById('confirm-modal');

            document.getElementById('confirm-ok').onclick = () => {
                modal.remove();
                if (onConfirm) onConfirm();
            };

            document.getElementById('confirm-cancel').onclick = () => {
                modal.remove();
                if (onCancel) onCancel();
            };
        }
    };

    // ==========================================
    // FORMATTING UTILITIES
    // ==========================================
    const Format = {
        currency(amount, symbol = 'GH₵') {
            const num = parseFloat(amount) || 0;
            return `${symbol}${num.toFixed(2)}`;
        },

        /**
         * Format a number with null-safety (for prices)
         * @param {number|string|null} value - The value to format
         * @param {number} decimals - Number of decimal places (default: 2)
         * @returns {string} Formatted number string
         */
        number(value, decimals = 2) {
            const num = parseFloat(value);
            return isNaN(num) ? '0.00' : num.toFixed(decimals);
        },

        phone(number) {
            const clean = String(number).replace(/\D/g, '');
            return clean;
        },

        /**
         * Format date with multiple preset options
         * @param {string|Date} dateStr - Date to format
         * @param {string} format - Format type: 'short', 'long', 'datetime', 'relative'
         * @returns {string} Formatted date string
         */
        date(dateStr, format = 'short') {
            if (!dateStr) return 'N/A';
            
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return 'Invalid Date';

            switch (format) {
                case 'relative':
                    return this.relativeDate(date);
                case 'datetime':
                    return date.toLocaleDateString('en-GB', { 
                        day: 'numeric', 
                        month: 'short', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                case 'long':
                    return date.toLocaleDateString('en-GB', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });
                case 'short':
                default:
                    return date.toLocaleDateString('en-GB', { 
                        day: 'numeric', 
                        month: 'short', 
                        year: 'numeric' 
                    });
            }
        },

        /**
         * Format date as relative time ("5m ago", "3h ago", or date if older)
         * @param {Date} date - Date object to format
         * @returns {string} Relative time string
         */
        relativeDate(date) {
            const now = new Date();
            const diff = now - date;

            // Less than 1 minute
            if (diff < 60000) {
                return 'Just now';
            }
            // Less than 1 hour
            if (diff < 3600000) {
                const mins = Math.floor(diff / 60000);
                return `${mins}m ago`;
            }
            // Less than 24 hours
            if (diff < 86400000) {
                const hours = Math.floor(diff / 3600000);
                return `${hours}h ago`;
            }
            // Less than 7 days
            if (diff < 604800000) {
                const days = Math.floor(diff / 86400000);
                return `${days}d ago`;
            }
            // Otherwise show date
            return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        },

        time(dateStr) {
            if (!dateStr) return 'N/A';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return 'Invalid Time';
            return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        },

        orderId() {
            // Generate a 4-digit sequential-looking order ID
            // Note: Actual sequential IDs are generated on the server
            const timestamp = Date.now() % 10000;
            return String(timestamp).padStart(4, '0');
        },

        truncate(str, length = 20) {
            if (!str) return '';
            if (str.length <= length) return str;
            return str.substring(0, length) + '...';
        }
    };

    // ==========================================
    // DOM UTILITIES
    // ==========================================
    const DOM = {
        $(selector) {
            return document.querySelector(selector);
        },

        $$(selector) {
            return document.querySelectorAll(selector);
        },

        create(tag, options = {}) {
            const el = document.createElement(tag);
            if (options.className) el.className = options.className;
            if (options.innerHTML) el.innerHTML = options.innerHTML;
            if (options.textContent) el.textContent = options.textContent;
            if (options.attributes) {
                Object.entries(options.attributes).forEach(([key, value]) => {
                    el.setAttribute(key, value);
                });
            }
            return el;
        },

        setLoading(button, isLoading, text = 'Processing...') {
            if (isLoading) {
                button.disabled = true;
                button.dataset.originalText = button.innerHTML;
                button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${text}`;
            } else {
                button.disabled = false;
                button.innerHTML = button.dataset.originalText || button.innerHTML;
            }
        },

        shake(element) {
            element.classList.add('shake-animation');
            setTimeout(() => element.classList.remove('shake-animation'), 500);
        }
    };

    // ==========================================
    // DEBOUNCE & THROTTLE
    // ==========================================
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

    function throttle(func, limit = 300) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ==========================================
    // NETWORK DETECTION (Ghana)
    // ==========================================
    const Network = {
        prefixes: {
            MTN: ['024', '025', '053', '054', '055', '059'],
            AirtelTigo: ['026', '027', '056', '057'],
            Telecel: ['020', '050']
        },

        detect(phoneNumber) {
            const clean = String(phoneNumber).replace(/\D/g, '');
            const prefix = clean.substring(0, 3);

            for (const [network, prefixes] of Object.entries(this.prefixes)) {
                if (prefixes.includes(prefix)) {
                    return network;
                }
            }
            return null;
        },

        getColor(network) {
            const colors = {
                MTN: { bg: '#F5C518', text: '#000000' },
                AirtelTigo: { bg: '#0033A0', text: '#FFFFFF' },
                Telecel: { bg: '#E53935', text: '#FFFFFF' }
            };
            return colors[network] || { bg: '#6B7280', text: '#FFFFFF' };
        },

        isValidGhanaNumber(phoneNumber) {
            const clean = String(phoneNumber).replace(/\D/g, '');
            return clean.length === 10 && this.detect(phoneNumber) !== null;
        }
    };

    // ==========================================
    // EVENT BUS (Pub/Sub)
    // ==========================================
    const EventBus = {
        events: {},

        on(event, callback) {
            if (!this.events[event]) {
                this.events[event] = [];
            }
            this.events[event].push(callback);
        },

        off(event, callback) {
            if (!this.events[event]) return;
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        },

        emit(event, data) {
            if (!this.events[event]) return;
            this.events[event].forEach(callback => callback(data));
        }
    };

    // ==========================================
    // PAYSTACK CONFIGURATION
    // ==========================================
    const Paystack = {
        // Paystack public key
        publicKey: 'pk_test_fa6266bd089971ce550966de52efe3add069fe55',
        
        /**
         * Initialize Paystack payment
         * @param {Object} options - Payment options
         * @param {number} options.amount - Amount in GHS (will be converted to pesewas)
         * @param {string} options.email - Customer email
         * @param {Function} options.onSuccess - Success callback
         * @param {Function} options.onCancel - Cancel callback
         */
        pay(options) {
            const { amount, email, onSuccess, onCancel, metadata = {} } = options;

            if (!window.PaystackPop) {
                Toast.error('Payment system not loaded. Please refresh the page.');
                return;
            }

            const handler = PaystackPop.setup({
                key: this.publicKey,
                email: email,
                amount: Math.round(amount * 100), // Convert to pesewas
                currency: 'GHS',
                ref: 'BTU_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                metadata: {
                    custom_fields: [
                        {
                            display_name: "Platform",
                            variable_name: "platform",
                            value: "DataEasy+"
                        },
                        ...Object.entries(metadata).map(([key, value]) => ({
                            display_name: key,
                            variable_name: key.toLowerCase().replace(/\s+/g, '_'),
                            value: value
                        }))
                    ]
                },
                callback: function(response) {
                    // Payment successful
                    if (onSuccess) {
                        onSuccess({
                            reference: response.reference,
                            transaction: response.transaction,
                            status: response.status,
                            amount: amount
                        });
                    }
                },
                onClose: function() {
                    // Payment window closed
                    if (onCancel) {
                        onCancel();
                    }
                }
            });

            handler.openIframe();
        },

        /**
         * Set the public key (useful for switching between test/live)
         */
        setPublicKey(key) {
            this.publicKey = key;
        }
    };

    // ==========================================
    // INITIALIZE
    // ==========================================
    function init() {
        Toast.init();
        console.log('✅ DataEasy Utils initialized');
    }

    // Auto-init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API
    return {
        Storage,
        Toast,
        Modal,
        Format,
        DOM,
        Network,
        EventBus,
        Paystack,
        debounce,
        throttle
    };

})();

// Make it globally available
window.DataEasyUtils = DataEasyUtils;

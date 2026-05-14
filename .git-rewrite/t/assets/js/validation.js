/**
 * DataEasy+ - Validation Module
 * Form validation, phone number validation, input sanitization
 */

const DataEasyValidation = (function() {
    'use strict';

    // ==========================================
    // VALIDATION RULES
    // ==========================================
    const Rules = {
        required(value, fieldName = 'This field') {
            const isValid = value !== null && value !== undefined && String(value).trim() !== '';
            return {
                isValid,
                message: isValid ? '' : `${fieldName} is required`
            };
        },

        email(value) {
            const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const isValid = pattern.test(String(value).toLowerCase());
            return {
                isValid,
                message: isValid ? '' : 'Please enter a valid email address'
            };
        },

        phone(value) {
            const clean = String(value).replace(/\D/g, '');
            const isValid = clean.length === 10;
            return {
                isValid,
                message: isValid ? '' : 'Phone number must be 10 digits'
            };
        },

        ghanaPhone(value) {
            const clean = String(value).replace(/\D/g, '');
            if (clean.length !== 10) {
                return { isValid: false, message: 'Phone number must be 10 digits' };
            }
            
            const network = DataEasyUtils.Network.detect(clean);
            if (!network) {
                return { isValid: false, message: 'Invalid Ghana phone number prefix' };
            }
            
            return { isValid: true, message: '', network };
        },

        password(value) {
            const minLength = 8;
            const hasUpperCase = /[A-Z]/.test(value);
            const hasLowerCase = /[a-z]/.test(value);
            const hasNumbers = /\d/.test(value);
            
            const errors = [];
            if (value.length < minLength) errors.push(`at least ${minLength} characters`);
            if (!hasUpperCase) errors.push('one uppercase letter');
            if (!hasLowerCase) errors.push('one lowercase letter');
            if (!hasNumbers) errors.push('one number');

            const isValid = errors.length === 0;
            return {
                isValid,
                message: isValid ? '' : `Password must contain ${errors.join(', ')}`,
                strength: this.getPasswordStrength(value)
            };
        },

        getPasswordStrength(password) {
            let score = 0;
            if (password.length >= 8) score++;
            if (password.length >= 12) score++;
            if (/[A-Z]/.test(password)) score++;
            if (/[a-z]/.test(password)) score++;
            if (/\d/.test(password)) score++;
            if (/[^A-Za-z0-9]/.test(password)) score++;

            if (score <= 2) return { level: 'weak', color: 'bg-red-500', width: '33%' };
            if (score <= 4) return { level: 'medium', color: 'bg-yellow-500', width: '66%' };
            return { level: 'strong', color: 'bg-green-500', width: '100%' };
        },

        passwordMatch(password, confirmPassword) {
            const isValid = password === confirmPassword;
            return {
                isValid,
                message: isValid ? '' : 'Passwords do not match'
            };
        },

        minLength(value, min) {
            const isValid = String(value).length >= min;
            return {
                isValid,
                message: isValid ? '' : `Must be at least ${min} characters`
            };
        },

        maxLength(value, max) {
            const isValid = String(value).length <= max;
            return {
                isValid,
                message: isValid ? '' : `Must be no more than ${max} characters`
            };
        },

        numeric(value) {
            const isValid = /^\d+$/.test(String(value));
            return {
                isValid,
                message: isValid ? '' : 'Please enter numbers only'
            };
        },

        amount(value, min = 0.01) {
            const num = parseFloat(value);
            const isValid = !isNaN(num) && num >= min;
            return {
                isValid,
                message: isValid ? '' : `Amount must be at least ${min}`
            };
        }
    };

    // ==========================================
    // BULK PHONE PARSER
    // ==========================================
    const BulkParser = {
        // Valid data sizes (in GB)
        validDataSizes: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50],

        parse(text) {
            if (!text || typeof text !== 'string') {
                return { valid: [], invalid: [], duplicates: [] };
            }

            // Split by newlines to get each line
            const lines = text.split(/[\n,;]+/).map(l => l.trim()).filter(l => l.length > 0);

            const valid = [];
            const invalid = [];
            const duplicates = [];
            const seen = new Set();

            lines.forEach(line => {
                // Extract phone number (first 10 digits) and data size (remaining)
                const digits = line.replace(/\D/g, '');
                
                if (digits.length < 10) {
                    invalid.push({
                        original: line,
                        number: digits,
                        reason: 'Phone number must be 10 digits'
                    });
                    return;
                }

                const phoneNumber = digits.substring(0, 10);
                const dataSizeStr = digits.substring(10) || line.replace(/^\d{10}\s*/, '').replace(/[^\d.]/g, '');
                const dataSize = parseInt(dataSizeStr) || null;

                // Check for duplicates (phone + data combination)
                const key = `${phoneNumber}-${dataSize}`;
                if (seen.has(key)) {
                    duplicates.push({ number: phoneNumber, dataSize });
                    return;
                }
                seen.add(key);

                // Validate Ghana phone
                const validation = Rules.ghanaPhone(phoneNumber);
                if (!validation.isValid) {
                    invalid.push({
                        original: line,
                        number: phoneNumber,
                        dataSize,
                        reason: validation.message
                    });
                    return;
                }

                // Validate data size
                if (!dataSize) {
                    invalid.push({
                        original: line,
                        number: phoneNumber,
                        dataSize: null,
                        reason: 'Data size is required (e.g., 10 for 10GB)'
                    });
                    return;
                }

                if (!this.validDataSizes.includes(dataSize)) {
                    invalid.push({
                        original: line,
                        number: phoneNumber,
                        dataSize,
                        reason: `Invalid data size. Valid sizes: ${this.validDataSizes.join(', ')}GB`
                    });
                    return;
                }

                valid.push({
                    number: phoneNumber,
                    network: validation.network,
                    dataSize,
                    formatted: DataEasyUtils.Format.phone(phoneNumber)
                });
            });

            return { valid, invalid, duplicates };
        },

        getSummary(parsed) {
            const networkCounts = {};
            const dataSizeCounts = {};
            let totalData = 0;

            parsed.valid.forEach(item => {
                networkCounts[item.network] = (networkCounts[item.network] || 0) + 1;
                dataSizeCounts[item.dataSize] = (dataSizeCounts[item.dataSize] || 0) + 1;
                totalData += item.dataSize;
            });

            return {
                total: parsed.valid.length + parsed.invalid.length + parsed.duplicates.length,
                valid: parsed.valid.length,
                invalid: parsed.invalid.length,
                duplicates: parsed.duplicates.length,
                networks: networkCounts,
                dataSizes: dataSizeCounts,
                totalData
            };
        }
    };

    // ==========================================
    // FORM VALIDATOR
    // ==========================================
    class FormValidator {
        constructor(formElement, options = {}) {
            this.form = typeof formElement === 'string' 
                ? document.querySelector(formElement) 
                : formElement;
            
            this.options = {
                validateOnBlur: true,
                validateOnInput: false,
                showSuccessState: true,
                ...options
            };

            this.fields = new Map();
            this.errors = new Map();

            if (this.form) {
                this.init();
            }
        }

        init() {
            this.form.setAttribute('novalidate', 'true');
            
            this.form.addEventListener('submit', (e) => {
                if (!this.validateAll()) {
                    e.preventDefault();
                    this.focusFirstError();
                }
            });
        }

        addField(name, rules, customMessages = {}) {
            const field = this.form.querySelector(`[name="${name}"]`);
            if (!field) return this;

            this.fields.set(name, { field, rules, customMessages });

            if (this.options.validateOnBlur) {
                field.addEventListener('blur', () => this.validateField(name));
            }

            if (this.options.validateOnInput) {
                field.addEventListener('input', DataEasyUtils.debounce(() => {
                    this.validateField(name);
                }, 300));
            }

            return this;
        }

        validateField(name) {
            const fieldData = this.fields.get(name);
            if (!fieldData) return true;

            const { field, rules, customMessages } = fieldData;
            const value = field.value;

            for (const rule of rules) {
                let result;
                
                if (typeof rule === 'string') {
                    // Built-in rule
                    if (Rules[rule]) {
                        result = Rules[rule](value);
                    }
                } else if (typeof rule === 'object') {
                    // Rule with parameters
                    const [ruleName, ...params] = Object.entries(rule)[0];
                    if (Rules[ruleName]) {
                        result = Rules[ruleName](value, ...params);
                    }
                } else if (typeof rule === 'function') {
                    // Custom validation function
                    result = rule(value, this.form);
                }

                if (result && !result.isValid) {
                    const message = customMessages[rule] || result.message;
                    this.setFieldError(name, message);
                    return false;
                }
            }

            this.clearFieldError(name);
            return true;
        }

        validateAll() {
            let isValid = true;
            
            this.fields.forEach((_, name) => {
                if (!this.validateField(name)) {
                    isValid = false;
                }
            });

            return isValid;
        }

        setFieldError(name, message) {
            const fieldData = this.fields.get(name);
            if (!fieldData) return;

            const { field } = fieldData;
            this.errors.set(name, message);

            // Add error styling
            field.classList.add('border-red-500', 'focus:border-red-500');
            field.classList.remove('border-green-500', 'focus:border-green-500', 'border-gray-700');

            // Show error message
            let errorEl = field.parentElement.querySelector('.field-error');
            if (!errorEl) {
                errorEl = document.createElement('p');
                errorEl.className = 'field-error text-red-400 text-xs mt-1 flex items-center gap-1';
                field.parentElement.appendChild(errorEl);
            }
            errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        }

        clearFieldError(name) {
            const fieldData = this.fields.get(name);
            if (!fieldData) return;

            const { field } = fieldData;
            this.errors.delete(name);

            // Remove error styling
            field.classList.remove('border-red-500', 'focus:border-red-500');
            
            if (this.options.showSuccessState && field.value) {
                field.classList.add('border-green-500', 'focus:border-green-500');
            } else {
                field.classList.add('border-gray-700');
            }

            // Remove error message
            const errorEl = field.parentElement.querySelector('.field-error');
            if (errorEl) {
                errorEl.remove();
            }
        }

        focusFirstError() {
            const firstErrorField = Array.from(this.fields.entries())
                .find(([name]) => this.errors.has(name));
            
            if (firstErrorField) {
                firstErrorField[1].field.focus();
                DataEasyUtils.DOM.shake(firstErrorField[1].field);
            }
        }

        reset() {
            this.errors.clear();
            this.fields.forEach((fieldData, name) => {
                const { field } = fieldData;
                field.classList.remove('border-red-500', 'border-green-500', 'focus:border-red-500', 'focus:border-green-500');
                field.classList.add('border-gray-700');
                
                const errorEl = field.parentElement.querySelector('.field-error');
                if (errorEl) errorEl.remove();
            });
        }

        getErrors() {
            return Object.fromEntries(this.errors);
        }

        isValid() {
            return this.errors.size === 0;
        }
    }

    // ==========================================
    // INPUT SANITIZATION
    // ==========================================
    const Sanitize = {
        text(value) {
            return String(value)
                .replace(/[<>]/g, '')
                .trim();
        },

        phone(value) {
            return String(value).replace(/\D/g, '').substring(0, 10);
        },

        email(value) {
            return String(value).toLowerCase().trim();
        },

        number(value) {
            return String(value).replace(/[^\d.]/g, '');
        },

        html(value) {
            const div = document.createElement('div');
            div.textContent = value;
            return div.innerHTML;
        }
    };

    // ==========================================
    // REAL-TIME INPUT FORMATTING
    // ==========================================
    const InputFormatter = {
        phone(input) {
            input.addEventListener('input', (e) => {
                let value = e.target.value.replace(/\D/g, '');
                if (value.length > 10) value = value.substring(0, 10);
                e.target.value = value;
            });
        },

        currency(input) {
            input.addEventListener('blur', (e) => {
                const value = parseFloat(e.target.value) || 0;
                e.target.value = value.toFixed(2);
            });
        },

        uppercase(input) {
            input.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
            });
        }
    };

    // Public API
    return {
        Rules,
        BulkParser,
        FormValidator,
        Sanitize,
        InputFormatter
    };

})();

// Make it globally available
window.DataEasyValidation = DataEasyValidation;

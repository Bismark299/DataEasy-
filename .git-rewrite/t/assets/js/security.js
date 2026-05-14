/**
 * Security Utilities for Frontend
 * XSS prevention and data sanitization
 */

// Escape HTML special characters to prevent XSS
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// Alias for escapeHtml
const sanitize = escapeHtml;

// Validate that a value is a safe ID (alphanumeric, dash, underscore only)
function isSafeId(id) {
    if (!id) return false;
    return /^[a-zA-Z0-9_-]+$/.test(String(id));
}

// Format currency safely
function formatCurrencySafe(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
}

// Format date safely
function formatDateSafe(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString();
    } catch {
        return 'N/A';
    }
}

// Safe phone number display (only digits and common chars)
function formatPhoneSafe(phone) {
    if (!phone) return 'N/A';
    // Only allow digits, spaces, dashes, plus, parentheses
    return String(phone).replace(/[^\d\s\-+()]/g, '');
}

// Safe email display
function formatEmailSafe(email) {
    if (!email) return 'N/A';
    // Basic email char whitelist
    return String(email).replace(/[^a-zA-Z0-9@._\-+]/g, '');
}

// Create element safely with text content
function createSafeElement(tag, text, className) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
}

// Set text content safely (never use innerHTML for user data)
function setTextSafe(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = String(text || '');
    }
}

// Export for module systems (optional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        sanitize,
        isSafeId,
        formatCurrencySafe,
        formatDateSafe,
        formatPhoneSafe,
        formatEmailSafe,
        createSafeElement,
        setTextSafe
    };
}

/**
 * Money Utility Module
 * Provides consistent handling of currency values
 * Prevents floating point precision issues
 */

/**
 * Round a number to 2 decimal places (for currency)
 * Uses integer math to avoid floating point issues
 * @param {number|string} value - The value to round
 * @returns {number} Rounded value
 */
function roundMoney(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;
    return Math.round(num * 100) / 100;
}

/**
 * Add two money values safely
 * @param {number|string} a 
 * @param {number|string} b 
 * @returns {number} Sum rounded to 2 decimal places
 */
function addMoney(a, b) {
    const numA = Math.round(parseFloat(a) * 100) || 0;
    const numB = Math.round(parseFloat(b) * 100) || 0;
    return (numA + numB) / 100;
}

/**
 * Subtract two money values safely
 * @param {number|string} a 
 * @param {number|string} b 
 * @returns {number} Difference rounded to 2 decimal places
 */
function subtractMoney(a, b) {
    const numA = Math.round(parseFloat(a) * 100) || 0;
    const numB = Math.round(parseFloat(b) * 100) || 0;
    return (numA - numB) / 100;
}

/**
 * Multiply money by a factor safely
 * @param {number|string} amount 
 * @param {number|string} factor 
 * @returns {number} Product rounded to 2 decimal places
 */
function multiplyMoney(amount, factor) {
    const numAmount = Math.round(parseFloat(amount) * 100) || 0;
    const numFactor = parseFloat(factor) || 0;
    return Math.round(numAmount * numFactor) / 100;
}

/**
 * Format money for display
 * @param {number|string} value - The value to format
 * @param {string} currency - Currency symbol (default: GH₵)
 * @returns {string} Formatted money string
 */
function formatMoney(value, currency = 'GH₵') {
    const rounded = roundMoney(value);
    return `${currency}${rounded.toFixed(2)}`;
}

/**
 * Parse money string to number
 * @param {string} value - String like "GH₵10.50" or "10.50"
 * @returns {number} Parsed and rounded value
 */
function parseMoney(value) {
    if (typeof value === 'number') return roundMoney(value);
    const cleaned = String(value).replace(/[^0-9.-]/g, '');
    return roundMoney(cleaned);
}

/**
 * Compare two money values (accounting for floating point)
 * @param {number|string} a 
 * @param {number|string} b 
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
function compareMoney(a, b) {
    const numA = Math.round(parseFloat(a) * 100) || 0;
    const numB = Math.round(parseFloat(b) * 100) || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
    return 0;
}

/**
 * Check if money value is valid (non-negative number)
 * @param {any} value 
 * @returns {boolean}
 */
function isValidMoney(value) {
    const num = parseFloat(value);
    return !isNaN(num) && num >= 0;
}

module.exports = {
    roundMoney,
    addMoney,
    subtractMoney,
    multiplyMoney,
    formatMoney,
    parseMoney,
    compareMoney,
    isValidMoney
};

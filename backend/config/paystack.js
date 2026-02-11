/**
 * Paystack Configuration
 * Payment gateway integration
 */

const axios = require('axios');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';

// Create axios instance for Paystack
const paystackAPI = axios.create({
    baseURL: PAYSTACK_BASE_URL,
    headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Initialize a payment transaction
 */
const initializeTransaction = async ({ email, amount, reference, metadata = {}, callback_url }) => {
    try {
        const response = await paystackAPI.post('/transaction/initialize', {
            email,
            amount: Math.round(amount * 100), // Convert to pesewas
            reference,
            currency: 'GHS',
            metadata,
            callback_url
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to initialize payment');
    }
};

/**
 * Verify a transaction
 */
const verifyTransaction = async (reference) => {
    try {
        const response = await paystackAPI.get(`/transaction/verify/${reference}`);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to verify payment');
    }
};

/**
 * Get transaction details
 */
const getTransaction = async (transactionId) => {
    try {
        const response = await paystackAPI.get(`/transaction/${transactionId}`);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to get transaction');
    }
};

/**
 * List transactions
 */
const listTransactions = async (params = {}) => {
    try {
        const response = await paystackAPI.get('/transaction', { params });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to list transactions');
    }
};

/**
 * Verify webhook signature
 * @param {string} payload - Raw request body as string (NOT parsed JSON)
 * @param {string} signature - X-Paystack-Signature header value
 */
const verifyWebhookSignature = (payload, signature) => {
    const crypto = require('crypto');
    // IMPORTANT: Use raw payload string, not JSON.stringify
    // Paystack signs the exact bytes they send
    const hash = crypto
        .createHmac('sha512', PAYSTACK_SECRET_KEY)
        .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
        .digest('hex');
    return hash === signature;
};

module.exports = {
    initializeTransaction,
    verifyTransaction,
    getTransaction,
    listTransactions,
    verifyWebhookSignature,
    PAYSTACK_SECRET_KEY,
    PAYSTACK_PUBLIC_KEY
};

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
 * Refund a transaction (full or partial)
 * @param {Object} params
 * @param {string} params.transaction - Paystack transaction reference
 * @param {number} [params.amount] - Amount in GHS to refund (omit for full refund)
 * @param {string} [params.merchant_note] - Internal note for the refund
 */
const refundTransaction = async ({ transaction, amount, merchant_note }) => {
    try {
        const payload = { transaction, currency: 'GHS' };
        if (amount) payload.amount = Math.round(amount * 100); // pesewas
        if (merchant_note) payload.merchant_note = merchant_note;
        const response = await paystackAPI.post('/refund', payload);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to refund transaction');
    }
};

/**
 * List refunds for a transaction (used to reconcile ambiguous refund attempts)
 * @param {string} transaction - Paystack transaction reference
 */
const listRefunds = async (transaction) => {
    try {
        const response = await paystackAPI.get('/refund', { params: { transaction } });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to list refunds');
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

// ==========================================
// TRANSFER API (Payouts to MoMo / Bank)
// ==========================================

/**
 * Create a transfer recipient (MoMo or bank account)
 * Must be created before initiating a transfer
 * @param {Object} params
 * @param {string} params.type - 'mobile_money' or 'nuban'
 * @param {string} params.name - Recipient name
 * @param {string} params.account_number - MoMo number or bank account
 * @param {string} params.bank_code - Bank code or MoMo provider code
 * @param {string} params.currency - 'GHS'
 */
const createTransferRecipient = async ({ type, name, account_number, bank_code, currency = 'GHS' }) => {
    try {
        const response = await paystackAPI.post('/transferrecipient', {
            type,
            name,
            account_number,
            bank_code,
            currency
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to create transfer recipient');
    }
};

/**
 * Initiate a transfer (payout) to a recipient
 * @param {Object} params
 * @param {string} params.source - 'balance'
 * @param {number} params.amount - Amount in GHS (will be converted to pesewas)
 * @param {string} params.recipient - Recipient code from createTransferRecipient
 * @param {string} params.reference - Unique transfer reference
 * @param {string} params.reason - Description of the transfer
 */
const initiateTransfer = async ({ source = 'balance', amount, recipient, reference, reason }) => {
    try {
        const response = await paystackAPI.post('/transfer', {
            source,
            amount: Math.round(amount * 100), // Convert to pesewas
            recipient,
            reference,
            reason
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to initiate transfer');
    }
};

/**
 * Verify a transfer status
 * @param {string} reference - Transfer reference
 */
const verifyTransfer = async (reference) => {
    try {
        const response = await paystackAPI.get(`/transfer/verify/${reference}`);
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to verify transfer');
    }
};

/**
 * List banks for transfer (includes MoMo providers)
 * @param {string} country - Country code, e.g., 'ghana'
 * @param {string} type - 'mobile_money' or 'nuban'
 */
const listBanks = async (country = 'ghana', type) => {
    try {
        const params = { country };
        if (type) params.type = type;
        const response = await paystackAPI.get('/bank', { params });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to list banks');
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
    refundTransaction,
    listRefunds,
    getTransaction,
    listTransactions,
    createTransferRecipient,
    initiateTransfer,
    verifyTransfer,
    listBanks,
    verifyWebhookSignature,
    PAYSTACK_SECRET_KEY,
    PAYSTACK_PUBLIC_KEY
};

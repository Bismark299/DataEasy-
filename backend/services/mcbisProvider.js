/**
 * McbisSolution Data Provider API Integration (DataHub)
 * Documentation: https://documenter.getpostman.com/view/11929812/2sB34kDynu
 * 
 * Endpoints:
 * - POST /placeOrder - Purchase data bundle
 * - GET /walletBalance - Check dealer wallet balance
 * - GET /checkOrderStatus/:reference - Check order status
 * - GET /allProducts - Get available products/bundles
 * 
 * Networks: mtn, telecel, atishare (AirtelTigo iShare)
 */

const axios = require('axios');
const logger = require('../utils/logger');

// API Configuration from environment variables
// Supports both DATAHUB_* and MCBIS_* naming for backwards compatibility
const API_BASE_URL = process.env.DATAHUB_API_URL || process.env.MCBIS_API_URL || 'https://datahub.mcbissolution.com/api/v1';
const API_TOKEN = process.env.DATAHUB_API_TOKEN || process.env.MCBIS_API_TOKEN;

// Create axios instance with default config
const mcbisApi = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    },
    timeout: 30000 // 30 second timeout
});

// Add auth token to all requests
mcbisApi.interceptors.request.use((config) => {
    if (API_TOKEN) {
        config.headers.Authorization = `Bearer ${API_TOKEN}`;
    } else {
        logger.error('MCBIS API Token not configured');
    }
    return config;
});

// Log all responses
mcbisApi.interceptors.response.use(
    (response) => {
        logger.info('MCBIS API Response', {
            url: response.config.url,
            status: response.status,
            data: response.data
        });
        return response;
    },
    (error) => {
        logger.error('MCBIS API Error', {
            url: error.config?.url,
            status: error.response?.status,
            message: error.message,
            data: error.response?.data
        });
        throw error;
    }
);

/**
 * Map our network names to MCBIS DataHub network keys
 * IMPORTANT: AirtelTigo uses 'atishare' for iShare bundles
 */
const NETWORK_MAP = {
    'MTN': 'mtn',
    'TELECEL': 'telecel',
    'Telecel': 'telecel',
    'AIRTELTIGO': 'atishare',
    'AirtelTigo': 'atishare',
    'AT': 'atishare'
};

/**
 * Get all available products/bundles from MCBIS
 * @returns {Promise<Array>} List of products
 */
async function getProducts() {
    try {
        const response = await mcbisApi.get('/allProducts');
        return response.data;
    } catch (error) {
        logger.error('Failed to fetch MCBIS products', { error: error.message });
        throw new Error('Failed to fetch products from provider');
    }
}

/**
 * Get dealer wallet balance from MCBIS
 * @returns {Promise<Object>} Wallet balance info
 */
async function getWalletBalance() {
    // Check if API is configured
    if (!API_TOKEN) {
        logger.warn('MCBIS API Token not configured - cannot fetch balance');
        return {
            success: false,
            balance: 0,
            error: 'MCBIS API not configured. Set DATAHUB_API_TOKEN in environment.',
            configured: false
        };
    }
    
    try {
        const response = await mcbisApi.get('/walletBalance');
        return {
            success: true,
            balance: parseFloat(response.data?.data?.walletBalance || 0),
            configured: true,
            raw: response.data
        };
    } catch (error) {
        logger.error('Failed to fetch MCBIS wallet balance', { error: error.message });
        throw new Error('Failed to fetch wallet balance from provider');
    }
}

/**
 * Place a data bundle order with MCBIS
 * @param {Object} params - Order parameters
 * @param {string} params.network - Network (MTN, Telecel, AirtelTigo)
 * @param {string} params.receiver - Recipient phone number
 * @param {number} params.amount - Data amount in GB
 * @param {string} params.reference - Unique order reference
 * @returns {Promise<Object>} Order result
 */
async function placeOrder({ network, receiver, amount, reference }) {
    try {
        // Map network name to MCBIS key
        const mcbisNetwork = NETWORK_MAP[network] || network.toLowerCase();
        
        // Generate unique reference if not provided
        const orderReference = reference || `BT${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
        
        // Clean phone number (remove leading 0 if present, ensure 10 digits)
        const cleanPhone = receiver.replace(/\D/g, '');
        const formattedPhone = cleanPhone.startsWith('0') ? cleanPhone : `0${cleanPhone}`;

        logger.info('Placing MCBIS order', {
            network: mcbisNetwork,
            receiver: formattedPhone,
            amount,
            reference: orderReference
        });

        const response = await mcbisApi.post('/placeOrder', {
            network: mcbisNetwork,
            reference: orderReference,
            receiver: formattedPhone,
            amount: parseInt(amount, 10)
        });

        return {
            success: true,
            reference: orderReference,
            status: response.data?.data?.status || 'pending',
            message: response.data?.message || 'Order placed successfully',
            raw: response.data
        };
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        logger.error('Failed to place MCBIS order', { 
            error: errorMsg,
            network,
            receiver,
            amount
        });
        
        return {
            success: false,
            error: errorMsg,
            status: 'failed',
            raw: error.response?.data
        };
    }
}

/**
 * Check order status from MCBIS
 * 
 * IMPORTANT: MCBIS API returns:
 * {
 *   message: "Order status fetched successfully",
 *   data: {
 *     status: "success",  ← This is API CALL status, NOT order status!
 *     order: {
 *       status: "pending|completed|failed",  ← THIS is the actual ORDER status!
 *       reference: "...",
 *       amount: "1",
 *       recipient: "0591178627"
 *     }
 *   }
 * }
 * 
 * @param {string} reference - Order reference
 * @returns {Promise<Object>} Order status
 */
async function checkOrderStatus(reference) {
    try {
        const response = await mcbisApi.get(`/checkOrderStatus/${reference}`);
        
        const data = response.data?.data;
        
        // CRITICAL: Use data.order.status (actual order status), NOT data.status (API call status)
        // data.status === "success" just means the API call worked, not that the order is complete!
        // Fallback chain: data.order.status -> data.status (if order doesn't exist) -> 'unknown'
        const orderStatus = data?.order?.status || data?.status || 'unknown';
        
        logger.info('MCBIS checkOrderStatus response', {
            reference,
            apiCallStatus: data?.status,
            orderStatus: orderStatus,
            order: data?.order,
            rawData: data
        });
        
        return {
            success: true,
            status: orderStatus,  // Return the ACTUAL order status
            order: data?.order,
            raw: response.data
        };
    } catch (error) {
        logger.error('Failed to check MCBIS order status', { 
            error: error.message,
            reference
        });
        
        return {
            success: false,
            error: error.response?.data?.message || error.message,
            status: 'unknown'
        };
    }
}

/**
 * Process a data bundle delivery
 * This is the main function to be called when processing orders
 * Includes duplicate prevention and balance checks
 * 
 * ⚠️ PRICE ISOLATION: 
 * - The `price` parameter comes from our ORDER (immutable snapshot)
 * - Provider API prices are NEVER used for wallet debit
 * - Provider prices are logged for reconciliation only
 * 
 * @param {Object} orderItem - Order item to process
 * @param {Object} options - Additional options
 * @param {boolean} options.skipBalanceCheck - Skip balance verification (default: false)
 * @returns {Promise<Object>} Delivery result
 */
async function deliverBundle(orderItem, options = {}) {
    const { network, phoneNumber, dataAmount, orderId, itemIndex, existingReference, price } = orderItem;
    const { skipBalanceCheck = false } = options;
    
    // AUDIT: Log the price source (should be from order snapshot)
    logger.info('deliverBundle called with internal price', {
        orderId,
        itemIndex,
        internalPrice: price,
        priceNote: 'Price from order snapshot - NOT from provider'
    });
    
    // DUPLICATE CHECK: If item already has a provider reference, don't send again
    if (existingReference) {
        logger.warn('Duplicate order prevention: Item already has provider reference', {
            orderId,
            itemIndex,
            existingReference
        });
        
        // Check the status of existing order instead
        const statusCheck = await checkOrderStatus(existingReference);
        return {
            success: false,
            status: 'Duplicate',
            error: 'Order already sent to provider',
            reference: existingReference,
            existingStatus: statusCheck.status,
            providerResponse: statusCheck.raw
        };
    }
    
    // Extract numeric amount from data string (e.g., "1 GB" -> 1)
    let amount = dataAmount;
    if (typeof dataAmount === 'string') {
        const match = dataAmount.match(/(\d+)/);
        amount = match ? parseInt(match[1], 10) : 1;
    }

    // BALANCE CHECK: Verify sufficient funds before proceeding
    // NOTE: Uses OUR internal cost price, NOT provider price
    if (!skipBalanceCheck) {
        try {
            const balanceResult = await getWalletBalance();
            const currentBalance = parseFloat(balanceResult.balance || 0);
            const orderCost = parseFloat(price || 0); // OUR cost price from order
            
            // If we have the price, check if balance is sufficient
            if (orderCost > 0 && currentBalance < orderCost) {
                logger.error('Insufficient MCBIS balance for order', {
                    orderId,
                    itemIndex,
                    currentBalance,
                    orderCost,
                    deficit: orderCost - currentBalance
                });
                
                return {
                    success: false,
                    status: 'InsufficientBalance',
                    error: `Insufficient MCBIS balance. Available: ₵${currentBalance.toFixed(2)}, Required: ₵${orderCost.toFixed(2)}`,
                    currentBalance,
                    requiredAmount: orderCost
                };
            }
            
            // Even without exact price, ensure some balance exists
            if (currentBalance < 1) {
                logger.error('MCBIS balance too low', { currentBalance });
                return {
                    success: false,
                    status: 'InsufficientBalance',
                    error: `MCBIS balance too low: ₵${currentBalance.toFixed(2)}`,
                    currentBalance
                };
            }
            
            logger.info('MCBIS balance check passed', { 
                currentBalance, 
                orderCost: orderCost || 'unknown'
            });
        } catch (balanceError) {
            logger.error('Failed to check MCBIS balance', { error: balanceError.message });
            return {
                success: false,
                status: 'BalanceCheckFailed',
                error: 'Could not verify MCBIS balance before order'
            };
        }
    }
    
    // Create unique reference
    const reference = `BT-${orderId}-${itemIndex}-${Date.now()}`;

    logger.info('Delivering bundle via MCBIS', {
        network,
        phoneNumber,
        amount,
        reference
    });

    // Place the order
    const result = await placeOrder({
        network,
        receiver: phoneNumber,
        amount,
        reference
    });

    if (!result.success) {
        return {
            success: false,
            status: 'Failed',
            error: result.error,
            reference
        };
    }

    // Wait a moment and check status
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusCheck = await checkOrderStatus(reference);
    
    // Map MCBIS status to our status
    const statusMap = {
        'success': 'Delivered',
        'completed': 'Delivered',
        'pending': 'Processing',
        'processing': 'Processing',
        'failed': 'Failed',
        'error': 'Failed'
    };

    const finalStatus = statusMap[statusCheck.status?.toLowerCase()] || 'Processing';

    return {
        success: finalStatus === 'Delivered',
        status: finalStatus,
        reference,
        providerResponse: statusCheck.raw
    };
}

/**
 * Check if an order can be sent to MCBIS
 * Validates: API enabled, network enabled, sufficient balance
 * @param {string} network - Network name
 * @param {number} orderCost - Cost of the order
 * @returns {Promise<Object>} Validation result
 */
async function canProcessOrder(network, orderCost = 0) {
    const { Setting } = require('../models');
    
    // Check if MCBIS is enabled
    const mcbisEnabled = await Setting.getValue('mcbisEnabled', false);
    if (!mcbisEnabled) {
        return {
            canProcess: false,
            reason: 'MCBIS API is disabled',
            code: 'API_DISABLED'
        };
    }
    
    // Check if network is enabled
    const shouldDeliver = await Setting.shouldDeliverViaMcbis(network);
    if (!shouldDeliver) {
        return {
            canProcess: false,
            reason: `MCBIS delivery disabled for ${network}`,
            code: 'NETWORK_DISABLED'
        };
    }
    
    // Check balance
    try {
        const balanceResult = await getWalletBalance();
        const currentBalance = parseFloat(balanceResult.balance || 0);
        
        if (orderCost > 0 && currentBalance < orderCost) {
            return {
                canProcess: false,
                reason: `Insufficient balance. Available: ₵${currentBalance.toFixed(2)}, Required: ₵${orderCost.toFixed(2)}`,
                code: 'INSUFFICIENT_BALANCE',
                currentBalance,
                requiredAmount: orderCost
            };
        }
        
        if (currentBalance < 1) {
            return {
                canProcess: false,
                reason: `Balance too low: ₵${currentBalance.toFixed(2)}`,
                code: 'LOW_BALANCE',
                currentBalance
            };
        }
        
        return {
            canProcess: true,
            currentBalance,
            network
        };
    } catch (error) {
        return {
            canProcess: false,
            reason: 'Could not verify balance',
            code: 'BALANCE_CHECK_FAILED',
            error: error.message
        };
    }
}

module.exports = {
    getProducts,
    getWalletBalance,
    placeOrder,
    checkOrderStatus,
    deliverBundle,
    canProcessOrder,
    NETWORK_MAP
};

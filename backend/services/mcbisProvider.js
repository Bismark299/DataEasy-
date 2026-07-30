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

// Create axios instance optimized for server-to-server API calls
// Using custom User-Agent identifies this as a legitimate API client
const mcbisApi = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DataEasyPlus/1.0'  // Custom user agent for API client identification
    },
    timeout: 30000,      // 30 second timeout
    maxRedirects: 5      // Handle redirects automatically
});

// Add auth token to all requests
mcbisApi.interceptors.request.use((config) => {
    if (API_TOKEN) {
        config.headers.Authorization = `Bearer ${API_TOKEN}`;
    } else {
        logger.error('MCBIS API Token not configured');
    }
    logger.info('MCBIS API Request', { url: config.url, method: config.method });
    return config;
});

// ── Rate-limiting queue for checkOrderStatus ──
// Serialises all status-check calls so we never fire more than 1 per second.
const statusCheckQueue = [];
let statusCheckRunning = false;

async function enqueueStatusCheck(reference) {
    return new Promise((resolve, reject) => {
        statusCheckQueue.push({ reference, resolve, reject });
        if (!statusCheckRunning) processStatusCheckQueue();
    });
}

async function processStatusCheckQueue() {
    if (statusCheckRunning || statusCheckQueue.length === 0) return;
    statusCheckRunning = true;
    while (statusCheckQueue.length > 0) {
        const { reference, resolve, reject } = statusCheckQueue.shift();
        try {
            const result = await doCheckOrderStatus(reference);
            resolve(result);
        } catch (err) {
            reject(err);
        }
        if (statusCheckQueue.length > 0) {
            // Wait 1.2 seconds between calls to stay under MCBIS rate limit
            await new Promise(r => setTimeout(r, 1200));
        }
    }
    statusCheckRunning = false;
}

// Response interceptor with Cloudflare detection
mcbisApi.interceptors.response.use(
    (response) => {
        // Check if response is HTML (Cloudflare challenge page)
        const data = response.data;
        if (typeof data === 'string' && (data.includes('<!DOCTYPE') || data.includes('<html') || data.includes('Just a moment'))) {
            logger.error('MCBIS API returned Cloudflare challenge page');
            const error = new Error('API returned HTML (Cloudflare challenge). Contact McbisSolution to whitelist server IP.');
            error.cloudflareBlocked = true;
            throw error;
        }
        
        logger.info('MCBIS API Response', {
            url: response.config.url,
            status: response.status
        });
        return response;
    },
    (error) => {
        // Check for Cloudflare block in error response
        const responseData = error.response?.data;
        if (typeof responseData === 'string' && (responseData.includes('<!DOCTYPE') || responseData.includes('<html') || responseData.includes('Just a moment'))) {
            logger.error('MCBIS API blocked by Cloudflare');
            error.cloudflareBlocked = true;
            error.message = 'API blocked by Cloudflare. Contact McbisSolution to whitelist your server IP.';
        }
        
        logger.error('MCBIS API Error', {
            url: error.config?.url,
            status: error.response?.status,
            message: error.message,
            cloudflareBlocked: error.cloudflareBlocked || false
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

// ── Wallet balance cache ──────────────────────────────────────────────────────
// Shared across all callers to prevent concurrent API hammering (429 errors).
// - Successful response cached for 90 seconds
// - 429 response cached for 120 seconds (let MCBIS recover before retrying)
// - In-flight deduplication: concurrent callers share one pending promise
const _balanceCache = {
    value: null,
    expiresAt: 0,
    inflight: null  // shared Promise while a request is in progress
};
const BALANCE_CACHE_TTL   = 90  * 1000; // 90s normal TTL
const BALANCE_CACHE_429   = 120 * 1000; // 120s back-off after rate-limit

/**
 * Get dealer wallet balance from MCBIS
 * Cached for 90 s; deduplicated so concurrent callers share one HTTP request.
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

    // Return cached value if still fresh
    if (_balanceCache.value && Date.now() < _balanceCache.expiresAt) {
        logger.info('MCBIS wallet balance (cached)', { balance: _balanceCache.value.balance });
        return _balanceCache.value;
    }

    // Deduplicate concurrent callers — share one in-flight request
    if (_balanceCache.inflight) {
        logger.info('MCBIS wallet balance request already in-flight, awaiting shared promise');
        return _balanceCache.inflight;
    }

    // Start the real HTTP request and store the promise so other callers can join
    _balanceCache.inflight = (async () => {
        try {
            const response = await mcbisApi.get('/walletBalance');
            const data = response.data;

            // Robust balance extraction - handle multiple possible response formats
            // MCBIS may change field names across API updates
            const rawBalance =
                data?.data?.walletBalance ??   // Original: { data: { walletBalance: X } }
                data?.data?.wallet_balance ??   // Snake_case variant
                data?.data?.balance ??          // Simplified: { data: { balance: X } }
                data?.walletBalance ??          // Flat: { walletBalance: X }
                data?.wallet_balance ??         // Flat snake_case
                data?.balance ??               // Flat simplified
                null;

            const balance = rawBalance !== null ? parseFloat(rawBalance) : 0;
            const balanceParsed = !isNaN(balance) && rawBalance !== null;

            if (!balanceParsed) {
                logger.warn('MCBIS wallet balance field not found in response - API format may have changed', {
                    responseKeys: data ? Object.keys(data) : [],
                    dataKeys: data?.data ? Object.keys(data.data) : [],
                    rawResponse: JSON.stringify(data).substring(0, 500)
                });
            }

            const result = { success: true, balance, balanceParsed, configured: true, raw: data };
            // Cache successful result
            _balanceCache.value     = result;
            _balanceCache.expiresAt = Date.now() + BALANCE_CACHE_TTL;
            return result;
        } catch (error) {
            // Apply longer back-off on 429 to stop hammering MCBIS
            if (error.response?.status === 429) {
                logger.error('MCBIS /walletBalance rate-limited (429) — backing off', { backOffMs: BALANCE_CACHE_429 });
                const rateLimitResult = {
                    success: false, balance: 0, configured: true,
                    error: 'MCBIS rate limit hit (429). Retrying after back-off.',
                    rateLimited: true,
                    // Preserve last known balance so callers can still make decisions
                    lastKnownBalance: _balanceCache.value?.balance ?? null
                };
                _balanceCache.value     = rateLimitResult;
                _balanceCache.expiresAt = Date.now() + BALANCE_CACHE_429;
                return rateLimitResult;
            }

            // Check for Cloudflare challenge
            if (error.cloudflareBlocked) {
                logger.error('MCBIS API blocked by Cloudflare challenge');
                return {
                    success: false, balance: 0, configured: true,
                    error: 'MCBIS API blocked by Cloudflare. Contact McbisSolution to whitelist your server IP.',
                    cloudflareBlocked: true
                };
            }

            logger.error('Failed to fetch MCBIS wallet balance', { error: error.message });
            return {
                success: false, balance: 0, configured: true,
                error: 'Failed to fetch wallet balance: ' + error.message
            };
        }
    })().finally(() => {
        // Always clear the in-flight reference so the next expired-cache call
        // triggers a real HTTP request instead of re-using a stale promise.
        _balanceCache.inflight = null;
    });

    return _balanceCache.inflight;
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

        const respData = response.data;
        
        // Robust status extraction - handle multiple response formats
        const status = respData?.data?.status || respData?.status || respData?.data?.order?.status || 'pending';
        const message = respData?.message || respData?.data?.message || 'Order placed successfully';
        
        logger.info('MCBIS placeOrder raw response', {
            reference: orderReference,
            status,
            message,
            responseKeys: respData ? Object.keys(respData) : [],
            dataKeys: respData?.data ? Object.keys(respData.data) : []
        });

        return {
            success: true,
            reference: orderReference,
            status,
            message,
            raw: respData
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
async function doCheckOrderStatus(reference) {
    try {
        const response = await mcbisApi.get(`/checkOrderStatus/${reference}`);
        
        const respData = response.data;
        const data = respData?.data;
        
        // Robust status extraction - handle multiple possible response formats after MCBIS API updates
        // Priority: data.order.status (nested) -> data.orderStatus -> respData.order?.status -> data.status -> respData.status
        const orderStatus = 
            data?.order?.status ||          // Original: { data: { order: { status: X } } }
            data?.orderStatus ||            // Flat variant: { data: { orderStatus: X } }
            data?.order_status ||           // Snake_case variant
            respData?.order?.status ||      // Top-level: { order: { status: X } }
            data?.status ||                 // Fallback: { data: { status: X } } (API call status, less reliable)
            respData?.status ||             // Top-level status
            'unknown';
        
        logger.info('MCBIS checkOrderStatus response', {
            reference,
            extractedStatus: orderStatus,
            apiCallStatus: data?.status,
            orderData: data?.order,
            responseKeys: respData ? Object.keys(respData) : [],
            dataKeys: data ? Object.keys(data) : [],
            rawData: JSON.stringify(respData).substring(0, 500)
        });
        
        return {
            success: true,
            status: orderStatus,
            order: data?.order || respData?.order,
            raw: respData
        };
    } catch (error) {
        // If MCBIS returns 404, the order reference doesn't exist on their end
        const is404 = error.response?.status === 404;
        
        logger.error('Failed to check MCBIS order status', { 
            error: error.message,
            reference,
            httpStatus: error.response?.status,
            notFound: is404
        });
        
        return {
            success: false,
            error: error.response?.data?.message || error.message,
            status: is404 ? 'not_found' : 'unknown'
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
        const statusCheck = await enqueueStatusCheck(existingReference);
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
    // IMPORTANT: Balance check is advisory only - if it fails or can't parse the response,
    // we proceed anyway and let MCBIS reject on placeOrder if balance is truly insufficient.
    // This prevents orders getting stuck on "Pending" due to API format changes.
    if (!skipBalanceCheck) {
        try {
            const balanceResult = await getWalletBalance();
            const currentBalance = parseFloat(balanceResult.balance || 0);
            const orderCost = parseFloat(price || 0); // OUR cost price from order
            
            // If balance wasn't parseable (API format may have changed), skip check and proceed
            if (!balanceResult.balanceParsed) {
                logger.warn('MCBIS balance could not be parsed - skipping balance check and proceeding with order', {
                    orderId,
                    itemIndex,
                    rawResponse: balanceResult.raw
                });
            } else if (orderCost > 0 && currentBalance < orderCost) {
                // Only block if we successfully parsed a real balance that's too low
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
            } else if (balanceResult.balanceParsed && currentBalance < 1) {
                // Only block if we successfully parsed a real balance that's near zero
                logger.error('MCBIS balance too low', { currentBalance });
                return {
                    success: false,
                    status: 'InsufficientBalance',
                    error: `MCBIS balance too low: ₵${currentBalance.toFixed(2)}`,
                    currentBalance
                };
            } else {
                logger.info('MCBIS balance check passed', { 
                    currentBalance, 
                    orderCost: orderCost || 'unknown'
                });
            }
        } catch (balanceError) {
            // Balance check failed - proceed anyway, let placeOrder handle it
            logger.warn('Failed to check MCBIS balance - proceeding with order anyway', {
                error: balanceError.message,
                orderId,
                itemIndex
            });
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
        // Detect if MCBIS rejected because of low balance — these should stay
        // Pending (retried after top-up) rather than being permanently Failed
        const errLower = (result.error || '').toLowerCase();
        const isBalanceError = errLower.includes('insufficient') ||
            errLower.includes('balance') ||
            errLower.includes('low balance') ||
            errLower.includes('not enough') ||
            errLower.includes('no funds') ||
            errLower.includes('topup');

        if (isBalanceError) {
            // Bust the balance cache so the next pre-check fetches fresh data
            _balanceCache.value = null;
            _balanceCache.expiresAt = 0;
            logger.warn('MCBIS placeOrder rejected due to balance — item stays Pending until recharged', {
                orderId, itemIndex, error: result.error
            });
            return {
                success: false,
                status: 'InsufficientBalance',
                error: result.error,
                reference
            };
        }

        return {
            success: false,
            status: 'Failed',
            error: result.error,
            reference
        };
    }

    // Wait a moment and check status
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusCheck = await enqueueStatusCheck(reference);
    
    // Map MCBIS status to our status (expanded for API update compatibility)
    const statusMap = {
        'success': 'Delivered',
        'successful': 'Delivered',
        'completed': 'Delivered',
        'delivered': 'Delivered',
        'submitted': 'Processing',
        'pending': 'Processing',
        'processing': 'Processing',
        'initiated': 'Processing',
        'queued': 'Processing',
        'in_progress': 'Processing',
        'failed': 'Failed',
        'fail': 'Failed',
        'error': 'Failed',
        'cancelled': 'Failed',
        'canceled': 'Failed',
        'rejected': 'Failed'
    };

    const rawStatus = statusCheck.status?.toLowerCase()?.trim();
    const finalStatus = statusMap[rawStatus] || 'Processing';
    
    logger.info('deliverBundle status mapping', {
        reference,
        rawMcbisStatus: statusCheck.status,
        normalizedStatus: rawStatus,
        mappedStatus: finalStatus
    });

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
    checkOrderStatus: enqueueStatusCheck,
    deliverBundle,
    canProcessOrder,
    NETWORK_MAP
};

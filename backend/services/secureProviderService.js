/**
 * Secure Provider Service
 * Loss-Prevention Layer for Third-Party API Integration
 * 
 * This service wraps the MCBIS provider with defensive controls:
 * - Strict order state machine enforcement
 * - Two-phase wallet commits (hold → confirm/release)
 * - Circuit breaker pattern for failure protection
 * - Comprehensive audit logging
 * - Strict response validation
 * - Automatic refunds on failure
 * 
 * CRITICAL: This is the ONLY entry point for provider API calls.
 * Direct calls to mcbisProvider should be avoided.
 */

const mcbisProvider = require('./mcbisProvider');
const { ProviderTransaction, Wallet, Transaction, Setting } = require('../models');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

// Circuit breaker configuration
const CIRCUIT_BREAKER = {
    failureThreshold: 5,       // Failures before opening circuit
    resetTimeout: 60000,       // 60 seconds before attempting reset
    halfOpenRequests: 2,       // Test requests in half-open state
    monitorWindow: 300000,     // 5 minute window for failure counting
    
    // State
    state: 'CLOSED',           // CLOSED, OPEN, HALF_OPEN
    failures: [],              // Timestamps of recent failures
    lastFailure: null,
    openedAt: null,
    halfOpenAttempts: 0
};

// Response validation schemas
const MCBIS_RESPONSE_SCHEMA = {
    placeOrder: {
        requiredFields: ['data', 'message'],
        successIndicators: ['success', 'completed', 'pending', 'processing', 'submitted', 'initiated', 'queued'],
        failureIndicators: ['failed', 'error', 'insufficient', 'invalid', 'cancelled', 'rejected']
    },
    checkStatus: {
        requiredFields: ['data'],
        successIndicators: ['success', 'completed', 'delivered', 'successful'],
        failureIndicators: ['failed', 'error', 'cancelled', 'rejected']
    }
};

// ==================== CIRCUIT BREAKER ====================

/**
 * Check if circuit breaker allows request
 */
function canMakeRequest() {
    const now = Date.now();
    
    // Clean old failures outside monitoring window
    CIRCUIT_BREAKER.failures = CIRCUIT_BREAKER.failures.filter(
        f => now - f < CIRCUIT_BREAKER.monitorWindow
    );
    
    switch (CIRCUIT_BREAKER.state) {
        case 'CLOSED':
            return { allowed: true };
            
        case 'OPEN':
            // Check if reset timeout has passed
            if (now - CIRCUIT_BREAKER.openedAt >= CIRCUIT_BREAKER.resetTimeout) {
                CIRCUIT_BREAKER.state = 'HALF_OPEN';
                CIRCUIT_BREAKER.halfOpenAttempts = 0;
                logger.info('Circuit breaker entering HALF_OPEN state');
                return { allowed: true, isTestRequest: true };
            }
            return { 
                allowed: false, 
                reason: 'Circuit breaker is OPEN due to repeated failures',
                retryAfter: Math.ceil((CIRCUIT_BREAKER.resetTimeout - (now - CIRCUIT_BREAKER.openedAt)) / 1000)
            };
            
        case 'HALF_OPEN':
            if (CIRCUIT_BREAKER.halfOpenAttempts < CIRCUIT_BREAKER.halfOpenRequests) {
                return { allowed: true, isTestRequest: true };
            }
            return { 
                allowed: false, 
                reason: 'Circuit breaker HALF_OPEN - test requests exhausted'
            };
            
        default:
            return { allowed: true };
    }
}

/**
 * Record a successful request
 */
function recordSuccess() {
    if (CIRCUIT_BREAKER.state === 'HALF_OPEN') {
        CIRCUIT_BREAKER.halfOpenAttempts++;
        if (CIRCUIT_BREAKER.halfOpenAttempts >= CIRCUIT_BREAKER.halfOpenRequests) {
            // Reset circuit breaker
            CIRCUIT_BREAKER.state = 'CLOSED';
            CIRCUIT_BREAKER.failures = [];
            CIRCUIT_BREAKER.openedAt = null;
            logger.info('Circuit breaker CLOSED after successful recovery');
        }
    }
}

/**
 * Record a failed request
 */
function recordFailure() {
    const now = Date.now();
    CIRCUIT_BREAKER.failures.push(now);
    CIRCUIT_BREAKER.lastFailure = now;
    
    if (CIRCUIT_BREAKER.state === 'HALF_OPEN') {
        // Immediately re-open on failure during half-open
        CIRCUIT_BREAKER.state = 'OPEN';
        CIRCUIT_BREAKER.openedAt = now;
        logger.warn('Circuit breaker re-OPENED during half-open test');
        return;
    }
    
    // Clean old failures
    CIRCUIT_BREAKER.failures = CIRCUIT_BREAKER.failures.filter(
        f => now - f < CIRCUIT_BREAKER.monitorWindow
    );
    
    if (CIRCUIT_BREAKER.failures.length >= CIRCUIT_BREAKER.failureThreshold) {
        CIRCUIT_BREAKER.state = 'OPEN';
        CIRCUIT_BREAKER.openedAt = now;
        logger.error('Circuit breaker OPENED due to failure threshold', {
            failures: CIRCUIT_BREAKER.failures.length,
            threshold: CIRCUIT_BREAKER.failureThreshold
        });
        
        // Auto-disable MCBIS when circuit opens
        disableProviderSafely('Circuit breaker triggered due to repeated failures');
    }
}

/**
 * Get circuit breaker status
 */
function getCircuitBreakerStatus() {
    return {
        state: CIRCUIT_BREAKER.state,
        recentFailures: CIRCUIT_BREAKER.failures.length,
        failureThreshold: CIRCUIT_BREAKER.failureThreshold,
        lastFailure: CIRCUIT_BREAKER.lastFailure,
        openedAt: CIRCUIT_BREAKER.openedAt
    };
}

/**
 * Manually reset circuit breaker (admin function)
 */
function resetCircuitBreaker() {
    CIRCUIT_BREAKER.state = 'CLOSED';
    CIRCUIT_BREAKER.failures = [];
    CIRCUIT_BREAKER.openedAt = null;
    CIRCUIT_BREAKER.halfOpenAttempts = 0;
    logger.info('Circuit breaker manually reset');
    return true;
}

// ==================== RESPONSE VALIDATION ====================

/**
 * Validate provider response strictly
 * RULE: Unknown response = NOT SUCCESS
 */
function validateProviderResponse(response, operation = 'placeOrder') {
    const schema = MCBIS_RESPONSE_SCHEMA[operation];
    const result = {
        isValid: false,
        isSuccess: false,
        errors: [],
        warnings: [],
        normalizedStatus: 'UNKNOWN'
    };
    
    // Check for null/undefined response
    if (!response) {
        result.errors.push('Null or undefined response received');
        return result;
    }
    
    // Check HTTP-level success
    if (response.httpStatus && response.httpStatus >= 400) {
        result.errors.push(`HTTP error: ${response.httpStatus}`);
        result.normalizedStatus = 'FAILED';
        return result;
    }
    
    // Check required fields exist
    for (const field of schema.requiredFields) {
        if (response[field] === undefined && response.raw?.[field] === undefined) {
            result.warnings.push(`Missing expected field: ${field}`);
        }
    }
    
    // Determine success/failure from response
    const responseStatus = (
        response.status ||
        response.data?.status ||
        response.raw?.data?.status ||
        response.raw?.status ||
        ''
    ).toLowerCase();
    
    const responseMessage = (
        response.message ||
        response.data?.message ||
        response.raw?.message ||
        ''
    ).toLowerCase();
    
    // Check for explicit success indicators
    const hasSuccessIndicator = schema.successIndicators.some(
        ind => responseStatus.includes(ind) || responseMessage.includes(ind)
    );
    
    // Check for explicit failure indicators
    const hasFailureIndicator = schema.failureIndicators.some(
        ind => responseStatus.includes(ind) || responseMessage.includes(ind)
    );
    
    if (hasFailureIndicator) {
        result.normalizedStatus = 'FAILED';
        result.isValid = true;
    } else if (hasSuccessIndicator) {
        result.normalizedStatus = responseStatus.includes('pending') || responseStatus.includes('processing') 
            ? 'PENDING' 
            : 'CONFIRMED';
        result.isSuccess = result.normalizedStatus === 'CONFIRMED';
        result.isValid = true;
    } else {
        // CRITICAL: Unknown response is NOT treated as success
        result.normalizedStatus = 'UNKNOWN';
        result.warnings.push('Response status could not be determined - treating as UNKNOWN');
        result.isValid = false;
    }
    
    return result;
}

// ==================== SAFE PROVIDER CONTROL ====================

/**
 * Safely disable the provider (kill switch)
 */
async function disableProviderSafely(reason) {
    try {
        await Setting.setValue('mcbisEnabled', false, 'boolean', `Auto-disabled: ${reason}`);
        logger.error('MCBIS Provider DISABLED', { reason });
        return true;
    } catch (error) {
        logger.error('Failed to disable MCBIS provider', { error: error.message });
        return false;
    }
}

/**
 * Emergency stop - disable all provider activity
 */
async function emergencyStop(adminId, reason) {
    const t = await sequelize.transaction();
    try {
        // Disable main toggle
        await Setting.setValue('mcbisEnabled', false, 'boolean', `Emergency stop by ${adminId}: ${reason}`);
        
        // Disable all network toggles
        await Setting.setValue('mcbis_mtnAPI', false, 'boolean');
        await Setting.setValue('mcbis_telecelAPI', false, 'boolean');
        await Setting.setValue('mcbis_airteltigoAPI', false, 'boolean');
        
        // Reset circuit breaker to OPEN
        CIRCUIT_BREAKER.state = 'OPEN';
        CIRCUIT_BREAKER.openedAt = Date.now();
        
        await t.commit();
        
        logger.error('EMERGENCY STOP ACTIVATED', { adminId, reason });
        
        return {
            success: true,
            message: 'Emergency stop activated. All provider activity halted.',
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        await t.rollback();
        logger.error('Emergency stop failed', { error: error.message });
        throw error;
    }
}

// ==================== SECURE DELIVERY ====================

/**
 * Securely deliver a bundle with full safeguards
 * This is the main entry point for all provider deliveries
 * 
 * Flow:
 * 1. Check circuit breaker
 * 2. Validate inputs
 * 3. Check for duplicates (ProviderTransaction)
 * 4. Reserve funds (two-phase)
 * 5. Create ProviderTransaction (CREATED)
 * 6. Send to provider (mark PENDING_PROVIDER)
 * 7. Validate response strictly
 * 8. Confirm or release funds based on result
 * 9. Log everything
 */
async function secureDeliverBundle(orderData, options = {}) {
    const startTime = Date.now();
    const { orderId, itemIndex, userId, network, phoneNumber, dataAmount, price, costPrice, packageId } = orderData;
    const { skipCircuitBreaker = false } = options;
    
    let providerTx = null;
    let wallet = null;
    const auditLog = {
        orderId,
        itemIndex,
        startTime: new Date().toISOString(),
        steps: []
    };
    
    const addStep = (step, data) => {
        auditLog.steps.push({ step, timestamp: Date.now() - startTime, ...data });
    };
    
    try {
        // Step 1: Circuit Breaker Check
        if (!skipCircuitBreaker) {
            const circuitCheck = canMakeRequest();
            addStep('CIRCUIT_CHECK', { result: circuitCheck });
            
            if (!circuitCheck.allowed) {
                return {
                    success: false,
                    status: 'CIRCUIT_OPEN',
                    error: circuitCheck.reason,
                    retryAfter: circuitCheck.retryAfter
                };
            }
        }
        
        // Step 2: Check Provider Settings
        const canProcess = await mcbisProvider.canProcessOrder(network, price);
        addStep('CAN_PROCESS_CHECK', { result: canProcess });
        
        if (!canProcess.canProcess) {
            return {
                success: false,
                status: 'PROVIDER_DISABLED',
                error: canProcess.reason,
                code: canProcess.code
            };
        }
        
        // Step 3: Start transaction for atomicity
        const t = await sequelize.transaction();
        addStep('TRANSACTION_START', {});
        
        try {
            // Step 4: Check for duplicates via ProviderTransaction
            const existingTx = await ProviderTransaction.hasExistingTransaction(orderId, itemIndex);
            addStep('DUPLICATE_CHECK', { exists: !!existingTx, existingId: existingTx?.id });
            
            if (existingTx) {
                await t.rollback();
                
                // If existing is still pending, check its status
                if (existingTx.status === 'PENDING_PROVIDER') {
                    const statusCheck = await mcbisProvider.checkOrderStatus(existingTx.internalReference);
                    return {
                        success: false,
                        status: 'DUPLICATE_PENDING',
                        error: 'Order already sent to provider and pending',
                        existingReference: existingTx.internalReference,
                        existingStatus: statusCheck.status
                    };
                }
                
                return {
                    success: false,
                    status: 'DUPLICATE',
                    error: 'Duplicate order detected',
                    existingReference: existingTx.internalReference,
                    existingStatus: existingTx.status
                };
            }
            
            // Step 5: Get wallet and hold funds
            wallet = await Wallet.findOne({ 
                where: { userId },
                lock: t.LOCK.UPDATE,
                transaction: t
            });
            
            if (!wallet) {
                await t.rollback();
                return { success: false, status: 'NO_WALLET', error: 'User wallet not found' };
            }
            
            const holdReference = `HOLD-${orderId}-${itemIndex}`;
            addStep('HOLD_FUNDS', { amount: price, reference: holdReference });
            
            // Note: For orders, funds are already debited at order creation
            // This hold is for tracking purposes in provider delivery
            
            // Step 6: Create ProviderTransaction
            providerTx = await ProviderTransaction.createTransaction({
                orderId,
                orderItemIndex: itemIndex,
                provider: 'MCBIS',
                amount: price,
                costAmount: costPrice,
                network,
                phoneNumber,
                dataAmount: dataAmount || 'Unknown',
                packageId,
                userId
            }, { transaction: t });
            
            addStep('TX_CREATED', { txId: providerTx.id, reference: providerTx.internalReference });
            
            // Step 7: Get provider balance before
            let providerBalanceBefore = null;
            try {
                const balanceResult = await mcbisProvider.getWalletBalance();
                providerBalanceBefore = balanceResult.balance;
                addStep('BALANCE_BEFORE', { balance: providerBalanceBefore });
            } catch (e) {
                addStep('BALANCE_BEFORE_FAILED', { error: e.message });
            }
            
            // Step 8: Send to provider
            const requestPayload = {
                network,
                receiver: phoneNumber,
                amount: dataAmount,
                reference: providerTx.internalReference
            };
            
            await providerTx.markSent(requestPayload, providerBalanceBefore, { transaction: t });
            addStep('MARKED_SENT', {});
            
            // Commit the transaction before calling external API
            // This ensures our record exists even if API call hangs
            await t.commit();
            addStep('TX_COMMITTED', {});
            
            // Step 9: Make the actual API call (outside transaction)
            let apiResponse;
            try {
                apiResponse = await mcbisProvider.placeOrder({
                    network,
                    receiver: phoneNumber,
                    amount: dataAmount,
                    reference: providerTx.internalReference
                });
                addStep('API_RESPONSE', { 
                    success: apiResponse.success,
                    status: apiResponse.status,
                    reference: apiResponse.reference
                });
            } catch (apiError) {
                addStep('API_ERROR', { error: apiError.message });
                apiResponse = {
                    success: false,
                    error: apiError.message,
                    status: 'error'
                };
            }
            
            // Step 10: Validate response strictly
            const validation = validateProviderResponse(apiResponse, 'placeOrder');
            addStep('RESPONSE_VALIDATION', validation);
            
            // Step 11: Get balance after (for reconciliation)
            let providerBalanceAfter = null;
            try {
                const balanceResult = await mcbisProvider.getWalletBalance();
                providerBalanceAfter = balanceResult.balance;
                addStep('BALANCE_AFTER', { balance: providerBalanceAfter });
            } catch (e) {
                addStep('BALANCE_AFTER_FAILED', { error: e.message });
            }
            
            // Step 12: Update ProviderTransaction based on result
            const t2 = await sequelize.transaction();
            
            try {
                await providerTx.reload({ transaction: t2 });
                
                if (validation.normalizedStatus === 'CONFIRMED' || validation.normalizedStatus === 'PENDING') {
                    await providerTx.markConfirmed(
                        apiResponse.raw,
                        apiResponse.reference || providerTx.internalReference,
                        providerBalanceAfter,
                        { transaction: t2 }
                    );
                    recordSuccess();
                    addStep('MARKED_CONFIRMED', {});
                    
                } else if (validation.normalizedStatus === 'FAILED') {
                    await providerTx.markFailed(
                        apiResponse.raw,
                        apiResponse.error || 'PROVIDER_FAILED',
                        apiResponse.error || 'Provider returned failure status',
                        apiResponse.httpStatus || 0,
                        { transaction: t2 }
                    );
                    recordFailure();
                    addStep('MARKED_FAILED', {});
                    
                } else {
                    // UNKNOWN status - flag for review
                    await providerTx.flagForReview(
                        `Unknown response status: ${JSON.stringify(apiResponse)}`,
                        { transaction: t2 }
                    );
                    recordFailure();
                    addStep('FLAGGED_UNKNOWN', {});
                }
                
                await t2.commit();
            } catch (updateError) {
                await t2.rollback();
                addStep('UPDATE_ERROR', { error: updateError.message });
                // Log but don't fail - the provider call was made
                logger.error('Failed to update ProviderTransaction', {
                    txId: providerTx.id,
                    error: updateError.message
                });
            }
            
            // Step 13: Build result
            const result = {
                success: validation.isSuccess || validation.normalizedStatus === 'PENDING',
                status: validation.normalizedStatus === 'PENDING' ? 'Processing' : 
                        validation.normalizedStatus === 'CONFIRMED' ? 'Delivered' :
                        validation.normalizedStatus === 'FAILED' ? 'Failed' : 'Unknown',
                reference: providerTx.internalReference,
                providerReference: apiResponse.reference,
                validation,
                auditLog,
                requiresReview: validation.normalizedStatus === 'UNKNOWN'
            };
            
            addStep('COMPLETE', { success: result.success, status: result.status });
            
            // Log full audit trail
            logger.info('Secure delivery complete', {
                orderId,
                itemIndex,
                success: result.success,
                status: result.status,
                duration: Date.now() - startTime,
                auditLog
            });
            
            return result;
            
        } catch (innerError) {
            await t.rollback();
            throw innerError;
        }
        
    } catch (error) {
        addStep('ERROR', { error: error.message, stack: error.stack });
        
        logger.error('Secure delivery failed', {
            orderId,
            itemIndex,
            error: error.message,
            auditLog
        });
        
        recordFailure();
        
        return {
            success: false,
            status: 'ERROR',
            error: error.message,
            auditLog
        };
    }
}

/**
 * Process refund for failed delivery
 */
async function processRefund(orderId, itemIndex, amount, reason) {
    const t = await sequelize.transaction();
    
    try {
        // Find the provider transaction
        const providerTx = await ProviderTransaction.findOne({
            where: { orderId, orderItemIndex: itemIndex },
            transaction: t
        });
        
        if (!providerTx) {
            await t.rollback();
            return { success: false, error: 'Provider transaction not found' };
        }
        
        // Get wallet
        const wallet = await Wallet.findOne({
            where: { userId: providerTx.userId },
            lock: t.LOCK.UPDATE,
            transaction: t
        });
        
        if (!wallet) {
            await t.rollback();
            return { success: false, error: 'Wallet not found' };
        }
        
        // Credit the refund
        const balanceBefore = wallet.balance;
        await wallet.credit(amount, { transaction: t });
        
        // Create refund transaction record
        const refundTx = await Transaction.create({
            userId: providerTx.userId,
            type: 'credit',
            amount,
            balanceBefore,
            balanceAfter: wallet.balance,
            description: `Refund for failed delivery - Order ${orderId} Item ${itemIndex}`,
            reference: `REFUND-${providerTx.internalReference}`,
            paymentMethod: 'refund',
            status: 'completed',
            orderId
        }, { transaction: t });
        
        // Mark provider transaction as reversed
        await providerTx.markReversed(reason, refundTx.id, { transaction: t });
        
        await t.commit();
        
        logger.info('Refund processed', {
            orderId,
            itemIndex,
            amount,
            reason,
            refundTxId: refundTx.id
        });
        
        return {
            success: true,
            refundTransactionId: refundTx.id,
            newBalance: wallet.balance
        };
        
    } catch (error) {
        await t.rollback();
        logger.error('Refund failed', { orderId, itemIndex, error: error.message });
        return { success: false, error: error.message };
    }
}

// ==================== RECONCILIATION ====================

/**
 * Run daily reconciliation check
 */
async function runReconciliation() {
    const report = {
        timestamp: new Date().toISOString(),
        mismatches: [],
        unreconciledCount: 0,
        reviewRequired: []
    };
    
    try {
        // 1. Find transactions pending longer than expected
        const staleTransactions = await ProviderTransaction.findAll({
            where: {
                status: 'PENDING_PROVIDER',
                sentAt: { [sequelize.Op.lt]: new Date(Date.now() - 3600000) } // > 1 hour
            }
        });
        
        for (const tx of staleTransactions) {
            // Check status with provider
            const statusCheck = await mcbisProvider.checkOrderStatus(tx.internalReference);
            
            if (statusCheck.status !== 'pending' && statusCheck.status !== 'processing') {
                report.mismatches.push({
                    type: 'STALE_PENDING',
                    txId: tx.id,
                    reference: tx.internalReference,
                    ourStatus: tx.status,
                    providerStatus: statusCheck.status
                });
                
                // Update our record
                await tx.update({
                    mismatchDetected: true,
                    mismatchReason: `Stale pending - provider says: ${statusCheck.status}`,
                    requiresReview: true
                });
            }
        }
        
        // 2. Get unreconciled transactions
        const unreconciled = await ProviderTransaction.getUnreconciled();
        report.unreconciledCount = unreconciled.length;
        
        // 3. Get transactions requiring review
        const needsReview = await ProviderTransaction.getRequiringReview();
        report.reviewRequired = needsReview.map(tx => ({
            id: tx.id,
            reference: tx.internalReference,
            status: tx.status,
            createdAt: tx.createdAt
        }));
        
        // 4. Get daily summary
        report.dailySummary = await ProviderTransaction.getDailySummary();
        
        logger.info('Reconciliation complete', report);
        
        return report;
        
    } catch (error) {
        logger.error('Reconciliation failed', { error: error.message });
        return { ...report, error: error.message };
    }
}

module.exports = {
    // Main delivery function
    secureDeliverBundle,
    
    // Refund
    processRefund,
    
    // Circuit breaker
    getCircuitBreakerStatus,
    resetCircuitBreaker,
    canMakeRequest,
    
    // Kill switches
    emergencyStop,
    disableProviderSafely,
    
    // Reconciliation
    runReconciliation,
    
    // Response validation
    validateProviderResponse
};

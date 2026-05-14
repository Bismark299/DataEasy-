/**
 * Price Integrity Validation
 * 
 * This module performs startup and runtime checks to ensure
 * price integrity across the system.
 * 
 * SINGLE SOURCE OF TRUTH: Database is the ONLY authoritative price source
 */

const logger = require('./logger');

/**
 * Validate that all packages in database have valid prices
 * @returns {Promise<{valid: boolean, errors: Array}>}
 */
async function validateDatabasePrices() {
    const errors = [];
    
    try {
        const Package = require('../models/Package');
        const packages = await Package.findAll();
        
        if (packages.length === 0) {
            errors.push('CRITICAL: No packages found in database');
            return { valid: false, errors };
        }
        
        for (const pkg of packages) {
            // Check selling price
            const price = parseFloat(pkg.price);
            if (isNaN(price) || price <= 0) {
                errors.push(`Invalid price for ${pkg.id}: ${pkg.price}`);
            }
            
            // Check cost price if set (can be null)
            if (pkg.costPrice !== null) {
                const costPrice = parseFloat(pkg.costPrice);
                if (isNaN(costPrice) || costPrice < 0) {
                    errors.push(`Invalid cost price for ${pkg.id}: ${pkg.costPrice}`);
                }
                
                // Warn if cost >= selling price (no profit)
                if (costPrice >= price) {
                    logger.warn('PROFIT WARNING: Cost price >= selling price', {
                        packageId: pkg.id,
                        price,
                        costPrice,
                        margin: price - costPrice
                    });
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            packagesChecked: packages.length
        };
    } catch (error) {
        errors.push(`Database error: ${error.message}`);
        return { valid: false, errors };
    }
}

/**
 * Check for price consistency (detect stale cache or mismatches)
 * @param {string} packageId - Package ID to check
 * @param {number} expectedPrice - Expected price from cache/order
 * @returns {Promise<{consistent: boolean, dbPrice: number}>}
 */
async function verifyPriceConsistency(packageId, expectedPrice) {
    try {
        const Package = require('../models/Package');
        const pkg = await Package.findByPk(packageId);
        
        if (!pkg) {
            logger.error('Price consistency check failed: Package not found', { packageId });
            return { consistent: false, dbPrice: null, error: 'Package not found' };
        }
        
        const dbPrice = parseFloat(pkg.price);
        const expected = parseFloat(expectedPrice);
        
        // Allow small floating point differences
        const consistent = Math.abs(dbPrice - expected) < 0.01;
        
        if (!consistent) {
            logger.error('PRICE MISMATCH DETECTED', {
                packageId,
                expectedPrice: expected,
                databasePrice: dbPrice,
                difference: dbPrice - expected,
                timestamp: new Date().toISOString()
            });
        }
        
        return { consistent, dbPrice, expectedPrice: expected };
    } catch (error) {
        logger.error('Price consistency check error', { packageId, error: error.message });
        return { consistent: false, error: error.message };
    }
}

/**
 * Startup validation - call this when server starts
 * @param {boolean} failOnError - If true, throws error on validation failure
 */
async function runStartupValidation(failOnError = false) {
    logger.info('=== PRICE INTEGRITY STARTUP VALIDATION ===');
    
    const result = await validateDatabasePrices();
    
    if (result.valid) {
        logger.info('✓ Price validation PASSED', {
            packagesChecked: result.packagesChecked
        });
    } else {
        logger.error('✗ Price validation FAILED', {
            errors: result.errors
        });
        
        if (failOnError) {
            throw new Error('Price integrity validation failed: ' + result.errors.join(', '));
        }
    }
    
    return result;
}

/**
 * Assert that a price came from database (defensive check)
 * @param {Object} pkg - Package object
 * @throws {Error} If price source is not database
 */
function assertDatabasePrice(pkg) {
    if (!pkg || !pkg.priceSource || pkg.priceSource !== 'database') {
        const error = new Error('CRITICAL: Price not from database source');
        logger.error(error.message, {
            packageId: pkg?.id,
            priceSource: pkg?.priceSource
        });
        throw error;
    }
}

/**
 * Create an immutable price snapshot for order
 * @param {Object} pkg - Package from database
 * @returns {Object} Immutable price snapshot
 */
function createPriceSnapshot(pkg) {
    // Freeze the snapshot to prevent modification
    return Object.freeze({
        price: Math.round(parseFloat(pkg.price) * 100) / 100,
        costPrice: pkg.costPrice ? Math.round(parseFloat(pkg.costPrice) * 100) / 100 : null,
        priceSource: 'database',
        priceLockedAt: new Date().toISOString(),
        packageId: pkg.id,
        // This object should never be modified after creation
        _immutable: true
    });
}

module.exports = {
    validateDatabasePrices,
    verifyPriceConsistency,
    runStartupValidation,
    assertDatabasePrice,
    createPriceSnapshot
};

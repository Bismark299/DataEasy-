/**
 * Package Configuration - SINGLE SOURCE OF TRUTH ENFORCEMENT
 * 
 * ⚠️ CRITICAL: Database is the ONLY authoritative source for pricing
 * 
 * Static configuration contains ONLY:
 * - Package IDs
 * - Provider codes  
 * - Metadata (name, data amount, validity)
 * 
 * ❌ NO PRICES in static config
 * ❌ NO FALLBACK to static prices
 * ❌ NO DEFAULT prices
 * 
 * Rule: No DB price → No order (FAIL CLOSED)
 */

const logger = require('../utils/logger');

// ============================================================================
// STATIC METADATA ONLY - NO PRICES
// Used for: Package ID validation, network mapping, provider codes
// ============================================================================
const packageMetadata = {
    MTN: [
        { id: 'mtn-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', providerCode: 'mtn-1gb' },
        { id: 'mtn-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', providerCode: 'mtn-2gb' },
        { id: 'mtn-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', providerCode: 'mtn-3gb' },
        { id: 'mtn-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', providerCode: 'mtn-4gb' },
        { id: 'mtn-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', providerCode: 'mtn-5gb' },
        { id: 'mtn-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', providerCode: 'mtn-6gb' },
        { id: 'mtn-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', providerCode: 'mtn-8gb' },
        { id: 'mtn-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', providerCode: 'mtn-10gb' },
        { id: 'mtn-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', providerCode: 'mtn-15gb' },
        { id: 'mtn-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', providerCode: 'mtn-20gb' },
        { id: 'mtn-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', providerCode: 'mtn-25gb' },
        { id: 'mtn-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', providerCode: 'mtn-30gb' },
        { id: 'mtn-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', providerCode: 'mtn-40gb' },
        { id: 'mtn-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', providerCode: 'mtn-50gb' }
    ],
    AirtelTigo: [
        { id: 'at-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', providerCode: 'at-1gb' },
        { id: 'at-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', providerCode: 'at-2gb' },
        { id: 'at-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', providerCode: 'at-3gb' },
        { id: 'at-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', providerCode: 'at-4gb' },
        { id: 'at-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', providerCode: 'at-5gb' },
        { id: 'at-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', providerCode: 'at-6gb' },
        { id: 'at-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', providerCode: 'at-8gb' },
        { id: 'at-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', providerCode: 'at-10gb' },
        { id: 'at-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', providerCode: 'at-15gb' },
        { id: 'at-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', providerCode: 'at-20gb' },
        { id: 'at-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', providerCode: 'at-25gb' },
        { id: 'at-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', providerCode: 'at-30gb' },
        { id: 'at-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', providerCode: 'at-40gb' },
        { id: 'at-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', providerCode: 'at-50gb' }
    ],
    Telecel: [
        { id: 'tc-1gb', name: '1GB', data: '1GB', validity: 'Non-Expiry', providerCode: 'tc-1gb' },
        { id: 'tc-2gb', name: '2GB', data: '2GB', validity: 'Non-Expiry', providerCode: 'tc-2gb' },
        { id: 'tc-3gb', name: '3GB', data: '3GB', validity: 'Non-Expiry', providerCode: 'tc-3gb' },
        { id: 'tc-4gb', name: '4GB', data: '4GB', validity: 'Non-Expiry', providerCode: 'tc-4gb' },
        { id: 'tc-5gb', name: '5GB', data: '5GB', validity: 'Non-Expiry', providerCode: 'tc-5gb' },
        { id: 'tc-6gb', name: '6GB', data: '6GB', validity: 'Non-Expiry', providerCode: 'tc-6gb' },
        { id: 'tc-8gb', name: '8GB', data: '8GB', validity: 'Non-Expiry', providerCode: 'tc-8gb' },
        { id: 'tc-10gb', name: '10GB', data: '10GB', validity: 'Non-Expiry', providerCode: 'tc-10gb' },
        { id: 'tc-15gb', name: '15GB', data: '15GB', validity: 'Non-Expiry', providerCode: 'tc-15gb' },
        { id: 'tc-20gb', name: '20GB', data: '20GB', validity: 'Non-Expiry', providerCode: 'tc-20gb' },
        { id: 'tc-25gb', name: '25GB', data: '25GB', validity: 'Non-Expiry', providerCode: 'tc-25gb' },
        { id: 'tc-30gb', name: '30GB', data: '30GB', validity: 'Non-Expiry', providerCode: 'tc-30gb' },
        { id: 'tc-40gb', name: '40GB', data: '40GB', validity: 'Non-Expiry', providerCode: 'tc-40gb' },
        { id: 'tc-50gb', name: '50GB', data: '50GB', validity: 'Non-Expiry', providerCode: 'tc-50gb' }
    ]
};

// ============================================================================
// CACHE CONFIGURATION
// Short TTL to ensure fresh prices, with invalidation on updates
// ============================================================================
let packagesCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 30000; // 30 seconds - short TTL for price freshness

/**
 * Clear the packages cache
 * MUST be called after any price update
 */
const clearPackagesCache = () => {
    packagesCache = null;
    cacheTimestamp = null;
    logger.info('Package cache invalidated');
};

// ============================================================================
// DATABASE-ONLY PRICE FETCHING
// ============================================================================

/**
 * Get packages from database - NO FALLBACK TO STATIC PRICES
 * @param {boolean} activeOnly - If true, only return active packages
 * @returns {Object|null} Grouped packages or null if DB fails
 */
const getPackagesFromDB = async (activeOnly = true) => {
    try {
        // Check cache (only for short period)
        if (packagesCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
            return packagesCache;
        }

        const Package = require('../models/Package');
        const whereClause = activeOnly ? { isActive: true } : {};
        
        const dbPackages = await Package.findAll({
            where: whereClause,
            order: [['network', 'ASC'], ['sortOrder', 'ASC'], ['price', 'ASC']]
        });

        if (dbPackages.length === 0) {
            logger.error('CRITICAL: No packages found in database');
            return null;
        }

        // Group by network WITH prices from DB
        const grouped = {
            MTN: [],
            AirtelTigo: [],
            Telecel: []
        };

        dbPackages.forEach(pkg => {
            // CRITICAL: Price MUST come from database
            const price = parseFloat(pkg.price);
            const costPrice = pkg.costPrice ? parseFloat(pkg.costPrice) : null;
            const superDealerPrice = pkg.superDealerPrice ? parseFloat(pkg.superDealerPrice) : price;
            const dealerPrice = pkg.dealerPrice ? parseFloat(pkg.dealerPrice) : price;
            const superAgentPrice = pkg.superAgentPrice ? parseFloat(pkg.superAgentPrice) : price;
            
            if (isNaN(price) || price <= 0) {
                logger.error('CRITICAL: Invalid price in database', {
                    packageId: pkg.id,
                    price: pkg.price
                });
                return; // Skip invalid packages
            }

            const pkgData = {
                id: pkg.id,
                name: pkg.name,
                data: pkg.data,
                validity: pkg.validity,
                // Agent price (default)
                price: Math.round(price * 100) / 100,
                // Role-based prices
                superDealerPrice: Math.round(superDealerPrice * 100) / 100,
                dealerPrice: Math.round(dealerPrice * 100) / 100,
                superAgentPrice: Math.round(superAgentPrice * 100) / 100,
                costPrice: costPrice ? Math.round(costPrice * 100) / 100 : null,
                popular: pkg.popular,
                isActive: pkg.isActive,
                outOfStock: !pkg.isActive,
                // Audit fields
                priceSource: 'database',
                priceFetchedAt: new Date().toISOString()
            };
            
            if (grouped[pkg.network]) {
                grouped[pkg.network].push(pkgData);
            }
        });

        // Update cache
        packagesCache = grouped;
        cacheTimestamp = Date.now();

        return grouped;
    } catch (error) {
        logger.error('CRITICAL: Database error fetching packages', {
            error: error.message,
            stack: error.stack
        });
        return null;
    }
};

/**
 * Get all packages for client display
 * Shows all packages, marks inactive as "out of stock"
 * @returns {Object} Grouped packages
 * @throws {Error} If database unavailable
 */
const getAllPackagesForClient = async () => {
    const dbPackages = await getPackagesFromDB(false); // Include inactive
    
    if (!dbPackages) {
        // FAIL CLOSED - No fallback to static prices
        logger.error('CRITICAL: Cannot serve packages - database unavailable');
        throw new Error('Package pricing unavailable. Please try again later.');
    }

    return dbPackages;
};

/**
 * Get active packages by network
 * @param {string} network - Network name
 * @returns {Array} Packages for network
 * @throws {Error} If database unavailable
 */
const getPackages = async (network = 'MTN') => {
    const dbPackages = await getPackagesFromDB(true);
    
    if (!dbPackages) {
        // FAIL CLOSED
        throw new Error('Package pricing unavailable');
    }

    return dbPackages[network] || [];
};

/**
 * Get all packages grouped by network
 * @returns {Object} All packages grouped
 * @throws {Error} If database unavailable
 */
const getAllPackages = async () => {
    const dbPackages = await getPackagesFromDB(true);
    
    if (!dbPackages) {
        // FAIL CLOSED
        throw new Error('Package pricing unavailable');
    }

    return dbPackages;
};

// ============================================================================
// CRITICAL: FIND PACKAGE FOR ORDER - DATABASE ONLY
// ============================================================================

/**
 * Find a package by ID for ORDER PROCESSING
 * 
 * ⚠️ CRITICAL: This function is used during order creation
 * - MUST return price from database
 * - MUST fail if package not found in DB
 * - NO FALLBACK to static config
 * 
 * @param {string} packageId - Package ID to find
 * @param {string} userRole - User role for pricing: 'super-dealer', 'dealer', 'super-agent', 'agent'
 * @returns {Object|null} Package with role-based price or null
 */
const findPackage = async (packageId, userRole = 'agent') => {
    try {
        const Package = require('../models/Package');
        const pkg = await Package.findByPk(packageId);
        
        if (!pkg) {
            logger.warn('Package not found in database', { packageId });
            return null;
        }

        if (!pkg.isActive) {
            logger.warn('Package is inactive/out of stock', { packageId });
            return null;
        }

        // Get all role-based prices
        const agentPrice = parseFloat(pkg.price);
        const superDealerPrice = pkg.superDealerPrice ? parseFloat(pkg.superDealerPrice) : agentPrice;
        const dealerPrice = pkg.dealerPrice ? parseFloat(pkg.dealerPrice) : agentPrice;
        const superAgentPrice = pkg.superAgentPrice ? parseFloat(pkg.superAgentPrice) : agentPrice;
        const costPrice = pkg.costPrice ? parseFloat(pkg.costPrice) : null;

        // CRITICAL VALIDATION: Price must be valid
        if (isNaN(agentPrice) || agentPrice <= 0) {
            logger.error('CRITICAL: Invalid price for package', {
                packageId,
                price: pkg.price
            });
            return null;
        }

        // Determine price based on role
        let price;
        switch (userRole) {
            case 'super-dealer':
                price = superDealerPrice;
                break;
            case 'dealer':
                price = dealerPrice;
                break;
            case 'super-agent':
                price = superAgentPrice;
                break;
            case 'agent':
            default:
                price = agentPrice;
        }

        // AUDIT LOG: Price source verification
        logger.info('Package price fetched from database', {
            packageId,
            userRole,
            price,
            costPrice,
            source: 'database'
        });

        return {
            id: pkg.id,
            name: pkg.name,
            data: pkg.data,
            validity: pkg.validity,
            price: Math.round(price * 100) / 100,
            costPrice: costPrice ? Math.round(costPrice * 100) / 100 : null,
            popular: pkg.popular,
            network: pkg.network,
            userRole, // Include role for audit
            // Audit fields
            priceSource: 'database',
            priceFetchedAt: new Date().toISOString()
        };
    } catch (error) {
        logger.error('CRITICAL: Database error finding package', {
            packageId,
            error: error.message
        });
        // FAIL CLOSED - No fallback
        return null;
    }
};

/**
 * @deprecated - DO NOT USE FOR ORDER PROCESSING
 * Only for backward compatibility with non-critical code
 * Returns metadata ONLY - NO PRICES
 */
const findPackageSync = (packageId) => {
    logger.warn('DEPRECATED: findPackageSync called - returns metadata only, no prices', {
        packageId
    });
    
    // Return metadata ONLY - NO PRICE
    for (const [network, packages] of Object.entries(packageMetadata)) {
        const pkg = packages.find(p => p.id === packageId);
        if (pkg) {
            return {
                ...pkg,
                price: null, // NO PRICE from static config
                costPrice: null,
                _warning: 'NO_PRICE_USE_DATABASE'
            };
        }
    }
    return null;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get network from package ID
 */
const getNetworkFromPackageId = (packageId) => {
    if (packageId.startsWith('mtn-')) return 'MTN';
    if (packageId.startsWith('at-')) return 'AirtelTigo';
    if (packageId.startsWith('tc-')) return 'Telecel';
    return null;
};

/**
 * Validate package ID exists (metadata check only)
 */
const isValidPackageId = (packageId) => {
    const network = getNetworkFromPackageId(packageId);
    if (!network) return false;
    
    const packages = packageMetadata[network] || [];
    return packages.some(p => p.id === packageId);
};

/**
 * Valid data sizes
 */
const validDataSizes = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50];

/**
 * Get the correct price for a user based on their role
 * @param {Object} pkg - Package object with all role prices
 * @param {string} role - User role: 'super-dealer', 'dealer', 'super-agent', 'agent'
 * @returns {number} The correct price for the user's role
 */
const getPriceForRole = (pkg, role) => {
    switch (role) {
        case 'super-dealer':
            return pkg.superDealerPrice || pkg.price;
        case 'dealer':
            return pkg.dealerPrice || pkg.price;
        case 'super-agent':
            return pkg.superAgentPrice || pkg.price;
        case 'agent':
        default:
            return pkg.price;
    }
};

/**
 * Get all packages with prices adjusted for user's role
 * @param {string} role - User role
 * @returns {Object} Grouped packages with role-appropriate prices
 * @throws {Error} If database unavailable
 */
const getAllPackagesForRole = async (role = 'agent') => {
    const dbPackages = await getPackagesFromDB(false);
    
    if (!dbPackages) {
        throw new Error('Package pricing unavailable. Please try again later.');
    }

    // Transform packages to show only the user's price
    const transformed = {
        MTN: [],
        AirtelTigo: [],
        Telecel: []
    };

    Object.keys(dbPackages).forEach(network => {
        transformed[network] = dbPackages[network].map(pkg => ({
            id: pkg.id,
            name: pkg.name,
            data: pkg.data,
            validity: pkg.validity,
            price: getPriceForRole(pkg, role),
            popular: pkg.popular,
            isActive: pkg.isActive,
            outOfStock: pkg.outOfStock,
            priceSource: pkg.priceSource,
            priceFetchedAt: pkg.priceFetchedAt
        }));
    });

    return transformed;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Package metadata (NO PRICES) - for backward compatibility
    packages: packageMetadata,
    packageMetadata,
    
    // Database-backed functions (WITH PRICES)
    getPackages,
    getAllPackages,
    getAllPackagesForClient,
    getAllPackagesForRole,
    findPackage,
    
    // Price utilities
    getPriceForRole,
    
    // Deprecated - logs warning, returns no prices
    findPackageSync,
    
    // Utilities
    getNetworkFromPackageId,
    isValidPackageId,
    validDataSizes,
    
    // Cache management
    clearPackagesCache
};

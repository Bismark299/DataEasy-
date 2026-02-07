/**
 * Package Model
 * Stores data bundle packages with editable prices
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Package = sequelize.define('Package', {
    id: {
        type: DataTypes.STRING(50),
        primaryKey: true,
        allowNull: false,
        comment: 'Unique package identifier (e.g., mtn-5gb)'
    },
    network: {
        type: DataTypes.ENUM('MTN', 'AirtelTigo', 'Telecel'),
        allowNull: false,
        comment: 'Network provider'
    },
    name: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Display name (e.g., 5GB)'
    },
    data: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: 'Data amount (e.g., 5GB)'
    },
    validity: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'Non-Expiry',
        comment: 'Package validity period'
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Agent/default price in GH₵'
    },
    costPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Cost price for profit calculation'
    },
    superDealerPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Price for super-dealer role'
    },
    dealerPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Price for dealer role'
    },
    superAgentPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Price for super-agent role'
    },
    popular: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Mark as popular/featured package'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Whether package is available for purchase'
    },
    sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Display order within network'
    }
}, {
    tableName: 'packages',
    timestamps: true,
    indexes: [
        { fields: ['network'] },
        { fields: ['isActive'] },
        { fields: ['network', 'isActive'] },
        { fields: ['sortOrder'] }
    ]
});

/**
 * Get all active packages for a network
 */
Package.getByNetwork = async function(network) {
    return await this.findAll({
        where: { 
            network, 
            isActive: true 
        },
        order: [['sortOrder', 'ASC'], ['price', 'ASC']]
    });
};

/**
 * Get all packages (including inactive) for admin
 */
Package.getAllForAdmin = async function(network = null) {
    const where = network ? { network } : {};
    return await this.findAll({
        where,
        order: [['network', 'ASC'], ['sortOrder', 'ASC'], ['price', 'ASC']]
    });
};

/**
 * Seed default packages if table is empty
 * 
 * ⚠️ IMPORTANT: This is for INITIAL DATABASE SETUP ONLY
 * - Only runs when the Packages table is completely empty
 * - Prices here are initial defaults that admins MUST review and update
 * - After seeding, ALL prices should be managed via Admin Dashboard
 * - These values are NEVER used at runtime after initial seed
 * 
 * To update prices after deployment:
 * 1. Login to Admin Dashboard
 * 2. Go to Packages Management
 * 3. Edit individual package prices
 * 
 * DO NOT modify this file to change production prices!
 */
Package.seedDefaults = async function() {
    const count = await this.count();
    if (count > 0) return false; // Already seeded, do nothing

    console.log('⚠️  Seeding initial package data (one-time setup)...');
    console.log('    Prices are initial defaults - update via Admin Dashboard');

    const defaultPackages = [
        // MTN packages
        { id: 'mtn-1gb', network: 'MTN', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 4.00, sortOrder: 1 },
        { id: 'mtn-2gb', network: 'MTN', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 8.00, sortOrder: 2 },
        { id: 'mtn-3gb', network: 'MTN', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 11.00, sortOrder: 3 },
        { id: 'mtn-4gb', network: 'MTN', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 14.00, sortOrder: 4 },
        { id: 'mtn-5gb', network: 'MTN', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 18.00, popular: true, sortOrder: 5 },
        { id: 'mtn-6gb', network: 'MTN', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 21.00, sortOrder: 6 },
        { id: 'mtn-8gb', network: 'MTN', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 27.00, sortOrder: 7 },
        { id: 'mtn-10gb', network: 'MTN', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 32.00, popular: true, sortOrder: 8 },
        { id: 'mtn-15gb', network: 'MTN', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 48.00, sortOrder: 9 },
        { id: 'mtn-20gb', network: 'MTN', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 60.00, sortOrder: 10 },
        { id: 'mtn-25gb', network: 'MTN', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 75.00, sortOrder: 11 },
        { id: 'mtn-30gb', network: 'MTN', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 88.00, sortOrder: 12 },
        { id: 'mtn-40gb', network: 'MTN', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 110.00, sortOrder: 13 },
        { id: 'mtn-50gb', network: 'MTN', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 135.00, sortOrder: 14 },
        // AirtelTigo packages
        { id: 'at-1gb', network: 'AirtelTigo', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 3.50, sortOrder: 1 },
        { id: 'at-2gb', network: 'AirtelTigo', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 7.00, sortOrder: 2 },
        { id: 'at-3gb', network: 'AirtelTigo', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 10.00, sortOrder: 3 },
        { id: 'at-4gb', network: 'AirtelTigo', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 13.00, sortOrder: 4 },
        { id: 'at-5gb', network: 'AirtelTigo', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 16.00, popular: true, sortOrder: 5 },
        { id: 'at-6gb', network: 'AirtelTigo', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 19.00, sortOrder: 6 },
        { id: 'at-8gb', network: 'AirtelTigo', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 25.00, sortOrder: 7 },
        { id: 'at-10gb', network: 'AirtelTigo', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 30.00, popular: true, sortOrder: 8 },
        { id: 'at-15gb', network: 'AirtelTigo', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 45.00, sortOrder: 9 },
        { id: 'at-20gb', network: 'AirtelTigo', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 55.00, sortOrder: 10 },
        { id: 'at-25gb', network: 'AirtelTigo', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 70.00, sortOrder: 11 },
        { id: 'at-30gb', network: 'AirtelTigo', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 82.00, sortOrder: 12 },
        { id: 'at-40gb', network: 'AirtelTigo', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 105.00, sortOrder: 13 },
        { id: 'at-50gb', network: 'AirtelTigo', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 125.00, sortOrder: 14 },
        // Telecel packages
        { id: 'tc-1gb', network: 'Telecel', name: '1GB', data: '1GB', validity: 'Non-Expiry', price: 3.80, sortOrder: 1 },
        { id: 'tc-2gb', network: 'Telecel', name: '2GB', data: '2GB', validity: 'Non-Expiry', price: 7.50, sortOrder: 2 },
        { id: 'tc-3gb', network: 'Telecel', name: '3GB', data: '3GB', validity: 'Non-Expiry', price: 10.50, sortOrder: 3 },
        { id: 'tc-4gb', network: 'Telecel', name: '4GB', data: '4GB', validity: 'Non-Expiry', price: 13.50, sortOrder: 4 },
        { id: 'tc-5gb', network: 'Telecel', name: '5GB', data: '5GB', validity: 'Non-Expiry', price: 17.00, popular: true, sortOrder: 5 },
        { id: 'tc-6gb', network: 'Telecel', name: '6GB', data: '6GB', validity: 'Non-Expiry', price: 20.00, sortOrder: 6 },
        { id: 'tc-8gb', network: 'Telecel', name: '8GB', data: '8GB', validity: 'Non-Expiry', price: 26.00, sortOrder: 7 },
        { id: 'tc-10gb', network: 'Telecel', name: '10GB', data: '10GB', validity: 'Non-Expiry', price: 31.00, popular: true, sortOrder: 8 },
        { id: 'tc-15gb', network: 'Telecel', name: '15GB', data: '15GB', validity: 'Non-Expiry', price: 46.00, sortOrder: 9 },
        { id: 'tc-20gb', network: 'Telecel', name: '20GB', data: '20GB', validity: 'Non-Expiry', price: 58.00, sortOrder: 10 },
        { id: 'tc-25gb', network: 'Telecel', name: '25GB', data: '25GB', validity: 'Non-Expiry', price: 72.00, sortOrder: 11 },
        { id: 'tc-30gb', network: 'Telecel', name: '30GB', data: '30GB', validity: 'Non-Expiry', price: 85.00, sortOrder: 12 },
        { id: 'tc-40gb', network: 'Telecel', name: '40GB', data: '40GB', validity: 'Non-Expiry', price: 108.00, sortOrder: 13 },
        { id: 'tc-50gb', network: 'Telecel', name: '50GB', data: '50GB', validity: 'Non-Expiry', price: 130.00, sortOrder: 14 }
    ];

    await this.bulkCreate(defaultPackages);
    return true;
};

module.exports = Package;

/**
 * Migration: Add MoMo Deposits Table
 * Creates table for storing incoming MoMo SMS deposits
 * 
 * Run: node backend/migrations/add-momo-deposits.js
 */

const { sequelize } = require('../config/database');
const { DataTypes, QueryInterface } = require('sequelize');

async function up() {
    const queryInterface = sequelize.getQueryInterface();
    
    console.log('Creating momo_deposits table...');
    
    await queryInterface.createTable('momo_deposits', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        transactionId: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
            field: 'transactionId'
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        senderPhone: {
            type: DataTypes.STRING(20),
            allowNull: false,
            field: 'senderPhone'
        },
        reference: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        rawMessage: {
            type: DataTypes.TEXT,
            allowNull: true,
            field: 'rawMessage'
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
            field: 'userId'
        },
        status: {
            type: DataTypes.STRING(20),
            defaultValue: 'pending'
        },
        statusMessage: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: 'statusMessage'
        },
        walletTransactionId: {
            type: DataTypes.UUID,
            allowNull: true,
            field: 'walletTransactionId'
        },
        smsReceivedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: 'smsReceivedAt'
        },
        deviceInfo: {
            type: DataTypes.JSONB,
            defaultValue: {},
            field: 'deviceInfo'
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    });
    
    // Add indexes
    console.log('Adding indexes...');
    
    await queryInterface.addIndex('momo_deposits', ['transactionId'], {
        unique: true,
        name: 'momo_deposits_transaction_id_unique'
    });
    
    await queryInterface.addIndex('momo_deposits', ['userId'], {
        name: 'momo_deposits_user_id'
    });
    
    await queryInterface.addIndex('momo_deposits', ['status'], {
        name: 'momo_deposits_status'
    });
    
    await queryInterface.addIndex('momo_deposits', ['reference'], {
        name: 'momo_deposits_reference'
    });
    
    await queryInterface.addIndex('momo_deposits', ['createdAt'], {
        name: 'momo_deposits_created_at'
    });
    
    console.log('✅ momo_deposits table created successfully!');
}

async function down() {
    const queryInterface = sequelize.getQueryInterface();
    
    console.log('Dropping momo_deposits table...');
    await queryInterface.dropTable('momo_deposits');
    console.log('✅ momo_deposits table dropped');
}

// Run migration
async function run() {
    try {
        await sequelize.authenticate();
        console.log('Database connected');
        
        const args = process.argv.slice(2);
        
        if (args.includes('--down')) {
            await down();
        } else {
            await up();
        }
        
        console.log('Migration completed');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

run();

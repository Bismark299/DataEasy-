/**
 * Migration Script: Add agentCode to existing users
 * Run: node scripts/add-agent-code.js
 */

require('dotenv').config();
const { sequelize } = require('../config/database');
const User = require('../models/User');

async function migrate() {
    try {
        console.log('🚀 Starting agent code migration...');
        
        // Connect to database
        await sequelize.authenticate();
        console.log('✅ Database connected');

        // Add agentCode column if it doesn't exist
        const queryInterface = sequelize.getQueryInterface();
        const tableDescription = await queryInterface.describeTable('users');
        
        if (!tableDescription.agentCode) {
            console.log('📝 Adding agentCode column...');
            await queryInterface.addColumn('users', 'agentCode', {
                type: require('sequelize').DataTypes.STRING(20),
                allowNull: true,
                unique: true
            });
            console.log('✅ agentCode column added');
        } else {
            console.log('ℹ️ agentCode column already exists');
        }

        // Get all users without agentCode, ordered by creation date
        const usersWithoutCode = await User.findAll({
            where: { agentCode: null },
            order: [['createdAt', 'ASC']]
        });

        if (usersWithoutCode.length === 0) {
            console.log('✅ All users already have agent codes');
            return;
        }

        console.log(`📋 Found ${usersWithoutCode.length} users without agent codes`);

        // Get the highest existing agent code number
        const lastUserWithCode = await User.findOne({
            where: { agentCode: { [require('sequelize').Op.ne]: null } },
            order: [['agentCode', 'DESC']]
        });

        let nextNumber = 1;
        if (lastUserWithCode && lastUserWithCode.agentCode) {
            const match = lastUserWithCode.agentCode.match(/BT-(\d+)/);
            if (match) {
                nextNumber = parseInt(match[1]) + 1;
            }
        }

        // Assign agent codes to users
        for (const user of usersWithoutCode) {
            const agentCode = `BT-${String(nextNumber).padStart(4, '0')}`;
            await User.update(
                { agentCode },
                { where: { id: user.id }, hooks: false }
            );
            console.log(`  ✅ ${user.fullName || user.email} → ${agentCode}`);
            nextNumber++;
        }

        console.log('\n🎉 Migration completed successfully!');
        console.log(`   Total users updated: ${usersWithoutCode.length}`);
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
    } finally {
        await sequelize.close();
        process.exit(0);
    }
}

migrate();

/**
 * Script to update existing users with old agent codes (like BT-0001, BT-0002)
 * to new random format (BT-1234 where number is between 1110-9999)
 */

require('dotenv').config();
const { User } = require('../models');

async function generateUniqueAgentCode() {
    let agentCode;
    let isUnique = false;
    
    while (!isUnique) {
        // Generate 4-digit number where first 3 digits are non-zero (111-999) + last digit (0-9)
        const first3Digits = Math.floor(111 + Math.random() * 889); // 111 to 999
        const lastDigit = Math.floor(Math.random() * 10); // 0 to 9
        const randomNum = first3Digits * 10 + lastDigit; // e.g., 1234, 5678, etc.
        agentCode = `BT-${randomNum}`;
        
        // Check if this code already exists
        const existing = await User.findOne({
            where: { agentCode: agentCode }
        });
        
        if (!existing) {
            isUnique = true;
        }
    }
    
    return agentCode;
}

async function fixAgentCodes() {
    try {
        console.log('🔧 Fixing agent codes...\n');
        
        // Find all users with old-format agent codes (BT-0001, BT-0002, etc. - numbers less than 1000)
        const users = await User.findAll();
        
        let updated = 0;
        
        for (const user of users) {
            if (user.agentCode) {
                // Extract the number part
                const match = user.agentCode.match(/BT-(\d+)/);
                if (match) {
                    const num = parseInt(match[1]);
                    // If number is less than 1110 (old format), update it
                    if (num < 1110) {
                        const newCode = await generateUniqueAgentCode();
                        console.log(`  Updating ${user.email}: ${user.agentCode} → ${newCode}`);
                        
                        await User.update(
                            { agentCode: newCode },
                            { where: { id: user.id }, hooks: false }
                        );
                        updated++;
                    }
                }
            } else {
                // User has no agent code, generate one
                const newCode = await generateUniqueAgentCode();
                console.log(`  Adding code for ${user.email}: ${newCode}`);
                
                await User.update(
                    { agentCode: newCode },
                    { where: { id: user.id }, hooks: false }
                );
                updated++;
            }
        }
        
        console.log(`\n✅ Updated ${updated} user(s) with new agent codes`);
        
        // Show all users with their codes
        console.log('\n📋 Current agent codes:');
        const updatedUsers = await User.findAll({ attributes: ['email', 'agentCode'] });
        updatedUsers.forEach(u => {
            console.log(`  ${u.email}: ${u.agentCode}`);
        });
        
    } catch (error) {
        console.error('❌ Error fixing agent codes:', error);
    }
}

fixAgentCodes().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});

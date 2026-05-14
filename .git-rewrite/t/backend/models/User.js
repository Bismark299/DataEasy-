/**
 * User Model
 * PostgreSQL Schema with Sequelize
 */

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    agentCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: true,
        comment: 'Agent ID starting with BT- followed by 4-digit number'
    },
    fullName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            len: {
                args: [2, 100],
                msg: 'Name must be between 2 and 100 characters'
            }
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: {
                msg: 'Please enter a valid email'
            }
        },
        set(value) {
            this.setDataValue('email', value.toLowerCase().trim());
        }
    },
    phone: {
        type: DataTypes.STRING(15),
        allowNull: false,
        unique: true,
        validate: {
            is: {
                args: /^0[235]\d{8}$/,
                msg: 'Please enter a valid Ghana phone number'
            }
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: {
                args: [6, 255],
                msg: 'Password must be at least 6 characters'
            }
        }
    },
    avatar: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    isVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    role: {
        type: DataTypes.STRING(20),
        defaultValue: 'agent',
        allowNull: true,
        validate: {
            isIn: {
                args: [['super-dealer', 'dealer', 'super-agent', 'agent']],
                msg: 'Role must be one of: super-dealer, dealer, super-agent, agent'
            }
        },
        comment: 'User role: super-dealer, dealer, super-agent, agent'
    },
    settings: {
        type: DataTypes.JSONB,
        defaultValue: {
            twoFactorEnabled: false,
            emailNotifications: true,
            smsNotifications: true
        }
    },
    lastLogin: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    },
    tokenVersion: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Incremented on password change to invalidate existing tokens'
    },
    failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
    }
}, {
    tableName: 'users',
    timestamps: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 12);
                user.password = await bcrypt.hash(user.password, salt);
            }
            // Generate agent code BT- with random 4-digit number (first 3 digits non-zero)
            if (!user.agentCode) {
                let agentCode;
                let isUnique = false;
                const { Op } = require('sequelize');
                
                // Keep generating until we get a unique code
                while (!isUnique) {
                    // Generate 4-digit number where first 3 digits are non-zero (111-999) + last digit (0-9)
                    const first3Digits = Math.floor(111 + Math.random() * 889); // 111 to 999
                    const lastDigit = Math.floor(Math.random() * 10); // 0 to 9
                    const randomNum = first3Digits * 10 + lastDigit; // e.g., 1234, 5678, etc.
                    agentCode = `BT-${randomNum}`;
                    
                    // Check if this code already exists using sequelize.models to avoid circular reference
                    const existing = await sequelize.models.User.findOne({
                        where: { agentCode: agentCode }
                    });
                    
                    if (!existing) {
                        isUnique = true;
                    }
                }
                user.agentCode = agentCode;
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(user.password, salt);
            }
        }
    }
});

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toSafeObject = function() {
    const obj = this.toJSON();
    delete obj.password;
    return obj;
};

module.exports = User;

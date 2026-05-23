/**
 * LookupUser Model
 * Dedicated accounts for the HSTN Lookup page only.
 * Completely separate from main app users.
 */

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

const LookupUser = sequelize.define('LookupUser', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    username: {
        type: DataTypes.STRING(60),
        allowNull: false,
        unique: true,
        validate: {
            len: { args: [3, 60], msg: 'Username must be 3–60 characters' },
            is: { args: /^[a-zA-Z0-9_.-]+$/, msg: 'Username may only contain letters, numbers, _ . -' }
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
}, {
    tableName: 'lookup_users',
    timestamps: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                const salt = await bcrypt.genSalt(12);
                user.password = await bcrypt.hash(user.password, salt);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                const salt = await bcrypt.genSalt(12);
                user.password = await bcrypt.hash(user.password, salt);
            }
        }
    }
});

LookupUser.prototype.comparePassword = async function(candidate) {
    return bcrypt.compare(candidate, this.password);
};

module.exports = LookupUser;

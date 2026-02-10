const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Setting = sequelize.define('Setting', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        key: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        value: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        type: {
            type: DataTypes.ENUM('string', 'number', 'boolean', 'json'),
            defaultValue: 'string'
        },
        description: {
            type: DataTypes.STRING,
            allowNull: true
        }
    }, {
        tableName: 'settings',
        timestamps: true
    });

    // Helper methods
    Setting.getValue = async function(key, defaultValue = null) {
        const setting = await this.findOne({ where: { key } });
        if (!setting) return defaultValue;
        
        switch (setting.type) {
            case 'boolean':
                return setting.value === 'true';
            case 'number':
                return parseFloat(setting.value);
            case 'json':
                try {
                    return JSON.parse(setting.value);
                } catch {
                    return defaultValue;
                }
            default:
                return setting.value;
        }
    };

    Setting.setValue = async function(key, value, type = 'string', description = null) {
        let stringValue = value;
        if (type === 'boolean') {
            stringValue = value ? 'true' : 'false';
        } else if (type === 'json') {
            stringValue = JSON.stringify(value);
        } else if (type === 'number') {
            stringValue = String(value);
        }

        const [setting, created] = await this.findOrCreate({
            where: { key },
            defaults: { value: stringValue, type, description }
        });

        if (!created) {
            setting.value = stringValue;
            setting.type = type;
            if (description) setting.description = description;
            await setting.save();
        }

        return setting;
    };

    // Get all MCBIS settings at once
    Setting.getMcbisSettings = async function() {
        const defaults = {
            mcbisEnabled: false,
            mcbis_mtnAPI: true,
            mcbis_telecelAPI: true,
            mcbis_airteltigoAPI: true,  // Uses atishare in MCBIS DataHub
            mcbisAutoSync: true,
            mcbisApiUrl: 'https://datahub.mcbissolution.com/api/v1'
        };

        const settings = {};
        for (const [key, defaultValue] of Object.entries(defaults)) {
            settings[key] = await this.getValue(key, defaultValue);
        }
        return settings;
    };

    // Get network availability settings
    Setting.getNetworkAvailability = async function() {
        const defaults = {
            network_mtn_available: true,
            network_telecel_available: true,
            network_airteltigo_available: true
        };

        const settings = {};
        for (const [key, defaultValue] of Object.entries(defaults)) {
            settings[key] = await this.getValue(key, defaultValue);
        }
        return {
            MTN: settings.network_mtn_available,
            Telecel: settings.network_telecel_available,
            AirtelTigo: settings.network_airteltigo_available
        };
    };

    // Check if a specific network is available
    Setting.isNetworkAvailable = async function(network) {
        const networkLower = network.toLowerCase();
        let settingKey;
        
        if (networkLower === 'mtn') {
            settingKey = 'network_mtn_available';
        } else if (networkLower === 'telecel') {
            settingKey = 'network_telecel_available';
        } else if (networkLower === 'airteltigo' || networkLower === 'at') {
            settingKey = 'network_airteltigo_available';
        } else {
            return true; // Unknown networks default to available
        }

        return await this.getValue(settingKey, true);
    };

    // Check if order should be sent to MCBIS
    Setting.shouldDeliverViaMcbis = async function(network) {
        const mcbisEnabled = await this.getValue('mcbisEnabled', false);
        if (!mcbisEnabled) return false;

        // Map network to setting key (mcbis_<network>API pattern)
        const networkLower = network.toLowerCase();
        let toggleKey;
        
        if (networkLower === 'mtn') {
            toggleKey = 'mcbis_mtnAPI';
        } else if (networkLower === 'telecel') {
            toggleKey = 'mcbis_telecelAPI';
        } else if (networkLower === 'airteltigo' || networkLower === 'at') {
            toggleKey = 'mcbis_airteltigoAPI';  // Uses atishare in MCBIS DataHub
        } else {
            return false;
        }

        return await this.getValue(toggleKey, false);
    };

    // Get wallet topup fee settings
    Setting.getTopupFeeSettings = async function() {
        return {
            // Fee percentage charged to user (default 2% to cover Paystack)
            feePercentage: await this.getValue('topup_fee_percentage', 2),
            // Minimum fee in GHS
            minimumFee: await this.getValue('topup_minimum_fee', 0),
            // Whether fees are enabled
            feesEnabled: await this.getValue('topup_fees_enabled', true)
        };
    };

    // Get general app settings
    Setting.getAppSettings = async function() {
        return {
            appName: await this.getValue('app_name', 'DataEasy+'),
            supportEmail: await this.getValue('support_email', 'support@dataeasyplus.com'),
            supportPhone: await this.getValue('support_phone', '+233 20 000 0000'),
            maintenanceMode: await this.getValue('maintenance_mode', false),
            sendClaimVisible: await this.getValue('send_claim_visible', true) // Show Send & Claim section on client
        };
    };

    // Get client UI settings (for public API)
    Setting.getClientUISettings = async function() {
        return {
            sendClaimVisible: await this.getValue('send_claim_visible', true)
        };
    };

    // Check if maintenance mode is enabled
    Setting.isMaintenanceMode = async function() {
        return await this.getValue('maintenance_mode', false);
    };

    // Get deposit limit settings
    Setting.getDepositLimits = async function() {
        return {
            minDeposit: await this.getValue('min_deposit', 1),
            maxDeposit: await this.getValue('max_deposit', 5000)
        };
    };

    // Get security settings
    Setting.getSecuritySettings = async function() {
        return {
            maxLoginAttempts: await this.getValue('max_login_attempts', 5),
            lockoutMinutes: await this.getValue('lockout_minutes', 15),
            sessionTimeoutHours: await this.getValue('session_timeout_hours', 24)
        };
    };

    // Calculate topup fee for a given amount
    Setting.calculateTopupFee = async function(baseAmount) {
        const settings = await this.getTopupFeeSettings();
        
        if (!settings.feesEnabled) {
            return {
                baseAmount: baseAmount,
                feeAmount: 0,
                feePercentage: 0,
                totalAmount: baseAmount
            };
        }

        // Calculate fee
        let feeAmount = (baseAmount * settings.feePercentage) / 100;
        
        // Apply minimum fee if set
        if (settings.minimumFee > 0 && feeAmount < settings.minimumFee) {
            feeAmount = settings.minimumFee;
        }

        // Round to 2 decimal places
        feeAmount = Math.round(feeAmount * 100) / 100;
        const totalAmount = Math.round((baseAmount + feeAmount) * 100) / 100;

        return {
            baseAmount: baseAmount,
            feeAmount: feeAmount,
            feePercentage: settings.feePercentage,
            totalAmount: totalAmount
        };
    };

    return Setting;
};

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
    /**
     * Batch-fetch multiple settings in a single SQL query.
     * @param {Object} keysWithDefaults - { key: defaultValue }
     * @returns {Object} - { key: resolvedValue }
     */
    Setting.getMultiple = async function(keysWithDefaults) {
        const keys = Object.keys(keysWithDefaults);
        const rows = await this.findAll({ where: { key: keys } });

        // Build a lookup map from DB rows
        const rowMap = {};
        rows.forEach(row => { rowMap[row.key] = row; });

        // Resolve each key with type conversion and fallback to default
        const result = {};
        for (const [key, defaultValue] of Object.entries(keysWithDefaults)) {
            const row = rowMap[key];
            if (!row) {
                result[key] = defaultValue;
                continue;
            }
            switch (row.type) {
                case 'boolean':
                    result[key] = row.value === 'true';
                    break;
                case 'number':
                    result[key] = parseFloat(row.value);
                    break;
                case 'json':
                    try { result[key] = JSON.parse(row.value); } catch { result[key] = defaultValue; }
                    break;
                default:
                    result[key] = row.value;
            }
        }
        return result;
    };

    Setting.getMcbisSettings = async function() {
        return await this.getMultiple({
            mcbisEnabled: false,
            mcbis_mtnAPI: true,
            mcbis_telecelAPI: true,
            mcbis_airteltigoAPI: true,
            mcbisAutoSync: true,
            mcbisApiUrl: 'https://datahub.mcbissolution.com/api/v1'
        });
    };

    // Get network availability settings
    Setting.getNetworkAvailability = async function() {
        const s = await this.getMultiple({
            network_mtn_available: true,
            network_telecel_available: true,
            network_airteltigo_available: true
        });
        return {
            MTN: s.network_mtn_available,
            Telecel: s.network_telecel_available,
            AirtelTigo: s.network_airteltigo_available
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
        const s = await this.getMultiple({
            topup_fee_percentage: 2,
            topup_minimum_fee: 0,
            topup_fees_enabled: true
        });
        return {
            feePercentage: s.topup_fee_percentage,
            minimumFee: s.topup_minimum_fee,
            feesEnabled: s.topup_fees_enabled
        };
    };

    // Get general app settings
    Setting.getAppSettings = async function() {
        const s = await this.getMultiple({
            app_name: 'DataEasy+',
            support_email: 'support@dataeasyplus.com',
            support_phone: '+233 20 000 0000',
            maintenance_mode: false,
            send_claim_visible: true,
            store_visible: true,
            momo_details_visible: true,
            momo_enabled: true,
            momo_number: '0555546229',
            momo_name: 'Bismark Kwame Oteng'
        });
        return {
            appName: s.app_name,
            supportEmail: s.support_email,
            supportPhone: s.support_phone,
            maintenanceMode: s.maintenance_mode,
            sendClaimVisible: s.send_claim_visible,
            storeVisible: s.store_visible,
            momoDetailsVisible: s.momo_details_visible,
            momoEnabled: s.momo_enabled,
            momoNumber: s.momo_number,
            momoName: s.momo_name
        };
    };

    // Get client UI settings (for public API)
    Setting.getClientUISettings = async function() {
        const s = await this.getMultiple({
            send_claim_visible: true,
            store_visible: true,
            momo_details_visible: true,
            momo_enabled: true,
            momo_number: '0555546229',
            momo_name: 'Bismark Kwame Oteng'
        });
        return {
            sendClaimVisible: s.send_claim_visible,
            storeVisible: s.store_visible,
            momoDetailsVisible: s.momo_details_visible,
            momoEnabled: s.momo_enabled,
            momoNumber: s.momo_number,
            momoName: s.momo_name
        };
    };

    // Check if maintenance mode is enabled
    Setting.isMaintenanceMode = async function() {
        return await this.getValue('maintenance_mode', false);
    };

    // Get deposit limit settings
    Setting.getDepositLimits = async function() {
        const s = await this.getMultiple({ min_deposit: 5 });
        return { minDeposit: s.min_deposit };
    };

    // Get security settings
    Setting.getSecuritySettings = async function() {
        const s = await this.getMultiple({
            max_login_attempts: 5,
            lockout_minutes: 15,
            session_timeout_hours: 24
        });
        return {
            maxLoginAttempts: s.max_login_attempts,
            lockoutMinutes: s.lockout_minutes,
            sessionTimeoutHours: s.session_timeout_hours
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

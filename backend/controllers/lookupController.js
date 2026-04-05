/**
 * Lookup Controller
 * Proxies requests to the HST LOOKUP API
 */

const axios = require('axios');
const logger = require('../utils/logger');

const LOOKUP_BASE_URL = process.env.LOOKUP_BASE_URL || 'https://4e9af2d5e8c2.hstonline.tech';
const LOOKUP_API_KEY = process.env.LOOKUP_API_KEY;

/**
 * Convert phone number to 233 format
 */
function formatMsisdn(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) {
        return '233' + digits.slice(1);
    }
    if (digits.length === 9) {
        return '233' + digits;
    }
    return digits;
}

/**
 * Convert 233 format back to local
 */
function toLocal(msisdn) {
    if (msisdn && msisdn.startsWith('233') && msisdn.length === 12) {
        return '0' + msisdn.slice(3);
    }
    return msisdn;
}

/**
 * Single phone lookup
 * POST /api/lookup/search
 */
exports.search = async (req, res) => {
    try {
        const { phone, dataGb } = req.body;

        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }

        const msisdn = formatMsisdn(phone.trim());
        const params = { msisdn, page: 1, per_page: 50 };
        if (dataGb) params.gb = parseFloat(dataGb);

        const response = await axios.get(`${LOOKUP_BASE_URL}/allocations/lookup`, {
            headers: { 'X-API-Key': LOOKUP_API_KEY },
            params,
            timeout: 15000
        });

        const data = response.data;
        // Convert msisdn back to local format in results
        if (data.data && Array.isArray(data.data)) {
            data.data = data.data.map(r => ({ ...r, msisdn_local: toLocal(r.msisdn) }));
        }

        res.json({ success: true, data: data.data || [], pagination: data.pagination || {} });
    } catch (error) {
        logger.error('Lookup search error', { error: error.message });
        const msg = error.response?.data?.error || error.response?.data?.message || error.message;
        res.status(error.response?.status || 500).json({ success: false, error: msg });
    }
};

/**
 * Bulk phone lookup
 * POST /api/lookup/bulk-search
 */
exports.bulkSearch = async (req, res) => {
    try {
        const { phones, dataGb } = req.body;

        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, error: 'Phone numbers array is required' });
        }

        // Normalize: phones can be strings or {phone, gb} objects
        const entries = phones.map(p => {
            if (typeof p === 'object' && p.phone) {
                return { phone: p.phone.toString().trim(), gb: p.gb ? parseFloat(p.gb) : null };
            }
            return { phone: p.toString().trim(), gb: null };
        }).filter(e => e.phone);

        // Deduplicate by phone
        const seen = new Set();
        const uniqueEntries = entries.filter(e => {
            if (seen.has(e.phone)) return false;
            seen.add(e.phone);
            return true;
        });

        const results = [];
        const batchSize = 5;

        for (let i = 0; i < uniqueEntries.length; i += batchSize) {
            const batch = uniqueEntries.slice(i, i + batchSize);
            const batchPromises = batch.map(async (entry) => {
                const phone = entry.phone;
                const msisdn = formatMsisdn(phone);
                const params = { msisdn, page: 1, per_page: 50 };
                const gb = entry.gb || (dataGb ? parseFloat(dataGb) : null);
                if (gb) params.gb = gb;

                try {
                    const response = await axios.get(`${LOOKUP_BASE_URL}/allocations/lookup`, {
                        headers: { 'X-API-Key': LOOKUP_API_KEY },
                        params,
                        timeout: 15000
                    });

                    const records = response.data.data || [];
                    return {
                        phone,
                        msisdn,
                        success: true,
                        records: records.map(r => ({ ...r, msisdn_local: toLocal(r.msisdn) })),
                        total: response.data.pagination?.total || records.length
                    };
                } catch (err) {
                    return {
                        phone,
                        msisdn,
                        success: false,
                        error: err.response?.data?.error || err.message,
                        records: [],
                        total: 0
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        res.json({ success: true, results });
    } catch (error) {
        logger.error('Lookup bulk search error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Download export CSV file
 * POST /api/lookup/export-download
 */
exports.exportDownload = async (req, res) => {
    try {
        const { path: rawPath } = req.body;
        if (!rawPath || typeof rawPath !== 'string') {
            return res.status(400).json({ success: false, error: 'File path is required' });
        }

        // The URL may be "/exports/download?path=/data/..." — extract the actual path
        let filePath = rawPath;
        if (rawPath.includes('?path=')) {
            filePath = decodeURIComponent(rawPath.split('?path=')[1]);
        }

        const response = await axios.get(`${LOOKUP_BASE_URL}/exports/download`, {
            headers: { 'X-API-Key': LOOKUP_API_KEY },
            params: { path: filePath },
            timeout: 30000,
            responseType: 'text'
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
        res.send(response.data);
    } catch (error) {
        logger.error('Export download error', { error: error.message });
        const msg = error.response?.data?.error || error.message;
        res.status(error.response?.status || 500).json({ success: false, error: msg });
    }
};

/**
 * Get system health status
 * GET /api/lookup/health
 */
exports.health = async (req, res) => {
    try {
        const response = await axios.get(`${LOOKUP_BASE_URL}/health`, {
            headers: { 'X-API-Key': LOOKUP_API_KEY },
            timeout: 10000
        });
        res.json({ success: true, health: response.data });
    } catch (error) {
        logger.error('Health check error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
};

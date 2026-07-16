/**
 * Lookup Controller
 * Proxies requests to the HST LOOKUP API.
 * Auth: single shared password stored in LOOKUP_PASSWORD env var.
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const LOOKUP_BASE_URL = process.env.LOOKUP_BASE_URL || 'https://4e9af2d5e8c2.hstonline.tech';
const LOOKUP_API_KEY  = process.env.LOOKUP_API_KEY;

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/lookup/login
 * Body: { password }
 * Returns a 30-day JWT when the password matches LOOKUP_PASSWORD.
 */
exports.login = (req, res) => {
    const { password } = req.body || {};
    const expected = process.env.LOOKUP_PASSWORD;

    if (!expected) {
        return res.status(503).json({ success: false, error: 'Lookup access not configured on this server.' });
    }
    if (!password || password !== expected) {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
    }

    const token = jwt.sign(
        { type: 'lookup', v: 2 },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
    res.json({ success: true, token });
};

/**
 * Middleware — protect lookup API routes
 */
exports.verifyLookupToken = (req, res, next) => {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Login required' });
        }
        const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
        if (decoded.type !== 'lookup' || decoded.v !== 2) {
            return res.status(401).json({ success: false, error: 'Session expired — please log in again' });
        }
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Session expired — please log in again' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────

function formatMsisdn(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return '233' + digits.slice(1);
    if (digits.length === 9) return '233' + digits;
    return digits;
}

function toLocal(msisdn) {
    if (msisdn && msisdn.startsWith('233') && msisdn.length === 12) return '0' + msisdn.slice(3);
    return msisdn;
}

/**
 * Single phone lookup
 * POST /api/lookup/search
 */
exports.search = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }

        const msisdn  = formatMsisdn(phone.trim());
        const params  = { msisdn, page: 1, per_page: 50 };
        const headers = { 'X-API-Key': LOOKUP_API_KEY };

        const [allocRes, failRes] = await Promise.allSettled([
            axios.get(`${LOOKUP_BASE_URL}/allocations`, { headers, params, timeout: 15000 }),
            axios.get(`${LOOKUP_BASE_URL}/failures`,    { headers, params, timeout: 15000 })
        ]);

        // If BOTH upstream requests failed, surface the real error instead of
        // silently returning zero results (e.g. "user account is inactive").
        if (allocRes.status === 'rejected' && failRes.status === 'rejected') {
            const upErr = allocRes.reason;
            const msg = upErr.response?.data?.error || upErr.response?.data?.message || upErr.message;
            return res.status(upErr.response?.status || 502).json({ success: false, error: 'Lookup provider error: ' + msg });
        }

        const allocations = (allocRes.status === 'fulfilled' ? allocRes.value.data.data : []) || [];
        const failures    = (failRes.status  === 'fulfilled' ? failRes.value.data.data  : []) || [];

        const taggedAlloc = allocations.map(r => ({ ...r, status: 'success', msisdn_local: toLocal(r.msisdn) }));
        const taggedFail  = failures.map(r    => ({ ...r, status: 'failed',  msisdn_local: toLocal(r.msisdn) }));

        const totalAlloc = allocRes.status === 'fulfilled' ? (allocRes.value.data.pagination?.total || allocations.length) : 0;
        const totalFail  = failRes.status  === 'fulfilled' ? (failRes.value.data.pagination?.total  || failures.length)    : 0;

        res.json({
            success: true,
            msisdn,
            data: [...taggedAlloc, ...taggedFail],
            pagination: { total: totalAlloc + totalFail, allocations: totalAlloc, failures: totalFail }
        });
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
        const { phones } = req.body;
        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, error: 'Phone numbers array is required' });
        }

        const entries = phones.map(p => ({
            phone: (typeof p === 'object' && p.phone ? p.phone : p).toString().trim()
        })).filter(e => e.phone);

        const seen = new Set();
        const uniqueEntries = entries.filter(e => {
            if (seen.has(e.phone)) return false;
            seen.add(e.phone);
            return true;
        });

        const results   = [];
        const batchSize = 10;

        for (let i = 0; i < uniqueEntries.length; i += batchSize) {
            const batch = uniqueEntries.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(async ({ phone }) => {
                const msisdn  = formatMsisdn(phone);
                const params  = { msisdn, page: 1, per_page: 50 };
                const headers = { 'X-API-Key': LOOKUP_API_KEY };
                try {
                    const [allocRes, failRes] = await Promise.allSettled([
                        axios.get(`${LOOKUP_BASE_URL}/allocations`, { headers, params, timeout: 15000 }),
                        axios.get(`${LOOKUP_BASE_URL}/failures`,    { headers, params, timeout: 15000 })
                    ]);
                    if (allocRes.status === 'rejected' && failRes.status === 'rejected') {
                        const upErr = allocRes.reason;
                        const msg = upErr.response?.data?.error || upErr.response?.data?.message || upErr.message;
                        return { phone, msisdn, success: false, error: 'Lookup provider error: ' + msg, records: [], total: 0 };
                    }
                    const allocations = (allocRes.status === 'fulfilled' ? allocRes.value.data.data : []) || [];
                    const failures    = (failRes.status  === 'fulfilled' ? failRes.value.data.data  : []) || [];
                    const taggedAlloc = allocations.map(r => ({ ...r, status: 'success', msisdn_local: toLocal(r.msisdn) }));
                    const taggedFail  = failures.map(r    => ({ ...r, status: 'failed',  msisdn_local: toLocal(r.msisdn) }));
                    const totalAlloc  = allocRes.status === 'fulfilled' ? (allocRes.value.data.pagination?.total || allocations.length) : 0;
                    const totalFail   = failRes.status  === 'fulfilled' ? (failRes.value.data.pagination?.total  || failures.length)    : 0;
                    return { phone, msisdn, success: true, records: [...taggedAlloc, ...taggedFail], total: totalAlloc + totalFail };
                } catch (err) {
                    return { phone, msisdn, success: false, error: err.response?.data?.error || err.message, records: [], total: 0 };
                }
            }));
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

        let filePath = rawPath;
        if (rawPath.includes('?path=')) filePath = decodeURIComponent(rawPath.split('?path=')[1]);

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

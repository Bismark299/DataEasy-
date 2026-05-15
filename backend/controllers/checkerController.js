/**
 * MTN Order Status Checker Controller
 * Authenticates against checker.instantdatagh.com using CHECKER_USERNAME /
 * CHECKER_PASSWORD env vars and proxies single / bulk check requests.
 *
 * Single : GET  /index.php?search=PHONE  -> parse HTML table
 * Bulk   : POST /index.php  ajax_bulk_line=LINE&default_date=DMY -> JSON {status}
 */

const axios = require('axios');
const logger = require('../utils/logger');

const CHECKER_URL  = (process.env.CHECKER_SITE_URL || 'https://checker.instantdatagh.com').replace(/\/$/, '');
const CHECKER_USER = process.env.CHECKER_USERNAME;
const CHECKER_PASS = process.env.CHECKER_PASSWORD;

// Cached session cookie - refreshed every 20 minutes or on session expiry
let _sessionCookie = null;
let _sessionExpiry = 0;

/** Login and cache the PHP session cookie. */
async function getSession(force) {
    const now = Date.now();
    if (!force && _sessionCookie && now < _sessionExpiry) return _sessionCookie;

    if (!CHECKER_USER || !CHECKER_PASS) {
        throw new Error('CHECKER_USERNAME / CHECKER_PASSWORD env vars are not set');
    }

    const body = new URLSearchParams();
    body.append('username', CHECKER_USER);
    body.append('password', CHECKER_PASS);

    const res = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 5,
        timeout: 15000,
        validateStatus: () => true,
    });

    const setCookieHeader = res.headers['set-cookie'];
    if (!setCookieHeader || setCookieHeader.length === 0) {
        throw new Error('Checker login failed: no session cookie returned. Check credentials.');
    }

    _sessionCookie = setCookieHeader.map(c => c.split(';')[0]).join('; ');
    _sessionExpiry = Date.now() + 20 * 60 * 1000;
    return _sessionCookie;
}

/** Convert "DD/MM/YYYY ..." to "YYYY-MM-DD" */
function parseSiteDate(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

/** Today as "DD/MM/YYYY" for the site default_date field */
function todayDMY() {
    const d = new Date();
    return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}

/**
 * Fetch full order history for a phone by parsing the HTML results table.
 * Retries once after re-login if the session has expired.
 */
async function fetchSingleOrders(phone, dateFrom, dateTo, retry) {
    if (retry === undefined) retry = true;
    const cookie = await getSession();
    const res = await axios.get(CHECKER_URL + '/index.php', {
        params: { search: phone },
        headers: { Cookie: cookie },
        timeout: 25000,
    });

    const html = typeof res.data === 'string' ? res.data : '';

    // Detect the actual login page by the presence of the username input field.
    // NOTE: do NOT match 'login-container' — that string appears in the <style>
    // block on EVERY page (including results pages), causing false positives.
    if (html.includes('name="username"') || html.includes("name='username'")) {
        if (retry) {
            await getSession(true);
            return fetchSingleOrders(phone, dateFrom, dateTo, false);
        }
        throw new Error('Checker session expired and re-login failed');
    }

    const rows = [];
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return rows;

    const tbody = tbodyMatch[1];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tbody)) !== null) {
        const cells = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;
        while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
            cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
        }
        if (cells.length < 7) continue;

        const msisdn  = cells[0] || '';
        const name    = cells[1] || null;
        const voice_m = parseFloat(cells[2]) || null;
        const data_mb = parseFloat(cells[3]) || null;
        const sms     = parseFloat(cells[4]) || null;
        const rawStat = (cells[5] || '').toLowerCase().trim();
        const isoDate = parseSiteDate(cells[6] || '');

        if (!msisdn || msisdn.toLowerCase() === 'no data found') continue;

        if (isoDate) {
            if (dateFrom && isoDate < dateFrom) continue;
            if (dateTo   && isoDate > dateTo)   continue;
        }

        let status = rawStat;
        if (rawStat === 'successful') status = 'delivered';

        const mb = data_mb || voice_m;
        const gb = mb ? parseFloat((mb / 1024).toFixed(2)) : null;

        rows.push({ date: isoDate, phone, name, gb, sms_units: sms || null, status, failed_reason: null });
    }

    return rows;
}

/**
 * Check a single line via the site AJAX endpoint.
 * Returns the JSON object from the site: { status, message? }
 */
async function checkBulkLine(line, defaultDate, retry) {
    if (retry === undefined) retry = true;
    const cookie = await getSession();
    const body = new URLSearchParams();
    body.append('ajax_bulk_line', line);
    if (defaultDate) body.append('default_date', defaultDate);

    const res = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookie,
        },
        timeout: 40000,
        validateStatus: () => true,
    });

    if (typeof res.data === 'string' && (res.data.includes('name="username"') || res.data.includes("name='username'"))) {
        if (retry) {
            await getSession(true);
            return checkBulkLine(line, defaultDate, false);
        }
        throw new Error('Session expired');
    }

    return res.data;
}

// ---------------------------------------------------------------------------

/**
 * Single phone lookup
 * POST /api/checker/check
 * Body: { phone, dateFrom?, dateTo? }
 */
exports.check = async (req, res) => {
    try {
        const { phone, dateFrom, dateTo } = req.body;
        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ success: false, error: 'Phone number is required' });
        }

        const cleanPhone = phone.trim();
        const orders = await fetchSingleOrders(cleanPhone, dateFrom || null, dateTo || null);

        res.json({
            success:       true,
            phone:         cleanPhone,
            total:         orders.length,
            delivered:     orders.filter(r => r.status === 'delivered').length,
            not_delivered: orders.filter(r => r.status === 'not delivered').length,
            orders,
        });
    } catch (error) {
        logger.error('Checker check error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Bulk phone lookup
 * POST /api/checker/bulk
 * Body: { phones: ["0547744594", ...], dateFrom?, dateTo? }
 */
exports.bulk = async (req, res) => {
    try {
        const { phones, dateFrom, dateTo } = req.body;
        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ success: false, error: 'phones array is required' });
        }
        if (phones.length > 200) {
            return res.status(400).json({ success: false, error: 'Maximum 200 phones per bulk request' });
        }

        await getSession();

        const defaultDate = (() => {
            if (dateTo) {
                const parts = dateTo.split('-');
                return parts[2] + '/' + parts[1] + '/' + parts[0];
            }
            return todayDMY();
        })();

        const CONCURRENCY = 3;
        const results = new Array(phones.length);
        let nextIdx = 0;

        const worker = async () => {
            while (nextIdx < phones.length) {
                const i = nextIdx++;
                const rawPhone = String(phones[i]).trim();
                try {
                    const data   = await checkBulkLine(rawPhone, defaultDate);
                    const status = (typeof data === 'object' && data.status ? data.status : '').toLowerCase().trim();
                    const ok     = status === 'delivered' || status === 'not delivered';
                    results[i] = {
                        phone:         rawPhone,
                        success:       ok,
                        status,
                        delivered:     status === 'delivered' ? 1 : 0,
                        not_delivered: status === 'not delivered' ? 1 : 0,
                        total:         ok ? 1 : 0,
                        orders:        [],
                        error:         !ok ? (data.message || data.error || 'Unknown status: ' + status) : undefined,
                    };
                } catch (err) {
                    results[i] = { phone: rawPhone, success: false, error: err.message };
                }
            }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, phones.length) }, worker));

        res.json({ success: true, results });
    } catch (error) {
        logger.error('Checker bulk error', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
};

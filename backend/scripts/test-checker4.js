const axios = require('axios');
const CHECKER_URL = 'https://checker.instantdatagh.com';
const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getSession() {
    const r0 = await axios.get(CHECKER_URL + '/index.php', { headers: { 'User-Agent': browserUA }, timeout: 15000, validateStatus: () => true });
    const initCookie = r0.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    const body = new URLSearchParams();
    body.append('username', 'instant');
    body.append('password', 'checker');
    await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': initCookie, 'User-Agent': browserUA, 'Referer': CHECKER_URL + '/index.php', 'Origin': CHECKER_URL },
        maxRedirects: 0, timeout: 15000, validateStatus: () => true,
    });
    return initCookie;
}

async function test() {
    const cookie = await getSession();
    console.log('Authenticated.\n');

    // === SINGLE SEARCH ===
    console.log('=== SINGLE SEARCH: 0555546229 ===');
    const r1 = await axios.get(CHECKER_URL + '/index.php', {
        params: { search: '0555546229' },
        headers: { Cookie: cookie, 'User-Agent': browserUA },
        timeout: 25000,
    });
    const html = String(r1.data);
    console.log('Has <tbody>:', html.includes('<tbody>'));

    // Print full tbody
    const tbIdx = html.indexOf('<tbody>');
    const tbEnd = html.indexOf('</tbody>');
    if (tbIdx >= 0) {
        console.log('\n--- FULL TBODY ---\n', html.substring(tbIdx, tbEnd + 8));
    }

    // === BULK AJAX ===
    console.log('\n=== BULK AJAX: 0555546229 ===');
    const body2 = new URLSearchParams();
    body2.append('ajax_bulk_line', '0555546229');
    const r2 = await axios.post(CHECKER_URL + '/index.php', body2.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, 'User-Agent': browserUA },
        timeout: 30000, validateStatus: () => true,
    });
    console.log('Bulk status:', r2.status);
    console.log('Bulk response:', typeof r2.data === 'object' ? JSON.stringify(r2.data, null, 2) : String(r2.data).substring(0, 500));
}

test().catch(e => console.error('ERROR:', e.message));

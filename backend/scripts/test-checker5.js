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

    // Get the main page to find bulk form structure
    const r = await axios.get(CHECKER_URL + '/index.php', {
        headers: { Cookie: cookie, 'User-Agent': browserUA },
        timeout: 15000,
    });
    const html = String(r.data);

    // Find the bulk form / textarea / JS code
    const bulkIdx = html.indexOf('bulktext');
    console.log('=== Bulk form context ===\n', html.substring(bulkIdx - 200, bulkIdx + 2000));

    // Find startBulkCheck function
    const funcIdx = html.indexOf('startBulkCheck');
    if (funcIdx >= 0) {
        console.log('\n=== startBulkCheck function ===\n', html.substring(funcIdx, funcIdx + 1500));
    }

    // Find ajax_bulk_line reference
    const ajaxIdx = html.indexOf('ajax_bulk_line');
    if (ajaxIdx >= 0) {
        console.log('\n=== ajax_bulk_line context ===\n', html.substring(ajaxIdx - 300, ajaxIdx + 500));
    }

    // Also try various line formats
    console.log('\n=== Testing line formats ===');
    const formats = [
        '0555546229',
        '0555546229,1024',
        '0555546229 1024',
        '0555546229|1024',
        '0555546229,1',
    ];
    for (const fmt of formats) {
        const b = new URLSearchParams();
        b.append('ajax_bulk_line', fmt);
        b.append('default_date', '15/05/2026');
        const res = await axios.post(CHECKER_URL + '/index.php', b.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, 'User-Agent': browserUA },
            timeout: 15000, validateStatus: () => true,
        });
        console.log('Format "' + fmt + '" ->', typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data).substring(0, 100));
    }
}

test().catch(e => console.error('ERROR:', e.message));

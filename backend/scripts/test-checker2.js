const axios = require('axios');
const CHECKER_URL = 'https://checker.instantdatagh.com';

async function test() {
    // GET login page first to check form structure
    console.log('--- GET login page ---');
    const r0 = await axios.get(CHECKER_URL + '/index.php', {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' }
    });
    console.log('Status:', r0.status);
    const sc0 = r0.headers['set-cookie'];
    console.log('Cookie from GET:', sc0);
    const initCookie = sc0 ? sc0.map(c => c.split(';')[0]).join('; ') : '';

    // Find hidden form fields
    const loginHtml = String(r0.data);
    const formMatch = loginHtml.match(/<form[\s\S]*?<\/form>/i);
    if (formMatch) {
        console.log('\nLogin form HTML (first 1500):\n', formMatch[0].substring(0, 1500));
    } else {
        console.log('No form found in page!');
    }

    // POST login with all browser-like headers
    console.log('\n--- POST login ---');
    const body = new URLSearchParams();
    body.append('username', 'instant');
    body.append('password', 'checker');

    const r1 = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': initCookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
            'Referer': CHECKER_URL + '/index.php',
            'Origin': CHECKER_URL,
        },
        maxRedirects: 0,
        timeout: 15000,
        validateStatus: () => true,
    });

    console.log('Login response status:', r1.status);
    console.log('Login response headers:');
    for (const [k, v] of Object.entries(r1.headers)) {
        if (['set-cookie', 'location', 'content-type', 'x-powered-by'].includes(k.toLowerCase())) {
            console.log(' ', k, ':', v);
        }
    }
    console.log('Body (first 800):\n', String(r1.data).substring(0, 800));
}

test().catch(e => console.error('ERROR:', e.message, e.response?.status));

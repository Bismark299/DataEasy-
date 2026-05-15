const axios = require('axios');

// Mirror exactly what the updated getSession() does
const CHECKER_URL = 'https://checker.instantdatagh.com';
const CHECKER_USER = 'instant';
const CHECKER_PASS = 'checker';
const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getSession() {
    const initRes = await axios.get(CHECKER_URL + '/index.php', {
        headers: { 'User-Agent': browserUA },
        timeout: 15000,
        validateStatus: () => true,
    });
    const initCookies = initRes.headers['set-cookie'];
    if (!initCookies || !initCookies.length) throw new Error('No session cookie on initial GET');
    const initCookie = initCookies.map(c => c.split(';')[0]).join('; ');
    console.log('Initial session cookie:', initCookie);

    const body = new URLSearchParams();
    body.append('username', CHECKER_USER);
    body.append('password', CHECKER_PASS);

    const loginRes = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': initCookie,
            'User-Agent': browserUA,
            'Referer': CHECKER_URL + '/index.php',
            'Origin': CHECKER_URL,
        },
        maxRedirects: 0,
        timeout: 15000,
        validateStatus: (s) => s === 302 || (s >= 200 && s < 300),
    });
    console.log('Login response status:', loginRes.status, '(302 = success redirect)');

    return initCookie;
}

async function test() {
    console.log('=== Testing fixed getSession() ===\n');
    const cookie = await getSession();
    console.log('Authenticated cookie:', cookie);

    console.log('\n=== Testing single search ===');
    const r = await axios.get(CHECKER_URL + '/index.php', {
        params: { search: '0547744594' },
        headers: { Cookie: cookie, 'User-Agent': browserUA },
        timeout: 25000,
    });
    const html = String(r.data);
    console.log('Search status:', r.status);
    console.log('Has name="username" (login page):', html.includes('name="username"'));
    console.log('Has Welcome, instant:', html.includes('Welcome, instant') || html.includes('instant'));
    console.log('Has <tbody>:', html.includes('<tbody>'));

    const tbIdx = html.indexOf('<tbody>');
    if (tbIdx >= 0) {
        console.log('\n<tbody>:\n', html.substring(tbIdx, tbIdx + 600));
    } else {
        console.log('\nHTML around idx 2500-3500:\n', html.substring(2500, 3500));
    }
}

test().catch(e => console.error('ERROR:', e.message, e.response?.status, String(e.response?.data || '').substring(0, 200)));

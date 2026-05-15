const axios = require('axios');
const CHECKER_URL = 'https://checker.instantdatagh.com';

async function test() {
    // Step 1: GET login page - check for hidden fields / CSRF tokens
    console.log('--- GET login page ---');
    const r0 = await axios.get(CHECKER_URL + '/index.php', {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' }
    });
    console.log('Status:', r0.status);
    const sc0 = r0.headers['set-cookie'];
    console.log('Cookie from GET:', sc0);
    const initCookie = sc0 ? sc0.map(c=>c.split(';')[0]).join('; ') : '';

    // Find the form HTML
    const loginHtml = String(r0.data);
    const formMatch = loginHtml.match(/<form[^>]*>[\s\S]*?<\/form>/i);
    if (formMatch) {
        console.log('\nLogin form HTML:\n', formMatch[0].substring(0, 1500));
    }

    // Step 2: POST login
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

    console.log('Login status:', r1.status);
    console.log('Login response headers:', JSON.stringify(r1.headers, null, 2));
    console.log('Body snippet:', String(r1.data).substring(0, 500));
}

test().catch(e => console.error('ERROR:', e.message, e.response?.status));


async function test() {
    // Step 1: GET the login page first to get initial PHP session cookie
    console.log('--- Step 1: GET login page (init session) ---');
    const r0 = await axios.get(CHECKER_URL + '/index.php', {
        timeout: 15000,
        validateStatus: () => true,
    });
    console.log('GET status:', r0.status);
    const initCookie = r0.headers['set-cookie'];
    console.log('Initial set-cookie:', initCookie);

    const initialSession = initCookie ? initCookie.map(c => c.split(';')[0]).join('; ') : '';
    console.log('Initial session:', initialSession);

    // Step 2: POST login WITH the initial session cookie
    console.log('\n--- Step 2: POST login with session cookie ---');
    const body = new URLSearchParams();
    body.append('username', 'instant');
    body.append('password', 'checker');

    const r1 = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(initialSession ? { Cookie: initialSession } : {}),
        },
        maxRedirects: 5,
        timeout: 15000,
        validateStatus: () => true,
    });

    console.log('Login HTTP status:', r1.status);
    const setCookie = r1.headers['set-cookie'];
    console.log('Login set-cookie:', setCookie);
    console.log('Response contains "Welcome, instant":', String(r1.data).includes('Welcome, instant'));

    // Merge cookies
    let cookie = initialSession;
    if (setCookie && setCookie.length > 0) {
        const newCookies = setCookie.map(c => c.split(';')[0]);
        // Replace any overlapping names
        const cookieMap = {};
        cookie.split('; ').filter(Boolean).forEach(c => { const [k,v] = c.split('='); cookieMap[k] = v; });
        newCookies.forEach(c => { const [k,v] = c.split('='); cookieMap[k] = v; });
        cookie = Object.entries(cookieMap).map(([k,v]) => k + '=' + v).join('; ');
    }
    console.log('Final cookie:', cookie);

    // Step 3: Search with authenticated cookie
    console.log('\n--- Step 3: Single search ---');
    const r2 = await axios.get(CHECKER_URL + '/index.php', {
        params: { search: '0547744594' },
        headers: { Cookie: cookie },
        timeout: 25000,
    });

    const html = String(r2.data);
    console.log('Search HTTP status:', r2.status);
    console.log('Contains name="username":', html.includes('name="username"'));
    console.log('Contains "Welcome, instant":', html.includes('Welcome, instant'));
    console.log('Contains <tbody>:', html.includes('<tbody>'));

    const tbodyIdx = html.indexOf('<tbody>');
    if (tbodyIdx >= 0) {
        console.log('\n<tbody> content:\n', html.substring(tbodyIdx, tbodyIdx + 600));
    }
}

test().catch(e => {
    console.error('FATAL ERROR:', e.message);
    if (e.response) console.error('Response:', String(e.response.data).substring(0, 500));
});


async function test() {
    // Step 1: Login
    const body = new URLSearchParams();
    body.append('username', 'instant');
    body.append('password', 'checker');

    console.log('--- Step 1: Login ---');
    const r1 = await axios.post(CHECKER_URL + '/index.php', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 5,
        timeout: 15000,
        validateStatus: () => true,
    });

    console.log('HTTP status:', r1.status);
    const setCookie = r1.headers['set-cookie'];
    console.log('set-cookie header:', setCookie);

    if (!setCookie || setCookie.length === 0) {
        console.log('NO COOKIE returned - login failed');
        console.log('Response body (first 1000 chars):\n', String(r1.data).substring(0, 1000));
        return;
    }

    const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
    console.log('Using cookie:', cookie);

    // Step 2: Single search
    console.log('\n--- Step 2: Single search ---');
    const r2 = await axios.get(CHECKER_URL + '/index.php', {
        params: { search: '0547744594' },
        headers: { Cookie: cookie },
        timeout: 25000,
    });

    const html = String(r2.data);
    console.log('Search HTTP status:', r2.status);
    console.log('Contains name="username":', html.includes('name="username"'));
    console.log('Contains login-container:', html.includes('login-container'));
    console.log('Contains <tbody>:', html.includes('<tbody>'));
    console.log('Contains "Welcome, instant":', html.includes('Welcome, instant'));

    // Find where login form would appear
    const idx = html.indexOf('name="username"');
    if (idx >= 0) {
        console.log('\nContext around name="username" (idx ' + idx + '):\n', html.substring(idx - 100, idx + 200));
    }

    // Show the results area
    const tbodyIdx = html.indexOf('<tbody>');
    if (tbodyIdx >= 0) {
        console.log('\n<tbody> content:\n', html.substring(tbodyIdx, tbodyIdx + 500));
    }
}

test().catch(e => {
    console.error('FATAL ERROR:', e.message);
    if (e.response) {
        console.error('Response status:', e.response.status);
        console.error('Response data:', String(e.response.data).substring(0, 500));
    }
});

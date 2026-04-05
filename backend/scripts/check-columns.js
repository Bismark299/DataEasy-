const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

async function main() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    for (const table of ['users', 'wallets', 'transactions', 'orders', 'momo_deposits']) {
        const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='" + table + "' ORDER BY ordinal_position");
        console.log('\n' + table + ':');
        console.log('  ' + r.rows.map(x => x.column_name).join(', '));
    }
    await c.end();
}
main().catch(e => console.error(e.message));

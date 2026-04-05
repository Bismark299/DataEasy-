const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

async function search() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();

    const search = process.argv[2] || 'BT-4034';
    console.log('Searching for: ' + search + '\n');

    // Search in transaction references
    console.log('=== TRANSACTIONS with reference matching ===');
    const txRes = await c.query(
        "SELECT t.*, u.email, u.\"fullName\" FROM transactions t JOIN users u ON u.id = t.\"userId\" WHERE t.reference ILIKE $1 ORDER BY t.\"createdAt\" DESC LIMIT 10",
        ['%' + search + '%']
    );
    if (txRes.rows.length === 0) {
        console.log('  None found');
    } else {
        txRes.rows.forEach(tx => {
            const arrow = tx.type === 'credit' ? '+' : '-';
            console.log('  ' + tx.email + ' | ' + arrow + 'GHS ' + parseFloat(tx.amount).toFixed(2) + ' | ' + tx.balanceBefore + '->' + tx.balanceAfter + ' | ' + tx.status + ' | ' + tx.reference + ' | ' + tx.description + ' | ' + tx.createdAt);
        });
    }

    // Search in order items (providerReference stored inside JSONB items array)
    console.log('\n=== ORDERS with providerReference matching in items ===');
    const orderRes = await c.query(
        "SELECT o.\"orderId\", o.total, o.\"paymentStatus\", o.\"deliveryStatus\", o.items, o.\"createdAt\", u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.items::text ILIKE $1 ORDER BY o.\"createdAt\" DESC LIMIT 10",
        ['%' + search + '%']
    );
    if (orderRes.rows.length === 0) {
        console.log('  None found');
    } else {
        orderRes.rows.forEach(o => {
            const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
            console.log('  Order #' + o.orderId + ' | ' + o.email + ' | GHS ' + parseFloat(o.total).toFixed(2) + ' | Pay=' + o.paymentStatus + ' | Del=' + o.deliveryStatus + ' | ' + o.createdAt);
            items.forEach((item, i) => {
                if (JSON.stringify(item).toLowerCase().includes(search.toLowerCase())) {
                    console.log('    Item #' + i + ': ' + item.phoneNumber + ' | ' + item.packageName + ' | GHS ' + parseFloat(item.price).toFixed(2) + ' | Ref: ' + (item.providerReference || 'NONE') + ' | Status: ' + item.deliveryStatus + ' | Error: ' + (item.deliveryError || 'none'));
                }
            });
        });
    }

    // Also search by orderId containing the number
    console.log('\n=== ORDERS with orderId matching ===');
    const numOnly = search.replace(/\D/g, '');
    if (numOnly) {
        const oidRes = await c.query(
            "SELECT o.\"orderId\", o.total, o.\"paymentStatus\", o.\"deliveryStatus\", o.\"createdAt\", o.items, u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.\"orderId\" = $1",
            [numOnly]
        );
        if (oidRes.rows.length === 0) {
            // Try padded
            const padded = numOnly.padStart(4, '0');
            const oidRes2 = await c.query(
                "SELECT o.\"orderId\", o.total, o.\"paymentStatus\", o.\"deliveryStatus\", o.\"createdAt\", o.items, u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.\"orderId\" = $1",
                [padded]
            );
            if (oidRes2.rows.length > 0) {
                const o = oidRes2.rows[0];
                const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                console.log('  Order #' + o.orderId + ' | ' + o.email + ' (' + o.fullName + ') | GHS ' + parseFloat(o.total).toFixed(2) + ' | Pay=' + o.paymentStatus + ' | Del=' + o.deliveryStatus + ' | ' + o.createdAt);
                items.forEach((item, i) => {
                    console.log('    Item #' + i + ': ' + item.phoneNumber + ' | ' + item.packageName + ' | GHS ' + parseFloat(item.price).toFixed(2) + ' | Ref: ' + (item.providerReference || 'NONE') + ' | Status: ' + item.deliveryStatus + ' | Error: ' + (item.deliveryError || 'none'));
                });
            } else {
                console.log('  None found');
            }
        } else {
            const o = oidRes.rows[0];
            const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
            console.log('  Order #' + o.orderId + ' | ' + o.email + ' (' + o.fullName + ') | GHS ' + parseFloat(o.total).toFixed(2) + ' | Pay=' + o.paymentStatus + ' | Del=' + o.deliveryStatus + ' | ' + o.createdAt);
            items.forEach((item, i) => {
                console.log('    Item #' + i + ': ' + item.phoneNumber + ' | ' + item.packageName + ' | GHS ' + parseFloat(item.price).toFixed(2) + ' | Ref: ' + (item.providerReference || 'NONE') + ' | Status: ' + item.deliveryStatus + ' | Error: ' + (item.deliveryError || 'none'));
            });
        }
    }

    await c.end();
}

search().catch(e => console.error('Error:', e));

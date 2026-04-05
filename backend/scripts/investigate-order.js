const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

const TARGET = process.argv[2] || '4034';

async function investigate() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();

    // 1. Find the order
    console.log('=== INVESTIGATING ORDER #' + TARGET + ' ===\n');
    const orderRes = await c.query(
        "SELECT o.*, u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.\"orderId\" = $1",
        [TARGET]
    );

    if (orderRes.rows.length === 0) {
        // Try with leading zeros stripped or added
        const padded = TARGET.padStart(4, '0');
        const orderRes2 = await c.query(
            "SELECT o.*, u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.\"orderId\" = $1",
            [padded]
        );
        if (orderRes2.rows.length === 0) {
            // Try LIKE search
            const likeRes = await c.query(
                "SELECT o.*, u.email, u.\"fullName\" FROM orders o JOIN users u ON u.id = o.\"userId\" WHERE o.\"orderId\" LIKE $1",
                ['%' + TARGET + '%']
            );
            if (likeRes.rows.length === 0) {
                console.log('Order not found with ID: ' + TARGET);
                await c.end();
                return;
            }
            orderRes.rows.push(...likeRes.rows);
        } else {
            orderRes.rows.push(...orderRes2.rows);
        }
    }

    const order = orderRes.rows[0];
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

    console.log('ORDER DETAILS:');
    console.log('  Order ID:        #' + order.orderId);
    console.log('  DB ID:           ' + order.id);
    console.log('  User:            ' + order.email + ' (' + order.fullName + ')');
    console.log('  User DB ID:      ' + order.userId);
    console.log('  Network:         ' + order.network);
    console.log('  Subtotal:        GHS ' + parseFloat(order.subtotal).toFixed(2));
    console.log('  Total:           GHS ' + parseFloat(order.total).toFixed(2));
    console.log('  Payment Status:  ' + order.paymentStatus);
    console.log('  Payment Method:  ' + order.paymentMethod);
    console.log('  Delivery Status: ' + order.deliveryStatus);
    console.log('  Created:         ' + order.createdAt);
    console.log('  Processed By:    ' + (order.processedBy || 'N/A'));
    console.log('  Processed At:    ' + (order.processedAt || 'N/A'));
    console.log('  Notes:           ' + (order.notes || 'N/A'));

    console.log('\nORDER ITEMS (' + items.length + '):');
    items.forEach((item, i) => {
        console.log('  Item #' + i + ':');
        console.log('    Package:           ' + item.packageName + ' (' + item.packageId + ')');
        console.log('    Data:              ' + item.data);
        console.log('    Price:             GHS ' + parseFloat(item.price).toFixed(2));
        console.log('    Cost Price:        GHS ' + parseFloat(item.costPrice || 0).toFixed(2));
        console.log('    Phone:             ' + item.phoneNumber);
        console.log('    Delivery Status:   ' + item.deliveryStatus);
        console.log('    Provider Ref:      ' + (item.providerReference || 'NONE'));
        console.log('    Sent to Provider:  ' + (item.sentToProviderAt || 'NEVER'));
        console.log('    Delivery Error:    ' + (item.deliveryError || 'none'));
        console.log('    Price Locked At:   ' + (item.priceLockedAt || 'N/A'));
    });

    // 2. Find the matching debit transaction
    console.log('\n=== MATCHING TRANSACTIONS ===');
    const txRes = await c.query(
        "SELECT * FROM transactions WHERE \"orderId\" = $1 ORDER BY \"createdAt\" ASC",
        [order.id]
    );

    if (txRes.rows.length === 0) {
        // Try by reference
        const txRef = await c.query(
            "SELECT * FROM transactions WHERE reference LIKE $1 ORDER BY \"createdAt\" ASC",
            ['%' + order.orderId + '%']
        );
        if (txRef.rows.length === 0) {
            console.log('  NO TRANSACTIONS FOUND for this order!');
        } else {
            txRef.rows.forEach(printTx);
        }
    } else {
        txRes.rows.forEach(printTx);
    }

    // 3. Check if there's a refund
    console.log('\n=== REFUND CHECK ===');
    const refundRes = await c.query(
        "SELECT * FROM transactions WHERE \"userId\" = $1 AND type = 'credit' AND (description ILIKE $2 OR description ILIKE $3) ORDER BY \"createdAt\" ASC",
        [order.userId, '%refund%' + order.orderId + '%', '%' + order.orderId + '%refund%']
    );
    if (refundRes.rows.length === 0) {
        console.log('  NO REFUND found for this order');
    } else {
        console.log('  REFUND FOUND:');
        refundRes.rows.forEach(printTx);
    }

    // 4. User's current wallet state
    console.log('\n=== USER WALLET STATE ===');
    const walletRes = await c.query(
        "SELECT * FROM wallets WHERE \"userId\" = $1",
        [order.userId]
    );
    if (walletRes.rows.length > 0) {
        const w = walletRes.rows[0];
        console.log('  Balance:       GHS ' + parseFloat(w.balance).toFixed(2));
        console.log('  Total Topups:  GHS ' + parseFloat(w.totalTopups).toFixed(2));
        console.log('  Total Spent:   GHS ' + parseFloat(w.totalSpent).toFixed(2));
        console.log('  Reserved:      GHS ' + parseFloat(w.reservedBalance).toFixed(2));
    }

    // 5. Transactions around the time of this order (timeline)
    console.log('\n=== TRANSACTION TIMELINE (5 before + 5 after this order) ===');
    const timelineRes = await c.query(`
        (SELECT * FROM transactions WHERE "userId" = $1 AND "createdAt" <= $2 ORDER BY "createdAt" DESC LIMIT 5)
        UNION ALL
        (SELECT * FROM transactions WHERE "userId" = $1 AND "createdAt" > $2 ORDER BY "createdAt" ASC LIMIT 5)
        ORDER BY "createdAt" ASC
    `, [order.userId, order.createdAt]);
    
    timelineRes.rows.forEach(tx => {
        const arrow = tx.type === 'credit' ? '+' : '-';
        const marker = tx.orderId === order.id ? ' <<<< THIS ORDER' : '';
        console.log('  ' + tx.createdAt + ' | ' + arrow + 'GHS ' + parseFloat(tx.amount).toFixed(2) + ' | ' + tx.balanceBefore + ' -> ' + tx.balanceAfter + ' | ' + tx.status + ' | ' + tx.paymentMethod + ' | ' + tx.description + marker);
    });

    // 6. Check provider_transactions table
    console.log('\n=== PROVIDER TRANSACTIONS ===');
    try {
        const provRes = await c.query(
            "SELECT * FROM provider_transactions WHERE \"orderId\" = $1 OR reference LIKE $2",
            [order.id, '%' + order.orderId + '%']
        );
        if (provRes.rows.length === 0) {
            console.log('  No provider_transactions records found');
        } else {
            provRes.rows.forEach(pt => {
                console.log('  Ref: ' + pt.reference + ' | Status: ' + pt.status + ' | Provider: ' + pt.provider + ' | Created: ' + pt.createdAt);
            });
        }
    } catch (e) {
        console.log('  provider_transactions query error: ' + e.message);
    }

    await c.end();
    console.log('\n=== INVESTIGATION COMPLETE ===');
}

function printTx(tx) {
    const arrow = tx.type === 'credit' ? '+' : '-';
    console.log('  ' + tx.createdAt + ' | ' + arrow + 'GHS ' + parseFloat(tx.amount).toFixed(2));
    console.log('    Balance: ' + tx.balanceBefore + ' -> ' + tx.balanceAfter);
    console.log('    Desc: ' + tx.description);
    console.log('    Ref: ' + tx.reference);
    console.log('    Method: ' + tx.paymentMethod + ' | Status: ' + tx.status);
    console.log('');
}

investigate().catch(e => console.error('Error:', e));

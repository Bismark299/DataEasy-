const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

const AGENT = process.argv[2] || 'BT-4034';

async function investigate() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();

    console.log('=== INVESTIGATING AGENT: ' + AGENT + ' ===\n');

    // Find user by agentCode
    const userRes = await c.query(
        "SELECT * FROM users WHERE \"agentCode\" = $1",
        [AGENT]
    );

    if (userRes.rows.length === 0) {
        // Try without dash, with dash, case-insensitive
        const userRes2 = await c.query(
            "SELECT * FROM users WHERE \"agentCode\" ILIKE $1",
            ['%' + AGENT + '%']
        );
        if (userRes2.rows.length === 0) {
            console.log('Agent not found: ' + AGENT);
            // List all agent codes for reference
            const all = await c.query("SELECT \"agentCode\", email, \"fullName\" FROM users WHERE \"agentCode\" IS NOT NULL ORDER BY \"agentCode\"");
            console.log('\nAll agent codes:');
            all.rows.forEach(r => console.log('  ' + r.agentCode + ' | ' + r.email + ' | ' + r.fullName));
            await c.end();
            return;
        }
        userRes.rows.push(...userRes2.rows);
    }

    const user = userRes.rows[0];
    console.log('AGENT DETAILS:');
    console.log('  Agent Code:    ' + user.agentCode);
    console.log('  Name:          ' + user.fullName);
    console.log('  Email:         ' + user.email);
    console.log('  Phone:         ' + user.phone);
    console.log('  Role:          ' + user.role);
    console.log('  Active:        ' + user.isActive);
    console.log('  Verified:      ' + user.isVerified);
    console.log('  Joined:        ' + user.createdAt);
    console.log('  Last Login:    ' + user.lastLogin);

    // Wallet
    console.log('\n=== WALLET ===');
    const walletRes = await c.query("SELECT * FROM wallets WHERE \"userId\" = $1", [user.id]);
    if (walletRes.rows.length > 0) {
        const w = walletRes.rows[0];
        console.log('  Balance:       GHS ' + parseFloat(w.balance).toFixed(2));
        console.log('  Total Topups:  GHS ' + parseFloat(w.totalTopups).toFixed(2));
        console.log('  Total Spent:   GHS ' + parseFloat(w.totalSpent).toFixed(2));
        console.log('  Reserved:      GHS ' + parseFloat(w.reservedBalance).toFixed(2));

        // Calculate expected balance from transactions
        const calcRes = await c.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN type='credit' AND status='completed' THEN amount ELSE 0 END), 0) as total_credits,
                COALESCE(SUM(CASE WHEN type='debit' AND status='completed' THEN amount ELSE 0 END), 0) as total_debits
            FROM transactions WHERE "userId" = $1
        `, [user.id]);
        const credits = parseFloat(calcRes.rows[0].total_credits);
        const debits = parseFloat(calcRes.rows[0].total_debits);
        const expected = credits - debits;
        const discrepancy = parseFloat(w.balance) - expected;
        console.log('\n  AUDIT:');
        console.log('    Sum of credits:     GHS ' + credits.toFixed(2));
        console.log('    Sum of debits:      GHS ' + debits.toFixed(2));
        console.log('    Expected balance:   GHS ' + expected.toFixed(2));
        console.log('    Actual balance:     GHS ' + parseFloat(w.balance).toFixed(2));
        console.log('    DISCREPANCY:        GHS ' + discrepancy.toFixed(2));
    }

    // Order summary
    console.log('\n=== ORDER SUMMARY ===');
    const orderSummary = await c.query(`
        SELECT 
            "deliveryStatus", 
            COUNT(*) as cnt, 
            SUM(total) as total_amount
        FROM orders 
        WHERE "userId" = $1 AND "paymentStatus" = 'Completed'
        GROUP BY "deliveryStatus"
        ORDER BY cnt DESC
    `, [user.id]);
    let totalOrders = 0;
    let totalSpentOnOrders = 0;
    orderSummary.rows.forEach(r => {
        totalOrders += parseInt(r.cnt);
        totalSpentOnOrders += parseFloat(r.total_amount);
        console.log('  ' + r.deliveryStatus + ': ' + r.cnt + ' orders, GHS ' + parseFloat(r.total_amount).toFixed(2));
    });
    console.log('  TOTAL: ' + totalOrders + ' orders, GHS ' + totalSpentOnOrders.toFixed(2));

    // Failed / stuck orders detail
    console.log('\n=== STUCK/FAILED ORDERS (Processing or Failed, no refund) ===');
    const stuckOrders = await c.query(`
        SELECT o."orderId", o.total, o."deliveryStatus", o."createdAt", o.items
        FROM orders o
        WHERE o."userId" = $1 
          AND o."paymentStatus" = 'Completed'
          AND o."deliveryStatus" IN ('Processing', 'Failed', 'Pending')
        ORDER BY o."createdAt" DESC
    `, [user.id]);

    if (stuckOrders.rows.length === 0) {
        console.log('  No stuck/failed orders');
    } else {
        let stuckTotal = 0;
        console.log('  Found ' + stuckOrders.rows.length + ' stuck orders:\n');
        for (const o of stuckOrders.rows) {
            const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
            stuckTotal += parseFloat(o.total);
            console.log('  #' + o.orderId + ' | GHS ' + parseFloat(o.total).toFixed(2) + ' | ' + o.deliveryStatus + ' | ' + o.createdAt);
            items.forEach((item, i) => {
                if (item.deliveryStatus !== 'Delivered') {
                    console.log('    Item ' + i + ': ' + item.phoneNumber + ' | ' + item.packageName + ' | GHS ' + parseFloat(item.price).toFixed(2) + ' | Status: ' + item.deliveryStatus + ' | Ref: ' + (item.providerReference || 'NONE') + ' | Error: ' + (item.deliveryError || 'none'));
                }
            });
        }
        console.log('\n  TOTAL MONEY STUCK: GHS ' + stuckTotal.toFixed(2));
    }

    // Recent topups (credits)
    console.log('\n=== RECENT 10 TOPUPS ===');
    const topups = await c.query(`
        SELECT * FROM transactions 
        WHERE "userId" = $1 AND type = 'credit' AND status = 'completed'
        ORDER BY "createdAt" DESC LIMIT 10
    `, [user.id]);
    topups.rows.forEach(tx => {
        console.log('  +GHS ' + parseFloat(tx.amount).toFixed(2) + ' | ' + tx.paymentMethod + ' | ' + tx.description + ' | ' + tx.createdAt);
    });

    // Recent 10 orders
    console.log('\n=== RECENT 10 ORDERS ===');
    const recentOrders = await c.query(`
        SELECT "orderId", total, "paymentStatus", "deliveryStatus", "createdAt"
        FROM orders 
        WHERE "userId" = $1
        ORDER BY "createdAt" DESC LIMIT 10
    `, [user.id]);
    recentOrders.rows.forEach(o => {
        console.log('  #' + o.orderId + ' | GHS ' + parseFloat(o.total).toFixed(2) + ' | Pay=' + o.paymentStatus + ' | Del=' + o.deliveryStatus + ' | ' + o.createdAt);
    });

    await c.end();
    console.log('\n=== INVESTIGATION COMPLETE ===');
}

investigate().catch(e => console.error('Error:', e));

/**
 * Wallet Audit Script
 * Investigates missing money / balance discrepancies
 */
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;

async function audit() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    console.log('Connected to database\n');

    // 1. Row counts
    console.log('=== ROW COUNTS ===');
    for (const t of ['users', 'wallets', 'transactions', 'orders', 'momo_deposits']) {
        try {
            const r = await c.query('SELECT COUNT(*) as cnt FROM ' + t);
            console.log('  ' + t + ': ' + r.rows[0].cnt);
        } catch (e) {
            console.log('  ' + t + ': ERROR - ' + e.message);
        }
    }

    // 2. Check wallet balance vs transaction math
    console.log('\n=== WALLET BALANCE vs TRANSACTION MATH ===');
    console.log('(Comparing wallet.balance with SUM of completed transactions)\n');
    const balanceCheck = await c.query(`
        SELECT 
            u.id as user_id,
            u.email,
            u."fullName",
            w.balance as wallet_balance,
            w."totalTopups",
            w."totalSpent",
            w."reservedBalance",
            COALESCE(credits.total_credits, 0) as calc_total_credits,
            COALESCE(debits.total_debits, 0) as calc_total_debits,
            COALESCE(credits.total_credits, 0) - COALESCE(debits.total_debits, 0) as calc_expected_balance,
            w.balance - (COALESCE(credits.total_credits, 0) - COALESCE(debits.total_debits, 0)) as discrepancy
        FROM wallets w
        JOIN users u ON u.id = w."userId"
        LEFT JOIN (
            SELECT "userId", SUM(amount) as total_credits
            FROM transactions 
            WHERE type = 'credit' AND status = 'completed'
            GROUP BY "userId"
        ) credits ON credits."userId" = w."userId"
        LEFT JOIN (
            SELECT "userId", SUM(amount) as total_debits
            FROM transactions 
            WHERE type = 'debit' AND status = 'completed'
            GROUP BY "userId"
        ) debits ON debits."userId" = w."userId"
        ORDER BY ABS(w.balance - (COALESCE(credits.total_credits, 0) - COALESCE(debits.total_debits, 0))) DESC
    `);

    let discrepancyCount = 0;
    let totalDiscrepancy = 0;
    for (const row of balanceCheck.rows) {
        const disc = parseFloat(row.discrepancy);
        if (Math.abs(disc) > 0.01) {
            discrepancyCount++;
            totalDiscrepancy += disc;
            console.log('  *** DISCREPANCY: ' + row.email + ' (' + row.fullName + ')');
            console.log('      Wallet balance:   GHS ' + parseFloat(row.wallet_balance).toFixed(2));
            console.log('      Total credits:    GHS ' + parseFloat(row.calc_total_credits).toFixed(2));
            console.log('      Total debits:     GHS ' + parseFloat(row.calc_total_debits).toFixed(2));
            console.log('      Expected balance: GHS ' + parseFloat(row.calc_expected_balance).toFixed(2));
            console.log('      DISCREPANCY:      GHS ' + disc.toFixed(2));
            console.log('      totalTopups:      GHS ' + parseFloat(row.totalTopups).toFixed(2));
            console.log('      totalSpent:       GHS ' + parseFloat(row.totalSpent).toFixed(2));
            console.log('      reserved:         GHS ' + parseFloat(row.reservedBalance).toFixed(2));
            console.log('');
        }
    }
    if (discrepancyCount === 0) {
        console.log('  No discrepancies found - all wallet balances match transaction records');
    } else {
        console.log('  TOTAL: ' + discrepancyCount + ' wallets with discrepancies, net: GHS ' + totalDiscrepancy.toFixed(2));
    }

    // 3. Orders paid but delivery failed (money taken, nothing delivered)
    console.log('\n=== ORDERS: PAID BUT DELIVERY FAILED (No Refund) ===');
    const failedOrders = await c.query(`
        SELECT 
            o."orderId",
            o.total,
            o."paymentStatus",
            o."deliveryStatus",
            o."createdAt",
            u.email,
            u."fullName",
            o.items
        FROM orders o
        JOIN users u ON u.id = o."userId"
        WHERE o."paymentStatus" = 'Completed'
          AND o."deliveryStatus" IN ('Failed', 'Partially Delivered')
        ORDER BY o."createdAt" DESC
    `);
    
    if (failedOrders.rows.length === 0) {
        console.log('  No paid-but-failed orders found');
    } else {
        let totalLost = 0;
        let unrefundedCount = 0;
        for (const row of failedOrders.rows) {
            const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
            const failedItems = items.filter(i => i.deliveryStatus === 'Failed');
            const failedAmount = failedItems.reduce((sum, i) => sum + parseFloat(i.price || 0), 0);
            
            // Check if refund exists for this order
            const refundCheck = await c.query(
                "SELECT COUNT(*) as cnt FROM transactions WHERE type='credit' AND status='completed' AND description ILIKE '%refund%' AND description ILIKE $1",
                ['%' + row.orderId + '%']
            );
            const hasRefund = parseInt(refundCheck.rows[0].cnt) > 0;
            
            if (!hasRefund && failedAmount > 0) {
                unrefundedCount++;
                totalLost += failedAmount;
                console.log('  Order #' + row.orderId + ' | ' + row.email + ' | ' + row.fullName);
                console.log('    Total: GHS ' + parseFloat(row.total).toFixed(2) + ' | Failed items: ' + failedItems.length + '/' + items.length + ' | Lost: GHS ' + failedAmount.toFixed(2));
                console.log('    Delivery=' + row.deliveryStatus + ' | Date: ' + row.createdAt);
                if (unrefundedCount <= 20) {
                    // Show failed item details for first 20
                    failedItems.forEach(fi => {
                        console.log('      -> ' + fi.phoneNumber + ' | ' + fi.packageName + ' | GHS ' + parseFloat(fi.price).toFixed(2) + ' | ' + (fi.deliveryError || 'no error msg'));
                    });
                }
                console.log('');
            }
        }
        console.log('  TOTAL UNREFUNDED FAILED ORDERS: ' + unrefundedCount + ' orders, GHS ' + totalLost.toFixed(2));
    }

    // 4. Orders paid but still Pending delivery (stuck orders)
    console.log('\n=== ORDERS: PAID BUT STILL PENDING DELIVERY ===');
    const pendingOrders = await c.query(`
        SELECT 
            o."orderId",
            o.total,
            o."deliveryStatus",
            o."createdAt",
            u.email,
            u."fullName",
            o.items
        FROM orders o
        JOIN users u ON u.id = o."userId"
        WHERE o."paymentStatus" = 'Completed'
          AND o."deliveryStatus" IN ('Pending', 'Processing')
          AND o."createdAt" < NOW() - INTERVAL '1 hour'
        ORDER BY o."createdAt" DESC
    `);
    if (pendingOrders.rows.length === 0) {
        console.log('  No stuck pending orders (older than 1 hour)');
    } else {
        console.log('  Found ' + pendingOrders.rows.length + ' stuck paid orders:');
        let stuckTotal = 0;
        for (const row of pendingOrders.rows) {
            stuckTotal += parseFloat(row.total);
            console.log('  #' + row.orderId + ' | ' + row.email + ' | GHS ' + parseFloat(row.total).toFixed(2) + ' | ' + row.deliveryStatus + ' | ' + row.createdAt);
        }
        console.log('  TOTAL STUCK: GHS ' + stuckTotal.toFixed(2));
    }

    // 5. Pending transactions that are stuck (never completed, never failed)
    console.log('\n=== STUCK PENDING TRANSACTIONS ===');
    const pendingTx = await c.query(`
        SELECT 
            t.id,
            t."userId",
            t.type,
            t.amount,
            t.description,
            t.reference,
            t."paymentMethod",
            t.status,
            t."createdAt",
            u.email,
            u."fullName"
        FROM transactions t
        JOIN users u ON u.id = t."userId"
        WHERE t.status = 'pending'
        ORDER BY t."createdAt" DESC
    `);
    
    if (pendingTx.rows.length === 0) {
        console.log('  No stuck pending transactions');
    } else {
        console.log('  Found ' + pendingTx.rows.length + ' pending transactions:');
        let pendingTotal = 0;
        for (const row of pendingTx.rows) {
            pendingTotal += parseFloat(row.amount);
            console.log('  ' + row.email + ' | ' + row.type + ' | GHS ' + parseFloat(row.amount).toFixed(2) + ' | ' + row.description + ' | ' + row.paymentMethod + ' | ' + row.createdAt);
        }
        console.log('  TOTAL PENDING: GHS ' + pendingTotal.toFixed(2));
    }

    // 6. MoMo deposits - check if they all have matching credit transactions
    console.log('\n=== MOMO DEPOSITS WITHOUT MATCHING CREDIT ===');
    try {
        const orphanMomo = await c.query(`
            SELECT 
                m.id,
                m.amount,
                m."transactionId",
                m.status,
                m."createdAt",
                m."userId",
                u.email
            FROM momo_deposits m
            LEFT JOIN users u ON u.id = m."userId"
            WHERE m.status = 'completed'
              AND NOT EXISTS (
                  SELECT 1 FROM transactions t 
                  WHERE t."userId" = m."userId" 
                    AND t.type = 'credit' 
                    AND t.status = 'completed'
                    AND t."paymentMethod" = 'momo'
                    AND t.amount = m.amount
                    AND t."createdAt" BETWEEN m."createdAt" - INTERVAL '5 minutes' AND m."createdAt" + INTERVAL '5 minutes'
              )
        `);
        if (orphanMomo.rows.length === 0) {
            console.log('  All MoMo deposits have matching credit transactions');
        } else {
            console.log('  Found ' + orphanMomo.rows.length + ' MoMo deposits without matching credit:');
            for (const row of orphanMomo.rows) {
                console.log('  ' + (row.email || 'unknown') + ' | GHS ' + parseFloat(row.amount).toFixed(2) + ' | TxID: ' + row.transactionId + ' | ' + row.createdAt);
            }
        }
    } catch (e) {
        console.log('  MoMo table error:', e.message);
    }

    // 7. Double debits check - same order charged twice
    console.log('\n=== DOUBLE DEBIT CHECK ===');
    const doubleDeb = await c.query(`
        SELECT 
            reference, 
            COUNT(*) as cnt, 
            SUM(amount) as total_charged
        FROM transactions 
        WHERE type = 'debit' AND status = 'completed' AND reference IS NOT NULL
        GROUP BY reference 
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
    `);
    if (doubleDeb.rows.length === 0) {
        console.log('  No double debits found');
    } else {
        for (const row of doubleDeb.rows) {
            console.log('  DOUBLE DEBIT: ' + row.reference + ' charged ' + row.cnt + ' times, total GHS ' + parseFloat(row.total_charged).toFixed(2));
        }
    }

    // 8. Wallet adjustments by admin (manual credits/debits)
    console.log('\n=== ADMIN MANUAL ADJUSTMENTS ===');
    const adjustments = await c.query(`
        SELECT 
            t.type,
            t.amount,
            t.description,
            t."paymentMethod",
            t."createdAt",
            u.email
        FROM transactions t
        JOIN users u ON u.id = t."userId"
        WHERE t."paymentMethod" = 'manual'
          AND t.status = 'completed'
        ORDER BY t."createdAt" DESC
        LIMIT 50
    `);
    if (adjustments.rows.length === 0) {
        console.log('  No manual adjustments found');
    } else {
        console.log('  Found ' + adjustments.rows.length + ' manual adjustments:');
        for (const row of adjustments.rows) {
            console.log('  ' + row.email + ' | ' + row.type + ' | GHS ' + parseFloat(row.amount).toFixed(2) + ' | ' + row.description + ' | ' + row.createdAt);
        }
    }

    // 9. Balance chain integrity check (balanceAfter of prev tx should = balanceBefore of next tx)
    console.log('\n=== BALANCE CHAIN BREAKS (balanceAfter != next balanceBefore) ===');
    const chainBreaks = await c.query(`
        WITH ranked AS (
            SELECT 
                t.id, t."userId", t.type, t.amount, 
                t."balanceBefore", t."balanceAfter",
                t.description, t.status, t."createdAt",
                LAG(t."balanceAfter") OVER (PARTITION BY t."userId" ORDER BY t."createdAt", t.id) as prev_balance_after,
                u.email
            FROM transactions t
            JOIN users u ON u.id = t."userId"
            WHERE t.status = 'completed'
        )
        SELECT * FROM ranked
        WHERE prev_balance_after IS NOT NULL 
          AND ABS("balanceBefore" - prev_balance_after) > 0.01
        ORDER BY "createdAt" DESC
        LIMIT 30
    `);
    if (chainBreaks.rows.length === 0) {
        console.log('  No balance chain breaks found - all transactions chain correctly');
    } else {
        console.log('  Found ' + chainBreaks.rows.length + ' chain breaks:');
        for (const row of chainBreaks.rows) {
            const gap = parseFloat(row.balanceBefore) - parseFloat(row.prev_balance_after);
            console.log('  ' + row.email + ' | ' + row.createdAt + ' | prev_after=' + parseFloat(row.prev_balance_after).toFixed(2) + ' -> this_before=' + parseFloat(row.balanceBefore).toFixed(2) + ' | GAP: GHS ' + gap.toFixed(2) + ' | ' + row.description);
        }
    }

    // 10. Summary of all wallet balances
    console.log('\n=== ALL WALLET BALANCES (top 30) ===');
    const allWallets = await c.query(`
        SELECT 
            u.email,
            u."fullName",
            w.balance,
            w."totalTopups",
            w."totalSpent",
            w."reservedBalance"
        FROM wallets w
        JOIN users u ON u.id = w."userId"
        ORDER BY w.balance DESC
        LIMIT 30
    `);
    for (const row of allWallets.rows) {
        console.log('  ' + row.email + ' | ' + row.fullName + ' | Bal: GHS ' + parseFloat(row.balance).toFixed(2) + ' | In: GHS ' + parseFloat(row.totalTopups).toFixed(2) + ' | Out: GHS ' + parseFloat(row.totalSpent).toFixed(2) + ' | Reserved: GHS ' + parseFloat(row.reservedBalance).toFixed(2));
    }

    // 11. Recent 30 transactions
    console.log('\n=== RECENT 30 TRANSACTIONS ===');
    const recent = await c.query(`
        SELECT 
            t.type,
            t.amount,
            t."balanceBefore",
            t."balanceAfter",
            t.description,
            t.status,
            t."paymentMethod",
            t."createdAt",
            u.email
        FROM transactions t
        JOIN users u ON u.id = t."userId"
        ORDER BY t."createdAt" DESC
        LIMIT 30
    `);
    for (const row of recent.rows) {
        const arrow = row.type === 'credit' ? '+' : '-';
        console.log('  ' + row.createdAt + ' | ' + row.email + ' | ' + arrow + 'GHS ' + parseFloat(row.amount).toFixed(2) + ' | ' + row.balanceBefore + '->' + row.balanceAfter + ' | ' + row.status + ' | ' + row.paymentMethod + ' | ' + row.description);
    }

    // 12. Order delivery status summary
    console.log('\n=== ORDER DELIVERY STATUS SUMMARY ===');
    const deliverySummary = await c.query(`
        SELECT 
            "deliveryStatus",
            "paymentStatus",
            COUNT(*) as cnt,
            SUM(total) as total_amount
        FROM orders
        GROUP BY "deliveryStatus", "paymentStatus"
        ORDER BY cnt DESC
    `);
    for (const row of deliverySummary.rows) {
        console.log('  ' + row.paymentStatus + ' / ' + row.deliveryStatus + ': ' + row.cnt + ' orders, GHS ' + parseFloat(row.total_amount).toFixed(2));
    }

    await c.end();
    console.log('\n=== AUDIT COMPLETE ===');
}

audit().catch(e => console.error('Audit failed:', e));

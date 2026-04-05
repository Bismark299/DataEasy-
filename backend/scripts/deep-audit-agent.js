const { Client } = require('pg');
const DB_URL = process.env.DATABASE_URL;

async function deepAudit() {
    const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();

    // Get agent BT-4034
    const userRes = await c.query("SELECT * FROM users WHERE \"agentCode\" = 'BT-4034'");
    const user = userRes.rows[0];
    console.log('=== DEEP WALLET AUDIT: ' + user.fullName + ' (' + user.agentCode + ') ===\n');

    // Get ALL transactions, ordered chronologically
    const txRes = await c.query(
        "SELECT * FROM transactions WHERE \"userId\" = $1 ORDER BY \"createdAt\" ASC",
        [user.id]
    );

    console.log('COMPLETE TRANSACTION HISTORY (' + txRes.rows.length + ' transactions):\n');
    console.log('  #  | Date                | Type   | Amount     | Before     | After      | Method   | Status    | Description');
    console.log('  ' + '-'.repeat(140));

    let prevAfter = null;
    let chainBreaks = [];
    let totalCredits = 0;
    let totalDebits = 0;
    let issues = [];

    txRes.rows.forEach((tx, i) => {
        const num = String(i + 1).padStart(3, ' ');
        const date = new Date(tx.createdAt).toISOString().replace('T', ' ').slice(0, 19);
        const type = tx.type.padEnd(6);
        const amount = parseFloat(tx.amount).toFixed(2).padStart(10);
        const before = parseFloat(tx.balanceBefore).toFixed(2).padStart(10);
        const after = parseFloat(tx.balanceAfter).toFixed(2).padStart(10);
        const method = (tx.paymentMethod || '').padEnd(8);
        const status = tx.status.padEnd(9);
        const desc = tx.description;

        let flag = '';

        // Check chain continuity
        if (prevAfter !== null && tx.status === 'completed') {
            const gap = Math.abs(parseFloat(tx.balanceBefore) - prevAfter);
            if (gap > 0.01) {
                flag = ' *** CHAIN BREAK (gap: GHS ' + (parseFloat(tx.balanceBefore) - prevAfter).toFixed(2) + ')';
                chainBreaks.push({
                    txNum: i + 1,
                    date: date,
                    expectedBefore: prevAfter.toFixed(2),
                    actualBefore: parseFloat(tx.balanceBefore).toFixed(2),
                    gap: (parseFloat(tx.balanceBefore) - prevAfter).toFixed(2),
                    desc: desc
                });
            }
        }

        // Check math: before +/- amount should = after
        if (tx.status === 'completed') {
            let expectedAfter;
            if (tx.type === 'credit') {
                expectedAfter = parseFloat(tx.balanceBefore) + parseFloat(tx.amount);
                totalCredits += parseFloat(tx.amount);
            } else {
                expectedAfter = parseFloat(tx.balanceBefore) - parseFloat(tx.amount);
                totalDebits += parseFloat(tx.amount);
            }
            const mathError = Math.abs(parseFloat(tx.balanceAfter) - expectedAfter);
            if (mathError > 0.01) {
                flag += ' *** MATH ERROR (expected after: ' + expectedAfter.toFixed(2) + ')';
                issues.push({
                    txNum: i + 1,
                    date: date,
                    type: 'MATH_ERROR',
                    detail: 'Before=' + tx.balanceBefore + ' ' + tx.type + ' ' + tx.amount + ' should = ' + expectedAfter.toFixed(2) + ' but got ' + tx.balanceAfter
                });
            }
            prevAfter = parseFloat(tx.balanceAfter);
        }

        // Check for duplicate debits (same amount, same second)
        if (tx.type === 'debit' && tx.status === 'completed' && i > 0) {
            const prevTx = txRes.rows[i - 1];
            if (prevTx.type === 'debit' && prevTx.status === 'completed') {
                const timeDiff = Math.abs(new Date(tx.createdAt) - new Date(prevTx.createdAt));
                if (timeDiff < 3000 && parseFloat(tx.amount) === parseFloat(prevTx.amount)) {
                    flag += ' *** POSSIBLE DOUBLE CHARGE (same amount within 3s)';
                    issues.push({
                        txNum: i + 1,
                        date: date,
                        type: 'DOUBLE_CHARGE',
                        detail: 'Same amount GHS ' + parseFloat(tx.amount).toFixed(2) + ' within ' + timeDiff + 'ms of previous debit'
                    });
                }
            }
        }

        // Check for debit without matching order
        if (tx.type === 'debit' && tx.status === 'completed' && tx.paymentMethod === 'order' && !tx.orderId) {
            flag += ' *** DEBIT WITHOUT ORDER ID';
            issues.push({
                txNum: i + 1,
                date: date,
                type: 'ORPHAN_DEBIT',
                detail: 'Debit of GHS ' + parseFloat(tx.amount).toFixed(2) + ' has no orderId'
            });
        }

        console.log('  ' + num + ' | ' + date + ' | ' + type + ' | ' + amount + ' | ' + before + ' | ' + after + ' | ' + method + ' | ' + status + ' | ' + desc + flag);
    });

    // Cross-check: every completed debit with paymentMethod=order should have a matching order
    console.log('\n\n=== CROSS-CHECK: DEBIT vs ORDER MATCH ===\n');
    const orderDebits = txRes.rows.filter(tx => tx.type === 'debit' && tx.status === 'completed' && tx.paymentMethod === 'order');
    
    for (const tx of orderDebits) {
        let orderFound = false;
        let orderStatus = '';
        
        if (tx.orderId) {
            const oRes = await c.query("SELECT \"orderId\", total, \"deliveryStatus\" FROM orders WHERE id = $1", [tx.orderId]);
            if (oRes.rows.length > 0) {
                orderFound = true;
                const o = oRes.rows[0];
                orderStatus = '#' + o.orderId + ' | GHS ' + parseFloat(o.total).toFixed(2) + ' | ' + o.deliveryStatus;
                const amountMatch = Math.abs(parseFloat(o.total) - parseFloat(tx.amount)) < 0.01;
                if (!amountMatch) {
                    console.log('  *** AMOUNT MISMATCH: Tx amount GHS ' + parseFloat(tx.amount).toFixed(2) + ' != Order total GHS ' + parseFloat(o.total).toFixed(2));
                    issues.push({ type: 'AMOUNT_MISMATCH', detail: 'Tx ' + tx.reference + ' amount != order total' });
                }
            }
        }
        
        // Also try reference match
        if (!orderFound && tx.reference) {
            const refNum = tx.reference.replace('ORDER-', '');
            const oRes2 = await c.query("SELECT \"orderId\", total, \"deliveryStatus\" FROM orders WHERE \"orderId\" = $1", [refNum]);
            if (oRes2.rows.length > 0) {
                orderFound = true;
                const o = oRes2.rows[0];
                orderStatus = '#' + o.orderId + ' | GHS ' + parseFloat(o.total).toFixed(2) + ' | ' + o.deliveryStatus;
            }
        }

        const mark = orderFound ? 'OK' : '*** MISSING ORDER';
        console.log('  ' + tx.reference + ' | GHS ' + parseFloat(tx.amount).toFixed(2) + ' | ' + (orderFound ? orderStatus : 'ORDER NOT FOUND') + ' | ' + mark);
    }

    // Check for orders without matching debit
    console.log('\n=== CROSS-CHECK: ORDER vs DEBIT MATCH ===\n');
    const ordersRes = await c.query(
        "SELECT * FROM orders WHERE \"userId\" = $1 AND \"paymentStatus\" = 'Completed' ORDER BY \"createdAt\" ASC",
        [user.id]
    );
    
    for (const order of ordersRes.rows) {
        const matchTx = await c.query(
            "SELECT id, amount, status FROM transactions WHERE \"orderId\" = $1 AND type = 'debit'",
            [order.id]
        );
        if (matchTx.rows.length === 0) {
            // Try reference
            const matchRef = await c.query(
                "SELECT id, amount, status FROM transactions WHERE reference = $1 AND type = 'debit'",
                ['ORDER-' + order.orderId]
            );
            if (matchRef.rows.length === 0) {
                console.log('  *** Order #' + order.orderId + ' (GHS ' + parseFloat(order.total).toFixed(2) + ') has NO matching debit transaction!');
                issues.push({ type: 'ORDER_NO_DEBIT', detail: 'Order #' + order.orderId + ' paid but no debit record' });
            } else {
                console.log('  Order #' + order.orderId + ' -> matched by reference OK');
            }
        } else {
            console.log('  Order #' + order.orderId + ' -> matched by orderId OK | Debit GHS ' + parseFloat(matchTx.rows[0].amount).toFixed(2));
        }
    }

    // Summary
    console.log('\n\n========================================');
    console.log('=== SUMMARY ===');
    console.log('========================================');
    console.log('  Total transactions: ' + txRes.rows.length);
    console.log('  Total credits:      GHS ' + totalCredits.toFixed(2));
    console.log('  Total debits:       GHS ' + totalDebits.toFixed(2));
    console.log('  Expected balance:   GHS ' + (totalCredits - totalDebits).toFixed(2));
    
    const wallet = await c.query("SELECT balance FROM wallets WHERE \"userId\" = $1", [user.id]);
    const actualBalance = parseFloat(wallet.rows[0].balance);
    console.log('  Actual balance:     GHS ' + actualBalance.toFixed(2));
    console.log('  Discrepancy:        GHS ' + (actualBalance - (totalCredits - totalDebits)).toFixed(2));
    
    console.log('\n  Chain breaks: ' + chainBreaks.length);
    if (chainBreaks.length > 0) {
        chainBreaks.forEach(b => {
            console.log('    Tx #' + b.txNum + ' | ' + b.date + ' | Expected before: ' + b.expectedBefore + ' | Actual before: ' + b.actualBefore + ' | Gap: GHS ' + b.gap + ' | ' + b.desc);
        });
    }
    
    console.log('\n  Issues found: ' + issues.length);
    if (issues.length > 0) {
        issues.forEach(iss => {
            console.log('    [' + iss.type + '] ' + iss.detail);
        });
    } else {
        console.log('    No issues detected - all transactions are clean and properly chained');
    }

    await c.end();
    console.log('\n=== AUDIT COMPLETE ===');
}

deepAudit().catch(e => console.error('Error:', e));

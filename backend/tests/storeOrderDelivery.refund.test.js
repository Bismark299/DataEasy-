/**
 * Tests for the automatic Paystack refund flow for MCBIS-cancelled store orders.
 *
 * Paystack is fully mocked. StoreOrder is backed by an in-memory fake with a
 * per-row mutex so that `findByPk(..., { lock })` actually serializes the
 * two-phase claim the way Postgres FOR UPDATE does — this lets us prove the
 * concurrent double-call case issues only one refund.
 */

// ── In-memory fake DB with row-level locking ──
const db = { orders: new Map(), mutexes: new Map() };

function makeMutex() {
    let tail = Promise.resolve();
    return function acquire() {
        let release;
        const next = new Promise(r => { release = r; });
        const ready = tail;
        tail = tail.then(() => next);
        return ready.then(() => release);
    };
}

function rowMutex(id) {
    if (!db.mutexes.has(id)) db.mutexes.set(id, makeMutex());
    return db.mutexes.get(id);
}

function makeInstance(id) {
    const record = db.orders.get(id);
    const inst = { ...JSON.parse(JSON.stringify(record)) };
    inst.update = async (updates) => {
        Object.assign(db.orders.get(id), JSON.parse(JSON.stringify(updates)));
        Object.assign(inst, JSON.parse(JSON.stringify(updates)));
        return inst;
    };
    inst.reload = async () => makeInstance(id);
    return inst;
}

const fakeSequelize = {
    transaction: async () => {
        const releases = [];
        const t = {
            _releases: releases,
            LOCK: { UPDATE: 'UPDATE' },
            commit: async () => { releases.splice(0).forEach(r => r()); },
            rollback: async () => { releases.splice(0).forEach(r => r()); }
        };
        return t;
    }
};

const fakeStoreOrder = {
    findByPk: async (id, opts = {}) => {
        if (!db.orders.has(id)) return null;
        if (opts.lock && opts.transaction) {
            const release = await rowMutex(id)();
            opts.transaction._releases.push(release);
        }
        return makeInstance(id);
    },
    findAll: async ({ where } = {}) => {
        const statuses = (where && where.status && where.status[Object.getOwnPropertySymbols(where.status)[0]]) || null;
        return [...db.orders.keys()]
            .map(id => makeInstance(id))
            .filter(o => !statuses || statuses.includes(o.status));
    }
};

jest.mock('../config/database', () => ({ sequelize: fakeSequelize }));
jest.mock('../models', () => ({ StoreOrder: fakeStoreOrder, Setting: { shouldDeliverViaMcbis: jest.fn() } }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/ledgerService', () => ({ recordSale: jest.fn() }));
jest.mock('../services/mcbisProvider', () => ({ deliverBundle: jest.fn(), checkOrderStatus: jest.fn() }));
jest.mock('../services/dispatchLock', () => ({ claim: jest.fn(() => true), release: jest.fn() }));
jest.mock('../config/paystack', () => ({
    refundTransaction: jest.fn(),
    listRefunds: jest.fn()
}));

const paystack = require('../config/paystack');
const mcbisProvider = require('../services/mcbisProvider');
const svc = require('../services/storeOrderDelivery');

const TEN_MIN = 10 * 60 * 1000;

function seedOrder(overrides = {}) {
    const id = overrides.id || 1;
    db.orders.set(id, {
        id,
        orderId: 'SO-1001',
        status: 'paid',
        deliveryStatus: 'Failed',
        paymentReference: 'PSK_REF_1',
        subtotal: 10, commission: 1, netAmount: 9, totalCost: 8,
        items: [{ network: 'MTN', data: '5GB', lineTotal: 10, quantity: 1, deliveryStatus: 'Failed' }],
        createdAt: new Date().toISOString(),
        ...overrides
    });
    return id;
}

beforeEach(() => {
    db.orders.clear();
    db.mutexes.clear();
    jest.clearAllMocks();
    paystack.refundTransaction.mockResolvedValue({ status: true });
    paystack.listRefunds.mockResolvedValue({ data: [] });
});

describe('refundCancelledItem — happy path', () => {
    test('issues one Paystack refund and marks item refunded, order refunded', async () => {
        const id = seedOrder();
        await svc.refundCancelledItem(id, 0, 'Delivery cancelled by provider');

        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
        expect(paystack.refundTransaction).toHaveBeenCalledWith({
            transaction: 'PSK_REF_1',
            amount: 10,
            merchant_note: expect.stringContaining('order SO-1001 item 1')
        });

        const order = db.orders.get(id);
        expect(order.items[0].refundStatus).toBe('refunded');
        expect(order.items[0].refundAmount).toBe(10);
        expect(order.items[0].refundedAt).toBeTruthy();
        expect(order.status).toBe('refunded'); // all items refunded → order refunded
    });

    test('does nothing for an order without a payment reference', async () => {
        const id = seedOrder({ paymentReference: null });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].refundStatus).toBeUndefined();
    });

    test('does nothing for a non-paid/non-fulfilled order', async () => {
        const id = seedOrder({ status: 'pending' });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).not.toHaveBeenCalled();
    });

    test('is idempotent once refunded', async () => {
        const id = seedOrder();
        await svc.refundCancelledItem(id, 0, 'x');
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
    });
});

describe('refundCancelledItem — concurrency', () => {
    test('two concurrent calls issue exactly one refund', async () => {
        const id = seedOrder();
        // Slow the Paystack call so both callers overlap phase 1 + 2
        paystack.refundTransaction.mockImplementation(
            () => new Promise(r => setTimeout(() => r({ status: true }), 50))
        );
        await Promise.all([
            svc.refundCancelledItem(id, 0, 'x'),
            svc.refundCancelledItem(id, 0, 'x')
        ]);
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
        expect(db.orders.get(id).items[0].refundStatus).toBe('refunded');
    });

    test('a fresh (non-stale) processing claim is not re-attempted', async () => {
        const id = seedOrder();
        db.orders.get(id).items[0].refundStatus = 'processing';
        db.orders.get(id).items[0].refundClaimedAt = new Date().toISOString();
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).not.toHaveBeenCalled();
        expect(paystack.listRefunds).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].refundStatus).toBe('processing');
    });
});

describe('refundCancelledItem — stale-claim reconciliation', () => {
    function seedStale() {
        const id = seedOrder();
        const item = db.orders.get(id).items[0];
        item.refundStatus = 'processing';
        item.refundClaimedAt = new Date(Date.now() - TEN_MIN - 60000).toISOString();
        return id;
    }

    test('finds the existing Paystack refund and does NOT refund again', async () => {
        const id = seedStale();
        paystack.listRefunds.mockResolvedValue({
            data: [{ merchant_note: 'Auto-refund: x — order SO-1001 item 1', status: 'processed' }]
        });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.listRefunds).toHaveBeenCalledWith('PSK_REF_1');
        expect(paystack.refundTransaction).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].refundStatus).toBe('refunded');
    });

    test('no matching Paystack refund → issues the refund now', async () => {
        const id = seedStale();
        paystack.listRefunds.mockResolvedValue({
            data: [{ merchant_note: 'something else', status: 'processed' }]
        });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
        expect(db.orders.get(id).items[0].refundStatus).toBe('refunded');
    });

    test('ignores failed/reversed refunds during reconciliation', async () => {
        const id = seedStale();
        paystack.listRefunds.mockResolvedValue({
            data: [{ merchant_note: 'Auto-refund: x — order SO-1001 item 1', status: 'failed' }]
        });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
    });
});

describe('refundCancelledItem — Paystack failure', () => {
    test('marks refundStatus failed with the error, order stays paid', async () => {
        const id = seedOrder();
        paystack.refundTransaction.mockRejectedValue(new Error('Insufficient balance'));
        await svc.refundCancelledItem(id, 0, 'x');
        const item = db.orders.get(id).items[0];
        expect(item.refundStatus).toBe('failed');
        expect(item.refundError).toBe('Insufficient balance');
        expect(item.refundAmount).toBeUndefined();
        expect(db.orders.get(id).status).toBe('paid');
    });

    test('failed refund can be retried after a stale re-claim window', async () => {
        const id = seedOrder();
        paystack.refundTransaction.mockRejectedValueOnce(new Error('boom'));
        await svc.refundCancelledItem(id, 0, 'x');
        expect(db.orders.get(id).items[0].refundStatus).toBe('failed');
        // A later call (e.g. admin retry) succeeds
        await svc.refundCancelledItem(id, 0, 'x');
        expect(db.orders.get(id).items[0].refundStatus).toBe('refunded');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(2);
    });
});

describe('order status flip with multiple items', () => {
    test('order flips to refunded only when ALL items are refunded', async () => {
        const id = seedOrder({
            items: [
                { network: 'MTN', data: '5GB', lineTotal: 10, quantity: 1, deliveryStatus: 'Failed' },
                { network: 'MTN', data: '2GB', lineTotal: 4, quantity: 1, deliveryStatus: 'Failed' }
            ]
        });
        await svc.refundCancelledItem(id, 0, 'x');
        expect(db.orders.get(id).status).toBe('paid');
        expect(db.orders.get(id).items[0].refundStatus).toBe('refunded');

        await svc.refundCancelledItem(id, 1, 'x');
        expect(db.orders.get(id).status).toBe('refunded');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(2);
    });
});

describe('retryStuckRefunds sweep', () => {
    test('retries only stale processing claims', async () => {
        const staleId = seedOrder({ id: 1, orderId: 'SO-1' });
        const freshId = seedOrder({ id: 2, orderId: 'SO-2' });
        db.orders.get(staleId).items[0].refundStatus = 'processing';
        db.orders.get(staleId).items[0].refundClaimedAt = new Date(Date.now() - TEN_MIN - 60000).toISOString();
        db.orders.get(freshId).items[0].refundStatus = 'processing';
        db.orders.get(freshId).items[0].refundClaimedAt = new Date().toISOString();

        await svc.retryStuckRefunds();

        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
        expect(db.orders.get(staleId).items[0].refundStatus).toBe('refunded');
        expect(db.orders.get(freshId).items[0].refundStatus).toBe('processing');
    }, 15000);
});

describe('pollItem → auto-refund on MCBIS cancellation', () => {
    test('cancelled provider status marks item Failed and refunds it', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [{ network: 'MTN', data: '5GB', lineTotal: 10, quantity: 1, deliveryStatus: 'Processing', providerReference: 'MCB-1' }]
        });
        mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'CANCELLED' });

        await svc.pollItem(makeInstance(id), 0);

        const order = db.orders.get(id);
        expect(order.items[0].deliveryStatus).toBe('Failed');
        expect(order.items[0].refundStatus).toBe('refunded');
        expect(order.status).toBe('refunded');
        expect(paystack.refundTransaction).toHaveBeenCalledTimes(1);
    });

    test('failed (non-cancelled) provider status does NOT auto-refund', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [{ network: 'MTN', data: '5GB', lineTotal: 10, quantity: 1, deliveryStatus: 'Processing', providerReference: 'MCB-1' }]
        });
        mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'failed' });

        await svc.pollItem(makeInstance(id), 0);

        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Failed');
        expect(db.orders.get(id).items[0].refundStatus).toBeUndefined();
        expect(paystack.refundTransaction).not.toHaveBeenCalled();
    });
});

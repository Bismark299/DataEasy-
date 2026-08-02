/**
 * Tests for the dispatch/polling side of store-order delivery.
 *
 * MCBIS is fully mocked. StoreOrder is backed by the same in-memory
 * row-locked fake used by storeOrderDelivery.refund.test.js. Covers:
 *  - deliverItem (via dispatchStoreOrder) skips items that already have a
 *    providerReference (no double-send)
 *  - insufficient MCBIS balance leaves items Pending
 *  - dispatch failure marks items Failed
 *  - updateItem flips the order to 'fulfilled' and records the sale exactly
 *    once when all items deliver
 *  - the sweep skips admin-managed Processing items without a providerReference
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
        return {
            _releases: releases,
            LOCK: { UPDATE: 'UPDATE' },
            commit: async () => { releases.splice(0).forEach(r => r()); },
            rollback: async () => { releases.splice(0).forEach(r => r()); }
        };
    }
};

// Extract values from a `{ [Op.in]: [...] }` / `{ [Op.gte]: ... }` clause
function symValue(clause) {
    if (clause == null || typeof clause !== 'object') return clause;
    const syms = Object.getOwnPropertySymbols(clause);
    return syms.length ? clause[syms[0]] : clause;
}

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
        return [...db.orders.keys()].map(id => makeInstance(id)).filter(o => {
            if (!where) return true;
            if (where.status !== undefined) {
                const s = symValue(where.status);
                if (Array.isArray(s) ? !s.includes(o.status) : o.status !== s) return false;
            }
            if (where.deliveryStatus !== undefined) {
                const d = symValue(where.deliveryStatus);
                if (Array.isArray(d) ? !d.includes(o.deliveryStatus) : o.deliveryStatus !== d) return false;
            }
            if (where.createdAt !== undefined) {
                const min = symValue(where.createdAt);
                if (new Date(o.createdAt) < new Date(min)) return false;
            }
            return true;
        });
    }
};

jest.mock('../config/database', () => ({ sequelize: fakeSequelize }));
jest.mock('../models', () => ({ StoreOrder: fakeStoreOrder, Setting: { shouldDeliverViaMcbis: jest.fn() } }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/ledgerService', () => ({
    recordSale: jest.fn(),
    recordRefund: jest.fn(),
    recordCustomerRefund: jest.fn()
}));
jest.mock('../services/mcbisProvider', () => ({ deliverBundle: jest.fn(), checkOrderStatus: jest.fn() }));
jest.mock('../services/dispatchLock', () => ({ claim: jest.fn(() => true), release: jest.fn() }));
jest.mock('../config/paystack', () => ({ refundTransaction: jest.fn(), listRefunds: jest.fn() }));

const { Setting } = require('../models');
const ledgerService = require('../services/ledgerService');
const mcbisProvider = require('../services/mcbisProvider');
const paystack = require('../config/paystack');
const svc = require('../services/storeOrderDelivery');

function seedOrder(overrides = {}) {
    const id = overrides.id || 1;
    db.orders.set(id, {
        id,
        orderId: 'SO-2001',
        status: 'paid',
        deliveryStatus: 'Pending',
        paymentReference: 'PSK_REF_2',
        customerPhone: '0551234567',
        subtotal: 10, commission: 1, netAmount: 9, totalCost: 8,
        storeId: 'store-1',
        items: [{ network: 'MTN', data: '5GB', costPrice: 8, lineTotal: 10, quantity: 1, deliveryStatus: 'Pending' }],
        createdAt: new Date().toISOString(),
        ...overrides
    });
    return id;
}

beforeEach(() => {
    db.orders.clear();
    db.mutexes.clear();
    jest.clearAllMocks();
    Setting.shouldDeliverViaMcbis.mockResolvedValue(true);
    paystack.refundTransaction.mockResolvedValue({ status: true });
    paystack.listRefunds.mockResolvedValue({ data: [] });
    mcbisProvider.deliverBundle.mockResolvedValue({ status: 'Processing', reference: 'MCB-NEW' });
    mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'processing' });
});

describe('dispatchStoreOrder → deliverItem', () => {
    test('sends a pending item to MCBIS and marks it Processing with the reference', async () => {
        const id = seedOrder();
        await svc.dispatchStoreOrder(id);

        expect(mcbisProvider.deliverBundle).toHaveBeenCalledTimes(1);
        expect(mcbisProvider.deliverBundle).toHaveBeenCalledWith(
            expect.objectContaining({ network: 'MTN', phoneNumber: '0551234567', dataAmount: '5GB' }),
            { skipBalanceCheck: false }
        );
        const order = db.orders.get(id);
        expect(order.items[0].deliveryStatus).toBe('Processing');
        expect(order.items[0].providerReference).toBe('MCB-NEW');
        expect(order.items[0].sentToProviderAt).toBeTruthy();
        expect(order.deliveryStatus).toBe('Processing');
    });

    test('NEVER re-sends an item that already has a providerReference', async () => {
        const id = seedOrder({
            items: [{ network: 'MTN', data: '5GB', costPrice: 8, deliveryStatus: 'Processing', providerReference: 'MCB-OLD' }]
        });
        await svc.dispatchStoreOrder(id);
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].providerReference).toBe('MCB-OLD');
    });

    test('skips already-terminal (Delivered/Failed) items', async () => {
        const id = seedOrder({
            items: [
                { network: 'MTN', data: '5GB', costPrice: 8, deliveryStatus: 'Delivered' },
                { network: 'MTN', data: '2GB', costPrice: 4, deliveryStatus: 'Failed' }
            ]
        });
        await svc.dispatchStoreOrder(id);
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
    });

    test('insufficient MCBIS balance leaves the item Pending (retried next sweep)', async () => {
        const id = seedOrder();
        mcbisProvider.deliverBundle.mockResolvedValue({ status: 'InsufficientBalance', error: 'Low balance' });
        await svc.dispatchStoreOrder(id);
        const item = db.orders.get(id).items[0];
        expect(item.deliveryStatus).toBe('Pending');
        expect(item.deliveryError).toBe('Low balance');
        expect(item.providerReference).toBeUndefined();
        expect(db.orders.get(id).status).toBe('paid');
    });

    test('dispatch failure (no reference) marks the item Failed', async () => {
        const id = seedOrder();
        mcbisProvider.deliverBundle.mockResolvedValue({ status: 'Failed', error: 'Provider rejected' });
        await svc.dispatchStoreOrder(id);
        const item = db.orders.get(id).items[0];
        expect(item.deliveryStatus).toBe('Failed');
        expect(item.deliveryError).toBe('Provider rejected');
    });

    test('dispatch throwing marks the item Failed with the error message', async () => {
        const id = seedOrder();
        mcbisProvider.deliverBundle.mockRejectedValue(new Error('network down'));
        await svc.dispatchStoreOrder(id);
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Failed');
        expect(db.orders.get(id).items[0].deliveryError).toBe('network down');
    });

    test('no recipient phone → item Failed without calling MCBIS', async () => {
        const id = seedOrder({ customerPhone: null });
        await svc.dispatchStoreOrder(id);
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Failed');
        expect(db.orders.get(id).items[0].deliveryError).toBe('No recipient phone number');
    });

    test('auto-delivery disabled for network → item stays Pending', async () => {
        const id = seedOrder();
        Setting.shouldDeliverViaMcbis.mockResolvedValue(false);
        await svc.dispatchStoreOrder(id);
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Pending');
    });

    test('does nothing for a non-paid order', async () => {
        const id = seedOrder({ status: 'pending' });
        await svc.dispatchStoreOrder(id);
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
    });
});

describe('updateItem → fulfillment + recordSale', () => {
    test('flips order to fulfilled and records the sale exactly once when all items deliver', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [
                { network: 'MTN', data: '5GB', deliveryStatus: 'Processing', providerReference: 'MCB-1' },
                { network: 'MTN', data: '2GB', deliveryStatus: 'Processing', providerReference: 'MCB-2' }
            ]
        });

        await svc.updateItem(id, 0, { deliveryStatus: 'Delivered' });
        expect(db.orders.get(id).status).toBe('paid');
        expect(ledgerService.recordSale).not.toHaveBeenCalled();

        await svc.updateItem(id, 1, { deliveryStatus: 'Delivered' });
        const order = db.orders.get(id);
        expect(order.status).toBe('fulfilled');
        expect(order.deliveryStatus).toBe('Delivered');
        expect(order.fulfilledAt).toBeTruthy();
        expect(ledgerService.recordSale).toHaveBeenCalledTimes(1);
        expect(ledgerService.recordSale).toHaveBeenCalledWith('store-1', {
            orderId: 'SO-2001',
            subtotal: 10, commission: 1, netAmount: 9, totalCost: 8
        }, expect.anything());

        // A redundant later update must NOT record the sale again
        await svc.updateItem(id, 1, { deliveryStatus: 'Delivered' });
        expect(ledgerService.recordSale).toHaveBeenCalledTimes(1);
        expect(db.orders.get(id).status).toBe('fulfilled');
    });

    test('does not fulfill or record a sale while any item is not Delivered', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [
                { network: 'MTN', data: '5GB', deliveryStatus: 'Processing', providerReference: 'MCB-1' },
                { network: 'MTN', data: '2GB', deliveryStatus: 'Failed' },
                { network: 'MTN', data: '1GB', deliveryStatus: 'Processing', providerReference: 'MCB-3' }
            ]
        });
        await svc.updateItem(id, 0, { deliveryStatus: 'Delivered' });
        expect(db.orders.get(id).status).toBe('paid');
        expect(db.orders.get(id).deliveryStatus).toBe('Partially Delivered');
        expect(ledgerService.recordSale).not.toHaveBeenCalled();
    });

    test('returns null for a missing order or item index', async () => {
        expect(await svc.updateItem(999, 0, {})).toBeNull();
        const id = seedOrder();
        expect(await svc.updateItem(id, 5, {})).toBeNull();
    });
});

describe('sweepStoreOrders', () => {
    test('skips admin-managed Processing items without a providerReference (no double-send)', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [{ network: 'MTN', data: '5GB', costPrice: 8, deliveryStatus: 'Processing' }] // no providerReference
        });
        await svc.sweepStoreOrders();
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
        expect(mcbisProvider.checkOrderStatus).not.toHaveBeenCalled();
        const item = db.orders.get(id).items[0];
        expect(item.deliveryStatus).toBe('Processing'); // untouched — admin owns it
    });

    test('polls dispatched items and dispatches un-sent Pending items', async () => {
        const id = seedOrder({
            deliveryStatus: 'Processing',
            items: [
                { network: 'MTN', data: '5GB', costPrice: 8, deliveryStatus: 'Processing', providerReference: 'MCB-1' },
                { network: 'MTN', data: '2GB', costPrice: 4, deliveryStatus: 'Pending' }
            ]
        });
        mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'delivered' });
        mcbisProvider.deliverBundle.mockResolvedValue({ status: 'Processing', reference: 'MCB-2' });

        await svc.sweepStoreOrders();

        expect(mcbisProvider.checkOrderStatus).toHaveBeenCalledWith('MCB-1');
        expect(mcbisProvider.deliverBundle).toHaveBeenCalledTimes(1);
        const order = db.orders.get(id);
        expect(order.items[0].deliveryStatus).toBe('Delivered');
        expect(order.items[1].deliveryStatus).toBe('Processing');
        expect(order.items[1].providerReference).toBe('MCB-2');
    }, 15000);

    test('ignores orders that are not paid or already Delivered', async () => {
        seedOrder({ id: 1, status: 'fulfilled', deliveryStatus: 'Delivered' });
        seedOrder({ id: 2, status: 'pending', deliveryStatus: 'Pending' });
        await svc.sweepStoreOrders();
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
        expect(mcbisProvider.checkOrderStatus).not.toHaveBeenCalled();
    });

    test('ignores paid orders older than the 7-day cutoff', async () => {
        seedOrder({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
        await svc.sweepStoreOrders();
        expect(mcbisProvider.deliverBundle).not.toHaveBeenCalled();
    });
});

describe('pollItem status transitions', () => {
    function seedProcessing() {
        return seedOrder({
            deliveryStatus: 'Processing',
            items: [{ network: 'MTN', data: '5GB', deliveryStatus: 'Processing', providerReference: 'MCB-1' }]
        });
    }

    test('delivered status marks the item Delivered', async () => {
        const id = seedProcessing();
        mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'SUCCESS' });
        await svc.pollItem(makeInstance(id), 0);
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Delivered');
        expect(db.orders.get(id).items[0].deliveredAt).toBeTruthy();
    });

    test('unknown/processing status leaves the item untouched', async () => {
        const id = seedProcessing();
        mcbisProvider.checkOrderStatus.mockResolvedValue({ status: 'processing' });
        await svc.pollItem(makeInstance(id), 0);
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Processing');
    });

    test('transient poll error leaves the item untouched for the next sweep', async () => {
        const id = seedProcessing();
        mcbisProvider.checkOrderStatus.mockRejectedValue(new Error('timeout'));
        await svc.pollItem(makeInstance(id), 0);
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Processing');
    });

    test('404 from provider marks the item Failed', async () => {
        const id = seedProcessing();
        const err = new Error('not found');
        err.response = { status: 404 };
        mcbisProvider.checkOrderStatus.mockRejectedValue(err);
        await svc.pollItem(makeInstance(id), 0);
        expect(db.orders.get(id).items[0].deliveryStatus).toBe('Failed');
        expect(db.orders.get(id).items[0].deliveryError).toBe('Provider reference not found (404)');
    });
});

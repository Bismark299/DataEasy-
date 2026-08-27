const { extractConfirmedOrderStatus } = require('../services/mcbisProvider');

describe('MCBIS confirmed order-status extraction', () => {
    test('accepts a nested order status only when its reference matches', () => {
        expect(extractConfirmedOrderStatus({
            data: {
                status: 'success',
                order: { status: 'cancelled', reference: 'BT-123' }
            }
        }, 'BT-123')).toEqual(expect.objectContaining({
            status: 'cancelled',
            confirmedOrderStatus: true,
            orderReference: 'BT-123'
        }));
    });

    test('does not mistake an API-level error for a failed order', () => {
        expect(extractConfirmedOrderStatus({
            data: { status: 'error', message: 'Provider unavailable' }
        }, 'BT-123')).toEqual(expect.objectContaining({
            status: 'unknown',
            confirmedOrderStatus: false
        }));
    });

    test('rejects an order status belonging to a different reference', () => {
        expect(extractConfirmedOrderStatus({
            data: {
                status: 'success',
                order: { status: 'failed', reference: 'BT-DIFFERENT' }
            }
        }, 'BT-123')).toEqual(expect.objectContaining({
            status: 'unknown',
            confirmedOrderStatus: false,
            orderReference: 'BT-DIFFERENT'
        }));
    });

    test('accepts a flat explicit orderStatus only with a matching reference', () => {
        expect(extractConfirmedOrderStatus({
            data: { status: 'success', orderStatus: 'delivered', reference: 'BT-123' }
        }, 'BT-123')).toEqual(expect.objectContaining({
            status: 'delivered',
            confirmedOrderStatus: true
        }));
    });

    test('does not trust a terminal-looking top-level status without order evidence', () => {
        expect(extractConfirmedOrderStatus({
            status: 'failed',
            message: 'API request failed'
        }, 'BT-123')).toEqual(expect.objectContaining({
            status: 'unknown',
            confirmedOrderStatus: false
        }));
    });
});
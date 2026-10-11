import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { daysUntil, describeExpiry, expiringItems, todayString } from './expiry';

const item = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const TODAY = '2026-10-10';

describe('daysUntil', () => {
    it('counts calendar days, negative when past', () => {
        assert.strictEqual(daysUntil(TODAY, '2026-10-12'), 2);
        assert.strictEqual(daysUntil(TODAY, '2026-10-08'), -2);
        assert.strictEqual(daysUntil('2026-10-31', '2026-11-01'), 1);
        assert.strictEqual(daysUntil('2026-03-28', '2026-03-30'), 2);
    });

    it('is undefined for a malformed date', () => {
        assert.strictEqual(daysUntil(TODAY, 'soon'), undefined);
    });
});

describe('todayString', () => {
    it('uses the local calendar date', () => {
        assert.strictEqual(todayString(new Date(2026, 9, 3, 23, 30)), '2026-10-03');
    });
});

describe('expiringItems', () => {
    it('includes expired items and those within N days, and leaves out later ones and items without a date', () => {
        const items = [
            item('spinach', { expireDate: '2026-10-12' }),
            item('yogurt', { expireDate: '2026-10-08' }),
            item('cheddar', { expireDate: '2026-10-16' }),
            item('rice'),
        ];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5).map(entry => [entry.name, entry.daysLeft]), [['yogurt', -2], ['spinach', 2]]);
    });

    it('counts the boundary day as within', () => {
        assert.deepStrictEqual(expiringItems([item('milk', { expireDate: '2026-10-15' })], TODAY, 5).map(entry => entry.daysLeft), [5]);
    });

    it('skips out-of-stock items', () => {
        assert.deepStrictEqual(expiringItems([item('cream', { expireDate: '2026-10-11', isOutOfStock: true })], TODAY, 5), []);
    });

    it('keeps the earliest date when a name appears twice', () => {
        const items = [item('Eggs', { expireDate: '2026-10-14' }), item('egg', { expireDate: '2026-10-11' })];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5), [{ name: 'egg', key: 'egg', expireDate: '2026-10-11', daysLeft: 1 }]);
    });

    it('sorts by days left, then name', () => {
        const items = [item('leeks', { expireDate: '2026-10-11' }), item('kale', { expireDate: '2026-10-11' }), item('ham', { expireDate: '2026-10-10' })];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5).map(entry => entry.name), ['ham', 'kale', 'leeks']);
    });
});

describe('describeExpiry', () => {
    it('words the days left', () => {
        assert.strictEqual(describeExpiry(-3), 'expired 3 days ago');
        assert.strictEqual(describeExpiry(-1), 'expired yesterday');
        assert.strictEqual(describeExpiry(0), 'expires today');
        assert.strictEqual(describeExpiry(1), 'expires tomorrow');
        assert.strictEqual(describeExpiry(4), 'expires in 4 days');
    });
});

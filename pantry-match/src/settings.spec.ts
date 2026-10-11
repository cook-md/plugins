import * as assert from 'assert';
import { readSettings } from './settings';

const read = (values: Record<string, unknown>) => readSettings(key => values[key]);

describe('readSettings', () => {
    it('falls back to the defaults', () => {
        assert.deepStrictEqual(read({}), {
            alwaysHave: ['salt', 'pepper', 'black pepper', 'water'],
            expiringWithinDays: 5,
            showBadge: true,
        });
    });

    it('keeps trimmed, non-empty strings from alwaysHave', () => {
        assert.deepStrictEqual(read({ alwaysHave: [' olive oil ', '', 3, 'salt'] }).alwaysHave, ['olive oil', 'salt']);
    });

    it('treats an empty alwaysHave as "assume nothing"', () => {
        assert.deepStrictEqual(read({ alwaysHave: [] }).alwaysHave, []);
    });

    it('floors and caps expiringWithinDays, rejecting negatives and non-numbers', () => {
        assert.strictEqual(read({ expiringWithinDays: 2.7 }).expiringWithinDays, 2);
        assert.strictEqual(read({ expiringWithinDays: 1000 }).expiringWithinDays, 365);
        assert.strictEqual(read({ expiringWithinDays: 0 }).expiringWithinDays, 0);
        assert.strictEqual(read({ expiringWithinDays: -1 }).expiringWithinDays, 5);
        assert.strictEqual(read({ expiringWithinDays: '3' }).expiringWithinDays, 5);
    });

    it('turns the badge off only for false', () => {
        assert.strictEqual(read({ showBadge: false }).showBadge, false);
        assert.strictEqual(read({ showBadge: 'no' }).showBadge, true);
    });
});

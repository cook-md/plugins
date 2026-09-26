import * as assert from 'assert';
import { isInactive, readSettings } from './settings';

const reader = (values: Record<string, unknown>) => (key: string): unknown => values[key];

describe('readSettings', () => {
    it('returns the ticked classes in EU-14 order', () => {
        const settings = readSettings(reader({ milk: true, gluten: true, treeNuts: false, eggs: 'yes' }));
        assert.deepStrictEqual(settings.classes.map(c => c.slug), ['gluten', 'milk']);
    });

    it('trims custom words, drops blanks, over-long and non-string entries, dedupes case-insensitively', () => {
        const settings = readSettings(reader({ custom: [' Coriander ', 'coriander', '', '   ', 42, 'x'.repeat(41), 'Mushroom'] }));
        assert.deepStrictEqual(settings.customWords, ['Coriander', 'Mushroom']);
    });

    it('treats a non-array custom setting as empty', () => {
        assert.deepStrictEqual(readSettings(reader({ custom: 'coriander' })).customWords, []);
    });

    it('shows the locked hint unless explicitly disabled', () => {
        assert.strictEqual(readSettings(reader({})).showWhenLocked, true);
        assert.strictEqual(readSettings(reader({ showWhenLocked: false })).showWhenLocked, false);
    });

    it('is inactive with nothing ticked and no custom words', () => {
        assert.strictEqual(isInactive(readSettings(reader({}))), true);
        assert.strictEqual(isInactive(readSettings(reader({ custom: ['kiwi'] }))), false);
        assert.strictEqual(isInactive(readSettings(reader({ fish: true }))), false);
    });
});

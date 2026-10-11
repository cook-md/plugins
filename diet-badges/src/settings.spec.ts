import * as assert from 'assert';
import { DIET_IDS, isInactive, readSettings } from './settings';

const reader = (values: Record<string, unknown>) => (key: string): unknown => values[key];

describe('readSettings', () => {
    it('enables every diet and the locked hint by default', () => {
        assert.deepStrictEqual(readSettings(reader({})), {
            diets: { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true },
            extraNonVegan: [],
            showWhenLocked: true,
        });
    });

    it('only an explicit false switches a diet or the locked hint off', () => {
        const settings = readSettings(reader({ vegan: false, dairyFree: false, vegetarian: 'no', showWhenLocked: false }));
        assert.deepStrictEqual(settings.diets, { vegan: false, vegetarian: true, pescatarian: true, dairyFree: false });
        assert.strictEqual(settings.showWhenLocked, false);
    });

    it('cleans extra non-vegan words: control characters and whitespace runs become one space, blanks, over-long, non-string and duplicate entries are dropped', () => {
        const settings = readSettings(reader({ extraNonVegan: ['  Bone\tbroth ', 'bone broth', '', '   ', 42, 'x'.repeat(41), 'carmine', 'a\u0000b'] }));
        assert.deepStrictEqual(settings.extraNonVegan, ['Bone broth', 'carmine', 'a b']);
    });

    it('treats a non-array word list as empty', () => {
        assert.deepStrictEqual(readSettings(reader({ extraNonVegan: 'honey' })).extraNonVegan, []);
    });

    it('lists the diets strictest first, Dairy-free last', () => {
        assert.deepStrictEqual(DIET_IDS, ['vegan', 'vegetarian', 'pescatarian', 'dairyFree']);
    });
});

describe('isInactive', () => {
    it('is true only when every diet is switched off', () => {
        assert.strictEqual(isInactive(readSettings(reader({}))), false);
        assert.strictEqual(isInactive(readSettings(reader({ vegan: false, vegetarian: false, pescatarian: false, dairyFree: false }))), true);
        assert.strictEqual(isInactive(readSettings(reader({ vegan: false, vegetarian: false, pescatarian: false }))), false);
    });
});

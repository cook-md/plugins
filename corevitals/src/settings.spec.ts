import * as assert from 'assert';
import { DEFAULT_MICRONUTRIENTS, MAX_MICRONUTRIENTS, readSettings } from './settings';

function read(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

describe('readSettings', () => {
    it('uses the defaults when nothing is set', () => {
        const settings = readSettings(read({}));
        assert.deepStrictEqual(settings, {
            standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
            micronutrients: [...DEFAULT_MICRONUTRIENTS], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
        });
    });

    it('accepts the three standards and falls back to fda otherwise', () => {
        assert.strictEqual(readSettings(read({ standard: 'eu' })).standard, 'eu');
        assert.strictEqual(readSettings(read({ standard: 'uk' })).standard, 'uk');
        assert.strictEqual(readSettings(read({ standard: 'who' })).standard, 'fda');
    });

    it('drops negative, non-finite and non-numeric numbers', () => {
        const settings = readSettings(read({ energyKcal: -5, tolerancePercent: Number.NaN, mealsPerDay: '4' }));
        assert.strictEqual(settings.energyKcal, 0);
        assert.strictEqual(settings.tolerancePercent, 20);
        assert.strictEqual(settings.mealsPerDay, 3);
    });

    it('treats macro overrides outside 1–100 as unset', () => {
        const settings = readSettings(read({ proteinPercent: 0.5, carbPercent: 101, fatPercent: 30 }));
        assert.strictEqual(settings.proteinPercent, 0);
        assert.strictEqual(settings.carbPercent, 0);
        assert.strictEqual(settings.fatPercent, 30);
    });

    it('drops all macro overrides when the set ones add up to more than 100', () => {
        const settings = readSettings(read({ proteinPercent: 40, carbPercent: 50, fatPercent: 30 }));
        assert.deepStrictEqual([settings.proteinPercent, settings.carbPercent, settings.fatPercent], [0, 0, 0]);
        const partial = readSettings(read({ proteinPercent: 60, fatPercent: 50 }));
        assert.deepStrictEqual([partial.proteinPercent, partial.carbPercent, partial.fatPercent], [0, 0, 0]);
        const fits = readSettings(read({ proteinPercent: 30, carbPercent: 40, fatPercent: 30 }));
        assert.deepStrictEqual([fits.proteinPercent, fits.carbPercent, fits.fatPercent], [30, 40, 30]);
    });

    it('clamps tolerance to 0–100 and meals per day to 1–10, rounding meals', () => {
        assert.strictEqual(readSettings(read({ tolerancePercent: 250 })).tolerancePercent, 100);
        assert.strictEqual(readSettings(read({ mealsPerDay: 0 })).mealsPerDay, 1);
        assert.strictEqual(readSettings(read({ mealsPerDay: 2.6 })).mealsPerDay, 3);
        assert.strictEqual(readSettings(read({ mealsPerDay: 40 })).mealsPerDay, 10);
    });

    it('normalises micronutrient keys: trims, lower-cases, validates, de-duplicates, drops always-checked keys', () => {
        const settings = readSettings(read({ micronutrients: [' Iron_mg ', 'iron_mg', 'vit_c_mg', 'Bad Key', 42, 'sodium_mg', 'kcal', ''] }));
        assert.deepStrictEqual(settings.micronutrients, ['iron_mg', 'vit_c_mg']);
    });

    it('keeps an explicitly empty list empty and caps the list', () => {
        assert.deepStrictEqual(readSettings(read({ micronutrients: [] })).micronutrients, []);
        const many = Array.from({ length: 40 }, (_, i) => `n${i}_mg`);
        assert.strictEqual(readSettings(read({ micronutrients: many })).micronutrients.length, MAX_MICRONUTRIENTS);
    });

    it('reads showWhenLocked as false only when explicitly false', () => {
        assert.strictEqual(readSettings(read({ showWhenLocked: false })).showWhenLocked, false);
        assert.strictEqual(readSettings(read({ showWhenLocked: 'no' })).showWhenLocked, true);
    });
});

import * as assert from 'assert';
import { isConfident, summarizeMatch } from './match';
import { NutritionAggregate } from './nutrition-template';

const zero = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 };

function aggregate(matched: number, placeholders: string[], failures: string[]): NutritionAggregate {
    return {
        items: [
            ...Array.from({ length: matched }, (_, index) => ({ ingredient: `item ${index}`, amount: { mass_g: 100 }, warnings: [] })),
            ...placeholders.map(ingredient => ({ ingredient, amount: { mass_g: 0 }, warnings: [{ code: 'nutrition_placeholder' }] })),
        ],
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: matched * 100, macros: zero },
    };
}

describe('summarizeMatch', () => {
    it('counts placeholders and failures as unmatched, failures listed first', () => {
        assert.deepStrictEqual(summarizeMatch(aggregate(3, ['chana dal'], ['ghee'])), { matched: 3, total: 5, unmatched: ['ghee', 'chana dal'] });
    });

    it('is empty for a recipe without ingredients', () => {
        assert.deepStrictEqual(summarizeMatch(aggregate(0, [], [])), { matched: 0, total: 0, unmatched: [] });
    });
});

describe('isConfident', () => {
    it('needs at least 70 % matched', () => {
        assert.strictEqual(isConfident(summarizeMatch(aggregate(7, [], ['a', 'b', 'c']))), true);
        assert.strictEqual(isConfident(summarizeMatch(aggregate(6, ['a'], ['b', 'c', 'd']))), false);
        assert.strictEqual(isConfident(summarizeMatch(aggregate(2, [], ['a']))), false);
    });

    it('is false when nothing could be evaluated', () => {
        assert.strictEqual(isConfident(summarizeMatch(aggregate(0, [], []))), false);
    });
});

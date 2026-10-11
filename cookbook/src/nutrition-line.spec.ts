import * as assert from 'assert';
import { NUTRITION_TEMPLATE, nutritionLine, parseNutritionOutput, servingsFromMetadata } from './nutrition-line';

const macros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 6, sugar_g: 8, sat_fat_g: 2 };
const item = (ingredient: string, warnings: unknown[] = []) => ({ ingredient, amount: { value: 1, unit: '', mass_g: 100 }, macros, micros: {}, warnings });

describe('NUTRITION_TEMPLATE', () => {
    it('returns the aggregate as JSON', () => {
        assert.strictEqual(NUTRITION_TEMPLATE, '{{ aggregate_nutrition(ingredients) | tojson }}');
    });
});

describe('parseNutritionOutput', () => {
    it('reads the macros and counts placeholders and failures as unmatched', () => {
        const output = JSON.stringify({
            items: [item('a'), item('b'), item('c', [{ code: 'nutrition_placeholder' }]), item('d', ['nutrition_placeholder'])],
            failures: [{ index: 4, ingredient: 'e', error: { code: 'x', message: 'y' } }],
            totals: { mass_g: 400, macros, micros: {} },
        });
        assert.deepStrictEqual(parseNutritionOutput(output), { kcal: 2080, protein_g: 152, carb_g: 208, fat_g: 56, matched: 2, total: 5 });
    });

    it('rejects output that is not an aggregate', () => {
        assert.strictEqual(parseNutritionOutput('nope'), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ items: [], failures: [], totals: { macros: { kcal: '1' } } })), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ items: [], totals: { macros } })), undefined);
    });
});

describe('servingsFromMetadata', () => {
    it('reads servings, serves or yield', () => {
        assert.strictEqual(servingsFromMetadata({ servings: 4 }), 4);
        assert.strictEqual(servingsFromMetadata({ Serves: '6 people' }), 6);
        assert.strictEqual(servingsFromMetadata({ yield: '2|4' }), 2);
    });

    it('is undefined when absent, non-numeric or out of range', () => {
        assert.strictEqual(servingsFromMetadata({}), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 'a few' }), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 0 }), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 5000 }), undefined);
    });
});

describe('nutritionLine', () => {
    const summary = { kcal: 2080, protein_g: 152, carb_g: 208, fat_g: 56, matched: 7, total: 10 };

    it('divides by servings', () => {
        assert.strictEqual(nutritionLine(summary, 4), 'Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat');
    });

    it('labels the whole recipe when servings are unknown', () => {
        assert.strictEqual(nutritionLine(summary, undefined), 'Whole recipe: 2080 kcal · 152 g protein · 208 g carbs · 56 g fat');
    });

    it('is withheld below a 70 % match or with nothing matched', () => {
        assert.strictEqual(nutritionLine({ ...summary, matched: 6 }, 4), undefined);
        assert.strictEqual(nutritionLine({ ...summary, matched: 0, total: 0 }, 4), undefined);
    });
});

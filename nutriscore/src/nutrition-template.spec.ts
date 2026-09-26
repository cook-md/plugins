import * as assert from 'assert';
import { nutritionTemplate, parseNutritionOutput } from './nutrition-template';

const aggregate = {
    items: [
        { ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'flour', preparation: '', amount: { value: 200, unit: 'g', mass_g: 200 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 500 },
};

describe('nutritionTemplate', () => {
    it('embeds the category slugs and returns JSON through tojson', () => {
        const template = nutritionTemplate(['fruit', 'vegetable']);
        assert.ok(template.startsWith('{%- set categories = ["fruit","vegetable"] -%}'));
        assert.ok(template.includes('aggregate_nutrition(ingredients)'));
        assert.ok(template.trimEnd().endsWith('{{ {"aggregate": agg, "categoryIngredients": found.names} | tojson }}'));
    });

    it('rejects slugs that could break the template', () => {
        assert.throws(() => nutritionTemplate(['fruit"] %}{{ x']), /slug/);
    });
});

describe('parseNutritionOutput', () => {
    it('sums the mass of category ingredients', () => {
        const data = parseNutritionOutput(JSON.stringify({ aggregate, categoryIngredients: ['apple'] }), true);
        assert.strictEqual(data?.categoryMassG, 300);
        assert.strictEqual(data?.aggregate.totals.mass_g, 500);
    });

    it('leaves categoryMassG undefined when no categories were requested', () => {
        const data = parseNutritionOutput(JSON.stringify({ aggregate, categoryIngredients: [] }), false);
        assert.strictEqual(data?.categoryMassG, undefined);
    });

    it('returns undefined for output that is not the template result', () => {
        assert.strictEqual(parseNutritionOutput('not json', true), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: {} }), true), undefined);
    });
});

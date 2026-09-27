import * as assert from 'assert';
import { NutritionItem, isPlaceholder, nutritionTemplate, parseNutritionOutput } from './nutrition-template';

const macros = { kcal: 400, protein_g: 10, fat_g: 5, carb_g: 50, fiber_g: 6, sugar_g: 8, sat_fat_g: 2 };

const aggregate = {
    items: [
        { ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'flour', preparation: '', amount: { value: 200, unit: 'g', mass_g: 200 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 500, macros, micros: {} },
};

describe('nutritionTemplate', () => {
    it('embeds the category slugs and returns JSON through tojson', () => {
        const template = nutritionTemplate(['fruits', 'vegetables']);
        assert.ok(template.startsWith('{%- set categories = ["fruits","vegetables"] -%}'));
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

    it('rejects a null totals', () => {
        const bad = { ...aggregate, totals: null };
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: bad, categoryIngredients: [] }), false), undefined);
    });

    it('rejects totals missing macros', () => {
        const bad = { items: [], failures: [], totals: { mass_g: 500, micros: {} } };
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: bad, categoryIngredients: [] }), false), undefined);
    });

    it('rejects totals with a missing or non-numeric macro field', () => {
        const { kcal, ...macrosWithoutKcal } = macros;
        const missingField = { items: [], failures: [], totals: { mass_g: 500, macros: macrosWithoutKcal, micros: {} } };
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: missingField, categoryIngredients: [] }), false), undefined);

        const stringField = { items: [], failures: [], totals: { mass_g: 500, macros: { ...macros, kcal: '12' }, micros: {} } };
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ aggregate: stringField, categoryIngredients: [] }), false), undefined);
    });

    it('drops malformed items and failures but keeps valid ones, and sums mass correctly', () => {
        const withJunk = {
            ...aggregate,
            items: [
                ...aggregate.items,
                { ingredient: 'apple' }, // missing amount.mass_g
                { amount: { mass_g: 999 } }, // missing ingredient
                'not an object',
                null,
            ],
            failures: [
                { ingredient: 'salt' },
                { error: { code: 'x', message: 'y' } }, // missing ingredient
                42,
            ],
        };
        const data = parseNutritionOutput(JSON.stringify({ aggregate: withJunk, categoryIngredients: ['apple'] }), true);
        assert.strictEqual(data?.aggregate.items.length, 2);
        assert.strictEqual(data?.aggregate.failures.length, 1);
        assert.strictEqual(data?.categoryMassG, 300);
    });

    it('keeps warnings on validated items, including a nutrition_placeholder one, and tolerates a missing warnings field', () => {
        const withWarnings = {
            ...aggregate,
            items: [
                {
                    ingredient: 'chana dal', preparation: '', amount: { value: 0, unit: '', mass_g: 0 }, macros: {}, micros: {},
                    source: 'usda', confidence: 'estimated', warnings: [{ code: 'nutrition_placeholder', message: 'unresolved' }],
                },
                // No `warnings` field at all -- must not be dropped or crash.
                { ingredient: 'flour', preparation: '', amount: { value: 200, unit: 'g', mass_g: 200 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed' },
            ],
        };
        const data = parseNutritionOutput(JSON.stringify({ aggregate: withWarnings, categoryIngredients: [] }), false);
        assert.strictEqual(data?.aggregate.items.length, 2);
        assert.deepStrictEqual(data?.aggregate.items[0].warnings, [{ code: 'nutrition_placeholder', message: 'unresolved' }]);
        assert.strictEqual(data?.aggregate.items[1].warnings, undefined);
    });
});

describe('isPlaceholder', () => {
    const base = {
        ingredient: 'x', preparation: '', amount: { value: 0, unit: '', mass_g: 0 },
        macros: {}, micros: {}, source: 'usda', confidence: 'estimated',
    };

    it('detects a warning object with code "nutrition_placeholder"', () => {
        const item = { ...base, warnings: [{ code: 'nutrition_placeholder', message: 'unresolved' }] } as unknown as NutritionItem;
        assert.strictEqual(isPlaceholder(item), true);
    });

    it('detects a bare string "nutrition_placeholder" warning', () => {
        const item = { ...base, warnings: ['nutrition_placeholder'] } as unknown as NutritionItem;
        assert.strictEqual(isPlaceholder(item), true);
    });

    it('is false for an unrelated warning code, an empty warnings array, or a missing warnings field', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: [{ code: 'some_other_warning' }] } as unknown as NutritionItem), false);
        assert.strictEqual(isPlaceholder({ ...base, warnings: [] } as unknown as NutritionItem), false);
        assert.strictEqual(isPlaceholder({ ...base } as unknown as NutritionItem), false);
    });

    it('is false when warnings is not an array', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: 'nutrition_placeholder' } as unknown as NutritionItem), false);
    });
});

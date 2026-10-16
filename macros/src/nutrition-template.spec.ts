import * as assert from 'assert';
import { MACROS_TEMPLATE, NutritionItem, isPlaceholder, parseMacrosOutput } from './nutrition-template';

const macros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

const aggregate = {
    items: [
        { ingredient: 'chicken', preparation: '', amount: { value: 600, unit: 'g', mass_g: 600 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'rice', preparation: '', amount: { value: 300, unit: 'g', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 900, macros, micros: {}, confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 2, failed_count: 0 },
};

describe('MACROS_TEMPLATE', () => {
    it('aggregates plan ingredients for menus and recipe ingredients otherwise, returning JSON', () => {
        assert.ok(MACROS_TEMPLATE.startsWith('{%- if plan is defined -%}'));
        assert.ok(MACROS_TEMPLATE.includes('aggregate_nutrition(plan.all_ingredients)'));
        assert.ok(MACROS_TEMPLATE.includes('aggregate_nutrition(ingredients)'));
        assert.ok(MACROS_TEMPLATE.includes('plan.missing_recipes | map(attribute="name") | list'));
        assert.strictEqual(MACROS_TEMPLATE.split('| tojson }}').length, 3);
        assert.ok(MACROS_TEMPLATE.trimEnd().endsWith('{%- endif -%}'));
    });
});

describe('parseMacrosOutput', () => {
    it('counts only day sections of a plan, so Snacks or Batch Prep are not extra days', () => {
        assert.ok(MACROS_TEMPLATE.includes('"day" in (d.name | lower)'));
        assert.ok(!MACROS_TEMPLATE.includes('{%- set days = (plan.days | length) if'));
    });

    it('reads a recipe payload and keeps only the fields it needs', () => {
        const data = parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate }));
        assert.strictEqual(data?.kind, 'recipe');
        assert.deepStrictEqual(data?.aggregate.totals, { mass_g: 900, macros });
        assert.strictEqual(data?.aggregate.items.length, 2);
    });

    it('reads a plan payload with days, people and missing recipes', () => {
        const data = parseMacrosOutput(JSON.stringify({ kind: 'plan', aggregate, days: 7, people: 2, missingRecipes: ['Curry', 3] }));
        assert.deepStrictEqual(data && data.kind === 'plan' ? [data.days, data.people, data.missingRecipes] : undefined, [7, 2, ['Curry']]);
    });

    it('rejects a plan with a non-positive or fractional day count, or a people count below 1 or not a number', () => {
        for (const bad of [{ days: 0, people: 2 }, { days: 7, people: 0 }, { days: 7, people: 0.5 }, { days: 1.5, people: 2 }, { days: 7, people: '2' }]) {
            assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'plan', aggregate, missingRecipes: [], ...bad })), undefined);
        }
    });

    it('accepts fractional people on a plan', () => {
        const data = parseMacrosOutput(JSON.stringify({ kind: 'plan', aggregate, days: 2, people: 2.5, missingRecipes: [] }));
        assert.strictEqual(data?.kind === 'plan' ? data.people : undefined, 2.5);
    });

    it('rejects output that is not the template result', () => {
        assert.strictEqual(parseMacrosOutput('not json'), undefined);
        assert.strictEqual(parseMacrosOutput('[]'), undefined);
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: {} })), undefined);
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'other', aggregate })), undefined);
    });

    it('rejects totals with a missing or non-numeric macro field', () => {
        const { kcal, ...withoutKcal } = macros;
        void kcal;
        const missing = { ...aggregate, totals: { mass_g: 900, macros: withoutKcal } };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: missing })), undefined);
        const stringField = { ...aggregate, totals: { mass_g: 900, macros: { ...macros, protein_g: '12' } } };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: stringField })), undefined);
        const nullTotals = { ...aggregate, totals: null };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: nullTotals })), undefined);
    });

    it('drops malformed items and failures but keeps valid ones', () => {
        const withJunk = {
            ...aggregate,
            items: [...aggregate.items, { ingredient: 'x' }, { amount: { mass_g: 9 } }, 'nope', null],
            failures: [{ ingredient: 'salt' }, { error: {} }, 42],
        };
        const data = parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: withJunk }));
        assert.strictEqual(data?.aggregate.items.length, 2);
        assert.deepStrictEqual(data?.aggregate.failures.map(failure => failure.ingredient), ['salt']);
    });
});

describe('isPlaceholder', () => {
    const base = { ingredient: 'x', amount: { mass_g: 0 } };

    it('detects a nutrition_placeholder warning object or bare string', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: [{ code: 'nutrition_placeholder', message: 'unresolved' }] }), true);
        assert.strictEqual(isPlaceholder({ ...base, warnings: ['nutrition_placeholder'] }), true);
    });

    it('is false for other warnings, no warnings, or a non-array warnings field', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: [{ code: 'something_else' }] }), false);
        assert.strictEqual(isPlaceholder({ ...base, warnings: [] }), false);
        assert.strictEqual(isPlaceholder({ ...base }), false);
        assert.strictEqual(isPlaceholder({ ...base, warnings: 'nutrition_placeholder' } as unknown as NutritionItem), false);
    });
});

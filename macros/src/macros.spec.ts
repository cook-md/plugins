import * as assert from 'assert';
import { computeMacros, normaliseScale, roundGrams, roundKcal } from './macros';
import { MacrosOutput, NutritionAggregate, NutritionMacros } from './nutrition-template';

// Chicken & rice for 4: 152 g protein, 208 g carbs, 56 g fat, 2080 kcal, 900 g.
const MACROS: NutritionMacros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

function aggregate(macros: NutritionMacros = MACROS, massG = 900, failures: string[] = []): NutritionAggregate {
    return {
        items: Array.from({ length: 4 }, (_, index) => ({ ingredient: `item ${index}`, amount: { mass_g: massG / 4 }, warnings: [] })),
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: massG, macros },
    };
}

function times(macros: NutritionMacros, factor: number): NutritionMacros {
    return {
        kcal: macros.kcal * factor, protein_g: macros.protein_g * factor, fat_g: macros.fat_g * factor, carb_g: macros.carb_g * factor,
        fiber_g: macros.fiber_g * factor, sugar_g: macros.sugar_g * factor, sat_fat_g: macros.sat_fat_g * factor,
    };
}

const recipe = (agg: NutritionAggregate = aggregate()): MacrosOutput => ({ kind: 'recipe', aggregate: agg });

describe('rounding', () => {
    it('rounds grams to integers and kcal to the nearest 10', () => {
        assert.strictEqual(roundGrams(37.5), 38);
        assert.strictEqual(roundGrams(0.4), 0);
        assert.strictEqual(roundKcal(524), 520);
        assert.strictEqual(roundKcal(525), 530);
        assert.strictEqual(roundKcal(4), 0);
        assert.ok(Object.is(roundGrams(-0.2), 0));
    });

    it('normalises a missing or broken scale to 1', () => {
        assert.strictEqual(normaliseScale(2), 2);
        assert.strictEqual(normaliseScale(0), 1);
        assert.strictEqual(normaliseScale(Number.NaN), 1);
        assert.strictEqual(normaliseScale(-1), 1);
    });
});

describe('computeMacros', () => {
    it('divides by the servings per serving', () => {
        const result = computeMacros(recipe(), { basis: 'serving', servings: 4, scale: 1 });
        assert.deepStrictEqual(result.portion, { kind: 'serving', servings: 4 });
        assert.deepStrictEqual(result.figures, { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 });
        // 608 + 832 + 504 = 1944 kcal from macros.
        assert.deepStrictEqual(result.shares, { protein: 31, carb: 43, fat: 26 });
        assert.strictEqual(result.withheld, undefined);
    });

    it('keeps per-serving figures when the preview is scaled (the engine scaled the totals)', () => {
        const scaled = computeMacros(recipe(aggregate(times(MACROS, 2), 1800)), { basis: 'serving', servings: 4, scale: 2 });
        const plain = computeMacros(recipe(), { basis: 'serving', servings: 4, scale: 1 });
        assert.deepStrictEqual(scaled.portion, { kind: 'serving', servings: 8 });
        assert.deepStrictEqual(scaled.figures, plain.figures);
    });

    it('shows the whole recipe without servings', () => {
        const result = computeMacros(recipe(), { basis: 'serving', servings: undefined, scale: 1 });
        assert.deepStrictEqual(result.portion, { kind: 'whole' });
        assert.deepStrictEqual(result.figures, { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 });
    });

    it('scales per 100 g by the total mass, ignoring servings and scale', () => {
        const result = computeMacros(recipe(aggregate(times(MACROS, 3), 2700)), { basis: '100g', servings: 4, scale: 3 });
        assert.deepStrictEqual(result.portion, { kind: '100g' });
        // 2080 / 9 = 231.1 kcal, 152 / 9 = 16.9 g protein per 100 g.
        assert.deepStrictEqual(result.figures, { kcal: 230, protein_g: 17, fat_g: 6, carb_g: 23, fiber_g: 3, sugar_g: 4, sat_fat_g: 2 });
    });

    it('withholds per-100 g figures when the service could not weigh the recipe', () => {
        const result = computeMacros(recipe(aggregate(MACROS, 0)), { basis: '100g', servings: undefined, scale: 1 });
        assert.strictEqual(result.withheld, 'notWeighed');
        assert.strictEqual(result.figures, undefined);
    });

    it('divides a plan by people × days, whatever the basis', () => {
        // A week for two: 14 × the daily intake.
        const week = aggregate(times({ kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 }, 14), 30000);
        const plan: MacrosOutput = { kind: 'plan', aggregate: week, days: 7, people: 2, missingRecipes: [] };
        const result = computeMacros(plan, { basis: '100g', servings: 4, scale: 3 });
        assert.deepStrictEqual(result.portion, { kind: 'day', people: 2, days: 7 });
        assert.deepStrictEqual(result.figures, { kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 });
    });

    it('withholds figures when fewer than 70 % of ingredients matched, listing the unmatched', () => {
        const result = computeMacros(recipe(aggregate(MACROS, 900, ['ghee', 'garam masala'])), { basis: 'serving', servings: 4, scale: 1 });
        assert.strictEqual(result.withheld, 'unmatched');
        assert.deepStrictEqual(result.match, { matched: 4, total: 6, unmatched: ['ghee', 'garam masala'] });
        assert.strictEqual(result.figures, undefined);
    });

    it('withholds figures for a plan with a missing recipe', () => {
        const plan: MacrosOutput = { kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: ['Curry'] };
        const result = computeMacros(plan, { basis: 'serving', servings: undefined, scale: 1 });
        assert.strictEqual(result.withheld, 'missingRecipes');
        assert.deepStrictEqual(result.missingRecipes, ['Curry']);
    });

    it('names the missing recipes even when no ingredient could be evaluated at all', () => {
        const empty: NutritionAggregate = { items: [], failures: [], totals: { mass_g: 0, macros: times(MACROS, 0) } };
        const plan: MacrosOutput = { kind: 'plan', aggregate: empty, days: 1, people: 1, missingRecipes: ['Does Not Exist'] };
        assert.strictEqual(computeMacros(plan, { basis: 'serving', servings: undefined, scale: 1 }).withheld, 'missingRecipes');
    });

    it('withholds figures when there is nothing to evaluate', () => {
        const empty: NutritionAggregate = { items: [], failures: [], totals: { mass_g: 0, macros: times(MACROS, 0) } };
        assert.strictEqual(computeMacros(recipe(empty), { basis: 'serving', servings: 4, scale: 1 }).withheld, 'noData');
    });

    it('leaves the energy shares out when the macros supply no energy', () => {
        const water = aggregate({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 });
        assert.strictEqual(computeMacros(recipe(water), { basis: 'serving', servings: 1, scale: 1 }).shares, undefined);
    });
});

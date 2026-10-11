import * as assert from 'assert';
import { CategorySlug, DietIngredient, DietOutput } from './diet-template';
import { DietVerdicts, NON_VEGAN_WORDS, evaluateDiets } from './rules';
import { DIET_IDS } from './settings';

const ing = (name: string, options: { categories?: CategorySlug[]; allergens?: string[]; unknown?: boolean } = {}): DietIngredient =>
    ({ name, status: options.unknown ? 'unknown' : 'verified', allergenClasses: options.allergens ?? [], categories: options.categories ?? [] });
const output = (ingredients: DietIngredient[], extra: { refs?: string[]; missing?: string[] } = {}): DietOutput =>
    ({ names: ingredients.map(i => i.name), refs: extra.refs ?? [], missing: extra.missing ?? [], ingredients });
/** Vegan, Vegetarian, Pescatarian, Dairy-free. */
const statuses = (verdicts: DietVerdicts) => DIET_IDS.map(id => verdicts[id].status);

describe('evaluateDiets', () => {
    it('passes every diet when every ingredient is verified and plant-based', () => {
        const verdicts = evaluateDiets(output([ing('tofu', { allergens: ['soybeans'] }), ing('rice')]), []);
        assert.deepStrictEqual(statuses(verdicts), ['pass', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual([verdicts.vegan.violations, verdicts.vegan.unknown], [[], []]);
    });

    it('fails meat, poultry and animal fat for Pescatarian and stricter', () => {
        for (const [ingredient, reason] of [
            [ing('chicken thighs', { categories: ['poultry'] }), 'poultry'],
            [ing('bacon', { categories: ['meat'] }), 'meat'],
            [ing('lard', { categories: ['animal_fat'] }), 'animal fat'],
        ] as const) {
            const verdicts = evaluateDiets(output([ingredient]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'pass'], ingredient.name);
            assert.deepStrictEqual(verdicts.pescatarian.violations, [{ ingredient: ingredient.name, reason }]);
        }
    });

    it('fails fish via the tree-aware category for Vegetarian, not Pescatarian, preferring the allergen reason', () => {
        const verdicts = evaluateDiets(output([ing('salmon', { categories: ['fish_and_shellfish'], allergens: ['fish'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegetarian.violations, [{ ingredient: 'salmon', reason: 'fish' }]);
        const categoryOnly = evaluateDiets(output([ing('cod', { categories: ['fish_and_shellfish'] })]), []);
        assert.deepStrictEqual(categoryOnly.vegetarian.violations, [{ ingredient: 'cod', reason: 'fish or shellfish' }]);
    });

    it('fails crustaceans and molluscs allergen classes for Vegetarian', () => {
        const verdicts = evaluateDiets(output([ing('prawns', { allergens: ['crustaceans'] }), ing('mussels', { allergens: ['molluscs'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegetarian.violations, [
            { ingredient: 'prawns', reason: 'crustaceans' },
            { ingredient: 'mussels', reason: 'molluscs' },
        ]);
    });

    it('fails dairy for Vegan and Dairy-free, eggs for Vegan only', () => {
        const butter = evaluateDiets(output([ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] })]), []);
        assert.deepStrictEqual(statuses(butter), ['fail', 'pass', 'pass', 'fail']);
        assert.deepStrictEqual([butter.vegan.violations, butter.dairyFree.violations], [
            [{ ingredient: 'butter', reason: 'dairy' }],
            [{ ingredient: 'butter', reason: 'dairy' }],
        ]);
        const eggs = evaluateDiets(output([ing('eggs', { allergens: ['eggs'], categories: ['dairy_and_egg'] })]), []);
        assert.deepStrictEqual(statuses(eggs), ['fail', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual(eggs.vegan.violations, [{ ingredient: 'eggs', reason: 'eggs' }]);
    });

    it('fails Dairy-free on a dairy sub-category without the milk allergen class', () => {
        const verdicts = evaluateDiets(output([ing('parmesan', { categories: ['dairy_and_egg', 'cheese'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'parmesan', reason: 'dairy or egg' }]);
        assert.deepStrictEqual(verdicts.dairyFree.violations, [{ ingredient: 'parmesan', reason: 'dairy' }]);
    });

    it('fails Vegan on the built-in word list, plurals included', () => {
        for (const [name, reason] of [['honey', 'honey'], ['gelatine sheets', 'gelatine'], ['anchovies', 'anchovies'], ['Worcestershire sauce', 'worcestershire'], ['whey protein', 'whey']]) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'pass'], name);
            assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: name, reason }], name);
        }
        assert.ok(NON_VEGAN_WORDS.includes('suet'));
    });

    it('fails Vegan on the user\'s extra words', () => {
        const verdicts = evaluateDiets(output([ing('bone broth')]), ['bone broth']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'bone broth', reason: 'bone broth' }]);
    });

    it('is unknown, never pass, when an ingredient couldn\'t be checked', () => {
        const verdicts = evaluateDiets(output([ing('tofu'), ing('miso paste', { unknown: true })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso paste']);
    });

    it('lets a violation win over unknown ingredients, but still lists them', () => {
        const verdicts = evaluateDiets(output([
            ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] }),
            ing('miso paste', { unknown: true }),
        ]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'unknown', 'unknown', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso paste']);
    });

    it('fails an unknown ingredient that still matched a category', () => {
        const verdicts = evaluateDiets(output([ing('mystery chicken', { unknown: true, categories: ['poultry'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'unknown']);
        assert.deepStrictEqual(verdicts.dairyFree.unknown, ['mystery chicken']);
    });

    it('reports linked recipes as unknown, unless a non-vegan word matches their name', () => {
        const linked = evaluateDiets(output([ing('rice')], { refs: ['Pesto'] }), []);
        assert.deepStrictEqual(statuses(linked), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(linked.vegan.unknown, ['Pesto (linked recipe)']);
        const honey = evaluateDiets(output([ing('rice')], { refs: ['Honey glaze'] }), []);
        assert.deepStrictEqual(statuses(honey), ['fail', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(honey.vegan.violations, [{ ingredient: 'Honey glaze (linked recipe)', reason: 'honey' }]);
    });

    it('reports missing menu recipes as unknown', () => {
        const verdicts = evaluateDiets(output([ing('rice')], { missing: ['Lasagne'] }), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(verdicts.pescatarian.unknown, ['Lasagne (recipe not found)']);
    });

    it('lists an ingredient once even when a menu repeats it', () => {
        const butter = ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] });
        const miso = ing('miso', { unknown: true });
        const verdicts = evaluateDiets(output([butter, butter, miso, miso]), []);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'butter', reason: 'dairy' }]);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso']);
    });
});

import * as assert from 'assert';
import { CategorySlug, DietIngredient, DietOutput, PlantSlug } from './diet-template';
import { DietVerdicts, NON_PESCATARIAN_WORDS, NON_VEGAN_WORDS, NON_VEGETARIAN_WORDS, evaluateDiets } from './rules';
import { DIET_IDS } from './settings';

const ing = (name: string, options: { categories?: CategorySlug[]; allergens?: string[]; unknown?: boolean; unclassified?: boolean; plant?: PlantSlug; canonical?: string } = {}): DietIngredient =>
    ({ name, ...(options.canonical ? { canonical: options.canonical } : {}), status: options.unknown ? 'unknown' : 'verified', ...(options.unclassified ? {} : { plant: options.plant ?? 'vegetables' }), allergenClasses: options.allergens ?? [], categories: options.categories ?? [] });
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

    it('fails every ladder diet on animal-flesh and animal-fat words, even with no category', () => {
        for (const [name, reason] of [['lard', 'lard'], ['Pancetta cubes', 'pancetta'], ['chorizo', 'chorizo'], ['prosciutto', 'prosciutto'], ['smoked ham', 'ham'], ['gelatine sheets', 'gelatine'], ['beef tallow', 'tallow'], ['salami', 'salami']]) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'pass'], name);
            assert.deepStrictEqual(verdicts.pescatarian.violations, [{ ingredient: name, reason }], name);
        }
        assert.ok(NON_PESCATARIAN_WORDS.includes('suet') && NON_PESCATARIAN_WORDS.includes('schmaltz') && NON_PESCATARIAN_WORDS.includes('dripping'));
    });

    it('fails Vegetarian and Vegan, not Pescatarian, on fish-derived words', () => {
        for (const [name, reason] of [['anchovies', 'anchovies'], ['fish sauce', 'fish sauce'], ['Worcestershire sauce', 'worcestershire']]) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass'], name);
            assert.deepStrictEqual(verdicts.vegetarian.violations, [{ ingredient: name, reason }], name);
        }
        assert.ok(NON_VEGETARIAN_WORDS.includes('anchovy'));
    });

    it('fails only Vegan on honey, whey, casein and ghee', () => {
        for (const [name, reason] of [['honey', 'honey'], ['whey protein', 'whey'], ['casein', 'casein'], ['ghee', 'ghee']]) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'pass'], name);
            assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: name, reason }], name);
        }
        assert.ok(NON_VEGAN_WORDS.includes('honey'));
    });

    it('is unknown for Vegan, Vegetarian and Pescatarian when an audited item has no category, but not for Dairy-free', () => {
        const verdicts = evaluateDiets(output([ing('mystery paste', { unclassified: true })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'pass']);
        assert.deepStrictEqual(verdicts.pescatarian.unknown, ['mystery paste']);
        assert.deepStrictEqual(verdicts.dairyFree.unknown, []);
    });

    it('lets a word or a category beat the unclassified state', () => {
        const verdicts = evaluateDiets(output([ing('bacon', { unclassified: true }), ing('honey', { unclassified: true })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'pass']);
        assert.deepStrictEqual(verdicts.pescatarian.violations, [{ ingredient: 'bacon', reason: 'bacon' }]);
        assert.deepStrictEqual(verdicts.vegetarian.unknown, ['honey']);
    });

    it('does not fail meat words that are part of a plant name', () => {
        for (const name of ['beef tomatoes', 'Beefsteak tomato', 'lamb\'s lettuce', 'Lamb’s lettuce', 'lambs lettuce', 'chicken of the woods', 'hen of the woods', 'duck sauce', 'cauliflower steak']) {
            assert.deepStrictEqual(statuses(evaluateDiets(output([ing(name)]), [])), ['pass', 'pass', 'pass', 'pass'], name);
        }
    });

    it('turns a meat or fish word into unknown, not fail, next to an analogue qualifier', () => {
        for (const name of ['vegan sausage', 'coconut bacon', 'chicken-style stock powder', 'crumbled vegan sausage', 'mushroom jerky ham', 'plant-based mince beef', 'tofu bacon', 'meatless lardons']) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'pass'], name);
            assert.deepStrictEqual(verdicts.vegan.violations, [], name);
        }
        // Fish words only reach Vegetarian and Vegan, so a pescatarian stays clean.
        for (const name of ['vegan worcestershire sauce', 'vegan fish sauce', 'faux anchovies']) {
            assert.deepStrictEqual(statuses(evaluateDiets(output([ing(name)]), [])), ['unknown', 'unknown', 'pass', 'pass'], name);
        }
    });

    it('lets categories and allergens beat a qualifier', () => {
        const verdicts = evaluateDiets(output([ing('vegan sausage', { categories: ['meat'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'pass']);
    });

    it('does not treat steak as a meat word: a salmon steak fails Vegetarian by category and passes Pescatarian', () => {
        const verdicts = evaluateDiets(output([ing('salmon steak', { categories: ['fish_and_shellfish'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass']);
        assert.ok(!NON_PESCATARIAN_WORDS.includes('steak'));
    });

    it('fails only Vegan on a duck egg, through the eggs allergen', () => {
        const verdicts = evaluateDiets(output([ing('duck eggs', { allergens: ['eggs'], categories: ['dairy_and_egg'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'duck eggs', reason: 'eggs' }]);
    });

    it('also matches words against the service\'s canonical name', () => {
        const pork = evaluateDiets(output([ing('mince', { canonical: 'Pork mince' })]), []);
        assert.deepStrictEqual(statuses(pork), ['fail', 'fail', 'fail', 'pass']);
        const vegan = evaluateDiets(output([ing('sausage', { canonical: 'Sausage, vegan' })]), []);
        assert.deepStrictEqual(statuses(vegan), ['unknown', 'unknown', 'unknown', 'pass']);
    });

    it('accepts beverages as plant-based for Vegetarian and Pescatarian but not Vegan (wine and beer fining)', () => {
        const verdicts = evaluateDiets(output([ing('white wine', { plant: 'beverages' })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['white wine']);
    });

    it('fails only Vegan on the user\'s extra words', () => {
        const verdicts = evaluateDiets(output([ing('bone broth')]), ['bone broth']);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'pass']);
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
        const bacon = evaluateDiets(output([ing('rice')], { refs: ['Bacon jam'] }), []);
        assert.deepStrictEqual(statuses(bacon), ['fail', 'fail', 'fail', 'unknown']);
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

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ANIMAL_SLUGS, DAIRY_SLUGS, DIET_TEMPLATE, MISALIGNED_NAME, PLANT_SLUGS, parseDietOutput } from './diet-template';

const verified = (...classes: string[]) => ({ status: 'verified', view: 'eu', contains: classes.map(c => ({ class: c, label: c })) });
const item = (ingredient: string, extra: Record<string, unknown> = {}) =>
    ({ ingredient, allergens: verified(), warnings: [], categories: [], plant: true, ...extra });
const raw = (fields: Record<string, unknown>) =>
    JSON.stringify({ names: [], refs: [], missing: [], items: [], failures: [], ...fields });

describe('DIET_TEMPLATE', () => {
    it('reads the expanded plan for menus and the recipe ingredients otherwise, in the EU allergen view', () => {
        assert.ok(DIET_TEMPLATE.includes('{%- set ings = plan.all_ingredients if is_plan else ingredients -%}'));
        assert.ok(DIET_TEMPLATE.includes('aggregate_nutrition(ings, "eu")'));
    });

    it('checks every animal slug, the plant groups, and the dairy children only under dairy_and_egg', () => {
        assert.ok(DIET_TEMPLATE.includes(JSON.stringify(ANIMAL_SLUGS)));
        assert.ok(DIET_TEMPLATE.includes(JSON.stringify(PLANT_SLUGS)));
        assert.ok(DIET_TEMPLATE.includes(JSON.stringify(DAIRY_SLUGS)));
        assert.ok(DIET_TEMPLATE.includes('{%- if "dairy_and_egg" in hit.list -%}'));
        assert.ok(DIET_TEMPLATE.includes('is_in_category(item.ingredient, slug)'));
    });

    it('uses bracket access for the aggregate items (minijinja resolves `.items` to the dict method)', () => {
        assert.ok(DIET_TEMPLATE.includes('agg["items"]'));
        assert.ok(!DIET_TEMPLATE.includes('agg.items'));
    });

    it('emits linked recipes and missing menu recipes', () => {
        assert.ok(DIET_TEMPLATE.includes('"refs": refs.list'));
        assert.ok(DIET_TEMPLATE.includes('plan.missing_recipes'));
        assert.ok(DIET_TEMPLATE.includes('| tojson'));
    });

    it('stops at the first animal hit, and skips every category call for placeholder items', () => {
        assert.ok(DIET_TEMPLATE.includes('{%- if not hit.list and is_in_category(item.ingredient, slug) -%}'));
        assert.ok(DIET_TEMPLATE.includes('{%- if not hit.plant and is_in_category(item.ingredient, slug) -%}'));
        assert.ok(DIET_TEMPLATE.includes('{%- if not placeholder.found -%}'));
        assert.ok(DIET_TEMPLATE.includes('"nutrition_placeholder"'));
        assert.ok(DIET_TEMPLATE.includes('"plant": hit.plant'));
    });

    it('stays well under the editor\'s 64 KiB template limit', () => {
        assert.ok(DIET_TEMPLATE.length < 4096, String(DIET_TEMPLATE.length));
    });
});

describe('category slugs', () => {
    // Checked-in copy of every `INSERT INTO categories` slug in the nutrition service's migrations
    // (db-reference-intakes/crates/service/migrations/0009_taxonomy and 0011_expand_categories).
    // An unknown slug makes the service answer `category_not_found`, which fails the whole render.
    const taxonomy: { slugs: string[] } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'taxonomy-slugs.json'), 'utf8'));

    it('uses only slugs that exist in the service taxonomy', () => {
        for (const slug of [...ANIMAL_SLUGS, ...DAIRY_SLUGS, ...PLANT_SLUGS]) {
            assert.ok(taxonomy.slugs.includes(slug), `unknown category slug: ${slug}`);
        }
    });

    it('never counts a slug as both animal and plant', () => {
        const animal: readonly string[] = [...ANIMAL_SLUGS, ...DAIRY_SLUGS];
        assert.deepStrictEqual(PLANT_SLUGS.filter(slug => animal.includes(slug)), []);
    });
});

describe('parseDietOutput', () => {
    it('aligns items and failures back to recipe names, stripping `?`', () => {
        const parsed = parseDietOutput(raw({
            names: ['?butter', 'unobtainium', 'tofu '],
            items: [
                item('butter', { allergens: verified('milk'), categories: ['dairy_and_egg', 'butter'] }),
                item('tofu', { allergens: verified('soybeans') }),
            ],
            failures: [{ index: 1, ingredient: 'unobtainium', error: { code: 'ingredient_not_found', message: 'x' } }],
        }));
        assert.deepStrictEqual(parsed, {
            names: ['butter', 'unobtainium', 'tofu'],
            refs: [],
            missing: [],
            ingredients: [
                { name: 'butter', status: 'verified', classified: true, allergenClasses: ['milk'], categories: ['dairy_and_egg', 'butter'] },
                { name: 'unobtainium', status: 'unknown', classified: false, allergenClasses: [], categories: [] },
                { name: 'tofu', status: 'verified', classified: true, allergenClasses: ['soybeans'], categories: [] },
            ],
        });
    });

    it('marks placeholders, unverified, non-EU and missing allergen blocks unknown', () => {
        const parsed = parseDietOutput(raw({
            names: ['a', 'b', 'c', 'd', 'e'],
            items: [
                item('a', { warnings: [{ code: 'nutrition_placeholder', message: 'x' }] }),
                item('b', { warnings: ['nutrition_placeholder'] }),
                item('c', { allergens: { status: 'unverified', view: 'eu', contains: [] } }),
                item('d', { allergens: { status: 'verified', view: 'fda', contains: [] } }),
                item('e', { allergens: null }),
            ],
        }));
        assert.ok(parsed);
        assert.deepStrictEqual(parsed.ingredients.map(i => i.status), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    });

    it('keeps the well-formed classes of a block with a malformed entry, but marks it unknown', () => {
        const parsed = parseDietOutput(raw({
            names: ['butter'],
            items: [item('butter', { allergens: { status: 'verified', view: 'eu', contains: [{ class: 'milk', label: 'Milk' }, { label: 'no class' }] } })],
        }));
        assert.deepStrictEqual(parsed?.ingredients, [{ name: 'butter', status: 'unknown', classified: true, allergenClasses: ['milk'], categories: [] }]);
    });

    it('drops category slugs it never asked for', () => {
        const parsed = parseDietOutput(raw({ names: ['milk'], items: [item('milk', { categories: ['dairy_and_egg', 'vegetables', 'milk'] })] }));
        assert.deepStrictEqual(parsed?.ingredients[0].categories, ['dairy_and_egg', 'milk']);
    });

    it('treats an item with no animal category and no plant group as unclassified, and a missing plant flag as false', () => {
        const parsed = parseDietOutput(raw({
            names: ['pancetta', 'onion', 'bacon'],
            items: [item('pancetta', { plant: false }), item('onion'), { ingredient: 'bacon', allergens: verified(), warnings: [], categories: [] }],
        }));
        assert.deepStrictEqual(parsed?.ingredients.map(i => [i.name, i.status, i.classified]), [
            ['pancetta', 'verified', false], ['onion', 'verified', true], ['bacon', 'verified', false],
        ]);
    });

    it('reads linked recipes and missing menu recipes', () => {
        const parsed = parseDietOutput(raw({ refs: ['?Pesto '], missing: [' Lasagne'] }));
        assert.deepStrictEqual([parsed?.refs, parsed?.missing], [['Pesto'], ['Lasagne']]);
    });

    it('falls back to service names, plus a stand-in, when items and failures do not line up', () => {
        const parsed = parseDietOutput(raw({ names: ['a', 'b', 'c'], items: [item('A')] }));
        assert.deepStrictEqual(parsed?.ingredients, [
            { name: 'A', status: 'verified', classified: true, allergenClasses: [], categories: [] },
            { name: MISALIGNED_NAME, status: 'unknown', classified: false, allergenClasses: [], categories: [] },
        ]);
    });

    it('rejects malformed output', () => {
        for (const output of [
            'not json',
            '[]',
            JSON.stringify({ names: [], refs: [], items: [], failures: [] }),
            raw({ names: [1] }),
            raw({ refs: 'Pesto' }),
            raw({ items: 'x' }),
            raw({ failures: {} }),
            raw({ names: ['x'], items: [{ ingredient: 'x', allergens: verified(), warnings: [] }] }),
            raw({ names: ['x'], items: [{ allergens: verified(), warnings: [], categories: [] }] }),
            raw({ names: ['x'], items: [item('x', { categories: [7] })] }),
        ]) {
            assert.strictEqual(parseDietOutput(output), undefined, output);
        }
    });
});

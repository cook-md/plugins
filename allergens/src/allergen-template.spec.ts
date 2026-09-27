import * as assert from 'assert';
import { NAMES_TEMPLATE, STANDARD_TEMPLATE, parseAllergenOutput } from './allergen-template';

const verified = (...contains: Array<{ class: string; subtype?: string; label: string }>) =>
    ({ status: 'verified', contains, view: 'eu' });
const item = (ingredient: string, allergens?: unknown) => ({ ingredient, amount: { mass_g: 10 }, allergens });

describe('templates', () => {
    it('the names template makes no nutrition call', () => {
        assert.ok(!NAMES_TEMPLATE.includes('aggregate_nutrition'));
        assert.ok(NAMES_TEMPLATE.includes('tojson'));
    });

    it('the standard template asks for the EU view', () => {
        assert.ok(STANDARD_TEMPLATE.includes('aggregate_nutrition(ingredients, "eu")'));
    });

    it('both templates emit linked recipes as refs', () => {
        for (const template of [NAMES_TEMPLATE, STANDARD_TEMPLATE]) {
            assert.ok(template.includes('"refs": refs.list'), template);
        }
    });
});

describe('parseAllergenOutput', () => {
    it('reads names and linked recipes for the names template, stripping every leading `?` and whitespace', () => {
        const parsed = parseAllergenOutput(JSON.stringify({ names: ['?salt ', '??pepper', 'butter'], refs: ['?? Pesto '] }), false);
        assert.deepStrictEqual(parsed, { names: ['salt', 'pepper', 'butter'], refs: ['Pesto'], ingredients: undefined });
    });

    it('requires refs to be a string array', () => {
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [] }), false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [], refs: [1] }), false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [], refs: 'x' }), false), undefined);
    });

    it('aligns items and failures back to recipe names', () => {
        const output = JSON.stringify({
            names: ['plain flour', 'almonds', 'unobtainium', 'butter'],
            refs: [],
            aggregate: {
                items: [
                    item('flour', { status: 'unverified', contains: [], view: 'eu' }),
                    item('almond', verified({ class: 'tree_nuts', subtype: 'almond', label: 'Almonds' })),
                    item('butter', verified({ class: 'milk', label: 'Milk' })),
                ],
                failures: [{ index: 2, ingredient: 'unobtainium', error: { code: 'not_found', message: '' } }],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'plain flour', status: 'unknown', contains: [] },
            { name: 'almonds', status: 'verified', contains: [{ class: 'tree_nuts', subtype: 'almond', label: 'Almonds' }] },
            { name: 'unobtainium', status: 'unknown', contains: [] },
            { name: 'butter', status: 'verified', contains: [{ class: 'milk', label: 'Milk' }] },
        ]);
    });

    it('falls back to service names when counts do not line up', () => {
        const output = JSON.stringify({
            names: ['a', 'b', 'c'],
            refs: [],
            aggregate: { items: [item('egg', verified({ class: 'eggs', label: 'Eggs' }))], failures: [{ index: 1, ingredient: 'zzz' }] },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'egg', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'zzz', status: 'unknown', contains: [] },
            { name: "some ingredients (the nutrition service's reply didn't line up)", status: 'unknown', contains: [] },
        ]);
    });

    it('treats a missing allergens block, or any malformed entry, as unknown', () => {
        const output = JSON.stringify({
            names: ['x', 'y', 'z', 'w'],
            refs: [],
            aggregate: {
                items: [
                    item('x'),
                    item('y', { status: 'verified', contains: [{ class: 'milk' }, { class: 'eggs', label: 'Eggs' }], view: 'eu' }),
                    item('z', { status: 'verified', contains: ['nope'], view: 'eu' }),
                    item('w', { status: 'verified', contains: [{ class: 'gluten', label: 3 }], view: 'eu' }),
                ],
                failures: [],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'x', status: 'unknown', contains: [] },
            { name: 'y', status: 'unknown', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'z', status: 'unknown', contains: [] },
            { name: 'w', status: 'unknown', contains: [] },
        ]);
    });

    it('omits a null or non-string subtype but keeps the entry', () => {
        const output = JSON.stringify({
            names: ['y', 'z'],
            refs: [],
            aggregate: {
                items: [
                    item('y', verified({ class: 'eggs', label: 'Eggs', subtype: 3 } as never)),
                    item('z', verified({ class: 'gluten', subtype: null, label: 'Wheat' } as never)),
                ],
                failures: [],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'y', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'z', status: 'verified', contains: [{ class: 'gluten', label: 'Wheat' }] },
        ]);
    });

    it('treats an allergens block in any view but EU as unknown', () => {
        const output = JSON.stringify({
            names: ['celery', 'milk', 'none'],
            refs: [],
            aggregate: {
                items: [
                    item('celery', { status: 'verified', contains: [], view: 'fda' }),
                    item('milk', { status: 'verified', contains: [{ class: 'milk', label: 'Milk' }], view: 'fda' }),
                    item('none', { status: 'verified', contains: [] }),
                ],
                failures: [],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients?.map(i => i.status), ['unknown', 'unknown', 'unknown']);
    });

    it('adds a sentinel unknown when the fallback has fewer results than ingredients', () => {
        const output = JSON.stringify({
            names: ['a', 'b', 'c', 'd'],
            refs: [],
            aggregate: { items: [item('egg', verified({ class: 'eggs', label: 'Eggs' })), { amount: {} }], failures: [{ index: 9, ingredient: 'zzz' }] },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'egg', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'zzz', status: 'unknown', contains: [] },
            { name: "some ingredients (the nutrition service's reply didn't line up)", status: 'unknown', contains: [] },
        ]);
    });

    it('keeps failures without an ingredient name', () => {
        const aligned = JSON.stringify({
            names: ['a', 'b'],
            refs: [],
            aggregate: { items: [item('a', verified())], failures: [{ index: 1 }] },
        });
        assert.deepStrictEqual(parseAllergenOutput(aligned, true)?.ingredients, [
            { name: 'a', status: 'verified', contains: [] },
            { name: 'b', status: 'unknown', contains: [] },
        ]);
        const fallback = JSON.stringify({
            names: ['a', 'b', 'c'],
            refs: [],
            aggregate: { items: [], failures: [{ index: 1 }, { index: 'x' }, { index: 1, ingredient: 'bb' }] },
        });
        assert.deepStrictEqual(parseAllergenOutput(fallback, true)?.ingredients, [
            { name: 'ingredient 2', status: 'unknown', contains: [] },
            { name: 'an unnamed ingredient', status: 'unknown', contains: [] },
            { name: 'bb', status: 'unknown', contains: [] },
        ]);
    });

    it('treats a null allergens block as unknown', () => {
        const output = JSON.stringify({
            names: ['x'],
            refs: [],
            aggregate: { items: [item('x', null)], failures: [] },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'x', status: 'unknown', contains: [] },
        ]);
    });

    it('rejects output that is not what the template produces', () => {
        assert.strictEqual(parseAllergenOutput('not json', false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [1], refs: [] }), false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [], refs: [] }), true), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [], refs: [], aggregate: { items: {}, failures: [] } }), true), undefined);
    });
});

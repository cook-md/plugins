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
        ]);
    });

    it('treats a missing or malformed allergens block as unknown and drops malformed entries', () => {
        const output = JSON.stringify({
            names: ['x', 'y', 'z'],
            refs: [],
            aggregate: {
                items: [
                    item('x'),
                    item('y', { status: 'verified', contains: [{ class: 'milk' }, { class: 'eggs', label: 'Eggs', subtype: 3 }, 'nope'] }),
                    item('z', { status: 'verified', contains: [{ class: 'gluten', subtype: null, label: 'Wheat' }], subtype: null }),
                ],
                failures: [],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'x', status: 'unknown', contains: [] },
            { name: 'y', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'z', status: 'verified', contains: [{ class: 'gluten', label: 'Wheat' }] },
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

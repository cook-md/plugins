import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { coverage, matchIngredients, normaliseName, pantryLookup } from './match';
import { IngredientName } from './names-template';

const pantryItem = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const req = (name: string): IngredientName => ({ name, optional: false });
const opt = (name: string): IngredientName => ({ name, optional: true });

describe('normaliseName', () => {
    const cases: Array<[string, string]> = [
        ['Tomatoes', 'tomato'],
        ['  Red   Onions ', 'red onion'],
        ['eggs', 'egg'],
        ['olives', 'olive'],
        ['peaches', 'peach'],
        ['radishes', 'radish'],
        ['potatoes', 'potato'],
        ['glasses', 'glass'],
        ['cress', 'cress'],
        ['garlic, minced', 'garlic'],
        ['gas', 'gas'],
        ['', ''],
        [' , chopped', ''],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
            assert.strictEqual(normaliseName(input), expected);
        });
    }

    it('makes singular and plural forms equal', () => {
        assert.strictEqual(normaliseName('Tomato'), normaliseName('tomatoes'));
        assert.strictEqual(normaliseName('onion'), normaliseName('Onions'));
    });
});

describe('pantryLookup', () => {
    it('normalises in-stock pantry names and alwaysHave, skipping out-of-stock items', () => {
        const lookup = pantryLookup([pantryItem('Tomatoes'), pantryItem('mozzarella', { isOutOfStock: true })], ['Black Pepper', ' ']);
        assert.deepStrictEqual([...lookup.inStock], ['tomato']);
        assert.deepStrictEqual([...lookup.alwaysHave], ['black pepper']);
    });
});

describe('matchIngredients', () => {
    const lookup = pantryLookup(
        [pantryItem('Tomatoes'), pantryItem('basil', { isLow: true }), pantryItem('mozzarella', { isOutOfStock: true })],
        ['salt', 'Black Pepper'],
    );

    it('covers plural/singular pantry names and counts low stock as in stock', () => {
        const match = matchIngredients([req('tomato'), req('Basil')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [2, 2, []]);
    });

    it('treats out-of-stock items as missing', () => {
        const match = matchIngredients([req('mozzarella')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [0, 1, ['mozzarella']]);
    });

    it('leaves alwaysHave out of both sides', () => {
        const match = matchIngredients([req('salt'), req('black peppers'), req('tomatoes')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [1, 1, []]);
        assert.ok(!match.uses.has('salt'));
    });

    it('never counts optional ingredients as missing, but records that the recipe uses them', () => {
        const match = matchIngredients([req('tomato'), opt('parmesan')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [1, 1, []]);
        assert.ok(match.uses.has('parmesan'));
    });

    it('counts a name once, and required wins over optional', () => {
        const match = matchIngredients([opt('onion'), req('Onions'), req('onion')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [0, 1, ['Onions']]);
    });

    it('keeps missing names in recipe order, without the text after a comma', () => {
        const match = matchIngredients([req('Garlic, minced'), req('tomato'), req('Olive Oil')], lookup);
        assert.deepStrictEqual(match.missing, ['Garlic', 'Olive Oil']);
    });

    it('has full coverage with no required ingredients', () => {
        assert.strictEqual(coverage(matchIngredients([opt('parsley'), req('salt')], lookup)), 1);
        assert.strictEqual(coverage(matchIngredients([req('tomato'), req('mozzarella')], lookup)), 0.5);
    });
});

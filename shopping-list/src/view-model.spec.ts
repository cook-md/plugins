import * as assert from 'assert';
import { displayCategories, displayNameFromPath, freeHandRows, recipeRows } from './view-model';

describe('view model', () => {
    it('names entries after the file, without extension or folders', () => {
        assert.strictEqual(displayNameFromPath('Dinner/Carbonara.cook'), 'Carbonara');
        assert.strictEqual(displayNameFromPath('Plans/Week.MENU'), 'Week');
        assert.strictEqual(displayNameFromPath('Bread'), 'Bread');
    });

    it('builds recipe rows with scale and a menu summary', () => {
        assert.deepStrictEqual(recipeRows([
            { type: 'recipe', path: 'Soup.cook', children: [] },
            { type: 'recipe', path: 'Week.menu', multiplier: 2, children: [
                { type: 'recipe', path: 'a', children: [] }, { type: 'recipe', path: 'b', children: [] },
            ] },
        ]), [
            { index: 0, name: 'Soup', scale: 1 },
            { index: 1, name: 'Week', scale: 2, detail: 'menu (2 recipes)' },
        ]);
    });

    it('skips free-hand lines but keeps indexes into the full list', () => {
        assert.deepStrictEqual(recipeRows([
            { type: 'ingredient', name: 'milk', quantity: '2%l' },
            { type: 'recipe', path: 'Week.menu', children: [
                { type: 'recipe', path: 'a', children: [] }, { type: 'ingredient', name: 'olive oil' },
            ] },
        ]), [
            { index: 1, name: 'Week', scale: 1, detail: 'menu (1 recipes)' },
        ]);
    });

    it('drops empty aisles and appends sorted uncategorised items', () => {
        assert.deepStrictEqual(displayCategories({
            categories: [{ name: 'produce', items: [{ name: 'garlic', quantities: '3' }] }, { name: 'dairy', items: [] }],
            other: { name: 'other', items: [{ name: 'salt', quantities: '' }, { name: 'flour', quantities: '1 kg' }] },
            pantryItems: [],
        }), [
            { name: 'produce', items: [{ name: 'garlic', quantities: '3' }] },
            { name: 'other', items: [{ name: 'flour', quantities: '1 kg' }, { name: 'salt', quantities: '' }] },
        ]);
    });
    it('lists top-level free-hand lines with their index and a readable amount', () => {
        assert.deepStrictEqual(freeHandRows([
            { type: 'recipe', path: 'Soup.cook', children: [{ type: 'ingredient', name: 'salt' }] },
            { type: 'ingredient', name: 'milk', quantity: '2%l' },
            { type: 'ingredient', name: 'bread' },
        ]), [
            { ref: { index: 1, name: 'milk', quantity: '2%l' }, quantity: '2 l' },
            { ref: { index: 2, name: 'bread' }, quantity: '' },
        ]);
    });
});

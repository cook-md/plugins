import * as assert from 'assert';
import { displayCategories, displayNameFromPath, recipeRows } from './view-model';

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
});

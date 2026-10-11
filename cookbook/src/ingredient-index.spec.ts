import * as assert from 'assert';
import { buildIngredientIndex, normaliseIngredient } from './ingredient-index';
import { RecipeIngredient } from './recipe-template';

const ingredient = (name: string, reference = false): RecipeIngredient => ({ name, quantity: '', note: '', optional: false, reference });

describe('normaliseIngredient', () => {
    it('lowercases, collapses spaces and strips a simple plural from the last word', () => {
        assert.strictEqual(normaliseIngredient('  Cherry   Tomatoes '), 'cherry tomato');
        assert.strictEqual(normaliseIngredient('Eggs'), 'egg');
        assert.strictEqual(normaliseIngredient('berries'), 'berry');
        assert.strictEqual(normaliseIngredient('peaches'), 'peach');
        assert.strictEqual(normaliseIngredient('green beans'), 'green bean');
    });

    it('leaves words that only look plural', () => {
        assert.strictEqual(normaliseIngredient('hummus'), 'hummus');
        assert.strictEqual(normaliseIngredient('Swiss'), 'swiss');
        assert.strictEqual(normaliseIngredient('gas'), 'gas');
        assert.strictEqual(normaliseIngredient('rice'), 'rice');
        assert.strictEqual(normaliseIngredient(''), '');
    });
});

describe('buildIngredientIndex', () => {
    it('groups recipes under normalised names, sorted, without recipe references or duplicates', () => {
        const index = buildIngredientIndex([
            { id: 'r-2', title: 'Tomato Soup', ingredients: [ingredient('Tomatoes'), ingredient('salt'), ingredient('./Sauces/Pesto', true), ingredient('tomato')] },
            { id: 'r-1', title: 'Bruschetta', ingredients: [ingredient('tomato'), ingredient('Bread')] },
        ]);
        assert.deepStrictEqual(index, [
            { name: 'bread', recipes: [{ id: 'r-1', title: 'Bruschetta' }] },
            { name: 'salt', recipes: [{ id: 'r-2', title: 'Tomato Soup' }] },
            { name: 'tomato', recipes: [{ id: 'r-1', title: 'Bruschetta' }, { id: 'r-2', title: 'Tomato Soup' }] },
        ]);
    });
});

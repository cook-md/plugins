import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { ExpiringItem } from './expiry';
import { pantryLookup } from './match';
import { buildViewModel, childrenOf, EMPTY_MODEL, IndexedRecipe, isEmptyModel, nodeId, recipeTitle, recipeUriOf, TreeNode } from './view-model';

const pantryItem = (name: string): PantryItem => ({ name, isLow: false, isOutOfStock: false });
const lookup = pantryLookup(['rice', 'onion', 'garlic', 'spinach', 'egg'].map(pantryItem), ['salt']);
const recipe = (path: string, ...names: string[]): IndexedRecipe => ({
    uri: `file:///ws/${path}`,
    path,
    ingredients: names.map(name => name.startsWith('?') ? { name: name.slice(1), optional: true } : { name, optional: false }),
});
const spinach: ExpiringItem = { name: 'spinach', key: 'spinach', expireDate: '2026-10-12', daysLeft: 2 };

const recipes = [
    recipe('Fried rice.cook', 'rice', 'egg', 'onion', 'salt'),
    recipe('Dinners/Risotto.cook', 'rice', 'onion', 'parmesan', 'stock'),
    recipe('Omelette.cook', 'egg', 'cheese', '?spinach'),
    recipe('Spinach pie.cook', 'spinach', 'pastry', 'feta', 'egg', 'cream'),
    recipe('Salted water.cook', 'salt'),
];
const model = buildViewModel(recipes, [{ uri: 'file:///ws/Broken.cook', path: 'Broken.cook', message: 'syntax error' }], lookup, [spinach]);

describe('recipeTitle', () => {
    it('is the file name without .cook', () => {
        assert.strictEqual(recipeTitle('Dinners/Risotto.cook'), 'Risotto');
        assert.strictEqual(recipeTitle('a.COOK'), 'a');
    });
});

describe('buildViewModel', () => {
    it('puts complete recipes under Cook now', () => {
        assert.deepStrictEqual(model.cookNow.map(row => [row.title, row.covered, row.total]), [['Fried rice', 3, 3]]);
    });

    it('ranks Missing 1–2 by missing count, then coverage, and leaves out 3+ missing', () => {
        assert.deepStrictEqual(model.missingFew.map(row => [row.title, row.missing]), [
            ['Omelette', ['cheese']],
            ['Risotto', ['parmesan', 'stock']],
        ]);
    });

    it('lists recipes that use an expiring item, optional uses included, best coverage first', () => {
        assert.deepStrictEqual(model.useItUp.map(entry => [entry.item.name, entry.recipes.map(row => row.title)]), [
            ['spinach', ['Omelette', 'Spinach pie']],
        ]);
    });

    it('orders Use it up by coverage even when another recipe misses fewer', () => {
        const big = recipe('Big.cook', 'spinach', 'rice', 'onion', 'garlic', 'egg', 'kale', 'leek');
        const small = recipe('Small.cook', 'spinach', 'tofu');
        const result = buildViewModel([small, big], [], lookup, [spinach]);
        assert.deepStrictEqual(result.useItUp[0].recipes.map(row => row.title), ['Big', 'Small']);
    });

    it('lists failed recipes under Couldn\'t read', () => {
        assert.deepStrictEqual(model.unreadable, [{ uri: 'file:///ws/Broken.cook', path: 'Broken.cook', title: 'Broken', message: 'syntax error' }]);
    });

    it('leaves out recipes with nothing to check', () => {
        const titles = [...model.cookNow, ...model.missingFew].map(row => row.title);
        assert.ok(!titles.includes('Salted water'));
    });
});

describe('Use it up edge cases', () => {
    it('sorts recipes that only use the item optionally (0 required) last, and shows them as optional', () => {
        const optionalOnly = recipe('Garnish.cook', '?spinach');
        const real = recipe('Zesty.cook', 'spinach', 'tofu');
        const result = buildViewModel([optionalOnly, real], [], lookup, [spinach]);
        assert.deepStrictEqual(result.useItUp[0].recipes.map(row => [row.title, row.total]), [['Zesty', 2], ['Garnish', 0]]);
    });

    it('shows the top 10 recipes under an item, then a "+N more" leaf', () => {
        const many = Array.from({ length: 13 }, (_, i) => recipe(`R${String(i).padStart(2, '0')}.cook`, 'spinach', 'tofu'));
        const result = buildViewModel(many, [], lookup, [spinach]);
        const useItUp = childrenOf(result).find(node => node.kind === 'group' && node.group === 'useItUp');
        const [expiring] = childrenOf(result, useItUp);
        const kids = childrenOf(result, expiring);
        assert.strictEqual(kids.length, 11);
        assert.deepStrictEqual(kids[10].kind === 'more' ? kids[10].count : undefined, 3);
        assert.strictEqual(new Set(kids.map(nodeId)).size, 11);
    });
});

describe('childrenOf', () => {
    const group = (id: string): TreeNode => {
        const found = childrenOf(model).find(node => node.kind === 'group' && node.group === id);
        assert.ok(found, id);
        return found;
    };

    it('shows only non-empty groups, in order', () => {
        assert.deepStrictEqual(childrenOf(model).map(node => node.kind === 'group' ? node.group : node.kind), ['cookNow', 'missingFew', 'useItUp', 'unreadable']);
        assert.deepStrictEqual(childrenOf(EMPTY_MODEL), []);
        assert.ok(isEmptyModel(EMPTY_MODEL));
        assert.ok(!isEmptyModel(model));
    });

    it('lists missing ingredients under a recipe', () => {
        const [omelette] = childrenOf(model, group('missingFew'));
        assert.deepStrictEqual(childrenOf(model, omelette).map(node => node.kind === 'missing' ? node.name : node.kind), ['cheese']);
    });

    it('lists recipes under an expiring item', () => {
        const [spinachNode] = childrenOf(model, group('useItUp'));
        assert.strictEqual(spinachNode.kind, 'expiring');
        assert.deepStrictEqual(childrenOf(model, spinachNode).map(node => node.kind === 'recipe' ? node.row.title : node.kind), ['Omelette', 'Spinach pie']);
    });

    it('gives a recipe shown in two groups two distinct ids', () => {
        const [omeletteInMissing] = childrenOf(model, group('missingFew'));
        const [spinachNode] = childrenOf(model, group('useItUp'));
        const [omeletteInUseItUp] = childrenOf(model, spinachNode);
        assert.notStrictEqual(nodeId(omeletteInMissing), nodeId(omeletteInUseItUp));
    });
});

describe('recipeUriOf', () => {
    it('reads the URI of recipe and unreadable nodes only', () => {
        const [fried] = childrenOf(model, childrenOf(model)[0]);
        assert.strictEqual(recipeUriOf(fried), 'file:///ws/Fried rice.cook');
        const [broken] = childrenOf(model, childrenOf(model)[3]);
        assert.strictEqual(recipeUriOf(broken), 'file:///ws/Broken.cook');
        assert.strictEqual(recipeUriOf(childrenOf(model)[0]), undefined);
        assert.strictEqual(recipeUriOf(undefined), undefined);
        assert.strictEqual(recipeUriOf({ kind: 'recipe' }), undefined);
    });
});

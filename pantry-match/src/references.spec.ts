import * as assert from 'assert';
import { ResolvedRecipeReference } from './cooklang-api';
import { RecipeNames } from './names-template';
import { flattenReferencePaths, ReferenceExpander, referencePath } from './references';

const ref = (path: string, children?: ResolvedRecipeReference[]): ResolvedRecipeReference =>
    children ? { path, scale: 1, children } : { path, scale: 1 };
const names = (...list: string[]): RecipeNames => ({ names: list.map(name => ({ name, optional: false })), refs: [] });

describe('referencePath', () => {
    it('adds .cook and drops ./ and backslashes', () => {
        assert.strictEqual(referencePath('./Sauces/Pesto'), 'Sauces/Pesto.cook');
        assert.strictEqual(referencePath('Sauces\\Pesto'), 'Sauces/Pesto.cook');
        assert.strictEqual(referencePath('Pesto.cook'), 'Pesto.cook');
    });
});

describe('flattenReferencePaths', () => {
    it('lists nested references depth-first', () => {
        const tree = [ref('Sauces/Pesto', [ref('Basics/Garlic oil')]), ref('Bread')];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'Pasta.cook'), ['Sauces/Pesto.cook', 'Basics/Garlic oil.cook', 'Bread.cook']);
    });

    it('skips a cycle back to the recipe itself or an ancestor', () => {
        const tree = [ref('B', [ref('A', [ref('B')])])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook']);
    });

    it('stops after three levels', () => {
        const tree = [ref('B', [ref('C', [ref('D', [ref('E')])])])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook', 'C.cook', 'D.cook']);
    });

    it('lists a recipe referenced twice once', () => {
        const tree = [ref('Stock'), ref('Soup', [ref('Stock')])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['Stock.cook', 'Soup.cook']);
    });

    it('ignores malformed entries', () => {
        const tree = [{ path: '', scale: 1 }, { scale: 1 } as unknown as ResolvedRecipeReference, ref('B')];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook']);
    });
});

describe('ReferenceExpander', () => {
    function setup(trees: Record<string, ResolvedRecipeReference[]>, recipes: Record<string, RecipeNames>): {
        expander: ReferenceExpander; resolved: string[];
    } {
        const resolved: string[] = [];
        const expander = new ReferenceExpander({
            resolve: async path => {
                resolved.push(path);
                const tree = trees[path];
                if (!tree) {
                    throw new Error(`Recipe not found: ${path}`);
                }
                return tree;
            },
            names: async path => recipes[path],
        });
        return { expander, resolved };
    }

    it('returns the recipe\'s own names when it has no references, without resolving', async () => {
        const { expander, resolved } = setup({}, {});
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', names('rice')), names('rice').names);
        assert.deepStrictEqual(resolved, []);
    });

    it('merges the ingredients of referenced recipes, keeping optional flags', async () => {
        const { expander } = setup(
            { 'Pasta.cook': [ref('Sauces/Pesto')] },
            { 'Sauces/Pesto.cook': { names: [{ name: 'basil', optional: false }, { name: 'pine nuts', optional: true }], refs: [] } },
        );
        const own: RecipeNames = { names: [{ name: 'pasta', optional: false }], refs: ['./Sauces/Pesto'] };
        assert.deepStrictEqual(await expander.ingredientsFor('Pasta.cook', own), [
            { name: 'pasta', optional: false },
            { name: 'basil', optional: false },
            { name: 'pine nuts', optional: true },
        ]);
    });

    it('survives a reference cycle', async () => {
        const { expander } = setup({ 'A.cook': [ref('B', [ref('A')])] }, { 'A.cook': names('a'), 'B.cook': names('b') });
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), [{ name: 'a', optional: false }, { name: 'b', optional: false }]);
    });

    it('skips references it cannot read', async () => {
        const { expander } = setup({ 'A.cook': [ref('Missing')] }, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./Missing'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), own.names);
    });

    it('falls back to the own names when resolving fails', async () => {
        const { expander } = setup({}, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), own.names);
    });

    it('does not resolve recipes outside the workspace', async () => {
        const { expander, resolved } = setup({}, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('', own), own.names);
        assert.deepStrictEqual(resolved, []);
    });

    it('caches resolved trees until cleared', async () => {
        const { expander, resolved } = setup({ 'A.cook': [ref('B')] }, { 'B.cook': names('b') });
        const own: RecipeNames = { names: [], refs: ['./B'] };
        await expander.ingredientsFor('A.cook', own);
        await expander.ingredientsFor('A.cook', own);
        assert.deepStrictEqual(resolved, ['A.cook']);
        expander.clear();
        await expander.ingredientsFor('A.cook', own);
        assert.deepStrictEqual(resolved, ['A.cook', 'A.cook']);
    });
});

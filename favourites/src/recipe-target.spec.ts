import * as assert from 'assert';
import { recipeTarget, relativePath, UriLike } from './recipe-target';

function uri(scheme: string, path: string): UriLike {
    return { scheme, path, toString: () => `${scheme}://${path}` };
}

const ROOT = uri('file', '/ws');
const PANCAKES = uri('file', '/ws/Breakfast/Pancakes.cook');

describe('relativePath', () => {
    it('returns the path under the root with / separators', () => {
        assert.strictEqual(relativePath(PANCAKES, ROOT), 'Breakfast/Pancakes.cook');
        assert.strictEqual(relativePath(uri('file', '/ws/Old'), ROOT), 'Old');
    });

    it('accepts a root with a trailing slash', () => {
        assert.strictEqual(relativePath(PANCAKES, uri('file', '/ws/')), 'Breakfast/Pancakes.cook');
    });

    it('rejects other schemes, no root, the root itself, and look-alike siblings', () => {
        assert.strictEqual(relativePath(uri('cooklang-hub', '/recipes/1.cook'), ROOT), undefined);
        assert.strictEqual(relativePath(PANCAKES, undefined), undefined);
        assert.strictEqual(relativePath(ROOT, ROOT), undefined);
        assert.strictEqual(relativePath(uri('file', '/ws2/a.cook'), ROOT), undefined);
    });
});

describe('recipeTarget', () => {
    it('uses a preview outlet context when it names a workspace recipe', () => {
        const context = { version: 1, uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook', scale: 1 };
        assert.deepStrictEqual(recipeTarget(context, ROOT, undefined), { uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook' });
    });

    it('rejects a preview context for a remote or out-of-workspace recipe', () => {
        assert.strictEqual(recipeTarget({ version: 1, uri: 'cooklang-hub:/r/1.cook', path: '', scale: 1 }, ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget({ version: 1, uri: 'file:///elsewhere/a.cook', path: '', scale: 1 }, ROOT, undefined), undefined);
    });

    it('uses a favourite tree item as is', () => {
        const item = { favouritePath: 'Dinner/Soup.cook', favouriteUri: 'file:///ws/Dinner/Soup.cook' };
        assert.deepStrictEqual(recipeTarget(item, ROOT, undefined), { uri: 'file:///ws/Dinner/Soup.cook', path: 'Dinner/Soup.cook' });
    });

    it('uses an explorer Uri when it is a .cook file in the workspace', () => {
        assert.deepStrictEqual(recipeTarget(PANCAKES, ROOT, undefined), { uri: 'file:///ws/Breakfast/Pancakes.cook', path: 'Breakfast/Pancakes.cook' });
        assert.deepStrictEqual(recipeTarget(uri('file', '/ws/A.COOK'), ROOT, undefined)?.path, 'A.COOK');
        assert.strictEqual(recipeTarget(uri('file', '/ws/plan.menu'), ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget(uri('file', '/other/a.cook'), ROOT, undefined), undefined);
    });

    it('falls back to the active editor, and to nothing', () => {
        assert.deepStrictEqual(recipeTarget(undefined, ROOT, PANCAKES)?.path, 'Breakfast/Pancakes.cook');
        assert.strictEqual(recipeTarget(undefined, ROOT, uri('file', '/ws/notes.md')), undefined);
        assert.strictEqual(recipeTarget(undefined, ROOT, undefined), undefined);
        assert.strictEqual(recipeTarget('a string', ROOT, undefined), undefined);
    });
});

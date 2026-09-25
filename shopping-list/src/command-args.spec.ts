import * as assert from 'assert';
import { isMenuPath, parseAddRecipesRequest, resolveTarget, ResourceUri } from './command-args';

const uri = (path: string): ResourceUri => ({ scheme: 'file', path });
const resolver = (active?: ResourceUri) => ({
    relativePath: (resource: ResourceUri) => resource.path.startsWith('/ws/') ? resource.path.slice('/ws/'.length) : undefined,
    activeUri: () => active,
});

describe('resolveTarget', () => {
    it('uses an outlet context as-is, keeping its scale', () => {
        assert.deepStrictEqual(resolveTarget([{ version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 3 }], resolver()),
            { path: 'a.cook', scale: 3 });
    });

    it('falls back to scale 1 for a missing or invalid context scale', () => {
        assert.deepStrictEqual(resolveTarget([{ version: 1, uri: 'x', path: 'a.cook', scale: -1 }], resolver()), { path: 'a.cook', scale: 1 });
    });

    it('turns an explorer / editor-title Uri into a workspace-relative path', () => {
        assert.deepStrictEqual(resolveTarget([uri('/ws/Dinner/Soup.cook'), [uri('/ws/Dinner/Soup.cook')]], resolver()),
            { path: 'Dinner/Soup.cook', scale: 1 });
    });

    it('uses the active editor when invoked without arguments', () => {
        assert.deepStrictEqual(resolveTarget([], resolver(uri('/ws/Soup.cook'))), { path: 'Soup.cook', scale: 1 });
    });

    it('returns undefined outside the workspace or with nothing to add', () => {
        assert.strictEqual(resolveTarget([uri('/elsewhere/Cake.cook')], resolver()), undefined);
        assert.strictEqual(resolveTarget([], resolver()), undefined);
    });
});

describe('isMenuPath', () => {
    it('matches .menu case-insensitively', () => {
        assert.strictEqual(isMenuPath('Plans/Week.MENU'), true);
        assert.strictEqual(isMenuPath('Soup.cook'), false);
    });
});

describe('parseAddRecipesRequest', () => {
    it('accepts recipes with optional scales', () => {
        assert.deepStrictEqual(parseAddRecipesRequest({ recipes: [{ path: 'a.cook', scale: 2 }, { path: 'b.cook' }] }),
            { recipes: [{ path: 'a.cook', scale: 2 }, { path: 'b.cook', scale: 1 }] });
    });

    it('accepts a menu', () => {
        assert.deepStrictEqual(parseAddRecipesRequest({ menu: 'Week.menu' }), { menu: 'Week.menu' });
    });

    it('rejects anything else with a message', () => {
        for (const bad of [undefined, {}, { recipes: [] }, { recipes: [{ scale: 1 }] }, { recipes: [{ path: 'a', scale: 0 }] }, { menu: '' }]) {
            assert.strictEqual(typeof (parseAddRecipesRequest(bad) as { error?: string }).error, 'string', JSON.stringify(bad));
        }
    });
});

import * as assert from 'assert';
import { HubError } from './hub-client';
import { ContentSource, HubFileSystemCore, HubFsError, loadRecipeContent, RecipeContentCache } from './hub-file-system-core';

function counting(content: (id: number) => string = id => `recipe ${id}`): { load: (id: number) => Promise<string>; loads: number[] } {
    const loads: number[] = [];
    return { loads, load: async id => { loads.push(id); return content(id); } };
}

function isFsError(code: string): (e: unknown) => boolean {
    return e => e instanceof HubFsError && e.code === code;
}

function source(
    download: () => Promise<string>, enclosureUrl?: string, baseUrl = 'https://hub.example',
): { client: ContentSource; calls: string[] } {
    const calls: string[] = [];
    const client: ContentSource = {
        baseUrl,
        download: async id => { calls.push(`download ${id}`); return download(); },
        recipe: async id => { calls.push(`recipe ${id}`); return enclosureUrl ? { id, title: 'Pasta', enclosureUrl } : { id, title: 'Pasta' }; },
        fetchText: async url => { calls.push(`fetch ${url}`); return 'from enclosure'; },
    };
    return { client, calls };
}

describe('RecipeContentCache', () => {
    it('loads once and serves from the cache', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load);
        assert.strictEqual(await cache.get(1), 'recipe 1');
        assert.strictEqual(await cache.get(1), 'recipe 1');
        assert.deepStrictEqual(loads, [1]);
    });

    it('evicts the least recently used entry beyond capacity', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load, 2);
        await cache.get(1);
        await cache.get(2);
        await cache.get(1);
        await cache.get(3);
        assert.deepStrictEqual([cache.has(1), cache.has(2), cache.has(3), cache.size], [true, false, true, 2]);
        await cache.get(2);
        assert.deepStrictEqual(loads, [1, 2, 3, 2]);
    });

    it('shares one load between concurrent reads', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load);
        assert.deepStrictEqual(await Promise.all([cache.get(5), cache.get(5)]), ['recipe 5', 'recipe 5']);
        assert.deepStrictEqual(loads, [5]);
    });

    it('does not cache failures', async () => {
        let attempts = 0;
        const cache = new RecipeContentCache(async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('offline');
            }
            return 'ok';
        });
        await assert.rejects(cache.get(1), /offline/);
        assert.strictEqual(await cache.get(1), 'ok');
        assert.strictEqual(attempts, 2);
    });

    it('clear() drops already-settled entries too (e.g. when serverUrl changes)', async () => {
        const { load, loads } = counting();
        const cache = new RecipeContentCache(load);
        await cache.get(1);
        await cache.get(2);
        assert.deepStrictEqual([cache.has(1), cache.has(2), cache.size], [true, true, 2]);
        cache.clear();
        assert.deepStrictEqual([cache.has(1), cache.has(2), cache.size], [false, false, 0]);
        await cache.get(1);
        assert.deepStrictEqual(loads, [1, 2, 1]);
    });

    it('drops loads that finish after clear()', async () => {
        let finishLoad: (content: string) => void = () => undefined;
        const cache = new RecipeContentCache(() => new Promise<string>(resolve => { finishLoad = resolve; }));
        const pending = cache.get(1);
        cache.clear();
        finishLoad('from the old server');
        assert.strictEqual(await pending, 'from the old server');
        assert.strictEqual(cache.has(1), false);
    });
});

describe('HubFileSystemCore', () => {
    it('reads a recipe as UTF-8 and stats its byte size', async () => {
        const core = new HubFileSystemCore(async () => 'Crème brûlée');
        const bytes = await core.readFile('/recipes/7/Crème brûlée.cook');
        assert.strictEqual(new TextDecoder().decode(bytes), 'Crème brûlée');
        assert.deepStrictEqual(await core.stat('/recipes/7/Crème brûlée.cook'), { type: 'file', size: 15 });
    });

    it('treats the root, /recipes and /recipes/<id> as directories', async () => {
        const core = new HubFileSystemCore(async () => 'x');
        assert.deepStrictEqual(await core.stat('/'), { type: 'directory', size: 0 });
        assert.deepStrictEqual(await core.stat('/recipes/7'), { type: 'directory', size: 0 });
        assert.deepStrictEqual(core.readDirectory('/'), [['recipes', 'directory']]);
        assert.deepStrictEqual(core.readDirectory('/recipes/7'), []);
        assert.throws(() => core.readDirectory('/recipes/7/A.cook'), isFsError('FileNotFound'));
    });

    it('maps load failures to file-system errors', async () => {
        const core = new HubFileSystemCore(async id => {
            if (id === 1) {
                throw new HubError('notFound', 'Recipe not found');
            }
            throw new HubError('network', 'Could not reach Recipe Hub (connect ECONNREFUSED).');
        });
        await assert.rejects(core.readFile('/recipes/1/A.cook'), isFsError('FileNotFound'));
        await assert.rejects(core.readFile('/recipes/2/B.cook'),
            (e: unknown) => isFsError('Unavailable')(e) && (e as Error).message.includes('ECONNREFUSED'));
        await assert.rejects(core.readFile('/nope'), isFsError('FileNotFound'));
    });

    it('refuses every write with NoPermissions', () => {
        const core = new HubFileSystemCore(async () => 'x');
        for (const path of ['/recipes/1/A.cook', '/recipes/2', '/']) {
            assert.throws(() => core.denyWrite(path), isFsError('NoPermissions'));
        }
    });
});

describe('loadRecipeContent', () => {
    it('uses the download endpoint', async () => {
        const { client, calls } = source(async () => 'downloaded');
        assert.strictEqual(await loadRecipeContent(client, 7), 'downloaded');
        assert.deepStrictEqual(calls, ['download 7']);
    });

    it('falls back to enclosure_url when the download is missing', async () => {
        const { client, calls } = source(async () => { throw new HubError('notFound', 'Recipe content not found'); }, 'https://feed.example/pasta.cook');
        assert.strictEqual(await loadRecipeContent(client, 7), 'from enclosure');
        assert.deepStrictEqual(calls, ['download 7', 'recipe 7', 'fetch https://feed.example/pasta.cook']);
    });

    it('rethrows when there is no fallback', async () => {
        const missing = source(async () => { throw new HubError('notFound', 'Recipe content not found'); });
        await assert.rejects(loadRecipeContent(missing.client, 7), /Recipe content not found/);
        const offline = source(async () => { throw new HubError('network', 'Could not reach Recipe Hub (offline).'); }, 'https://feed.example/pasta.cook');
        await assert.rejects(loadRecipeContent(offline.client, 7), /offline/);
        assert.deepStrictEqual(offline.calls, ['download 7']);
    });

    it('allows an http enclosure_url only from the configured server\'s own origin', async () => {
        const sameOrigin = source(
            async () => { throw new HubError('notFound', 'Recipe content not found'); }, 'http://hub.example/pasta.cook', 'http://hub.example',
        );
        assert.strictEqual(await loadRecipeContent(sameOrigin.client, 7), 'from enclosure');
        assert.deepStrictEqual(sameOrigin.calls, ['download 7', 'recipe 7', 'fetch http://hub.example/pasta.cook']);
    });

    it('rejects an http enclosure_url from a different origin, rethrowing the original download error', async () => {
        const offOrigin = source(
            async () => { throw new HubError('notFound', 'Recipe content not found'); }, 'http://other.example/pasta.cook', 'http://hub.example',
        );
        await assert.rejects(loadRecipeContent(offOrigin.client, 7), /Recipe content not found/);
        assert.deepStrictEqual(offOrigin.calls, ['download 7', 'recipe 7']);
    });

    it('rejects a non-http(s) enclosure_url, rethrowing the original download error', async () => {
        const badScheme = source(async () => { throw new HubError('notFound', 'Recipe content not found'); }, 'file:///etc/passwd');
        await assert.rejects(loadRecipeContent(badScheme.client, 7), /Recipe content not found/);
        assert.deepStrictEqual(badScheme.calls, ['download 7', 'recipe 7']);
    });
});

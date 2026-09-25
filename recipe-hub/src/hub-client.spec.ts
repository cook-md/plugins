import * as assert from 'assert';
import { FetchLike, FetchResponseLike, HubClient, HubError, HubErrorKind } from './hub-client';
import { emptyFilters } from './search-query';

const BASE = 'https://hub.example';

interface Call {
    url: string;
    accept: string;
}

function stubFetch(reply: (url: string) => FetchResponseLike): { fetch: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetch: FetchLike = async (url, init) => {
        calls.push({ url, accept: init.headers.Accept });
        return reply(url);
    };
    return { fetch, calls };
}

function response(status: number, body: string): FetchResponseLike {
    return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function json(status: number, value: unknown): FetchResponseLike {
    return response(status, JSON.stringify(value));
}

async function rejection(promise: Promise<unknown>): Promise<HubError> {
    try {
        await promise;
    } catch (e) {
        assert.ok(e instanceof HubError, `expected a HubError, got ${String(e)}`);
        return e;
    }
    return assert.fail('expected a rejection');
}

describe('HubClient', () => {
    it('searches with the filter params and maps a full card', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            results: [{
                id: 7, title: 'Pasta Bake', summary: 'Cheesy', tags: ['pasta'], locale: 'en',
                total_time_minutes: 40, servings: 4, difficulty: 'easy', image_url: 'https://img.example/p.jpg',
                feed: { id: 3, title: 'Anna\'s Kitchen' },
            }],
            pagination: { page: 1, limit: 20, total: 41, total_pages: 3 },
        }));
        const page = await new HubClient({ baseUrl: `${BASE}/`, fetch }).search({ ...emptyFilters('en'), q: 'pasta', tags: ['vegan'] }, 1);
        assert.deepStrictEqual(calls, [{ url: `${BASE}/api/search?q=pasta&tags=vegan&locale=en&page=1&limit=20`, accept: 'application/json' }]);
        assert.deepStrictEqual(page, {
            cards: [{
                id: 7, title: 'Pasta Bake', summary: 'Cheesy', tags: ['pasta'], locale: 'en', totalTimeMinutes: 40,
                servings: 4, difficulty: 'easy', imageUrl: 'https://img.example/p.jpg', feed: { id: 3, title: 'Anna\'s Kitchen' },
            }],
            page: 1, total: 41, totalPages: 3, hasMore: true,
        });
    });

    it('tolerates cards without the optional fields (older servers)', async () => {
        const { fetch } = stubFetch(() => json(200, {
            results: [{ id: 1, title: 'Soup', summary: null, tags: ['a', 3], locale: null }, { id: 'x' }],
            pagination: { page: 2, limit: 20, total: 21, total_pages: 2 },
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 2), {
            cards: [{ id: 1, title: 'Soup', tags: ['a'] }], page: 2, total: 21, totalPages: 2, hasMore: false,
        });
    });

    it('normalises explicit JSON null optional fields to undefined (never present as null)', async () => {
        const { fetch } = stubFetch(() => json(200, {
            results: [{
                id: 9, title: 'Broth', summary: null, tags: [], locale: null,
                total_time_minutes: null, servings: null, difficulty: null, image_url: null, feed: null,
            }],
            pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
        }));
        const page = await new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1);
        const card = page.cards[0];
        assert.deepStrictEqual(card, { id: 9, title: 'Broth', tags: [] });
        for (const key of ['summary', 'locale', 'totalTimeMinutes', 'servings', 'difficulty', 'imageUrl', 'feed']) {
            assert.strictEqual(card[key as keyof typeof card], undefined, `${key} should be undefined, not null`);
            assert.ok(!(key in card), `${key} should not be a key on the card at all`);
        }
    });

    it('maps HTTP errors to kinds', async () => {
        const cases: Array<[number, string, HubErrorKind, string]> = [
            [400, JSON.stringify({ error: 'Invalid query: expected \':\'' }), 'badQuery', 'Invalid query: expected \':\''],
            [404, JSON.stringify({ error: 'Recipe not found' }), 'notFound', 'Recipe not found'],
            [429, 'Too Many Requests! Wait for 2s', 'rateLimited', 'Too many searches — try again shortly.'],
            [500, JSON.stringify({ error: 'Search error' }), 'server', 'Recipe Hub error: Search error'],
            [502, '<html>Bad gateway</html>', 'server', 'Recipe Hub error (HTTP 502).'],
        ];
        for (const [status, body, kind, message] of cases) {
            const { fetch } = stubFetch(() => response(status, body));
            const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1));
            assert.deepStrictEqual([error.kind, error.message, error.status], [kind, message, status]);
        }
    });

    it('treats a plain-text 400 body as a badQuery error with a fallback message', async () => {
        // axum's own extractor-rejection 400s (e.g. a repeated query parameter) are
        // plain text, not the federation's `{"error": "..."}` JSON shape.
        const { fetch } = stubFetch(() => response(400, 'Failed to deserialize query string: duplicate field `q`'));
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1));
        assert.strictEqual(error.kind, 'badQuery');
        assert.strictEqual(error.status, 400);
        assert.strictEqual(error.message, 'Recipe Hub could not understand this search.');
    });

    it('reports an unreachable server as a network error', async () => {
        const fetch: FetchLike = async () => {
            throw Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') });
        };
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).facets());
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'Could not reach Recipe Hub (connect ECONNREFUSED 127.0.0.1:9).');
    });

    it('reports a timeout as a network error', async () => {
        const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch, timeoutMs: 20 }).download(1));
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'Recipe Hub did not respond in time.');
    });

    it('treats a non-JSON success as a server error', async () => {
        const { fetch } = stubFetch(() => response(200, '<html>maintenance</html>'));
        assert.strictEqual((await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1))).kind, 'server');
    });

    it('treats a search response without results as a server error', async () => {
        const { fetch } = stubFetch(() => json(200, { hello: 1 }));
        assert.strictEqual((await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1))).kind, 'server');
    });

    it('rejects an invalid server URL without a request', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {}));
        const error = await rejection(new HubClient({ baseUrl: 'recipes.cooklang.org', fetch }).search(emptyFilters(), 1));
        assert.strictEqual(error.kind, 'network');
        assert.ok(error.message.includes('recipeHub.serverUrl'), error.message);
        assert.strictEqual(calls.length, 0);
    });

    it('normalises facets', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            tags: [{ name: 'dessert', count: 12 }, { name: 5 }],
            locales: [{ code: 'en', name: 'English', count: 900 }, { code: 'de', count: 3 }],
            difficulties: [{ name: 'easy', count: 4 }],
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).facets(), {
            tags: [{ name: 'dessert', count: 12 }],
            locales: [{ code: 'en', name: 'English', count: 900 }, { code: 'de', name: 'de', count: 3 }],
            difficulties: [{ name: 'easy', count: 4 }],
        });
        assert.strictEqual(calls[0].url, `${BASE}/api/facets`);
    });

    it('normalises recipe details', async () => {
        const { fetch, calls } = stubFetch(() => json(200, {
            id: 7, title: 'Pasta Bake', summary: null, source_url: 'https://blog.example/pasta',
            enclosure_url: 'https://feed.example/pasta.cook', image_url: null, feed: { id: 3, title: 'Anna', author: null },
        }));
        assert.deepStrictEqual(await new HubClient({ baseUrl: BASE, fetch }).recipe(7), {
            id: 7, title: 'Pasta Bake', sourceUrl: 'https://blog.example/pasta',
            enclosureUrl: 'https://feed.example/pasta.cook', feed: { id: 3, title: 'Anna' },
        });
        assert.strictEqual(calls[0].url, `${BASE}/api/recipes/7`);
    });

    it('downloads recipe text', async () => {
        const { fetch, calls } = stubFetch(() => response(200, 'Boil @pasta{400%g}.\n'));
        assert.strictEqual(await new HubClient({ baseUrl: BASE, fetch }).download(7), 'Boil @pasta{400%g}.\n');
        assert.deepStrictEqual(calls, [{ url: `${BASE}/api/recipes/7/download`, accept: 'text/plain' }]);
    });

    it('fetchText only follows http(s) URLs', async () => {
        const { fetch, calls } = stubFetch(() => response(200, 'from the feed'));
        const client = new HubClient({ baseUrl: BASE, fetch });
        assert.strictEqual((await rejection(client.fetchText('file:///etc/passwd'))).kind, 'notFound');
        assert.strictEqual(calls.length, 0);
        assert.strictEqual(await client.fetchText('https://feed.example/pasta.cook'), 'from the feed');
        assert.deepStrictEqual(calls, [{ url: 'https://feed.example/pasta.cook', accept: 'text/plain' }]);
    });

    it('rejects invalid recipe ids without a request', async () => {
        const { fetch, calls } = stubFetch(() => json(200, { id: 1, title: 'X' }));
        const client = new HubClient({ baseUrl: BASE, fetch });
        for (const id of [0, -1, 1.5, NaN]) {
            const error = await rejection(client.recipe(id));
            assert.strictEqual(error.kind, 'notFound', `id ${id} should be rejected as notFound`);
        }
        assert.strictEqual(calls.length, 0);
    });

    it('rejects invalid download ids without a request', async () => {
        const { fetch, calls } = stubFetch(() => response(200, 'text'));
        const client = new HubClient({ baseUrl: BASE, fetch });
        for (const id of [0, -1, 1.5, NaN]) {
            const error = await rejection(client.download(id));
            assert.strictEqual(error.kind, 'notFound', `id ${id} should be rejected as notFound`);
        }
        assert.strictEqual(calls.length, 0);
    });

    it('rejects an oversize response using content-length, without reading the body', async () => {
        let textCalled = false;
        const fetch: FetchLike = async () => ({
            ok: true,
            status: 200,
            headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(3 * 1024 * 1024) : null) },
            text: async () => { textCalled = true; return '{}'; },
        });
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1));
        assert.strictEqual(error.kind, 'server');
        assert.strictEqual(error.message, 'Recipe Hub sent a response that is too large.');
        assert.strictEqual(textCalled, false, 'the body should never be read once content-length exceeds the cap');
    });

    it('rejects an oversize response body when content-length is absent', async () => {
        const big = 'x'.repeat(2 * 1024 * 1024 + 1);
        const { fetch } = stubFetch(() => response(200, big));
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).download(1));
        assert.strictEqual(error.kind, 'server');
        assert.strictEqual(error.message, 'Recipe Hub sent a response that is too large.');
    });

    it('rejects an oversize streamed response body without buffering it all', async () => {
        const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
        const totalChunks = 3; // 3 MiB, above the 2 MB cap
        let reads = 0;
        let cancelled = false;
        const fetch: FetchLike = async () => ({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: async () => {
                        reads += 1;
                        if (reads > totalChunks) {
                            return { done: true, value: undefined };
                        }
                        return { done: false, value: chunk };
                    },
                    cancel: async () => { cancelled = true; },
                }),
            },
            text: async () => { throw new Error('text() should not be called when a body reader is available'); },
        });
        const error = await rejection(new HubClient({ baseUrl: BASE, fetch }).search(emptyFilters(), 1));
        assert.strictEqual(error.kind, 'server');
        assert.strictEqual(error.message, 'Recipe Hub sent a response that is too large.');
        assert.ok(reads < totalChunks + 1, 'should stop reading once the cap is exceeded, not drain the whole stream');
        assert.strictEqual(cancelled, true, 'should cancel the reader once the cap is exceeded');
    });
});

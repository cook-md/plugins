import * as assert from 'assert';
import { parseFromWebview } from './protocol';
import { emptyFilters } from './search-query';

describe('parseFromWebview', () => {
    it('accepts well-formed messages', () => {
        assert.deepStrictEqual(parseFromWebview({ type: 'ready' }), { type: 'ready' });
        assert.deepStrictEqual(parseFromWebview({ type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } }),
            { type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } });
        assert.deepStrictEqual(parseFromWebview({ type: 'open', id: 7, title: 'Pasta Bake' }), { type: 'open', id: 7, title: 'Pasta Bake' });
    });

    it('rejects malformed messages', () => {
        const bad: unknown[] = [
            undefined, null, 'ready', {}, { type: 'delete' },
            { type: 'search', seq: 0, page: 1, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1.5, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1, filters: { q: 1 } },
            { type: 'open', id: -1, title: 'x' },
            { type: 'open', id: 7 },
        ];
        for (const message of bad) {
            assert.strictEqual(parseFromWebview(message), undefined, JSON.stringify(message));
        }
    });
});

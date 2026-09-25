import * as assert from 'assert';
import { parseFromWebview, parsePanelState } from './protocol';
import { emptyFilters } from './search-query';

describe('parseFromWebview', () => {
    it('accepts well-formed messages', () => {
        assert.deepStrictEqual(parseFromWebview({ type: 'ready' }), { type: 'ready' });
        assert.deepStrictEqual(parseFromWebview({ type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } }),
            { type: 'search', seq: 3, page: 2, filters: { ...emptyFilters('en'), q: 'soup' } });
        assert.deepStrictEqual(parseFromWebview({ type: 'open', id: 7, title: 'Pasta Bake' }), { type: 'open', id: 7, title: 'Pasta Bake' });
        assert.deepStrictEqual(
            parseFromWebview({ type: 'state', filters: { ...emptyFilters('en'), tags: ['vegan'] }, filtersOpen: true, localeTouched: false }),
            { type: 'state', filters: { ...emptyFilters('en'), tags: ['vegan'] }, filtersOpen: true, localeTouched: false });
    });

    it('reads missing panel-state flags as false', () => {
        assert.deepStrictEqual(parseFromWebview({ type: 'state', filters: emptyFilters() }),
            { type: 'state', filters: emptyFilters(), filtersOpen: false, localeTouched: false });
    });

    it('rejects malformed messages', () => {
        const bad: unknown[] = [
            undefined, null, 'ready', {}, { type: 'delete' },
            { type: 'search', seq: 0, page: 1, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1.5, filters: emptyFilters() },
            { type: 'search', seq: 1, page: 1, filters: { q: 1 } },
            { type: 'open', id: -1, title: 'x' },
            { type: 'open', id: 7 },
            { type: 'state' },
            { type: 'state', filters: { q: 1 }, filtersOpen: true },
            { type: 'state', filters: emptyFilters(), filtersOpen: 'yes' },
        ];
        for (const message of bad) {
            assert.strictEqual(parseFromWebview(message), undefined, JSON.stringify(message));
        }
    });
});

describe('parsePanelState', () => {
    it('reads a stored panel state', () => {
        const filters = { ...emptyFilters('de'), q: 'soup', maxTime: 30, feed: { id: 4, title: 'Grandma' } };
        assert.deepStrictEqual(parsePanelState({ filters, filtersOpen: true, localeTouched: true }),
            { filters, filtersOpen: true, localeTouched: true });
    });

    it('rejects corrupt stored state', () => {
        const bad: unknown[] = [
            undefined, null, 42, 'state', {}, { filters: undefined, filtersOpen: true },
            { filters: { ...emptyFilters(), sort: 'oldest' } },
            { filters: emptyFilters(), filtersOpen: 1 },
            { filters: emptyFilters(), localeTouched: 'true' },
        ];
        for (const value of bad) {
            assert.strictEqual(parsePanelState(value), undefined, JSON.stringify(value));
        }
    });

    it('drops unknown fields', () => {
        assert.deepStrictEqual(parsePanelState({ filters: emptyFilters(), filtersOpen: false, extra: 'x' }),
            { filters: emptyFilters(), filtersOpen: false, localeTouched: false });
    });
});

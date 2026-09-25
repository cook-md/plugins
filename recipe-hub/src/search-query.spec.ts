import * as assert from 'assert';
import {
    activeFilterCount, addTerm, clearFilters, emptyFilters, MAX_LIST_VALUES, orderServings, parseFilters, primaryLanguage,
    resolveDefaultLocale, SearchFilters, toSearchParams,
} from './search-query';

const FULL: SearchFilters = {
    q: 'tags:dinner pasta',
    tags: ['vegan', 'dessert'],
    includeIngredients: ['garlic', 'lemon'],
    excludeIngredients: ['peanut'],
    maxTime: 30,
    difficulty: 'Easy',
    minServings: 2,
    maxServings: 6,
    locale: 'de',
    sort: 'newest',
    feed: { id: 12, title: 'Anna' },
};

function entries(params: URLSearchParams): Record<string, string> {
    const out: Record<string, string> = {};
    params.forEach((value, key) => { out[key] = value; });
    return out;
}

describe('toSearchParams', () => {
    it('sends only paging for empty filters', () => {
        assert.deepStrictEqual(entries(toSearchParams(emptyFilters(), 1)), { page: '1', limit: '20' });
    });

    it('maps every filter to its API parameter', () => {
        assert.deepStrictEqual(entries(toSearchParams(FULL, 3, 20)), {
            q: 'tags:dinner pasta',
            tags: 'vegan,dessert',
            include_ingredients: 'garlic,lemon',
            exclude_ingredients: 'peanut',
            max_time: '30',
            min_servings: '2',
            max_servings: '6',
            difficulty: 'easy',
            feed_id: '12',
            locale: 'de',
            sort: 'newest',
            page: '3',
            limit: '20',
        });
    });

    it('normalises and de-duplicates list values', () => {
        const params = toSearchParams({ ...emptyFilters(), tags: [' Vegan ', 'vegan', 'a,b', '  '] }, 1);
        assert.strictEqual(params.get('tags'), 'vegan,a b');
    });

    it('drops invalid numbers and falls back to page 1', () => {
        const filters: SearchFilters = { ...emptyFilters(), maxTime: 0, minServings: 2.5, maxServings: -1 };
        assert.deepStrictEqual(entries(toSearchParams(filters, 0, 0)), { page: '1', limit: '20' });
    });

    it('omits sort=relevance', () => {
        assert.strictEqual(toSearchParams(emptyFilters(), 1).has('sort'), false);
    });

    it('caps each list value at 20 entries so the server never rejects the request', () => {
        const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
        const params = toSearchParams({ ...emptyFilters(), tags: many, includeIngredients: many, excludeIngredients: many }, 1);
        assert.strictEqual(params.get('tags')?.split(',').length, 20);
        assert.strictEqual(params.get('include_ingredients')?.split(',').length, 20);
        assert.strictEqual(params.get('exclude_ingredients')?.split(',').length, 20);
        assert.deepStrictEqual(params.get('tags')?.split(','), many.slice(0, 20));
    });
});

describe('parseFilters', () => {
    it('accepts a complete filter object', () => {
        assert.deepStrictEqual(parseFilters(FULL), FULL);
    });

    it('rejects malformed input', () => {
        for (const bad of [undefined, null, 'x', {}, { ...emptyFilters(), sort: 'best' }, { ...emptyFilters(), tags: [1] }, { ...emptyFilters(), q: 5 }]) {
            assert.strictEqual(parseFilters(bad), undefined, JSON.stringify(bad));
        }
    });

    it('drops invalid optional fields', () => {
        assert.deepStrictEqual(
            parseFilters({ ...emptyFilters('en'), maxTime: -5, minServings: 'two', difficulty: ' ', feed: { id: 0, title: 'x' }, tags: [' Vegan', 'vegan'] }),
            { ...emptyFilters('en'), tags: ['vegan'] });
    });

    it('caps list terms at MAX_LIST_VALUES, matching what toSearchParams sends', () => {
        const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
        const filters = parseFilters({ ...emptyFilters(), tags: many, includeIngredients: many, excludeIngredients: many });
        assert.strictEqual(filters?.tags.length, MAX_LIST_VALUES);
        assert.strictEqual(filters?.includeIngredients.length, MAX_LIST_VALUES);
        assert.strictEqual(filters?.excludeIngredients.length, MAX_LIST_VALUES);
        assert.deepStrictEqual(filters?.tags, many.slice(0, MAX_LIST_VALUES));
    });

    it('caps q and feed.title length so restored state matches what is sent', () => {
        const filters = parseFilters({ ...emptyFilters(), q: 'a'.repeat(600), feed: { id: 1, title: 'b'.repeat(300) } });
        assert.strictEqual(filters?.q.length, 500);
        assert.strictEqual(filters?.feed?.title.length, 200);
    });
});

describe('filter helpers', () => {
    it('addTerm normalises and ignores duplicates', () => {
        assert.deepStrictEqual(addTerm(['vegan'], ' Vegan '), ['vegan']);
        assert.deepStrictEqual(addTerm(['vegan'], 'Gluten, free'), ['vegan', 'gluten free']);
        assert.deepStrictEqual(addTerm([], '  '), []);
    });

    it('addTerm stops at the server list cap', () => {
        const full = Array.from({ length: MAX_LIST_VALUES }, (_, index) => `t${index}`);
        assert.deepStrictEqual(addTerm(full, 'one more'), full);
        assert.deepStrictEqual(addTerm(full.slice(1), 'one more'), [...full.slice(1), 'one more']);
    });

    it('activeFilterCount counts structured filters only', () => {
        assert.strictEqual(activeFilterCount(emptyFilters()), 0);
        assert.strictEqual(activeFilterCount({ ...emptyFilters('en'), q: 'x', sort: 'newest' }), 1);
        assert.strictEqual(activeFilterCount({ ...emptyFilters(), tags: ['a', 'b'], minServings: 2, maxServings: 4, maxTime: 15 }), 4);
        assert.strictEqual(activeFilterCount(FULL), 10);
    });

    it('activeFilterCount counts the language only when it differs from the default', () => {
        assert.strictEqual(activeFilterCount(emptyFilters('en'), 'en'), 0);
        assert.strictEqual(activeFilterCount(emptyFilters(''), 'en'), 1);
        assert.strictEqual(activeFilterCount(emptyFilters('de'), 'en'), 1);
        assert.strictEqual(activeFilterCount(clearFilters(FULL, 'en'), 'en'), 0);
    });

    it('orderServings swaps a reversed range and leaves the rest alone', () => {
        assert.deepStrictEqual(orderServings({ ...emptyFilters(), minServings: 6, maxServings: 2 }),
            { ...emptyFilters(), minServings: 2, maxServings: 6 });
        assert.deepStrictEqual(orderServings({ ...emptyFilters(), minServings: 2, maxServings: 6 }),
            { ...emptyFilters(), minServings: 2, maxServings: 6 });
        assert.deepStrictEqual(orderServings({ ...emptyFilters(), minServings: 6 }), { ...emptyFilters(), minServings: 6 });
    });

    it('clearFilters keeps the query and sort', () => {
        assert.deepStrictEqual(clearFilters(FULL, 'en'), { ...emptyFilters('en'), q: 'tags:dinner pasta', sort: 'newest' });
    });
});

describe('default locale', () => {
    it('primaryLanguage takes the language subtag', () => {
        assert.strictEqual(primaryLanguage('en-US'), 'en');
        assert.strictEqual(primaryLanguage('pt_BR'), 'pt');
        assert.strictEqual(primaryLanguage('DE'), 'de');
        assert.strictEqual(primaryLanguage(''), '');
    });

    it('resolveDefaultLocale keeps the display language only when recipes exist in it', () => {
        assert.strictEqual(resolveDefaultLocale('de-AT', undefined), 'de');
        assert.strictEqual(resolveDefaultLocale('de-AT', []), 'de');
        assert.strictEqual(resolveDefaultLocale('de-AT', [{ code: 'en' }, { code: 'DE' }]), 'de');
        assert.strictEqual(resolveDefaultLocale('fr', [{ code: 'en' }]), '');
    });
});

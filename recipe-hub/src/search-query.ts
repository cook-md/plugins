// Filter state shared by the webview and the extension host, and its mapping
// to the Recipe Hub `GET /api/search` query string. No `vscode` import: the
// webview bundle and the mocha specs both use it.

export type SortOrder = 'relevance' | 'newest';

/** Results per page; "Load more" fetches the next page. */
export const PAGE_SIZE = 20;

/** Max-time presets in minutes; `maxTime` undefined means any. */
export const MAX_TIME_PRESETS: readonly number[] = [15, 30, 60];

/**
 * The server de-duplicates and caps each of `tags`, `include_ingredients` and
 * `exclude_ingredients` at this many values, rejecting the request with 400
 * above it. The client caps to the same limit so it never sends a request the
 * server will reject.
 */
export const MAX_LIST_VALUES = 20;

export interface FeedFilter {
    id: number;
    title: string;
}

export interface SearchFilters {
    /** Free text; the full `q` syntax (e.g. `tags:vegan`) is passed through. */
    q: string;
    /** Recipe has all of these tags. */
    tags: string[];
    /** Recipe uses all of these. */
    includeIngredients: string[];
    /** Recipe uses none of these. */
    excludeIngredients: string[];
    /** Total time at most this many minutes. */
    maxTime?: number;
    difficulty?: string;
    minServings?: number;
    maxServings?: number;
    /** Language code such as `en`; empty means any language. */
    locale: string;
    sort: SortOrder;
    /** Only recipes from this feed. */
    feed?: FeedFilter;
}

export function emptyFilters(locale = ''): SearchFilters {
    return { q: '', tags: [], includeIngredients: [], excludeIngredients: [], locale, sort: 'relevance' };
}

/** Keeps the query text and sort order; resets every filter, the language back to `defaultLocale`. */
export function clearFilters(filters: SearchFilters, defaultLocale: string): SearchFilters {
    return { ...emptyFilters(defaultLocale), q: filters.q, sort: filters.sort };
}

/**
 * How many filters differ from the defaults. The query text and the sort order
 * are not filters; the language counts only when it is not `defaultLocale`.
 */
export function activeFilterCount(filters: SearchFilters, defaultLocale = ''): number {
    return filters.tags.length + filters.includeIngredients.length + filters.excludeIngredients.length
        + (filters.maxTime !== undefined ? 1 : 0)
        + (filters.difficulty !== undefined ? 1 : 0)
        + (filters.minServings !== undefined || filters.maxServings !== undefined ? 1 : 0)
        + (filters.locale !== defaultLocale ? 1 : 0)
        + (filters.feed !== undefined ? 1 : 0);
}

/** A tag or ingredient as typed: trimmed, lower-cased, commas removed (they separate list items on the wire). */
export function normalizeTerm(term: string): string {
    return term.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * `list` plus the normalised `term`; unchanged when the term is empty, already
 * present, or the list already holds `MAX_LIST_VALUES` terms.
 */
export function addTerm(list: readonly string[], term: string): string[] {
    const normalized = normalizeTerm(term);
    if (normalized === '' || list.includes(normalized) || list.length >= MAX_LIST_VALUES) {
        return [...list];
    }
    return [...list, normalized];
}

/** Swaps a reversed servings range (min above max) so it still matches something. */
export function orderServings(filters: SearchFilters): SearchFilters {
    const { minServings, maxServings } = filters;
    return minServings !== undefined && maxServings !== undefined && minServings > maxServings
        ? { ...filters, minServings: maxServings, maxServings: minServings }
        : filters;
}

function positiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function terms(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
        return undefined;
    }
    return [...new Set((value as string[]).map(normalizeTerm).filter(term => term !== ''))];
}

/** Query parameters for `GET /api/search`; empty and invalid filters are left out. */
export function toSearchParams(filters: SearchFilters, page: number, limit: number = PAGE_SIZE): URLSearchParams {
    const params = new URLSearchParams();
    const q = filters.q.trim();
    if (q !== '') {
        params.set('q', q);
    }
    const list = (key: string, values: readonly string[]): void => {
        const cleaned = [...new Set(values.map(normalizeTerm).filter(value => value !== ''))].slice(0, MAX_LIST_VALUES);
        if (cleaned.length > 0) {
            params.set(key, cleaned.join(','));
        }
    };
    const number = (key: string, value: number | undefined): void => {
        const valid = positiveInteger(value);
        if (valid !== undefined) {
            params.set(key, String(valid));
        }
    };
    list('tags', filters.tags);
    list('include_ingredients', filters.includeIngredients);
    list('exclude_ingredients', filters.excludeIngredients);
    number('max_time', filters.maxTime);
    number('min_servings', filters.minServings);
    number('max_servings', filters.maxServings);
    if (filters.difficulty !== undefined && filters.difficulty.trim() !== '') {
        params.set('difficulty', filters.difficulty.trim().toLowerCase());
    }
    number('feed_id', filters.feed?.id);
    if (filters.locale.trim() !== '') {
        params.set('locale', filters.locale.trim());
    }
    if (filters.sort === 'newest') {
        params.set('sort', 'newest');
    }
    params.set('page', String(positiveInteger(page) ?? 1));
    params.set('limit', String(positiveInteger(limit) ?? PAGE_SIZE));
    return params;
}

/**
 * Filters from untrusted input (webview messages, persisted webview state).
 * Undefined when the required fields are missing; invalid optional fields are dropped.
 */
export function parseFilters(value: unknown): SearchFilters | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const tags = terms(raw.tags);
    const includeIngredients = terms(raw.includeIngredients);
    const excludeIngredients = terms(raw.excludeIngredients);
    if (typeof raw.q !== 'string' || typeof raw.locale !== 'string' || !tags || !includeIngredients || !excludeIngredients) {
        return undefined;
    }
    if (raw.sort !== 'relevance' && raw.sort !== 'newest') {
        return undefined;
    }
    const filters: SearchFilters = { q: raw.q, tags, includeIngredients, excludeIngredients, locale: raw.locale, sort: raw.sort };
    const maxTime = positiveInteger(raw.maxTime);
    if (maxTime !== undefined) {
        filters.maxTime = maxTime;
    }
    const minServings = positiveInteger(raw.minServings);
    if (minServings !== undefined) {
        filters.minServings = minServings;
    }
    const maxServings = positiveInteger(raw.maxServings);
    if (maxServings !== undefined) {
        filters.maxServings = maxServings;
    }
    if (typeof raw.difficulty === 'string' && raw.difficulty.trim() !== '') {
        filters.difficulty = raw.difficulty.trim();
    }
    const feed = raw.feed as { id?: unknown; title?: unknown } | undefined;
    const feedId = typeof feed === 'object' && feed !== null ? positiveInteger(feed.id) : undefined;
    if (feedId !== undefined && typeof feed?.title === 'string') {
        filters.feed = { id: feedId, title: feed.title };
    }
    return filters;
}

/** `en-US` → `en`. */
export function primaryLanguage(displayLanguage: string): string {
    return displayLanguage.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * The language filter to start with: the editor's display language, unless the
 * index is known to have no recipes in it (then any language).
 */
export function resolveDefaultLocale(displayLanguage: string, locales?: ReadonlyArray<{ code: string }>): string {
    const primary = primaryLanguage(displayLanguage);
    if (!locales || locales.length === 0) {
        return primary;
    }
    return locales.some(locale => locale.code.toLowerCase() === primary) ? primary : '';
}

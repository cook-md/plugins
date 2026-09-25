// Typed client for the Recipe Hub (recipes.cooklang.org) public API. Runs in
// the extension host on Node's global `fetch`; no `vscode` import, so the
// specs stub `fetch`. Optional response fields may be missing (older
// servers): cards simply come back without them.

import { httpUrl, trimServerUrl } from './hub-urls';
import { PAGE_SIZE, SearchFilters, toSearchParams } from './search-query';

export const DEFAULT_SERVER_URL = 'https://recipes.cooklang.org';
export const DEFAULT_TIMEOUT_MS = 15000;

export type HubErrorKind = 'network' | 'badQuery' | 'rateLimited' | 'server' | 'notFound';

/** Every failure of a Recipe Hub request, with a message fit for the UI. */
export class HubError extends Error {
    constructor(readonly kind: HubErrorKind, message: string, readonly status?: number) {
        super(message);
        this.name = 'HubError';
    }
}

export interface HubFeed {
    id: number;
    title?: string;
    author?: string;
}

export interface RecipeCard {
    id: number;
    title: string;
    summary?: string;
    tags: string[];
    locale?: string;
    totalTimeMinutes?: number;
    servings?: number;
    difficulty?: string;
    imageUrl?: string;
    feed?: HubFeed;
}

export interface SearchPage {
    cards: RecipeCard[];
    page: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
}

export interface FacetCount {
    name: string;
    count: number;
}

export interface LocaleFacet {
    code: string;
    name: string;
    count: number;
}

export interface Facets {
    tags: FacetCount[];
    locales: LocaleFacet[];
    difficulties: FacetCount[];
}

export interface RecipeDetail {
    id: number;
    title: string;
    summary?: string;
    sourceUrl?: string;
    enclosureUrl?: string;
    imageUrl?: string;
    feed?: HubFeed;
}

/** The part of a fetch `Response` the client reads. */
export interface FetchResponseLike {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
}

export interface FetchInitLike {
    signal: AbortSignal;
    headers: Record<string, string>;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface HubClientOptions {
    baseUrl: string;
    fetch?: FetchLike;
    timeoutMs?: number;
}

export class HubClient {

    readonly baseUrl: string;
    protected readonly fetchImpl: FetchLike;
    protected readonly timeoutMs: number;

    constructor(options: HubClientOptions) {
        this.baseUrl = trimServerUrl(options.baseUrl);
        this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async search(filters: SearchFilters, page: number, limit: number = PAGE_SIZE): Promise<SearchPage> {
        return normalizeSearchPage(await this.getJson(`/api/search?${toSearchParams(filters, page, limit).toString()}`));
    }

    async facets(): Promise<Facets> {
        return normalizeFacets(await this.getJson('/api/facets'));
    }

    async recipe(id: number): Promise<RecipeDetail> {
        return normalizeDetail(await this.getJson(`/api/recipes/${id}`));
    }

    /** The recipe's Cooklang source. */
    async download(id: number): Promise<string> {
        return this.get(this.apiUrl(`/api/recipes/${id}/download`), 'text/plain');
    }

    /** Text at an absolute http(s) URL, e.g. a feed's `enclosure_url`. */
    async fetchText(url: string): Promise<string> {
        const valid = httpUrl(url);
        if (valid === undefined) {
            throw new HubError('notFound', 'The recipe file is not at an http(s) address.');
        }
        return this.get(valid, 'text/plain');
    }

    protected apiUrl(pathAndQuery: string): string {
        if (httpUrl(this.baseUrl) === undefined) {
            throw new HubError('network', `Invalid Recipe Hub server URL "${this.baseUrl}". Check the recipeHub.serverUrl setting.`);
        }
        return this.baseUrl + pathAndQuery;
    }

    protected async getJson(pathAndQuery: string): Promise<unknown> {
        const body = await this.get(this.apiUrl(pathAndQuery), 'application/json');
        try {
            return JSON.parse(body);
        } catch {
            throw new HubError('server', 'Recipe Hub sent an unexpected response.');
        }
    }

    protected async get(url: string, accept: string): Promise<string> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            let response: FetchResponseLike;
            let body: string;
            try {
                response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: accept } });
                body = await response.text();
            } catch (e) {
                throw networkError(e, controller.signal.aborted);
            }
            if (!response.ok) {
                throw httpError(response.status, body);
            }
            return body;
        } finally {
            clearTimeout(timer);
        }
    }
}

function networkError(e: unknown, timedOut: boolean): HubError {
    if (timedOut) {
        return new HubError('network', 'Recipe Hub did not respond in time.');
    }
    const cause = typeof e === 'object' && e !== null ? (e as { cause?: { message?: unknown } }).cause?.message : undefined;
    const reason = typeof cause === 'string' ? cause : e instanceof Error ? e.message : String(e);
    return new HubError('network', `Could not reach Recipe Hub (${reason}).`);
}

/** The `{ "error": "…" }` message the server puts in error bodies. */
function serverMessage(body: string): string | undefined {
    try {
        const parsed = JSON.parse(body) as { error?: unknown };
        return typeof parsed.error === 'string' && parsed.error.trim() !== '' ? parsed.error : undefined;
    } catch {
        return undefined;
    }
}

function httpError(status: number, body: string): HubError {
    const message = serverMessage(body);
    switch (status) {
        case 400: return new HubError('badQuery', message ?? 'Recipe Hub could not understand this search.', status);
        case 404: return new HubError('notFound', message ?? 'Not found on Recipe Hub.', status);
        case 429: return new HubError('rateLimited', 'Too many searches — try again shortly.', status);
        default: return new HubError('server', message ? `Recipe Hub error: ${message}` : `Recipe Hub error (HTTP ${status}).`, status);
    }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];
}

/** `value` without its undefined properties, so results compare and serialise cleanly. */
function compact<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function unexpected(): HubError {
    return new HubError('server', 'Recipe Hub sent an unexpected response.');
}

function normalizeFeed(value: unknown): HubFeed | undefined {
    const raw = asObject(value);
    const id = optionalNumber(raw?.id);
    if (!raw || id === undefined) {
        return undefined;
    }
    return compact({ id, title: optionalString(raw.title), author: optionalString(raw.author) });
}

function normalizeCard(value: unknown): RecipeCard | undefined {
    const raw = asObject(value);
    const id = optionalNumber(raw?.id);
    const title = optionalString(raw?.title);
    if (!raw || id === undefined || title === undefined) {
        return undefined;
    }
    return compact({
        id,
        title,
        summary: optionalString(raw.summary),
        tags: stringList(raw.tags),
        locale: optionalString(raw.locale),
        totalTimeMinutes: optionalNumber(raw.total_time_minutes),
        servings: optionalNumber(raw.servings),
        difficulty: optionalString(raw.difficulty),
        imageUrl: optionalString(raw.image_url),
        feed: normalizeFeed(raw.feed),
    });
}

function normalizeSearchPage(body: unknown): SearchPage {
    const raw = asObject(body);
    if (!raw || !Array.isArray(raw.results)) {
        throw unexpected();
    }
    const cards = raw.results.map(normalizeCard).filter((card): card is RecipeCard => card !== undefined);
    const pagination = asObject(raw.pagination);
    const page = optionalNumber(pagination?.page) ?? 1;
    const total = optionalNumber(pagination?.total) ?? cards.length;
    const totalPages = optionalNumber(pagination?.total_pages) ?? page;
    return { cards, page, total, totalPages, hasMore: page < totalPages };
}

function facetCounts(value: unknown): FacetCount[] {
    const counts: FacetCount[] = [];
    for (const item of Array.isArray(value) ? value : []) {
        const raw = asObject(item);
        const name = optionalString(raw?.name);
        if (name !== undefined) {
            counts.push({ name, count: optionalNumber(raw?.count) ?? 0 });
        }
    }
    return counts;
}

function normalizeFacets(body: unknown): Facets {
    const raw = asObject(body) ?? {};
    const locales: LocaleFacet[] = [];
    for (const item of Array.isArray(raw.locales) ? raw.locales : []) {
        const locale = asObject(item);
        const code = optionalString(locale?.code);
        if (code !== undefined) {
            locales.push({ code, name: optionalString(locale?.name) ?? code, count: optionalNumber(locale?.count) ?? 0 });
        }
    }
    return { tags: facetCounts(raw.tags), locales, difficulties: facetCounts(raw.difficulties) };
}

function normalizeDetail(body: unknown): RecipeDetail {
    const raw = asObject(body);
    const id = optionalNumber(raw?.id);
    const title = optionalString(raw?.title);
    if (!raw || id === undefined || title === undefined) {
        throw unexpected();
    }
    return compact({
        id,
        title,
        summary: optionalString(raw.summary),
        sourceUrl: optionalString(raw.source_url),
        enclosureUrl: optionalString(raw.enclosure_url),
        imageUrl: optionalString(raw.image_url),
        feed: normalizeFeed(raw.feed),
    });
}

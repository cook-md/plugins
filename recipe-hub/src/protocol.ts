// Messages between the extension host (search-view-provider.ts) and the
// webview (webview/main.ts). The webview is untrusted: every message from it
// goes through parseFromWebview.

import type { Facets, HubErrorKind, RecipeCard } from './hub-client';
import { parseFilters, SearchFilters } from './search-query';

export type ToWebview =
    /** Reply to `ready`. `defaultLocale` is the editor display language's subtag; `serverOrigin` may be ''. */
    | { type: 'init'; defaultLocale: string; serverOrigin: string }
    | { type: 'facets'; facets: Facets }
    | { type: 'results'; seq: number; page: number; cards: RecipeCard[]; total: number; hasMore: boolean }
    | { type: 'error'; seq: number; kind: HubErrorKind; message: string }
    /** From the `recipeHub.search` command. */
    | { type: 'focusSearch' };

export type FromWebview =
    | { type: 'ready' }
    /** `seq` grows with every request; responses carry it back so stale ones are dropped. */
    | { type: 'search'; seq: number; page: number; filters: SearchFilters }
    | { type: 'open'; id: number; title: string };

function positiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseFromWebview(message: unknown): FromWebview | undefined {
    if (typeof message !== 'object' || message === null) {
        return undefined;
    }
    const raw = message as Record<string, unknown>;
    switch (raw.type) {
        case 'ready':
            return { type: 'ready' };
        case 'search': {
            const filters = parseFilters(raw.filters);
            return filters && positiveInteger(raw.seq) && positiveInteger(raw.page)
                ? { type: 'search', seq: raw.seq as number, page: raw.page as number, filters }
                : undefined;
        }
        case 'open':
            return positiveInteger(raw.id) && typeof raw.title === 'string'
                ? { type: 'open', id: raw.id as number, title: raw.title as string }
                : undefined;
        default:
            return undefined;
    }
}

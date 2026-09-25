// Messages between the extension host (search-view-provider.ts) and the
// webview (webview/main.ts). The webview is untrusted: every message from it
// goes through parseFromWebview.

import type { Facets, HubErrorKind, RecipeCard } from './hub-client';
import { parseFilters, SearchFilters } from './search-query';

/**
 * What the panel shows, kept by the extension host per workspace. The webview's
 * own `setState` does not survive an editor restart (Theia gives the webview
 * view a new id every session), so the host remembers it too.
 */
export interface PanelState {
    filters: SearchFilters;
    /** The Filters section is expanded. */
    filtersOpen: boolean;
    /** The user picked a language, so facets no longer adjust the default. */
    localeTouched: boolean;
}

export type ToWebview =
    /**
     * Reply to `ready`. `defaultLocale` is the editor display language's subtag; `serverOrigin` may be ''.
     * `state` is the panel state the host remembered for this workspace, if any.
     */
    | { type: 'init'; defaultLocale: string; serverOrigin: string; state?: PanelState }
    | { type: 'facets'; facets: Facets }
    | { type: 'results'; seq: number; page: number; cards: RecipeCard[]; total: number; hasMore: boolean }
    | { type: 'error'; seq: number; kind: HubErrorKind; message: string }
    /** From the `recipeHub.search` command. */
    | { type: 'focusSearch' };

export type FromWebview =
    | { type: 'ready' }
    /** `seq` grows with every request; responses carry it back so stale ones are dropped. */
    | { type: 'search'; seq: number; page: number; filters: SearchFilters }
    | { type: 'open'; id: number; title: string }
    /** The panel state changed; the host remembers it for the next session. */
    | ({ type: 'state' } & PanelState);

function positiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function optionalFlag(value: unknown): boolean | undefined {
    return value === undefined ? false : typeof value === 'boolean' ? value : undefined;
}

/** A valid `PanelState` from untrusted input (a webview message or stored workspace state), else undefined. */
export function parsePanelState(value: unknown): PanelState | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const filters = parseFilters(raw.filters);
    const filtersOpen = optionalFlag(raw.filtersOpen);
    const localeTouched = optionalFlag(raw.localeTouched);
    return filters && filtersOpen !== undefined && localeTouched !== undefined
        ? { filters, filtersOpen, localeTouched }
        : undefined;
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
        case 'state': {
            const state = parsePanelState(raw);
            return state ? { type: 'state', ...state } : undefined;
        }
        default:
            return undefined;
    }
}

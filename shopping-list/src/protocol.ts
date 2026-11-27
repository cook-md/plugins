import type { ShoppingListEntry, ShoppingListResult } from './cooklang-api';

/** Everything the webview renders. */
export interface ViewState {
    /** False when no folder is open. */
    hasWorkspace: boolean;
    items: ShoppingListEntry[];
    result?: ShoppingListResult;
    /** Lower-cased checked ingredient names. */
    checked: string[];
    error?: string;
    /** False on editors whose API drops free-hand lines: no quick add, no editing. */
    canEditItems: boolean;
}

export type ToWebview =
    | { type: 'state'; state: ViewState }
    /** Names just added, as listed; the view highlights their rows briefly. */
    | { type: 'added'; names: string[] };

import type { FreeHandRef } from './shopping-list-store';

/**
 * A top-level free-hand line as the view saw it. The file can change under the
 * view (sync, other tools), so the store checks name and quantity before
 * touching the line at `index`.
 */
export type { FreeHandRef };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'remove'; index: number }
    | { type: 'scale'; index: number; scale: number }
    | { type: 'clear' }
    | { type: 'toggle'; name: string }
    /** Raw typed or pasted lines; the extension recognizes and cleans them. */
    | { type: 'addItems'; lines: string[] }
    | { type: 'editItem'; item: FreeHandRef; line: string }
    | { type: 'removeItem'; item: FreeHandRef }
    | { type: 'removeAllItems' };

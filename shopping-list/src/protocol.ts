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
    /** The top-level free-hand lines, with their edit text worked out by the extension. */
    freeHand: FreeHandRow[];
}

export type ToWebview =
    | { type: 'state'; state: ViewState }
    /** Names just added, as listed; the view highlights their rows briefly. */
    | { type: 'added'; names: string[] }
    /** The amount read from the quick-add text of request `seq`, if any. */
    | { type: 'recognized'; seq: number; chip?: string }
    /** The lines of a paste, for the view to offer before adding. */
    | { type: 'pastePreview'; rows: Array<{ name: string; chip?: string }> };

import type { FreeHandRef } from './shopping-list-store';
import type { FreeHandRow } from './view-model';

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
    /** Typed text, read by the extension (the webview never sends parsed items). */
    | { type: 'addLine'; line: string }
    | { type: 'recognize'; seq: number; text: string }
    /** Pasted text; the extension answers with `pastePreview`. */
    | { type: 'previewPaste'; text: string }
    /** Adds the previewed rows at these indexes. */
    | { type: 'addPasted'; keep: number[] }
    | { type: 'editItem'; item: FreeHandRef; line: string }
    | { type: 'removeItem'; item: FreeHandRef }
    | { type: 'removeAllItems' };

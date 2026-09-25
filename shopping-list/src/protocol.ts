import type { ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

/** Everything the webview renders. */
export interface ViewState {
    /** False when no folder is open. */
    hasWorkspace: boolean;
    items: ShoppingListRecipeItem[];
    result?: ShoppingListResult;
    /** Lower-cased checked ingredient names. */
    checked: string[];
    error?: string;
}

export type ToWebview = { type: 'state'; state: ViewState };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'remove'; index: number }
    | { type: 'scale'; index: number; scale: number }
    | { type: 'clear' }
    | { type: 'toggle'; name: string };

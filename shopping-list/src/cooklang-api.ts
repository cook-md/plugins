// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// The types mirror the editor's `shopping-list-types.ts` and
// `recipe-reference-resolver.ts`. Kept free of the `vscode` import so it can
// be unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;

export interface ShoppingListItem {
    name: string;
    /** Pre-formatted quantities, e.g. "500 g, 2 cups". */
    quantities: string;
}

export interface ShoppingListCategory {
    name: string;
    items: ShoppingListItem[];
}

export interface ShoppingListResult {
    /** Categories from aisle.conf, in aisle order. */
    categories: ShoppingListCategory[];
    /** Items with no aisle. */
    other: ShoppingListCategory;
    /** Ingredients subtracted because they are in pantry.conf. */
    pantryItems: string[];
}

export interface ShoppingListRecipeItem {
    type: 'recipe';
    path: string;
    /** Undefined means 1. */
    multiplier?: number;
    children: ShoppingListEntry[];
    /** A nested `? ./path` selection line. */
    optional?: boolean;
}

/**
 * A free-hand line (`milk{2%l}`, `bread`) written by CookCLI or the mobile
 * apps. Older editors drop these; keep them when editing the list.
 */
export interface ShoppingListIngredientItem {
    type: 'ingredient';
    name: string;
    /** Raw quantity text: `2%l`, `3`, `a pinch`. */
    quantity?: string;
    /** A nested `? name{quantity}` selection line. */
    optional?: boolean;
}

export type ShoppingListEntry = ShoppingListRecipeItem | ShoppingListIngredientItem;

export interface ShoppingListFile {
    items: ShoppingListEntry[];
}

export interface CheckEntry {
    type: 'checked' | 'unchecked';
    name: string;
}

export interface ResolvedRecipeReference {
    path: string;
    /** Multiplier relative to the recipe holding the reference. */
    scale: number;
    children?: ResolvedRecipeReference[];
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    /**
     * `ingredients` are free-hand lines, merged in unscaled. Editors without
     * free-hand aggregation ignore them; the view still lists them under
     * "Other items".
     */
    generateShoppingList(
        recipes: ReadonlyArray<{ path: string; scale: number }>,
        ingredients: ReadonlyArray<{ name: string; quantity?: string }> = [],
    ): Promise<ShoppingListResult> {
        return this.call('cooklang.api.generateShoppingList', ingredients.length > 0 ? { recipes, ingredients } : { recipes });
    }

    resolveRecipeReferences(path: string): Promise<ResolvedRecipeReference[]> {
        return this.call('cooklang.api.resolveRecipeReferences', { path });
    }

    parseShoppingList(text: string): Promise<ShoppingListFile> {
        return this.call('cooklang.api.parseShoppingList', { text });
    }

    writeShoppingList(list: ShoppingListFile): Promise<string> {
        return this.call('cooklang.api.writeShoppingList', { list });
    }

    parseShoppingChecked(text: string): Promise<CheckEntry[]> {
        return this.call('cooklang.api.parseShoppingChecked', { text });
    }

    writeShoppingChecked(entries: readonly CheckEntry[]): Promise<string> {
        return this.call('cooklang.api.writeShoppingChecked', { entries });
    }

    compactShoppingChecked(entries: readonly CheckEntry[], ingredients: readonly string[]): Promise<CheckEntry[]> {
        return this.call('cooklang.api.compactShoppingChecked', { entries, ingredients });
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}

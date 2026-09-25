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
    children: ShoppingListRecipeItem[];
}

export interface ShoppingListFile {
    items: ShoppingListRecipeItem[];
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

    generateShoppingList(recipes: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        return this.call('cooklang.api.generateShoppingList', { recipes });
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

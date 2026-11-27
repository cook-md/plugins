import type { ShoppingListCategory, ShoppingListEntry, ShoppingListResult } from './cooklang-api';
import type { FreeHandRef } from './shopping-list-store';

export interface RecipeRow {
    index: number;
    name: string;
    scale: number;
    /** e.g. "menu (3 recipes)" */
    detail?: string;
}

export function displayNameFromPath(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.(cook|menu)$/i, '');
}

/** One row per top-level recipe; `index` points into the full item list, free-hand lines included. */
export function recipeRows(items: readonly ShoppingListEntry[]): RecipeRow[] {
    const rows: RecipeRow[] = [];
    items.forEach((item, index) => {
        if (item.type !== 'recipe') {
            return;
        }
        const row: RecipeRow = { index, name: displayNameFromPath(item.path), scale: item.multiplier ?? 1 };
        const recipes = item.children.filter(child => child.type === 'recipe').length;
        if (recipes > 0 && /\.menu$/i.test(item.path)) {
            row.detail = `menu (${recipes} recipes)`;
        }
        rows.push(row);
    });
    return rows;
}

export interface FreeHandRow {
    /** What the extension needs to find the line again. */
    ref: FreeHandRef;
    /** `2 l`; empty when the line has no amount. */
    quantity: string;
    /** What the edit box starts with: `Milk 2 l`. */
    editText: string;
}

/** How a stored quantity reads in the list: `2%l` → `2 l`. */
export function displayQuantity(quantity: string | undefined): string {
    return quantity === undefined ? '' : quantity.replace(/%/g, ' ').replace(/\s+/g, ' ').trim();
}

/** One row per top-level free-hand line, in file order. */
export function freeHandRows(items: readonly ShoppingListEntry[], editText: (ref: FreeHandRef) => string): FreeHandRow[] {
    const rows: FreeHandRow[] = [];
    items.forEach((item, index) => {
        if (item.type === 'ingredient') {
            const ref: FreeHandRef = item.quantity === undefined ? { index, name: item.name } : { index, name: item.name, quantity: item.quantity };
            rows.push({ ref, quantity: displayQuantity(item.quantity), editText: editText(ref) });
        }
    });
    return rows;
}

/** Aisles in aisle.conf order (empty ones dropped), then uncategorised items sorted by name. */
export function displayCategories(result: ShoppingListResult): ShoppingListCategory[] {
    const categories = result.categories.filter(category => category.items.length > 0);
    if (result.other.items.length > 0) {
        categories.push({ ...result.other, items: [...result.other.items].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return categories;
}

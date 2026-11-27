import type { ShoppingListCategory, ShoppingListEntry, ShoppingListResult } from './cooklang-api';

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

/** Aisles in aisle.conf order (empty ones dropped), then uncategorised items sorted by name. */
export function displayCategories(result: ShoppingListResult): ShoppingListCategory[] {
    const categories = result.categories.filter(category => category.items.length > 0);
    if (result.other.items.length > 0) {
        categories.push({ ...result.other, items: [...result.other.items].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return categories;
}

import type { ShoppingListCategory, ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

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

export function recipeRows(items: readonly ShoppingListRecipeItem[]): RecipeRow[] {
    return items.map((item, index) => {
        const row: RecipeRow = { index, name: displayNameFromPath(item.path), scale: item.multiplier ?? 1 };
        if (item.children.length > 0 && /\.menu$/i.test(item.path)) {
            row.detail = `menu (${item.children.length} recipes)`;
        }
        return row;
    });
}

/** Aisles in aisle.conf order (empty ones dropped), then uncategorised items sorted by name. */
export function displayCategories(result: ShoppingListResult): ShoppingListCategory[] {
    const categories = result.categories.filter(category => category.items.length > 0);
    if (result.other.items.length > 0) {
        categories.push({ ...result.other, items: [...result.other.items].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return categories;
}

// The "Index of ingredients": every ingredient name, normalised, with links to
// the recipes that use it. References to other recipes are not ingredients.
import { compareNames } from './book-tree';
import { RecipeIngredient } from './recipe-template';

export interface IndexedRecipe {
    id: string;
    title: string;
    ingredients: readonly RecipeIngredient[];
}

export interface IndexEntry {
    name: string;
    recipes: { id: string; title: string }[];
}

/** Lowercase, single spaces, and a simple plural on the last word stripped: `Cherry Tomatoes` → `cherry tomato`. */
export function normaliseIngredient(name: string): string {
    const words = name.toLowerCase().trim().split(/\s+/).filter(word => word !== '');
    if (words.length === 0) {
        return '';
    }
    const last = words[words.length - 1];
    let singular = last;
    if (/[a-z]ies$/.test(last) && last.length > 4) {
        singular = `${last.slice(0, -3)}y`;
    } else if (/(oes|ches|shes|xes|sses)$/.test(last)) {
        singular = last.slice(0, -2);
    } else if (/[a-z]s$/.test(last) && !/(ss|us|is)$/.test(last) && last.length > 3) {
        singular = last.slice(0, -1);
    }
    words[words.length - 1] = singular;
    return words.join(' ');
}

export function buildIngredientIndex(recipes: readonly IndexedRecipe[]): IndexEntry[] {
    const entries = new Map<string, Map<string, string>>();
    for (const recipe of recipes) {
        for (const ingredient of recipe.ingredients) {
            const name = ingredient.reference ? '' : normaliseIngredient(ingredient.name);
            if (name === '') {
                continue;
            }
            let users = entries.get(name);
            if (!users) {
                users = new Map();
                entries.set(name, users);
            }
            users.set(recipe.id, recipe.title);
        }
    }
    return [...entries.entries()]
        .sort(([a], [b]) => compareNames(a, b))
        .map(([name, users]) => ({
            name,
            recipes: [...users.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => compareNames(a.title, b.title) || compareNames(a.id, b.id)),
        }));
}

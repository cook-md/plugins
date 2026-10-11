import { PantryItem } from './cooklang-api';
import { IngredientName } from './names-template';

/** Simple plurals only: `-es` after s/x/z/ch/sh/o, else a trailing `s` (not `ss`); words of 3 letters or fewer stay. */
function singular(word: string): string {
    if (word.length <= 3) {
        return word;
    }
    if (/(?:ss|x|z|ch|sh|o)es$/.test(word)) {
        return word.slice(0, -2);
    }
    if (word.endsWith('ss')) {
        return word;
    }
    if (word.endsWith('s')) {
        return word.slice(0, -1);
    }
    return word;
}

/** Lowercase, drop text after a comma, collapse whitespace, trim, singularise the last word. */
export function normaliseName(raw: string): string {
    const collapsed = raw.split(',')[0].toLowerCase().replace(/\s+/g, ' ').trim();
    if (collapsed === '') {
        return '';
    }
    const words = collapsed.split(' ');
    words[words.length - 1] = singular(words[words.length - 1]);
    return words.join(' ');
}

/** The name as written, minus the text after a comma (`Garlic, minced` → `Garlic`). */
function displayName(raw: string): string {
    return raw.split(',')[0].trim();
}

export interface PantryLookup {
    /** Normalised names of items that aren't out of stock (low counts as in stock). */
    readonly inStock: ReadonlySet<string>;
    /** Normalised `pantryMatch.alwaysHave`. */
    readonly alwaysHave: ReadonlySet<string>;
}

export function pantryLookup(items: readonly PantryItem[], alwaysHave: readonly string[]): PantryLookup {
    const inStock = new Set<string>();
    for (const item of items) {
        const key = normaliseName(item.name);
        if (!item.isOutOfStock && key !== '') {
            inStock.add(key);
        }
    }
    return { inStock, alwaysHave: new Set(alwaysHave.map(normaliseName).filter(key => key !== '')) };
}

export interface RecipeMatch {
    /** Required, non-alwaysHave ingredients that are in stock. */
    covered: number;
    /** Required, non-alwaysHave ingredients. */
    total: number;
    /** Display names of required ingredients not in stock, in recipe order. */
    missing: string[];
    /** Normalised names of every non-alwaysHave ingredient, optional included (for "Use it up"). */
    uses: ReadonlySet<string>;
}

export function matchIngredients(names: readonly IngredientName[], lookup: PantryLookup): RecipeMatch {
    const required = new Map<string, string>();
    const uses = new Set<string>();
    for (const { name, optional } of names) {
        const key = normaliseName(name);
        if (key === '' || lookup.alwaysHave.has(key)) {
            continue;
        }
        uses.add(key);
        if (!optional && !required.has(key)) {
            required.set(key, displayName(name));
        }
    }
    let covered = 0;
    const missing: string[] = [];
    for (const [key, name] of required) {
        if (lookup.inStock.has(key)) {
            covered++;
        } else {
            missing.push(name);
        }
    }
    return { covered, total: required.size, missing, uses };
}

/** Share of required ingredients in stock; 1 when there is nothing to check. */
export function coverage(match: Pick<RecipeMatch, 'covered' | 'total'>): number {
    return match.total === 0 ? 1 : match.covered / match.total;
}

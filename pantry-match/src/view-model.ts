// What the "What can I cook" view shows, as plain data: tree.ts only maps these nodes to TreeItems.
import { ExpiringItem } from './expiry';
import { coverage, matchIngredients, PantryLookup } from './match';
import { IngredientName } from './names-template';

export const MAX_MISSING = 2;
/** Recipes listed under one Use it up item; the rest collapse into a "+N more" leaf. */
export const MAX_RECIPES_PER_ITEM = 10;

export interface IndexedRecipe {
    uri: string;
    path: string;
    /** Own ingredients plus those of linked recipes. */
    ingredients: readonly IngredientName[];
}

export interface FailedRecipe {
    uri: string;
    path: string;
    message: string;
}

export interface RecipeRow {
    uri: string;
    path: string;
    title: string;
    covered: number;
    total: number;
    missing: readonly string[];
}

export interface ExpiringRow {
    item: ExpiringItem;
    recipes: RecipeRow[];
}

export interface UnreadableRow extends FailedRecipe {
    title: string;
}

export interface ViewModel {
    cookNow: RecipeRow[];
    missingFew: RecipeRow[];
    useItUp: ExpiringRow[];
    unreadable: UnreadableRow[];
}

export const EMPTY_MODEL: ViewModel = { cookNow: [], missingFew: [], useItUp: [], unreadable: [] };

export function isEmptyModel(model: ViewModel): boolean {
    return model.cookNow.length + model.missingFew.length + model.useItUp.length + model.unreadable.length === 0;
}

export function recipeTitle(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.cook$/i, '');
}

function byTitle(a: RecipeRow, b: RecipeRow): number {
    return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

/** Cook now / Missing 1–2: fewest missing first, then best coverage. */
export function compareByMissing(a: RecipeRow, b: RecipeRow): number {
    return a.missing.length - b.missing.length || coverage(b) - coverage(a) || byTitle(a, b);
}

/** Use it up: best coverage first, then fewest missing. */
export function compareByCoverage(a: RecipeRow, b: RecipeRow): number {
    // Recipes that only use the item optionally (nothing required to check) come last.
    return Number(a.total === 0) - Number(b.total === 0) || coverage(b) - coverage(a) || a.missing.length - b.missing.length || byTitle(a, b);
}

export function buildViewModel(
    recipes: readonly IndexedRecipe[],
    failed: readonly FailedRecipe[],
    lookup: PantryLookup,
    expiring: readonly ExpiringItem[],
): ViewModel {
    const matched = recipes.map(recipe => {
        const match = matchIngredients(recipe.ingredients, lookup);
        const row: RecipeRow = {
            uri: recipe.uri,
            path: recipe.path,
            title: recipeTitle(recipe.path),
            covered: match.covered,
            total: match.total,
            missing: match.missing,
        };
        return { row, uses: match.uses };
    });
    const ranked = matched.map(entry => entry.row).filter(row => row.total > 0).sort(compareByMissing);
    return {
        cookNow: ranked.filter(row => row.missing.length === 0),
        missingFew: ranked.filter(row => row.missing.length > 0 && row.missing.length <= MAX_MISSING),
        useItUp: expiring.map(item => ({
            item,
            recipes: matched.filter(entry => entry.uses.has(item.key)).map(entry => entry.row).sort(compareByCoverage),
        })),
        unreadable: failed
            .map(entry => ({ uri: entry.uri, path: entry.path, title: recipeTitle(entry.path), message: entry.message }))
            .sort((a, b) => a.path.localeCompare(b.path)),
    };
}

export type GroupId = 'cookNow' | 'missingFew' | 'useItUp' | 'unreadable';

export const GROUP_LABELS: Record<GroupId, string> = {
    cookNow: 'Cook now',
    missingFew: 'Missing 1–2',
    useItUp: 'Use it up',
    unreadable: 'Couldn\'t read',
};

export type TreeNode =
    | { kind: 'group'; group: GroupId; count: number }
    | { kind: 'recipe'; row: RecipeRow; parentId: string }
    | { kind: 'missing'; name: string; parentId: string }
    | { kind: 'more'; count: number; parentId: string }
    | { kind: 'expiring'; row: ExpiringRow }
    | { kind: 'unreadable'; row: UnreadableRow };

/** Stable and unique, even when a recipe appears under several groups. */
export function nodeId(node: TreeNode): string {
    switch (node.kind) {
        case 'group': return `group:${node.group}`;
        case 'recipe': return `${node.parentId}/recipe:${node.row.uri}`;
        case 'missing': return `${node.parentId}/missing:${node.name}`;
        case 'more': return `${node.parentId}/more`;
        case 'expiring': return `expiring:${node.row.item.key}`;
        case 'unreadable': return `unreadable:${node.row.uri}`;
    }
}

function recipeNodes(rows: readonly RecipeRow[], parentId: string): TreeNode[] {
    return rows.map((row): TreeNode => ({ kind: 'recipe', row, parentId }));
}

function groupChildren(model: ViewModel, group: GroupId, parentId: string): TreeNode[] {
    if (group === 'cookNow') {
        return recipeNodes(model.cookNow, parentId);
    }
    if (group === 'missingFew') {
        return recipeNodes(model.missingFew, parentId);
    }
    if (group === 'useItUp') {
        return model.useItUp.map((row): TreeNode => ({ kind: 'expiring', row }));
    }
    return model.unreadable.map((row): TreeNode => ({ kind: 'unreadable', row }));
}

export function childrenOf(model: ViewModel, node?: TreeNode): TreeNode[] {
    if (!node) {
        const counts: Array<[GroupId, number]> = [
            ['cookNow', model.cookNow.length],
            ['missingFew', model.missingFew.length],
            ['useItUp', model.useItUp.length],
            ['unreadable', model.unreadable.length],
        ];
        return counts.filter(([, count]) => count > 0).map(([group, count]): TreeNode => ({ kind: 'group', group, count }));
    }
    if (node.kind === 'group') {
        return groupChildren(model, node.group, nodeId(node));
    }
    if (node.kind === 'expiring') {
        const parentId = nodeId(node);
        const { recipes } = node.row;
        const nodes = recipeNodes(recipes.slice(0, MAX_RECIPES_PER_ITEM), parentId);
        if (recipes.length > MAX_RECIPES_PER_ITEM) {
            nodes.push({ kind: 'more', count: recipes.length - MAX_RECIPES_PER_ITEM, parentId });
        }
        return nodes;
    }
    if (node.kind === 'recipe') {
        const parentId = nodeId(node);
        return node.row.missing.map((name): TreeNode => ({ kind: 'missing', name, parentId }));
    }
    return [];
}

/** The recipe URI of a tree node passed to a command (row click or context menu). */
export function recipeUriOf(node: unknown): string | undefined {
    if (typeof node !== 'object' || node === null) {
        return undefined;
    }
    const candidate = node as { kind?: unknown; row?: { uri?: unknown } };
    if ((candidate.kind !== 'recipe' && candidate.kind !== 'unreadable') || typeof candidate.row?.uri !== 'string') {
        return undefined;
    }
    return candidate.row.uri;
}

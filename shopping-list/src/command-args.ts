/** Minimal shape of `vscode.Uri` this module needs. */
export interface ResourceUri {
    readonly scheme: string;
    readonly path: string;
}

export interface RecipeTarget {
    /** Workspace-relative. */
    path: string;
    scale: number;
}

export interface TargetResolver {
    /** Workspace-relative path, or undefined outside the workspace. */
    relativePath(uri: ResourceUri): string | undefined;
    activeUri(): ResourceUri | undefined;
}

export type AddRecipesRequest = { recipes: RecipeTarget[] } | { menu: string };

interface OutletContext {
    version: number;
    path: string;
    scale?: unknown;
}

function isOutletContext(arg: unknown): arg is OutletContext {
    return typeof arg === 'object' && arg !== null
        && typeof (arg as OutletContext).version === 'number'
        && typeof (arg as OutletContext).path === 'string';
}

function isResourceUri(arg: unknown): arg is ResourceUri {
    return typeof arg === 'object' && arg !== null
        && typeof (arg as ResourceUri).scheme === 'string'
        && typeof (arg as ResourceUri).path === 'string';
}

function positive(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The recipe or menu a command should act on, from how it was invoked:
 * a Cooklang outlet context (preview buttons), a `vscode.Uri` (explorer and
 * editor title; the explorer also passes the selection as a second argument),
 * or nothing (command palette → active editor).
 */
export function resolveTarget(args: readonly unknown[], resolver: TargetResolver): RecipeTarget | undefined {
    const [first] = args;
    if (isOutletContext(first)) {
        return { path: first.path, scale: positive(first.scale) ?? 1 };
    }
    const uri = isResourceUri(first) ? first : resolver.activeUri();
    if (!uri) {
        return undefined;
    }
    const path = resolver.relativePath(uri);
    return path === undefined ? undefined : { path, scale: 1 };
}

export function isMenuPath(path: string): boolean {
    return /\.menu$/i.test(path);
}

/** Validates the argument of `shoppingList.addRecipes` (used by Cookbot). */
export function parseAddRecipesRequest(arg: unknown): AddRecipesRequest | { error: string } {
    if (typeof arg !== 'object' || arg === null) {
        return { error: 'Expected { recipes: [{ path, scale? }] } or { menu: path }.' };
    }
    const request = arg as { recipes?: unknown; menu?: unknown };
    if (typeof request.menu === 'string' && request.menu.trim() !== '') {
        return { menu: request.menu.trim() };
    }
    if (!Array.isArray(request.recipes) || request.recipes.length === 0) {
        return { error: 'Expected { recipes: [{ path, scale? }] } or { menu: path }.' };
    }
    const recipes: RecipeTarget[] = [];
    for (const entry of request.recipes) {
        const recipe = (typeof entry === 'object' && entry !== null ? entry : {}) as { path?: unknown; scale?: unknown };
        if (typeof recipe.path !== 'string' || recipe.path.trim() === '') {
            return { error: 'Every recipe needs a `path`.' };
        }
        const scale = recipe.scale === undefined ? 1 : positive(recipe.scale);
        if (scale === undefined) {
            return { error: `Recipe scale must be a positive number: ${recipe.path}` };
        }
        recipes.push({ path: recipe.path.trim(), scale });
    }
    return { recipes };
}

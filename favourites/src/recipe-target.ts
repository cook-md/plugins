// Which recipe a favourites command refers to. The preview toolbar passes a
// `PreviewOutletContext`, the Explorer passes a `Uri`, the Favourites view
// passes a `FavouriteItem`, the palette passes nothing (active editor).
// Free of the `vscode` import so it can be unit-tested.
import { isRecipePath, normalizePath } from './bookmarks';

/** The parts of `vscode.Uri` used here. */
export interface UriLike {
    scheme: string;
    /** Decoded path with `/` separators, e.g. `/Users/me/recipes/a.cook` or `/c:/recipes/a.cook`. */
    path: string;
    toString(): string;
}

/** Mirrors the editor's `PreviewOutletContext` (API version 1). */
export interface PreviewOutletContext {
    version: 1;
    uri: string;
    path: string;
    scale: number;
}

/** An element of the Favourites view; plain JSON so it survives the plugin-host boundary. */
export interface FavouriteItem {
    favouritePath: string;
    favouriteUri: string;
}

/** A recipe a command acts on. */
export interface RecipeTarget {
    uri: string;
    /** Normalised workspace-relative path. */
    path: string;
}

/** Whether `value` is a preview outlet context. */
export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Whether `value` is an element of the Favourites view. */
export function isFavouriteItem(value: unknown): value is FavouriteItem {
    const item = value as FavouriteItem;
    return typeof value === 'object' && value !== null
        && typeof item.favouritePath === 'string' && typeof item.favouriteUri === 'string';
}

function isUriLike(value: unknown): value is UriLike {
    const candidate = value as UriLike;
    return typeof value === 'object' && value !== null
        && typeof candidate.scheme === 'string' && typeof candidate.path === 'string';
}

/** Lower-cases a leading Windows drive letter (`/C:/x` → `/c:/x`); `vscode-uri` is inconsistent about it. */
function normalizeDrive(path: string): string {
    return path.replace(/^\/[A-Za-z]:/, drive => drive.toLowerCase());
}

/** `uri` relative to `root` (file scheme, strictly inside), or `undefined`. Not limited to recipes. */
export function relativePath(uri: UriLike, root: UriLike | undefined): string | undefined {
    if (!root || uri.scheme !== 'file' || root.scheme !== 'file') {
        return undefined;
    }
    const prefix = normalizeDrive(root.path).replace(/\/+$/, '') + '/';
    const path = normalizeDrive(uri.path);
    if (!path.startsWith(prefix) || path.length === prefix.length) {
        return undefined;
    }
    return normalizePath(path.slice(prefix.length));
}

/** Resolves the recipe a command refers to from its argument, falling back to the active editor. */
export function recipeTarget(argument: unknown, root: UriLike | undefined, activeEditor: UriLike | undefined): RecipeTarget | undefined {
    if (isPreviewContext(argument)) {
        const path = normalizePath(argument.path);
        return argument.uri.startsWith('file:') && path !== '' && isRecipePath(path)
            ? { uri: argument.uri, path }
            : undefined;
    }
    if (isFavouriteItem(argument)) {
        return { uri: argument.favouriteUri, path: argument.favouritePath };
    }
    const uri = isUriLike(argument) ? argument : activeEditor;
    if (!uri) {
        return undefined;
    }
    const path = relativePath(uri, root);
    return path !== undefined && isRecipePath(path) ? { uri: uri.toString(), path } : undefined;
}

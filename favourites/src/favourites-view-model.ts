// What the Favourites view shows for each `.bookmarks` entry. Free of the
// `vscode` import so it can be unit-tested.

export interface FavouriteEntry {
    /** Normalised workspace-relative path. */
    path: string;
    /** File name without the `.cook` extension. */
    name: string;
    /** Containing folder, `''` at the workspace root. */
    folder: string;
}

/** Splits a workspace-relative path into the recipe name and its folder. */
export function describeFavourite(path: string): FavouriteEntry {
    const slash = path.lastIndexOf('/');
    const file = slash === -1 ? path : path.slice(slash + 1);
    return { path, name: file.replace(/\.cook$/i, ''), folder: slash === -1 ? '' : path.slice(0, slash) };
}

/** Entries sorted by name (case-insensitive), then path. */
export function favouriteEntries(paths: readonly string[]): FavouriteEntry[] {
    return paths.map(describeFavourite).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }) || a.path.localeCompare(b.path));
}

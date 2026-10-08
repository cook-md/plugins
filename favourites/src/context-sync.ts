// Mirrors the favourite list into context keys so `when` clauses in
// package.json pick "Add to Favourites" or "Remove from Favourites":
// `cooklang.favourites.paths` (workspace-relative paths, matched against the
// preview's `cooklangPreviewPath`) and `cooklang.favourites.uris` (URI strings,
// matched against the Explorer's `resource`).
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { FavouritesStore } from './favourites-store';

export const PATHS_CONTEXT_KEY = 'cooklang.favourites.paths';
export const URIS_CONTEXT_KEY = 'cooklang.favourites.uris';

/** The URI of a workspace-relative favourite path under `root`. */
export function favouriteUri(root: vscode.Uri, path: string): vscode.Uri {
    return vscode.Uri.joinPath(root, ...path.split('/'));
}

/** Publishes the favourites as context keys and asks open previews to re-evaluate. */
export async function syncContext(store: FavouritesStore, root: vscode.Uri | undefined, api: CooklangApi): Promise<void> {
    const paths = [...store.paths()];
    const uris = root ? paths.map(path => favouriteUri(root, path).toString()) : [];
    await vscode.commands.executeCommand('setContext', PATHS_CONTEXT_KEY, paths);
    await vscode.commands.executeCommand('setContext', URIS_CONTEXT_KEY, uris);
    await api.refreshBadges();
}

import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { syncContext } from './context-sync';
import { BookmarksFile, BOOKMARKS_FILE, FavouritesStore, NoWorkspaceError } from './favourites-store';
import { FavouritesTreeProvider, OPEN_RECIPE_COMMAND, VIEW_ID } from './favourites-tree';
import { recipeTarget, relativePath } from './recipe-target';

type Action = 'add' | 'remove' | 'toggle';

const COMMANDS: Record<Action, string> = {
    add: 'cooklang.favourites.add',
    remove: 'cooklang.favourites.remove',
    toggle: 'cooklang.favourites.toggle',
};

function workspaceRoot(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/** `.bookmarks` at the workspace root through `workspace.fs`; a missing file reads as `undefined`. */
function bookmarksFile(root: vscode.Uri): BookmarksFile {
    const uri = vscode.Uri.joinPath(root, BOOKMARKS_FILE);
    return {
        read: async () => (await exists(uri)) ? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) : undefined,
        write: async text => { await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text)); },
    };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Favourites');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const store = new FavouritesStore();
    const root = (): vscode.Uri | undefined => workspaceRoot()?.uri;

    const reportError = (what: string) => (error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`${what}: ${message}`);
    };

    // Context keys follow the store; the editor re-renders open previews on refreshBadges.
    context.subscriptions.push(store.onDidChange(() => {
        syncContext(store, root(), api).catch(reportError('Could not update favourites context'));
    }));

    const tree = new FavouritesTreeProvider(store, root, exists);
    context.subscriptions.push(tree);
    context.subscriptions.push(vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree, showCollapseAll: false }));

    // Watch the file of the (first) workspace folder; re-bind when folders change.
    let watcher: vscode.FileSystemWatcher | undefined;
    const bindWorkspace = async (): Promise<void> => {
        watcher?.dispose();
        watcher = undefined;
        const folder = workspaceRoot();
        if (!folder) {
            await store.setFile(undefined);
            return;
        }
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, BOOKMARKS_FILE));
        const reload = (): void => { store.reload().catch(reportError('Could not reload .bookmarks')); };
        watcher.onDidCreate(reload);
        watcher.onDidChange(reload);
        watcher.onDidDelete(reload);
        await store.setFile(bookmarksFile(folder.uri));
    };
    context.subscriptions.push({ dispose: () => watcher?.dispose() });
    // A new root with the same relative paths fires no store change, so re-sync the URIs explicitly.
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        bindWorkspace()
            .then(() => syncContext(store, root(), api))
            .catch(reportError('Could not bind the workspace'));
    }));

    const showToast = async (added: boolean, path: string): Promise<void> => {
        const message = added ? 'Added to Favourites' : 'Removed from Favourites';
        try {
            const choice = await vscode.window.showInformationMessage(message, 'Undo');
            if (choice === 'Undo') {
                await (added ? store.remove(path) : store.add(path));
            }
        } catch (error) {
            reportError('Undo failed')(error);
            vscode.window.showErrorMessage(`Could not update .bookmarks: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const run = async (action: Action, argument: unknown): Promise<void> => {
        if (!store.hasWorkspace()) {
            vscode.window.showInformationMessage(new NoWorkspaceError().message);
            return;
        }
        const target = recipeTarget(argument, root(), vscode.window.activeTextEditor?.document.uri);
        if (!target) {
            vscode.window.showInformationMessage('Open a recipe (.cook) to add it to Favourites.');
            return;
        }
        try {
            let nowFavourite: boolean;
            if (action === 'toggle') {
                nowFavourite = await store.toggle(target.path);
            } else if (action === 'add') {
                if (!await store.add(target.path)) {
                    vscode.window.showInformationMessage('Already in Favourites');
                    return;
                }
                nowFavourite = true;
            } else {
                if (!await store.remove(target.path)) {
                    vscode.window.showInformationMessage('Not in Favourites');
                    return;
                }
                nowFavourite = false;
            }
            void showToast(nowFavourite, target.path);
        } catch (error) {
            if (error instanceof NoWorkspaceError) {
                vscode.window.showInformationMessage(error.message);
                return;
            }
            reportError('Could not update .bookmarks')(error);
            vscode.window.showErrorMessage(`Could not update .bookmarks: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const action of Object.keys(COMMANDS) as Action[]) {
        context.subscriptions.push(vscode.commands.registerCommand(COMMANDS[action], (argument: unknown) => run(action, argument)));
    }
    context.subscriptions.push(vscode.commands.registerCommand(OPEN_RECIPE_COMMAND, async (argument: unknown) => {
        const target = recipeTarget(argument, root(), undefined);
        if (!target) {
            return;
        }
        try {
            await api.openPreview(target.uri);
        } catch (error) {
            // A hand-edited .bookmarks line can name something the preview cannot open (e.g. a menu).
            const message = error instanceof Error ? error.message : String(error);
            reportError('Could not open a favourite')(error);
            vscode.window.showErrorMessage(`Could not open ${target.path}: ${message}`);
        }
    }));

    // Renames and deletes made through the editor keep .bookmarks pointing at the right files.
    context.subscriptions.push(vscode.workspace.onDidRenameFiles(event => {
        const base = root();
        if (!base) {
            return;
        }
        const renames: { from: string; to: string }[] = [];
        const deletes: string[] = [];
        for (const { oldUri, newUri } of event.files) {
            const from = relativePath(oldUri, base);
            if (from === undefined) {
                continue;
            }
            const to = relativePath(newUri, base);
            if (to === undefined) {
                deletes.push(from);
            } else {
                renames.push({ from, to });
            }
        }
        store.applyRenames(renames).then(() => store.applyDeletes(deletes)).catch(reportError('Could not follow a rename in .bookmarks'));
    }));
    context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
        const base = root();
        if (!base) {
            return;
        }
        const deletes = event.files.map(uri => relativePath(uri, base)).filter((path): path is string => path !== undefined);
        store.applyDeletes(deletes).catch(reportError('Could not follow a delete in .bookmarks'));
    }));

    await bindWorkspace().catch(reportError('Could not bind the workspace'));
    await syncContext(store, root(), api).catch(reportError('Could not update favourites context'));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

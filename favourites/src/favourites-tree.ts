// The "Favourites" view in the Explorer: one flat list of recipes.
import * as vscode from 'vscode';
import { favouriteUri } from './context-sync';
import { FavouritesStore } from './favourites-store';
import { describeFavourite, favouriteEntries } from './favourites-view-model';
import { FavouriteItem } from './recipe-target';

export const VIEW_ID = 'cooklang.favourites.view';
export const OPEN_RECIPE_COMMAND = 'cooklang.favourites.openRecipe';

/** Tree data provider listing the favourite recipes. */
export class FavouritesTreeProvider implements vscode.TreeDataProvider<FavouriteItem>, vscode.Disposable {

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private readonly subscription: { dispose(): void };

    constructor(
        private readonly store: FavouritesStore,
        private readonly root: () => vscode.Uri | undefined,
        private readonly exists: (uri: vscode.Uri) => Promise<boolean>,
    ) {
        this.subscription = store.onDidChange(() => this.onDidChangeTreeDataEmitter.fire());
    }

    getChildren(element?: FavouriteItem): FavouriteItem[] {
        const root = this.root();
        if (element || !root) {
            return [];
        }
        return favouriteEntries(this.store.paths()).map(entry => ({
            favouritePath: entry.path,
            favouriteUri: favouriteUri(root, entry.path).toString(),
        }));
    }

    async getTreeItem(element: FavouriteItem): Promise<vscode.TreeItem> {
        const entry = describeFavourite(element.favouritePath);
        const uri = vscode.Uri.parse(element.favouriteUri);
        const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
        item.description = entry.folder;
        item.tooltip = entry.path;
        item.resourceUri = uri;
        item.contextValue = 'favourite';
        item.command = { command: OPEN_RECIPE_COMMAND, title: 'Open Recipe', arguments: [element] };
        if (!await this.exists(uri)) {
            item.iconPath = new vscode.ThemeIcon('warning');
            item.tooltip = `File not found: ${entry.path}`;
        }
        return item;
    }

    dispose(): void {
        this.subscription.dispose();
        this.onDidChangeTreeDataEmitter.dispose();
    }
}

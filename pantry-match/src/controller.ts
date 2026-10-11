// vscode glue: file watchers, debounce, pantry loading, index refresh, context keys and
// the tree. Decisions live in the pure modules (pantry-file, recipe-index, references,
// expiry, view-model, badge).
import * as vscode from 'vscode';
import { PantryBadgeProvider } from './badge';
import { CooklangApi, PantryItem } from './cooklang-api';
import { expiringItems, todayString } from './expiry';
import { PantryLookup, pantryLookup } from './match';
import { RecipeNames, renderNames } from './names-template';
import { loadPantry, PANTRY_FILE, PantryState } from './pantry-file';
import { RecipeFile, RecipeIndex } from './recipe-index';
import { ReferenceExpander } from './references';
import { PantryMatchSettings, readSettings } from './settings';
import { PantryMatchTreeProvider, VIEW_ID } from './tree';
import { buildViewModel, EMPTY_MODEL, FailedRecipe, IndexedRecipe, isEmptyModel, TreeNode, ViewModel } from './view-model';

export const STATE_CONTEXT_KEY = 'pantryMatch.state';
export type ViewState = 'noWorkspace' | 'unsupported' | 'noPantry' | 'pantryError' | 'indexing' | 'empty' | 'ready';

const RECIPE_GLOB = '**/*.cook';
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**}';
const DEBOUNCE_MS = 300;

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class PantryMatchController implements vscode.Disposable {

    readonly badges: PantryBadgeProvider;
    protected readonly tree = new PantryMatchTreeProvider();
    protected readonly treeView: vscode.TreeView<TreeNode>;
    protected readonly index: RecipeIndex;
    protected readonly expander: ReferenceExpander;
    protected readonly disposables: vscode.Disposable[] = [];
    protected watchers: vscode.Disposable[] = [];
    protected pantry: PantryState = { kind: 'missing' };
    protected lookup: PantryLookup | undefined;
    protected supported: Promise<boolean> | undefined;
    /** The workspace is only scanned once the view has been shown (or Refresh was pressed). */
    protected viewed = false;
    protected pantryChanged = true;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected queue: Promise<void> = Promise.resolve();

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) {
        this.index = new RecipeIndex({
            list: () => this.listRecipes(),
            mtime: uri => this.mtime(uri),
            render: uri => renderNames(api, uri),
        });
        this.expander = new ReferenceExpander({
            resolve: path => api.resolveRecipeReferences(path),
            names: path => this.namesForPath(path),
        });
        this.badges = new PantryBadgeProvider({
            showBadge: () => this.settings().showBadge,
            lookup: () => this.lookup,
            render: uri => renderNames(api, uri),
            expand: (path, own) => this.expander.ingredientsFor(path, own),
            log,
        });
        this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this.tree, showCollapseAll: true });
        this.disposables.push(
            this.tree,
            this.treeView,
            this.treeView.onDidChangeVisibility(event => {
                if (event.visible && !this.viewed) {
                    this.viewed = true;
                    this.scheduleUpdate(0);
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.bind();
                this.index.clear();
                this.expander.clear();
                this.pantryChanged = true;
                this.scheduleUpdate(0);
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('pantryMatch')) {
                    // alwaysHave feeds the lookup and showBadge the badges: reload both.
                    this.pantryChanged = true;
                    this.scheduleUpdate(0);
                }
            }),
        );
    }

    isSupported(): Promise<boolean> {
        this.supported ??= this.api.supported();
        return this.supported;
    }

    async start(): Promise<void> {
        this.viewed = this.treeView.visible;
        this.bind();
        await this.enqueue();
    }

    /** View title Refresh: forget every cached render and rescan. */
    refresh(): Promise<void> {
        this.index.clear();
        this.expander.clear();
        this.pantryChanged = true;
        this.viewed = true;
        return this.enqueue();
    }

    async openPantryFile(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            return;
        }
        try {
            await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...PANTRY_FILE.split('/')));
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open ${PANTRY_FILE}: ${messageOf(error)}`);
        }
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.watchers.forEach(disposable => disposable.dispose());
        this.disposables.forEach(disposable => disposable.dispose());
    }

    protected settings(): PantryMatchSettings {
        const configuration = vscode.workspace.getConfiguration('pantryMatch');
        return readSettings(key => configuration.get(key));
    }

    protected folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    protected bind(): void {
        this.watchers.forEach(disposable => disposable.dispose());
        this.watchers = [];
        const folder = this.folder();
        if (!folder) {
            return;
        }
        const recipes = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, RECIPE_GLOB));
        const onRecipe = (uri: vscode.Uri): void => {
            this.index.invalidate(uri.toString());
            // A changed recipe can change any tree it is linked from.
            this.expander.clear();
            this.scheduleUpdate();
        };
        const pantry = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, PANTRY_FILE));
        const onPantry = (): void => {
            this.pantryChanged = true;
            this.scheduleUpdate();
        };
        this.watchers = [
            recipes, recipes.onDidCreate(onRecipe), recipes.onDidChange(onRecipe), recipes.onDidDelete(onRecipe),
            pantry, pantry.onDidCreate(onPantry), pantry.onDidChange(onPantry), pantry.onDidDelete(onPantry),
        ];
    }

    protected scheduleUpdate(delay = DEBOUNCE_MS): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.enqueue(); }, delay);
    }

    /** Updates run one at a time, in order. */
    protected enqueue(): Promise<void> {
        this.queue = this.queue
            .then(() => this.update())
            .catch(error => this.log(`Pantry Match: update failed: ${messageOf(error)}`));
        return this.queue;
    }

    protected async update(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            this.lookup = undefined;
            this.show(EMPTY_MODEL, undefined);
            await this.setState('noWorkspace');
            return;
        }
        if (!await this.isSupported()) {
            this.lookup = undefined;
            this.show(EMPTY_MODEL, undefined);
            await this.setState('unsupported');
            return;
        }
        if (this.pantryChanged) {
            this.pantryChanged = false;
            this.pantry = await loadPantry({ read: () => this.readPantry(folder.uri), parse: text => this.api.parsePantry(text) });
            this.lookup = this.pantry.kind === 'ok' ? pantryLookup(this.pantry.items, this.settings().alwaysHave) : undefined;
            await this.api.refreshBadges().catch(() => false);
        }
        const pantry = this.pantry;
        if (pantry.kind === 'missing') {
            this.show(EMPTY_MODEL, undefined);
            await this.setState('noPantry');
            return;
        }
        if (pantry.kind === 'error') {
            this.show(EMPTY_MODEL, pantry.message);
            await this.setState('pantryError');
            return;
        }
        if (!this.viewed) {
            return;
        }
        await this.setState('indexing');
        await this.index.refresh((done, total) => {
            this.treeView.message = done < total ? `Reading recipes… ${done}/${total}` : undefined;
        });
        const model = await this.buildModel(pantry.items);
        this.show(model, undefined);
        await this.setState(isEmptyModel(model) ? 'empty' : 'ready');
    }

    protected async buildModel(items: readonly PantryItem[]): Promise<ViewModel> {
        const lookup = this.lookup;
        if (!lookup) {
            return EMPTY_MODEL;
        }
        const recipes: IndexedRecipe[] = [];
        const failed: FailedRecipe[] = [];
        for (const entry of this.index.entries()) {
            if (entry.result.ok) {
                recipes.push({ uri: entry.uri, path: entry.path, ingredients: await this.expander.ingredientsFor(entry.path, entry.result.names) });
            } else {
                failed.push({ uri: entry.uri, path: entry.path, message: entry.result.message });
            }
        }
        const expiring = expiringItems(items, todayString(new Date()), this.settings().expiringWithinDays);
        return buildViewModel(recipes, failed, lookup, expiring);
    }

    protected show(model: ViewModel, message: string | undefined): void {
        this.tree.setModel(model);
        this.treeView.message = message;
    }

    protected async setState(state: ViewState): Promise<void> {
        await vscode.commands.executeCommand('setContext', STATE_CONTEXT_KEY, state);
    }

    protected async readPantry(root: vscode.Uri): Promise<string | undefined> {
        const uri = vscode.Uri.joinPath(root, ...PANTRY_FILE.split('/'));
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            return undefined;
        }
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    }

    protected async listRecipes(): Promise<RecipeFile[]> {
        const folder = this.folder();
        if (!folder) {
            return [];
        }
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, RECIPE_GLOB), EXCLUDE_GLOB);
        return uris.map(uri => ({ uri: uri.toString(), path: vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/') }));
    }

    protected async mtime(uri: string): Promise<number | undefined> {
        try {
            return (await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).mtime;
        } catch {
            return undefined;
        }
    }

    /** A linked recipe's names: from the index when fresh, otherwise rendered now. */
    protected async namesForPath(path: string): Promise<RecipeNames | undefined> {
        const entry = this.index.byPath(path);
        if (entry) {
            return entry.result.ok ? entry.result.names : undefined;
        }
        const folder = this.folder();
        if (!folder) {
            return undefined;
        }
        const rendered = await renderNames(this.api, vscode.Uri.joinPath(folder.uri, ...path.split('/')).toString());
        return rendered.ok ? rendered.names : undefined;
    }
}

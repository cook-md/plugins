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
import { mapInBatches, RecipeFile, RecipeIndex } from './recipe-index';
import { ReferenceExpander } from './references';
import { PantryMatchSettings, readSettings } from './settings';
import { SupportCheck } from './support-check';
import { PantryMatchTreeProvider, VIEW_ID } from './tree';
import { blockedState, planUpdate, resultState, ViewState } from './update-plan';
import { buildViewModel, EMPTY_MODEL, FailedRecipe, IndexedRecipe, isEmptyModel, TreeNode, ViewModel } from './view-model';

export const STATE_CONTEXT_KEY = 'pantryMatch.state';
export { ViewState };

const RECIPE_GLOB = '**/*.cook';
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**}';
const DEBOUNCE_MS = 300;
const REFERENCE_BATCH = 10;

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
    protected readonly support: SupportCheck;
    /** The workspace is only scanned once the view has been shown (or Refresh was pressed). */
    protected viewed = false;
    protected pantryChanged = true;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    /** Badges must be re-queried (a recipe changed, so previews linking to it may differ). */
    protected badgesDirty = false;
    protected disposed = false;
    protected queue: Promise<void> = Promise.resolve();
    /** An update that is queued but hasn't started; further requests share it. */
    protected waiting: Promise<void> | undefined;

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) {
        this.support = new SupportCheck(() => api.supported());
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
        return this.support.isSupported();
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
        this.disposed = true;
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
            this.expander.invalidate(vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/'));
            this.badgesDirty = true;
            this.scheduleUpdate();
        };
        // A new or removed recipe can change which references resolve, in trees that don't mention it.
        const onRecipeAddedOrRemoved = (uri: vscode.Uri): void => {
            this.expander.clear();
            onRecipe(uri);
        };
        const pantry = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, PANTRY_FILE));
        const onPantry = (): void => {
            this.pantryChanged = true;
            this.scheduleUpdate();
        };
        this.watchers = [
            recipes, recipes.onDidCreate(onRecipeAddedOrRemoved), recipes.onDidChange(onRecipe), recipes.onDidDelete(onRecipeAddedOrRemoved),
            pantry, pantry.onDidCreate(onPantry), pantry.onDidChange(onPantry), pantry.onDidDelete(onPantry),
        ];
    }

    protected scheduleUpdate(delay = DEBOUNCE_MS): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.enqueue(); }, delay);
    }

    /** Updates run one at a time; a request while one is already waiting to start shares it. */
    protected enqueue(): Promise<void> {
        if (this.waiting) {
            return this.waiting;
        }
        const run = this.queue
            .then(() => {
                this.waiting = undefined;
                return this.update();
            })
            .catch(error => this.log(`Pantry Match: update failed: ${messageOf(error)}`));
        this.waiting = run;
        this.queue = run;
        return run;
    }

    protected async update(): Promise<void> {
        if (this.disposed) {
            return;
        }
        const folder = this.folder();
        const blocked = blockedState(folder !== undefined, folder === undefined || await this.isSupported());
        if (this.disposed) {
            return;
        }
        if (blocked || !folder) {
            this.lookup = undefined;
            this.show(EMPTY_MODEL, undefined);
            await this.setState(blocked ?? 'noWorkspace');
            return;
        }
        if (this.pantryChanged) {
            this.pantryChanged = false;
            this.badgesDirty = true;
            this.pantry = await loadPantry({ read: () => this.readPantry(folder.uri), parse: text => this.api.parsePantry(text) });
            if (this.disposed) {
                return;
            }
            this.lookup = this.pantry.kind === 'ok' ? pantryLookup(this.pantry.items, this.settings().alwaysHave) : undefined;
        }
        if (this.badgesDirty) {
            this.badgesDirty = false;
            await this.api.refreshBadges().catch(() => false);
            if (this.disposed) {
                return;
            }
        }
        const pantry = this.pantry;
        const plan = planUpdate(pantry.kind, this.viewed, this.index.size() === 0);
        if (plan.action === 'show-empty') {
            this.show(EMPTY_MODEL, plan.pantryMessage && pantry.kind === 'error' ? pantry.message : undefined);
            await this.setState(plan.state);
            return;
        }
        if (plan.action === 'idle' || pantry.kind !== 'ok') {
            return;
        }
        if (plan.announceIndexing) {
            await this.setState('indexing');
        }
        try {
            await this.index.refresh((done, total) => {
                this.treeView.message = done < total ? `Reading recipes… ${done}/${total}` : undefined;
            });
        } finally {
            this.treeView.message = undefined;
        }
        if (this.disposed) {
            return;
        }
        const model = await this.buildModel(pantry.items);
        if (this.disposed) {
            return;
        }
        this.show(model, undefined);
        await this.setState(resultState(isEmptyModel(model)));
    }

    protected async buildModel(items: readonly PantryItem[]): Promise<ViewModel> {
        const lookup = this.lookup;
        if (!lookup) {
            return EMPTY_MODEL;
        }
        const recipes: IndexedRecipe[] = [];
        const failed: FailedRecipe[] = [];
        const entries = this.index.entries();
        const ingredients = await mapInBatches(entries, REFERENCE_BATCH, entry =>
            entry.result.ok ? this.expander.ingredientsFor(entry.path, entry.result.names) : Promise.resolve(undefined));
        entries.forEach((entry, i) => {
            const own = ingredients[i];
            if (entry.result.ok && own) {
                recipes.push({ uri: entry.uri, path: entry.path, ingredients: own });
            } else if (!entry.result.ok) {
                failed.push({ uri: entry.uri, path: entry.path, message: entry.result.message });
            }
        });
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

import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { isMenuPath, parseAddRecipesRequest, RecipeTarget, resolveTargets, TargetResolver } from './command-args';
import { ResolvedRecipeReference } from './cooklang-api';
import { FromWebview, ToWebview, ViewState } from './protocol';
import { ListFiles, ShoppingListStore } from './shopping-list-store';

const VIEW_ID = 'shoppingList.view';

/** `workspace.fs` at one root, by file name. */
class WorkspaceListFiles implements ListFiles {
    constructor(protected readonly root: vscode.Uri) { }

    async read(name: string): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, name)));
        } catch (e) {
            if (isNotFound(e)) { return undefined; }
            throw e;
        }
    }

    async write(name: string, text: string): Promise<void> {
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.root, name), new TextEncoder().encode(text));
    }

    async delete(name: string): Promise<void> {
        try {
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, name));
        } catch (e) {
            if (!isNotFound(e)) { throw e; }
        }
    }
}

function isNotFound(e: unknown): boolean {
    const code = (e as { code?: string }).code;
    return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

interface ResolvedTarget {
    target: RecipeTarget;
    references: ResolvedRecipeReference[];
}

/** The webview is untrusted input: check shapes before touching the store. */
function isValidMessage(message: unknown): message is FromWebview {
    if (typeof message !== 'object' || message === null) {
        return false;
    }
    const m = message as { type?: unknown; index?: unknown; scale?: unknown; name?: unknown };
    const isIndex = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;
    switch (m.type) {
        case 'ready':
        case 'clear': return true;
        case 'remove': return isIndex(m.index);
        case 'scale': return isIndex(m.index) && typeof m.scale === 'number' && Number.isFinite(m.scale) && m.scale > 0;
        case 'toggle': return typeof m.name === 'string' && m.name.trim() !== '';
        default: return false;
    }
}

/** Owns the store for the first workspace folder, the webview view and the commands. */
export class ShoppingListController implements vscode.WebviewViewProvider {

    protected store: ShoppingListStore | undefined;
    protected storeDisposables: vscode.Disposable[] = [];
    protected view: vscode.WebviewView | undefined;

    constructor(protected readonly context: vscode.ExtensionContext, protected readonly api: CooklangApi) { }

    start(): void {
        const { subscriptions } = this.context;
        subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEW_ID, this),
            vscode.commands.registerCommand('shoppingList.show', () => this.reveal()),
            vscode.commands.registerCommand('shoppingList.addRecipe', (...args: unknown[]) => this.run(() => this.addRecipe(args))),
            vscode.commands.registerCommand('shoppingList.addMenu', (...args: unknown[]) => this.run(() => this.addMenu(args))),
            vscode.commands.registerCommand('shoppingList.addRecipes', (arg: unknown) => this.addRecipes(arg)),
            vscode.commands.registerCommand('shoppingList.clear', () => this.run(async () => this.requireStore().clearAll())),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.openStore()),
            { dispose: () => this.closeStore() },
        );
        this.openStore();
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const out = vscode.Uri.joinPath(this.context.extensionUri, 'out');
        view.webview.options = { enableScripts: true, localResourceRoots: [media, out] };
        const nonce = randomBytes(16).toString('hex');
        const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'shopping-list.css'));
        const script = view.webview.asWebviewUri(vscode.Uri.joinPath(out, 'webview.js'));
        view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
        view.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message));
        view.onDidDispose(() => { this.view = undefined; });
    }

    protected openStore(): void {
        this.closeStore();
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.postState();
            return;
        }
        const store = new ShoppingListStore(new WorkspaceListFiles(folder.uri), this.api);
        this.store = store;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folder, '{.shopping-list,.shopping-checked,config/aisle.conf,config/pantry.conf}'));
        const reload = (): void => store.scheduleReload();
        this.storeDisposables = [
            watcher,
            watcher.onDidChange(reload),
            watcher.onDidCreate(reload),
            watcher.onDidDelete(reload),
            store.onDidChange(() => this.postState()),
        ];
        store.load().catch(err => console.error('[shopping-list] initial load failed:', err));
    }

    protected closeStore(): void {
        this.storeDisposables.forEach(disposable => disposable.dispose());
        this.storeDisposables = [];
        this.store?.dispose();
        this.store = undefined;
    }

    protected requireStore(): ShoppingListStore {
        if (!this.store) {
            throw new Error('Open a recipe folder to use the shopping list.');
        }
        return this.store;
    }

    protected resolver(): TargetResolver {
        return {
            relativePath: uri => {
                const resource = vscode.Uri.from({ scheme: uri.scheme, path: uri.path });
                const root = vscode.workspace.workspaceFolders?.[0];
                const folder = vscode.workspace.getWorkspaceFolder(resource);
                // The list lives in the first folder only; paths are relative to it.
                if (!root || !folder || folder.uri.toString() !== root.uri.toString()) {
                    return undefined;
                }
                return vscode.workspace.asRelativePath(resource, false).replace(/\\/g, '/');
            },
            activeUri: () => vscode.window.activeTextEditor?.document.uri,
        };
    }

    protected async addRecipe(args: unknown[]): Promise<void> {
        await this.addFromUi(resolveTargets(args, this.resolver()).filter(target => !isMenuPath(target.path)));
    }

    protected async addMenu(args: unknown[]): Promise<void> {
        await this.addFromUi(resolveTargets(args, this.resolver()).filter(target => isMenuPath(target.path)));
    }

    /** UI path: an empty menu is a warning and is skipped; the others are still added. */
    protected async addFromUi(targets: RecipeTarget[]): Promise<void> {
        if (targets.length === 0) {
            return;
        }
        const store = this.requireStore();
        const resolved: ResolvedTarget[] = [];
        for (const target of targets) {
            const entry = await this.resolveTarget(target);
            if (entry) {
                resolved.push(entry);
            } else {
                vscode.window.showWarningMessage(`${target.path} has no recipe references to add.`);
            }
        }
        for (const entry of resolved) {
            await this.addResolved(store, entry);
        }
        if (resolved.length > 0) {
            await this.reveal();
        }
    }

    /** References of one target; undefined for a menu without recipe references. */
    protected async resolveTarget(target: RecipeTarget): Promise<ResolvedTarget | undefined> {
        const references = await this.api.resolveRecipeReferences(target.path);
        if (isMenuPath(target.path) && references.length === 0) {
            return undefined;
        }
        return { target, references };
    }

    protected async addResolved(store: ShoppingListStore, { target, references }: ResolvedTarget): Promise<void> {
        if (isMenuPath(target.path)) {
            await store.addMenu(target.path, target.scale, references);
        } else {
            await store.addRecipe(target.path, target.scale, references);
        }
    }

    /**
     * Programmatic entry point (Cookbot). Resolves every target before adding
     * any, so a bad entry fails without a partial add. Returns the live list;
     * rejects with a message on bad input or when the list cannot be built.
     */
    protected async addRecipes(arg: unknown): Promise<unknown> {
        const request = parseAddRecipesRequest(arg);
        if ('error' in request) {
            throw new Error(request.error);
        }
        const store = this.requireStore();
        const targets = 'menu' in request ? [{ path: request.menu, scale: 1 }] : request.recipes;
        const resolved: ResolvedTarget[] = [];
        for (const target of targets) {
            const entry = await this.resolveTarget(target);
            if (!entry) {
                throw new Error(`${target.path} has no recipe references to add.`);
            }
            resolved.push(entry);
        }
        for (const entry of resolved) {
            await this.addResolved(store, entry);
        }
        await this.reveal();
        const error = store.getError();
        if (error) {
            throw new Error(error);
        }
        return store.getResult();
    }

    protected async onMessage(message: unknown): Promise<void> {
        if (!isValidMessage(message)) {
            return;
        }
        if (message.type === 'ready') {
            this.postState();
            return;
        }
        const store = this.store;
        if (!store) {
            return;
        }
        await this.run(async () => {
            switch (message.type) {
                case 'remove': return store.removeRecipe(message.index);
                case 'scale': return store.updateScale(message.index, message.scale);
                case 'clear': return store.clearAll();
                case 'toggle': return store.toggleItem(message.name);
            }
        });
    }

    protected postState(): void {
        if (!this.view) {
            return;
        }
        const store = this.store;
        const state: ViewState = store
            ? {
                hasWorkspace: true,
                items: [...store.getItems()],
                result: store.getResult(),
                checked: store.getCheckedNames(),
                error: store.getError(),
            }
            : { hasWorkspace: false, items: [], checked: [] };
        const message: ToWebview = { type: 'state', state };
        this.view.webview.postMessage(message);
    }

    protected async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.shoppingList');
        }
    }

    /** Runs a user action, surfacing failures as an error notification. */
    protected async run(action: () => Promise<unknown>): Promise<void> {
        try {
            await action();
        } catch (e) {
            vscode.window.showErrorMessage(`Shopping List: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

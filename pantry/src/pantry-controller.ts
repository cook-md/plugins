import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { PANTRY_FILE, PantryFiles, PantryStore } from './pantry-store';
import { FromWebview, isValidMessage, ToWebview, ViewState } from './protocol';

const VIEW_ID = 'pantry.view';

/** `config/pantry.conf` under one workspace folder, via `workspace.fs`. */
class WorkspacePantryFiles implements PantryFiles {
    constructor(protected readonly root: vscode.Uri) { }

    get uri(): vscode.Uri {
        return vscode.Uri.joinPath(this.root, PANTRY_FILE);
    }

    async read(): Promise<string | undefined> {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri));
        } catch (e) {
            if (isNotFound(e)) { return undefined; }
            throw e;
        }
    }

    async write(text: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.root, 'config'));
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
    }
}

function isNotFound(e: unknown): boolean {
    const code = (e as { code?: string }).code;
    return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

/** Owns the store for the first workspace folder, the webview view and the commands. */
export class PantryController implements vscode.WebviewViewProvider {

    protected store: PantryStore | undefined;
    protected storeDisposables: vscode.Disposable[] = [];
    /** The folder `store` was opened for (as a URI string), to ignore folder changes that keep it. */
    protected storeFolder: string | undefined;
    protected view: vscode.WebviewView | undefined;
    /** `pantry.addItem` ran before the webview was ready. */
    protected pendingShowAdd = false;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly api: CooklangApi,
        /** False when this Cook Editor has no pantry API commands. */
        protected readonly supported: boolean,
    ) { }

    start(): void {
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEW_ID, this),
            vscode.commands.registerCommand('pantry.show', () => this.reveal()),
            vscode.commands.registerCommand('pantry.addItem', () => this.showAdd()),
            vscode.commands.registerCommand('pantry.openFile', () => this.openFile()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                if (this.folder()?.uri.toString() !== this.storeFolder) {
                    this.openStore();
                }
            }),
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
        const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'pantry.css'));
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

    protected folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    protected openStore(): void {
        this.closeStore();
        const folder = this.folder();
        this.storeFolder = folder?.uri.toString();
        if (!this.supported || !folder) {
            this.postState();
            return;
        }
        const store = new PantryStore(new WorkspacePantryFiles(folder.uri), this.api);
        this.store = store;
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, PANTRY_FILE));
        const reload = (): void => store.scheduleReload();
        this.storeDisposables = [
            watcher,
            watcher.onDidChange(reload),
            watcher.onDidCreate(reload),
            watcher.onDidDelete(reload),
            store.onDidChange(() => this.postState()),
        ];
        store.load().catch(err => console.error('[pantry] initial load failed:', err));
    }

    protected closeStore(): void {
        this.storeDisposables.forEach(disposable => disposable.dispose());
        this.storeDisposables = [];
        this.store?.dispose();
        this.store = undefined;
    }

    protected async onMessage(message: unknown): Promise<void> {
        if (!isValidMessage(message)) {
            return;
        }
        if (message.type === 'ready') {
            this.postState();
            if (this.pendingShowAdd) {
                this.pendingShowAdd = false;
                this.post({ type: 'showAdd' });
            }
            return;
        }
        if (message.type === 'openFile') {
            await this.openFile();
            return;
        }
        const store = this.store;
        if (!store) {
            return;
        }
        try {
            await this.handle(store, message);
        } catch (e) {
            vscode.window.showErrorMessage(`Pantry: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    protected async handle(store: PantryStore, message: Exclude<FromWebview, { type: 'ready' | 'openFile' }>): Promise<void> {
        switch (message.type) {
            case 'create': return store.create();
            case 'dismissError': return store.dismissEditError();
            case 'add': {
                const section = message.section.trim();
                const name = message.name.trim();
                return store.edit({ ...message.attributes, op: 'add', section, name });
            }
            case 'update': {
                const section = message.section.trim();
                const name = message.name.trim();
                return store.edit({ op: 'update', section, name, fields: message.fields });
            }
            case 'remove': {
                const section = message.section.trim();
                const name = message.name.trim();
                const choice = await vscode.window.showWarningMessage(
                    `Remove "${name}" from ${section}?`, { modal: true }, 'Remove');
                if (store !== this.store) {
                    return; // the workspace folder changed while the dialog was open
                }
                if (choice === 'Remove') {
                    await store.edit({ op: 'remove', section, name });
                }
                return;
            }
        }
    }

    protected postState(): void {
        const store = this.store;
        let state: ViewState;
        if (!this.supported) {
            state = { status: 'unsupported', sections: [] };
        } else if (!store) {
            state = { status: 'noWorkspace', sections: [] };
        } else {
            const current = store.getState();
            state = {
                status: current.kind,
                sections: current.kind === 'loaded' ? current.sections : [],
                parseError: current.kind === 'parseError' ? current.message : undefined,
                editError: store.getEditError(),
            };
        }
        this.post({ type: 'state', state });
    }

    protected post(message: ToWebview): void {
        this.view?.webview.postMessage(message);
    }

    /** Reveals the view first; if the webview cannot take the message now, it gets it after `ready`. */
    protected async showAdd(): Promise<void> {
        await this.reveal();
        const view = this.view;
        if (view?.visible && await view.webview.postMessage({ type: 'showAdd' } satisfies ToWebview)) {
            return;
        }
        this.pendingShowAdd = true;
    }

    protected async openFile(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            vscode.window.showInformationMessage('Open a folder to use the pantry.');
            return;
        }
        const uri = vscode.Uri.joinPath(folder.uri, PANTRY_FILE);
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            vscode.window.showInformationMessage(`There is no ${PANTRY_FILE} yet. Use "Create pantry" in the Pantry view.`);
            return;
        }
        try {
            await vscode.window.showTextDocument(uri);
        } catch (e) {
            vscode.window.showErrorMessage(`Pantry: could not open ${PANTRY_FILE}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    protected async reveal(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.pantry');
        }
    }
}

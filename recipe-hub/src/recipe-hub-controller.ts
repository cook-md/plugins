import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { DEFAULT_SERVER_URL, HubClient } from './hub-client';
import { HubFileSystemProvider } from './hub-file-system';
import { HubFileSystemCore, loadRecipeContent } from './hub-file-system-core';
import { HUB_SCHEME, outletContextUri, parseRecipePath, recipePath, titleFromFileName } from './hub-uri';
import { originalRecipeUrl, trimServerUrl } from './hub-urls';
import { buildSaveDraftArgs } from './recipe-draft';
import { SearchViewHost, SearchViewProvider, VIEW_ID } from './search-view-provider';

/** A hub recipe a preview-toolbar command was invoked on. */
interface HubTarget {
    id: number;
    fileName: string;
    path: string;
}

/** Owns the settings, the `cooklang-hub:` file system and the commands; the panel is `SearchViewProvider`. */
export class RecipeHubController implements SearchViewHost {

    readonly files = new HubFileSystemCore(id => loadRecipeContent(this.hub(), id));
    protected readonly view: SearchViewProvider;

    constructor(protected readonly context: vscode.ExtensionContext, protected readonly api: CooklangApi) {
        this.view = new SearchViewProvider(context.extensionUri, this);
    }

    start(): void {
        const fileSystem = new HubFileSystemProvider(this.files);
        this.context.subscriptions.push(
            fileSystem,
            this.view,
            vscode.workspace.registerFileSystemProvider(HUB_SCHEME, fileSystem, { isCaseSensitive: true, isReadonly: true }),
            vscode.window.registerWebviewViewProvider(VIEW_ID, this.view, { webviewOptions: { retainContextWhenHidden: true } }),
            vscode.commands.registerCommand('recipeHub.search', () => this.run(() => this.search())),
            vscode.commands.registerCommand('recipeHub.saveToDrafts', (arg: unknown) => this.run(() => this.saveToDrafts(arg))),
            vscode.commands.registerCommand('recipeHub.openSource', (arg: unknown) => this.run(() => this.openSource(arg))),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('recipeHub.serverUrl')) {
                    // Recipe ids belong to one server: drop cached recipes and restart the panel.
                    this.files.clear();
                    this.view.reload();
                }
            }),
        );
    }

    serverUrl(): string {
        const configured = vscode.workspace.getConfiguration('recipeHub').get<string>('serverUrl', DEFAULT_SERVER_URL);
        return trimServerUrl(configured) || DEFAULT_SERVER_URL;
    }

    hub(): HubClient {
        return new HubClient({ baseUrl: this.serverUrl() });
    }

    /** Card click: open the standard recipe preview on the hub URI. */
    async openRecipe(id: number, title: string): Promise<void> {
        await this.ensure(this.api.canOpenPreviews(), 'Update Cook Editor to preview Recipe Hub recipes.');
        const uri = vscode.Uri.from({ scheme: HUB_SCHEME, path: recipePath(id, title) });
        await this.api.openPreview(uri.toString());
    }

    protected async search(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
        } catch {
            await vscode.commands.executeCommand('workbench.view.extension.recipeHub');
        }
        this.view.focusSearch();
    }

    protected async saveToDrafts(arg: unknown): Promise<void> {
        await this.ensure(this.api.canSaveDrafts(), 'Update Cook Editor to save drafts.');
        const target = this.target(arg);
        const content = new TextDecoder().decode(await this.files.readFile(target.path));
        const detail = await this.hub().recipe(target.id).catch((e: unknown) => {
            console.warn(`[recipe-hub] no details for recipe ${target.id}; saving without them:`, e);
            return undefined;
        });
        await this.api.saveDraft(buildSaveDraftArgs({
            id: target.id,
            fileTitle: titleFromFileName(target.fileName),
            content,
            detail,
            serverUrl: this.serverUrl(),
        }));
    }

    protected async openSource(arg: unknown): Promise<void> {
        const target = this.target(arg);
        const detail = await this.hub().recipe(target.id).catch(() => undefined);
        await vscode.env.openExternal(vscode.Uri.parse(originalRecipeUrl(detail?.sourceUrl, this.serverUrl(), target.id)));
    }

    protected target(arg: unknown): HubTarget {
        const value = outletContextUri(arg);
        const uri = value === undefined ? undefined : vscode.Uri.parse(value);
        const ref = uri?.scheme === HUB_SCHEME ? parseRecipePath(uri.path) : undefined;
        if (!uri || !ref) {
            throw new Error('Open a Recipe Hub recipe in the preview first.');
        }
        return { ...ref, path: uri.path };
    }

    /** Rejects with `message` when the editor lacks the command behind `available`. */
    protected async ensure(available: Promise<boolean>, message: string): Promise<void> {
        if (!await available) {
            throw new Error(message);
        }
    }

    /** Runs a user action, surfacing failures as an error notification. */
    protected async run(action: () => Promise<void>): Promise<void> {
        try {
            await action();
        } catch (e) {
            vscode.window.showErrorMessage(`Recipe Hub: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

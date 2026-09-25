import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { HubClient, HubError } from './hub-client';
import { imageSources, serverOrigin } from './hub-urls';
import { PanelStateStore } from './panel-state-store';
import { parseFromWebview, ToWebview } from './protocol';
import { PAGE_SIZE, primaryLanguage, SearchFilters } from './search-query';

export const VIEW_ID = 'recipeHub.view';

/** What the panel needs from the controller. */
export interface SearchViewHost {
    hub(): HubClient;
    serverUrl(): string;
    openRecipe(id: number, title: string): Promise<void>;
}

/**
 * The Recipe Hub panel. Searches run here in the extension host, never in the
 * webview. The webview only loads thumbnails (CSP `img-src https:` plus the
 * server origin).
 */
export class SearchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {

    protected view: vscode.WebviewView | undefined;
    protected viewDisposables: vscode.Disposable[] = [];
    /** Sequence number of the newest search the webview asked for; responses to older ones are dropped. */
    protected latestSeq = 0;
    /**
     * Bumped whenever the webview restarts (reload, `ready`). The restarted
     * webview counts `seq` from 1 again, so a response from before the restart
     * could otherwise match a new request's `seq`.
     */
    protected generation = 0;

    constructor(
        protected readonly extensionUri: vscode.Uri,
        protected readonly host: SearchViewHost,
        protected readonly panelState: PanelStateStore,
    ) { }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.disposeView();
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media'), vscode.Uri.joinPath(this.extensionUri, 'out')],
        };
        view.webview.html = this.html(view.webview);
        this.viewDisposables.push(
            view.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message)),
            view.onDidDispose(() => {
                if (this.view === view) {
                    this.view = undefined;
                    this.disposeView();
                }
            }),
        );
    }

    /** The server changed: reload the webview so its CSP, facets and results follow the new server. */
    reload(): void {
        this.restart();
        if (this.view) {
            this.view.webview.html = this.html(this.view.webview);
        }
    }

    focusSearch(): void {
        this.post({ type: 'focusSearch' });
    }

    dispose(): void {
        this.view = undefined;
        this.disposeView();
        this.panelState.dispose();
    }

    protected disposeView(): void {
        this.viewDisposables.forEach(disposable => disposable.dispose());
        this.viewDisposables = [];
    }

    protected restart(): void {
        this.latestSeq = 0;
        this.generation += 1;
    }

    protected html(webview: vscode.Webview): string {
        const nonce = randomBytes(16).toString('hex');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'recipe-hub.css'));
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources(this.host.serverUrl())}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
    }

    protected async onMessage(raw: unknown): Promise<void> {
        const message = parseFromWebview(raw);
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'ready':
                this.restart();
                this.post({
                    type: 'init',
                    defaultLocale: primaryLanguage(vscode.env.language),
                    serverOrigin: serverOrigin(this.host.serverUrl()) ?? '',
                    state: this.panelState.read(),
                });
                await this.loadFacets();
                return;
            case 'search':
                await this.search(message.seq, message.filters, message.page);
                return;
            case 'state':
                this.panelState.write({ filters: message.filters, filtersOpen: message.filtersOpen, localeTouched: message.localeTouched });
                return;
            case 'open':
                try {
                    await this.host.openRecipe(message.id, message.title);
                } catch (e) {
                    vscode.window.showErrorMessage(`Recipe Hub: ${errorMessage(e)}`);
                }
                return;
        }
    }

    protected async search(seq: number, filters: SearchFilters, page: number): Promise<void> {
        this.latestSeq = seq;
        const generation = this.generation;
        const current = (): boolean => seq === this.latestSeq && generation === this.generation;
        try {
            const result = await this.host.hub().search(filters, page, PAGE_SIZE);
            if (!current()) {
                return;
            }
            this.post({ type: 'results', seq, page: result.page, cards: result.cards, total: result.total, hasMore: result.hasMore });
        } catch (e) {
            if (!current()) {
                return;
            }
            const error = e instanceof HubError ? e : new HubError('network', errorMessage(e));
            this.post({ type: 'error', seq, kind: error.kind, message: error.message });
        }
    }

    /** Facets only enrich the filters (tag list, languages); without them the panel still searches. */
    protected async loadFacets(): Promise<void> {
        const generation = this.generation;
        try {
            const facets = await this.host.hub().facets();
            if (generation === this.generation) {
                this.post({ type: 'facets', facets });
            }
        } catch (e) {
            console.warn('[recipe-hub] facets unavailable:', errorMessage(e));
        }
    }

    protected post(message: ToWebview): void {
        // Rejects when the webview is gone mid-request; there is nobody left to tell.
        this.view?.webview.postMessage(message).then(undefined, () => undefined);
    }
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

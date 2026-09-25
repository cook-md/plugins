import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { HubClient } from './hub-client';
import { imageSources, serverOrigin } from './hub-urls';
import { PanelStateStore } from './panel-state-store';
import { parseFromWebview, ToWebview } from './protocol';
import { asHubError, ResponseGate } from './response-gate';
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
    /** Drops stale search/facets responses across webview restarts; see response-gate.ts. */
    protected readonly gate = new ResponseGate();
    /** Whether the current webview has finished its `ready` → `init` handshake; posting before this is dropped silently. */
    protected ready = false;
    /** A `focusSearch()` call that arrived before `ready`; sent as soon as the handshake completes, then cleared. */
    protected pendingFocus = false;

    constructor(
        protected readonly extensionUri: vscode.Uri,
        protected readonly host: SearchViewHost,
        protected readonly panelState: PanelStateStore,
    ) { }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.disposeView();
        this.view = view;
        this.ready = false;
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
                    this.ready = false;
                    this.disposeView();
                }
            }),
        );
    }

    /** The server changed: reload the webview so its CSP, facets and results follow the new server. */
    reload(): void {
        this.gate.restart();
        this.ready = false;
        if (this.view) {
            this.view.webview.html = this.html(this.view.webview);
        }
    }

    /**
     * Focuses the search box. The webview may not exist yet (the view container
     * was just revealed) or may not have finished its `ready` handshake, so a
     * message posted now would be lost; queue it and send it once `ready`
     * replies with `init`.
     */
    focusSearch(): void {
        if (this.ready) {
            this.post({ type: 'focusSearch' });
        } else {
            this.pendingFocus = true;
        }
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
                this.gate.restart();
                this.ready = true;
                this.post({
                    type: 'init',
                    defaultLocale: primaryLanguage(vscode.env.language),
                    serverOrigin: serverOrigin(this.host.serverUrl()) ?? '',
                    state: this.panelState.read(),
                });
                if (this.pendingFocus) {
                    this.pendingFocus = false;
                    this.post({ type: 'focusSearch' });
                }
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
        const current = this.gate.startRequest(seq);
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
            const error = asHubError(e);
            this.post({ type: 'error', seq, kind: error.kind, message: error.message });
        }
    }

    /** Facets only enrich the filters (tag list, languages); without them the panel still searches. */
    protected async loadFacets(): Promise<void> {
        const current = this.gate.startGenerationRequest();
        try {
            const facets = await this.host.hub().facets();
            if (current()) {
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

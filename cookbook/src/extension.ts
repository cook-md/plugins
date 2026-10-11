import * as path from 'path';
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { BookFolder, CookbookExporter, CookbookUi, CookbookWorkspace, folderChoices } from './export-command';
import { readSettings } from './settings';

/** `.cook` files and READMEs (`README.md`, `readme.markdown`, any case). */
const BOOK_FILES = '**/{*.cook,[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd],[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Aa][Rr][Kk][Dd][Oo][Ww][Nn]}';
const SKIPPED = '**/node_modules/**';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Cookbook');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('cookbook');
        return readSettings(key => configuration.get(key));
    };
    const workspace: CookbookWorkspace = {
        listFiles: async folder => {
            const base = vscode.Uri.parse(folder.uri);
            const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(base, BOOK_FILES), SKIPPED);
            return uris.map(uri => path.posix.relative(base.path, uri.path)).filter(relative => relative !== '' && !relative.startsWith('..'));
        },
        uriOf: (folder, relativePath) => vscode.Uri.joinPath(vscode.Uri.parse(folder.uri), ...relativePath.split('/')).toString(),
        readText: async uri => {
            try {
                return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
            } catch {
                return undefined;
            }
        },
        images: {
            size: async uri => {
                try {
                    return (await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).size;
                } catch {
                    return undefined;
                }
            },
            read: async uri => vscode.workspace.fs.readFile(vscode.Uri.parse(uri)),
        },
    };
    const ui: CookbookUi = {
        withProgress: (title, task) => Promise.resolve(vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            (progress, token) => task(message => progress.report({ message }), token),
        )),
        showInformation: (message, ...actions) => Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
        showWarning: (message, ...actions) => Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
        showError: message => Promise.resolve(vscode.window.showErrorMessage(message)),
        openExternal: url => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
        openFile: file => Promise.resolve(vscode.env.openExternal(vscode.Uri.file(file))),
    };
    const exporter = new CookbookExporter(api, workspace, ui, settings);

    context.subscriptions.push(vscode.commands.registerCommand('cookbook.export', async (argument?: unknown) => {
        const uri = asUri(argument);
        const folder = uri ? toBookFolder(uri) : await pickFolder(settings().exclude);
        if (!folder) {
            return;
        }
        try {
            const outcome = await exporter.export(folder);
            output.appendLine(`Export of ${folder.uri}: ${JSON.stringify(outcome)}`);
        } catch (error) {
            output.appendLine(`Export of ${folder.uri} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            void vscode.window.showErrorMessage(`Could not export the cookbook: ${error instanceof Error ? error.message : String(error)}`);
        }
    }));
}

/** The Explorer passes the clicked folder's URI (and the selection as a second argument, ignored). */
function asUri(argument: unknown): vscode.Uri | undefined {
    if (argument instanceof vscode.Uri) {
        return argument;
    }
    if (typeof argument === 'object' && argument !== null) {
        const value = argument as { scheme?: unknown; authority?: unknown; path?: unknown };
        if (typeof value.scheme === 'string' && typeof value.path === 'string') {
            return vscode.Uri.from({ scheme: value.scheme, authority: typeof value.authority === 'string' ? value.authority : '', path: value.path });
        }
    }
    return undefined;
}

function toBookFolder(uri: vscode.Uri): BookFolder {
    const root = vscode.workspace.getWorkspaceFolder(uri);
    const name = path.posix.basename(uri.path) || root?.name || 'Cookbook';
    return { uri: uri.toString(), name };
}

/** Command palette: choose among the folders of every workspace root that contain recipes. */
async function pickFolder(exclude: readonly string[]): Promise<BookFolder | undefined> {
    const roots = vscode.workspace.workspaceFolders ?? [];
    if (roots.length === 0) {
        void vscode.window.showInformationMessage('Open a recipe folder to export a cookbook.');
        return undefined;
    }
    const choices: Array<{ label: string; description: string | undefined; root: vscode.WorkspaceFolder; relative: string }> = [];
    for (const root of roots) {
        const recipes = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.cook'), SKIPPED);
        for (const relative of folderChoices(recipes.map(uri => path.posix.relative(root.uri.path, uri.path)), exclude)) {
            const name = relative === '' ? root.name : roots.length > 1 ? `${root.name}/${relative}` : relative;
            choices.push({ label: name, description: relative === '' ? 'Whole workspace folder' : undefined, root, relative });
        }
    }
    if (choices.length === 0) {
        void vscode.window.showInformationMessage('No recipes to export in this workspace.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Folder to export as a cookbook' });
    if (!picked) {
        return undefined;
    }
    const { root, relative } = picked;
    const uri = relative === '' ? root.uri : vscode.Uri.joinPath(root.uri, ...relative.split('/'));
    return { uri: uri.toString(), name: relative === '' ? root.name : path.posix.basename(relative) };
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

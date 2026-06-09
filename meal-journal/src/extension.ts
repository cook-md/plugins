import * as vscode from 'vscode';
import { adjacentEntry, DEFAULT_TEMPLATE, fileNameForDate, isJournalFileName, renderTemplate } from './journal-files';
import { pickAndInsertRecipeReference } from './recipe-picker';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mealJournal.openToday', () => openOrCreateEntry(dateWithOffset(0))),
        vscode.commands.registerCommand('mealJournal.openYesterday', () => openYesterday()),
        vscode.commands.registerCommand('mealJournal.openPreviousEntry', () => openAdjacentEntry('previous')),
        vscode.commands.registerCommand('mealJournal.openNextEntry', () => openAdjacentEntry('next')),
        vscode.commands.registerCommand('mealJournal.insertRecipeReference', () => pickAndInsertRecipeReference())
    );

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(notebook) Today';
    statusBarItem.tooltip = "Open today's meal journal";
    statusBarItem.command = 'mealJournal.openToday';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
    // nothing to clean up; subscriptions are disposed by the host
}

function dateWithOffset(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

/** Journal folder URI from settings, or undefined (with a warning) when no workspace is open. */
function journalFolderUri(): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Meal Journal: open a workspace folder first.');
        return undefined;
    }
    const folderName = vscode.workspace.getConfiguration('mealJournal').get<string>('folder', 'Journal');
    return vscode.Uri.joinPath(workspaceFolder.uri, folderName);
}

async function openOrCreateEntry(date: Date): Promise<void> {
    const folder = journalFolderUri();
    if (!folder) {
        return;
    }
    await vscode.workspace.fs.createDirectory(folder);
    const entryUri = vscode.Uri.joinPath(folder, fileNameForDate(date));
    if (!(await exists(entryUri))) {
        const configured = vscode.workspace.getConfiguration('mealJournal').get<string>('template', '');
        const template = configured || DEFAULT_TEMPLATE;
        await vscode.workspace.fs.writeFile(entryUri, new TextEncoder().encode(renderTemplate(template, date)));
    }
    await openEntry(entryUri);
}

async function openYesterday(): Promise<void> {
    const folder = journalFolderUri();
    if (!folder) {
        return;
    }
    const yesterday = dateWithOffset(-1);
    const entryUri = vscode.Uri.joinPath(folder, fileNameForDate(yesterday));
    if (await exists(entryUri)) {
        await openEntry(entryUri);
        return;
    }
    const choice = await vscode.window.showInformationMessage('No journal entry for yesterday.', 'Create it');
    if (choice === 'Create it') {
        await openOrCreateEntry(yesterday);
    }
}

async function openAdjacentEntry(direction: 'previous' | 'next'): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const currentName = activeUri?.path.split('/').pop();
    if (!activeUri || !currentName || !isJournalFileName(currentName)) {
        vscode.window.showWarningMessage('Meal Journal: open a journal entry first.');
        return;
    }
    const folder = vscode.Uri.joinPath(activeUri, '..');
    const entries = (await vscode.workspace.fs.readDirectory(folder))
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => name);
    const target = adjacentEntry(entries, currentName, direction);
    if (!target) {
        vscode.window.setStatusBarMessage(direction === 'previous' ? 'No earlier entries' : 'No later entries', 3000);
        return;
    }
    await openEntry(vscode.Uri.joinPath(folder, target));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/** Opens an entry and places the cursor on the line after the first section heading. */
async function openEntry(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    for (let line = 0; line < document.lineCount; line++) {
        if (document.lineAt(line).text.startsWith('= ')) {
            const position = new vscode.Position(Math.min(line + 1, document.lineCount - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
            break;
        }
    }
}

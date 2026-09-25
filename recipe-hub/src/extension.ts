import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { RecipeHubController } from './recipe-hub-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    // Register first: a restored hub preview may be waiting for the cooklang-hub file system.
    new RecipeHubController(context, api).start();
    // Searching works on any editor; previewing and saving need cooklang.api.openPreview / saveDraft.
    // The editor's API version stays 1, so detect the commands themselves.
    const [canOpen, canSave] = await Promise.all([api.canOpenPreviews(), api.canSaveDrafts()]);
    if (!canOpen || !canSave) {
        vscode.window.showWarningMessage('Recipe Hub can search, but this Cook Editor cannot preview or save its recipes. Update Cook Editor to use them.');
    }
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

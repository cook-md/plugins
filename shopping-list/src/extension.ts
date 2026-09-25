import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { ShoppingListController } from './shopping-list-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi((command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)));
    let version: number | undefined;
    try {
        version = await api.version();
    } catch {
        version = undefined;
    }
    if (version !== SUPPORTED_API_VERSION) {
        vscode.window.showWarningMessage(
            `Shopping List needs Cook Editor's Cooklang API version ${SUPPORTED_API_VERSION}` +
            ` (found ${version ?? 'none'}). Update Cook Editor to use it.`);
        return;
    }
    new ShoppingListController(context, api).start();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

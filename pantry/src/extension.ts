import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { PantryController } from './pantry-controller';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    let version: number | undefined;
    try {
        version = await api.version();
    } catch {
        version = undefined;
    }
    // Without the pantry API the view still opens and asks the user to update.
    let supported = false;
    try {
        supported = version === SUPPORTED_API_VERSION && await api.supportsPantry();
    } catch {
        supported = false;
    }
    new PantryController(context, api, supported).start();
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

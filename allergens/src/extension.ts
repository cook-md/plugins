import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { AllergenBadgeProvider } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Allergens');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const supportCheck = new SupportCheck(api);
    const provider = new AllergenBadgeProvider(
        api,
        message => output.appendLine(message),
        () => {
            const configuration = vscode.workspace.getConfiguration('allergens');
            return readSettings(key => configuration.get(key));
        },
    );
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.allergens.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Allergens needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    // Ticking an allergen should update the open preview without an edit.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('allergens')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

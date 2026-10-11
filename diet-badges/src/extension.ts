import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { DietBadgeProvider } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Diet Badges');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const supportCheck = new SupportCheck(api);
    const provider = new DietBadgeProvider(
        api,
        message => {
            output.appendLine(message);
            console.warn(message);
        },
        () => {
            const configuration = vscode.workspace.getConfiguration('dietBadges');
            return readSettings(key => configuration.get(key));
        },
        uri => vscode.workspace.textDocuments.find(document => document.uri.toString() === uri)?.version,
    );
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.dietBadges.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Diet Badges needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    // Switching a diet off (or adding a word) should update the open preview without an edit.
    // Editors without cooklang.api.refreshBadges update on the next edit instead.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('dietBadges')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

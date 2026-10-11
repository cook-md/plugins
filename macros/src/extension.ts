import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { MacrosBadgeProvider, ReadText } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Macros');
    context.subscriptions.push(output);
    const log = (message: string): void => {
        output.appendLine(message);
        console.warn(`[macros] ${message}`);
    };
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('macros');
        return readSettings(key => configuration.get(key));
    };
    // The open document when there is one (unsaved edits included), else the file.
    // Failures are reported by the provider, once, not on every badge refresh.
    const readText: ReadText = async uri => {
        try {
            return (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
        } catch {
            return undefined;
        }
    };
    const supportCheck = new SupportCheck(api);
    const provider = new MacrosBadgeProvider(api, log, settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.macros.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            log('Macros needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        // A different nutrition service answers differently: forget cached renders.
        if (event.affectsConfiguration('cooklang.nutrition')) {
            provider.clearCache();
        }
        // Energy on/off or a new basis should update open previews without an edit.
        if (event.affectsConfiguration('macros') || event.affectsConfiguration('cooklang.nutrition')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

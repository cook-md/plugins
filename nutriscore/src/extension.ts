import * as vscode from 'vscode';
import { CooklangApi, SUPPORTED_API_VERSION } from './cooklang-api';
import { NutriScoreBadgeProvider } from './provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Nutri-Score');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    let supported = false;
    try {
        supported = await api.version() === SUPPORTED_API_VERSION && await api.supportsReports();
    } catch {
        supported = false;
    }
    if (!supported) {
        output.appendLine('Nutri-Score needs a newer Cook Editor (cooklang.api.renderReport is missing).');
    }
    const provider = new NutriScoreBadgeProvider(api, message => output.appendLine(message));
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.nutriscore.provideBadge',
        (outletContext: unknown) => supported ? provider.provide(outletContext) : undefined));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

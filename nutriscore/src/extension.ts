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
    // Undefined/false is never latched for the session: a stale editor build could
    // still be updated while this extension host keeps running, so every command
    // invocation re-checks until support is confirmed once and for all.
    let supported: boolean | undefined;
    let warned = false;
    const ensureSupported = async (): Promise<boolean> => {
        if (supported === true) {
            return true;
        }
        try {
            supported = await api.version() === SUPPORTED_API_VERSION && await api.supportsReports();
        } catch {
            supported = false;
        }
        if (!supported && !warned) {
            warned = true;
            output.appendLine('Nutri-Score needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported;
    };
    const provider = new NutriScoreBadgeProvider(api, message => output.appendLine(message));
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.nutriscore.provideBadge',
        async (outletContext: unknown) => await ensureSupported() ? provider.provide(outletContext) : undefined));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

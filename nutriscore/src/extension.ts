import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { NutriScoreBadgeProvider } from './provider';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Nutri-Score');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const supportCheck = new SupportCheck(api);
    const provider = new NutriScoreBadgeProvider(
        api,
        message => output.appendLine(message),
        () => vscode.workspace.getConfiguration('nutriscore').get<boolean>('showWhenLocked', true),
    );
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.nutriscore.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Nutri-Score needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

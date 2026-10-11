import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand('cookbook.export', () => undefined));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

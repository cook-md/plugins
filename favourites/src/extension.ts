import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    context.subscriptions.push(vscode.window.createOutputChannel('Favourites'));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

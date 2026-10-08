import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Core Vitals');
    context.subscriptions.push(output);
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

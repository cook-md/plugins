import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { CoreVitalsBadgeProvider, ReadText } from './provider';
import { OpenReportCommand, uriFromArgument } from './report-command';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Core Vitals');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('coreVitals');
        return readSettings(key => configuration.get(key));
    };
    // The open document when there is one (unsaved edits included), else the file.
    // Failures are reported by the caller, once, not on every badge refresh.
    const readText: ReadText = async uri => {
        try {
            return (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
        } catch {
            return undefined;
        }
    };
    const supportCheck = new SupportCheck(api);
    const provider = new CoreVitalsBadgeProvider(api, message => output.appendLine(message), settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.corevitals.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Core Vitals needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    const report = new OpenReportCommand(api, settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.corevitals.openReport', async (argument: unknown) => {
        const uri = uriFromArgument(argument, vscode.window.activeTextEditor?.document.uri.toString());
        if (!uri) {
            vscode.window.showInformationMessage('Open a recipe (.cook) or meal plan (.menu) to see its Core Vitals report.');
            return;
        }
        try {
            if (!await report.open(uri)) {
                vscode.window.showWarningMessage('The Core Vitals report needs a newer Cook Editor (cooklang.api.openReport is missing).');
            }
        } catch (error) {
            output.appendLine(`Could not open the Core Vitals report: ${error}`);
            vscode.window.showErrorMessage(`Could not open the Core Vitals report: ${error}`);
        }
    }));
    // Changing a target should update open previews without an edit.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('coreVitals')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

import * as vscode from 'vscode';
import { recipeReference } from './journal-files';

interface RecipeQuickPickItem extends vscode.QuickPickItem {
    relativePath: string;
}

/**
 * Shows a quick-pick of all .cook recipes in the workspace and inserts a
 * Cooklang recipe reference (relative to the active file's folder) at the cursor.
 */
export async function pickAndInsertRecipeReference(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Meal Journal: open a journal entry first.');
        return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Meal Journal: the active file is not inside the workspace.');
        return;
    }
    const recipeUris = await vscode.workspace.findFiles('**/*.cook');
    if (recipeUris.length === 0) {
        vscode.window.showInformationMessage('No .cook recipes found in the workspace.');
        return;
    }
    const items: RecipeQuickPickItem[] = recipeUris
        .map(uri => vscode.workspace.asRelativePath(uri, false))
        .sort()
        .map(relativePath => {
            const segments = relativePath.split('/');
            const fileName = segments.pop()!;
            return {
                label: fileName.replace(/\.cook$/, ''),
                description: segments.join('/'),
                relativePath
            };
        });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Pick a recipe to reference' });
    if (!picked) {
        return;
    }
    const journalDir = workspaceRelativeDir(editor.document.uri);
    const reference = recipeReference(journalDir, picked.relativePath);
    await editor.edit(editBuilder => editBuilder.insert(editor.selection.active, reference));
}

/** Workspace-relative POSIX path of the file's folder; '' when the file sits at the workspace root. */
function workspaceRelativeDir(documentUri: vscode.Uri): string {
    const dirUri = vscode.Uri.joinPath(documentUri, '..');
    const relative = vscode.workspace.asRelativePath(dirUri, false);
    // asRelativePath returns the input path unchanged when given the workspace root itself
    return relative === dirUri.path || relative === dirUri.fsPath ? '' : relative;
}

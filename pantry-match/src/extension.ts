import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { PantryMatchController } from './controller';
import { OPEN_RECIPE_COMMAND } from './tree';
import { recipeUriOf } from './view-model';

/** The Shopping List plugin's command; takes a `vscode.Uri` like the Explorer passes. */
export const SHOPPING_LIST_ADD_RECIPE = 'shoppingList.addRecipe';
export const SHOPPING_LIST_CONTEXT_KEY = 'pantryMatch.shoppingListAvailable';
/** The Pantry plugin's view, which offers "Create pantry". */
export const PANTRY_SHOW = 'pantry.show';
export const PANTRY_DOCS_URL = 'https://cook.md/help/plugins/pantry';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Pantry Match');
    const log = (message: string): void => output.appendLine(message);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const controller = new PantryMatchController(api, log);
    context.subscriptions.push(output, controller);

    // Hides "Add missing to shopping list" when the Shopping List plugin isn't installed.
    const syncShoppingList = async (): Promise<void> => {
        await vscode.commands.executeCommand('setContext', SHOPPING_LIST_CONTEXT_KEY, await api.hasCommands([SHOPPING_LIST_ADD_RECIPE]));
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('pantryMatch.refresh', () => controller.refresh()),
        vscode.commands.registerCommand(OPEN_RECIPE_COMMAND, async (node: unknown) => {
            const uri = recipeUriOf(node);
            if (!uri) {
                return;
            }
            try {
                await api.openPreview(uri);
            } catch (error) {
                log(`Pantry Match: could not open ${uri}: ${messageOf(error)}`);
                vscode.window.showErrorMessage(`Could not open the recipe: ${messageOf(error)}`);
            }
        }),
        vscode.commands.registerCommand('pantryMatch.addMissingToShoppingList', async (node: unknown) => {
            const uri = recipeUriOf(node);
            if (!uri) {
                return;
            }
            if (!await api.hasCommands([SHOPPING_LIST_ADD_RECIPE])) {
                vscode.window.showInformationMessage('Install the Shopping List plugin to add recipes to a shopping list.');
                return;
            }
            // The whole recipe goes on the list; the list subtracts the pantry, so only the missing items show.
            await vscode.commands.executeCommand(SHOPPING_LIST_ADD_RECIPE, vscode.Uri.parse(uri));
        }),
        vscode.commands.registerCommand('pantryMatch.setUpPantry', async () => {
            if (await api.hasCommands([PANTRY_SHOW])) {
                await vscode.commands.executeCommand(PANTRY_SHOW);
                return;
            }
            await vscode.env.openExternal(vscode.Uri.parse(PANTRY_DOCS_URL));
        }),
        vscode.commands.registerCommand('pantryMatch.openPantryFile', () => controller.openPantryFile()),
        vscode.commands.registerCommand('pantryMatch.provideBadge', async (outletContext: unknown) =>
            await controller.isSupported() ? controller.badges.provide(outletContext) : undefined),
        vscode.extensions.onDidChange(() => {
            syncShoppingList().catch(error => log(`Pantry Match: ${messageOf(error)}`));
        }),
    );

    await syncShoppingList().catch(error => log(`Pantry Match: ${messageOf(error)}`));
    await controller.start().catch(error => log(`Pantry Match: start failed: ${messageOf(error)}`));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}

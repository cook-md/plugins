// The "What can I cook" view in the Explorer. All structure comes from view-model.ts.
import * as vscode from 'vscode';
import { describeExpiry } from './expiry';
import { childrenOf, EMPTY_MODEL, GROUP_LABELS, nodeId, TreeNode, ViewModel } from './view-model';

export const VIEW_ID = 'pantryMatch.view';
export const OPEN_RECIPE_COMMAND = 'pantryMatch.openRecipe';

export class PantryMatchTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private model: ViewModel = EMPTY_MODEL;

    setModel(model: ViewModel): void {
        this.model = model;
        this.onDidChangeTreeDataEmitter.fire();
    }

    getChildren(element?: TreeNode): TreeNode[] {
        return childrenOf(this.model, element);
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const item = this.createItem(node);
        item.id = nodeId(node);
        return item;
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }

    protected createItem(node: TreeNode): vscode.TreeItem {
        const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
        switch (node.kind) {
            case 'group': {
                const item = new vscode.TreeItem(GROUP_LABELS[node.group], node.group === 'unreadable' ? Collapsed : Expanded);
                item.description = String(node.count);
                item.contextValue = 'group';
                return item;
            }
            case 'recipe': {
                const { row } = node;
                const hasMissing = row.missing.length > 0;
                const item = new vscode.TreeItem(row.title, hasMissing ? Collapsed : None);
                item.description = row.total === 0 ? 'optional' : `${row.covered}/${row.total}`;
                item.tooltip = row.total === 0
                    ? `${row.path}\nOnly uses it as an optional ingredient.`
                    : hasMissing ? `${row.path}\nMissing: ${row.missing.join(', ')}` : `${row.path}\nYou have everything.`;
                item.resourceUri = vscode.Uri.parse(row.uri);
                item.contextValue = hasMissing ? 'recipeMissing' : 'recipe';
                item.command = { command: OPEN_RECIPE_COMMAND, title: 'Open Recipe', arguments: [node] };
                return item;
            }
            case 'missing': {
                const item = new vscode.TreeItem(node.name, None);
                item.iconPath = new vscode.ThemeIcon('circle-slash');
                item.tooltip = 'Not in your pantry';
                item.contextValue = 'missingIngredient';
                return item;
            }
            case 'more': {
                const item = new vscode.TreeItem(`+${node.count} more`, None);
                item.contextValue = 'more';
                return item;
            }
            case 'expiring': {
                const { item: pantryItem, recipes } = node.row;
                const when = describeExpiry(pantryItem.daysLeft);
                const item = new vscode.TreeItem(pantryItem.name, recipes.length > 0 ? Expanded : None);
                item.description = recipes.length > 0 ? when : `${when} · no recipes use it`;
                item.tooltip = `${pantryItem.name}: ${when} (${pantryItem.expireDate})`;
                item.iconPath = new vscode.ThemeIcon(pantryItem.daysLeft < 0 ? 'warning' : 'clock');
                item.contextValue = 'expiring';
                return item;
            }
            case 'unreadable': {
                const { row } = node;
                const item = new vscode.TreeItem(row.title, None);
                item.description = row.message;
                item.tooltip = `${row.path}: ${row.message}`;
                item.iconPath = new vscode.ThemeIcon('warning');
                item.contextValue = 'unreadable';
                // The preview would fail the same way, so open the source.
                item.command = { command: 'vscode.open', title: 'Open Recipe', arguments: [vscode.Uri.parse(row.uri)] };
                return item;
            }
        }
    }
}

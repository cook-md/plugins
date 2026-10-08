// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// extension.ts passes `vscode.commands.executeCommand` and `getCommands`.

/** Asks open previews to re-query their outlets; older editors lack it. */
export const REFRESH_BADGES_COMMAND = 'cooklang.api.refreshBadges';
/** Opens the recipe preview tab for a `.cook` URI. */
export const OPEN_PREVIEW_COMMAND = 'cooklang.api.openPreview';

/** Runs a command by id (e.g. `vscode.commands.executeCommand`). */
export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
/** Lists the ids of all registered commands. */
export type ListCommands = () => Promise<readonly string[]>;

/** Wrapper over the editor's `cooklang.api.*` commands. */
export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** Re-renders open preview toolbars (so `when` clauses are re-evaluated). False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.listCommands()).includes(REFRESH_BADGES_COMMAND)) {
            return false;
        }
        await this.execute(REFRESH_BADGES_COMMAND);
        return true;
    }

    /** Opens the recipe preview tab for a `.cook` URI string. */
    async openPreview(uri: string): Promise<void> {
        await this.execute(OPEN_PREVIEW_COMMAND, { uri });
    }
}

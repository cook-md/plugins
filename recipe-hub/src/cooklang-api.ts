// Typed wrapper over the Cook Editor commands this plugin calls. Kept free of
// the `vscode` import so it can be unit-tested; extension.ts passes
// `vscode.commands.executeCommand` and `vscode.commands.getCommands(true)`.
//
// `cooklang.api.version` stays 1 while the API grows additively, so newer
// commands are detected by name, never by version.

import type { SaveDraftArgs } from './recipe-draft';

export const CooklangApiCommands = {
    /** `{ version: 1, content, title?, frontmatter? }` → saved URI string; saves into `Drafts/` and opens it. */
    SAVE_DRAFT: 'cooklang.api.saveDraft',
    /** `{ uri }` → opens (or reveals) the recipe preview for any recipe URI, including `cooklang-hub:`. */
    OPEN_PREVIEW: 'cooklang.api.openPreview',
} as const;

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** Whether this Cook Editor has `cooklang.api.saveDraft`. */
    canSaveDrafts(): Promise<boolean> {
        return this.has(CooklangApiCommands.SAVE_DRAFT);
    }

    /** Whether this Cook Editor has `cooklang.api.openPreview`. */
    canOpenPreviews(): Promise<boolean> {
        return this.has(CooklangApiCommands.OPEN_PREVIEW);
    }

    /** Saves into `Drafts/` and opens the file; resolves to its URI string. */
    async saveDraft(args: SaveDraftArgs): Promise<string> {
        const uri = await this.execute(CooklangApiCommands.SAVE_DRAFT, args);
        if (typeof uri !== 'string') {
            throw new Error('Cook Editor did not return the saved draft.');
        }
        return uri;
    }

    async openPreview(uri: string): Promise<void> {
        await this.execute(CooklangApiCommands.OPEN_PREVIEW, { uri });
    }

    protected async has(command: string): Promise<boolean> {
        try {
            return (await this.listCommands()).includes(command);
        } catch {
            return false;
        }
    }
}

// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/pantry-types.ts`.
// Kept free of the `vscode` import so it can be unit-tested; extension.ts
// passes `vscode.commands.executeCommand` and `vscode.commands.getCommands`.

export const SUPPORTED_API_VERSION = 1;

/** Pantry commands were added to API version 1 later; detect them by name. */
export const PANTRY_COMMANDS = ['cooklang.api.parsePantry', 'cooklang.api.editPantry'] as const;

export interface PantryItem {
    name: string;
    /** As written in pantry.conf, e.g. `500%g`. */
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
    isLow: boolean;
    /** Quantity parses to zero. No quantity means in stock. */
    isOutOfStock: boolean;
    /** `expire` as `YYYY-MM-DD`, when parseable. */
    expireDate?: string;
    /** `bought` as `YYYY-MM-DD`, when parseable. */
    boughtDate?: string;
}

export interface PantrySection {
    name: string;
    items: PantryItem[];
}

export interface PantryContents {
    sections: PantrySection[];
}

/** On update: omitted = unchanged, empty string = remove the attribute. */
export interface PantryAttributes {
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
}

export type PantryEdit =
    | ({ op: 'add'; section: string; name: string } & PantryAttributes)
    | { op: 'update'; section: string; name: string; fields: PantryAttributes }
    | { op: 'remove'; section: string; name: string };

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    async supportsPantry(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return PANTRY_COMMANDS.every(command => commands.has(command));
    }

    parsePantry(text: string): Promise<PantryContents> {
        return this.call('cooklang.api.parsePantry', { text });
    }

    /** Returns the new file text; rejects with the editor's message on a bad edit. */
    editPantry(text: string, edit: PantryEdit): Promise<string> {
        return this.call('cooklang.api.editPantry', { text, edit });
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}

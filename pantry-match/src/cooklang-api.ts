// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `plugin-report-types.ts`, `pantry-types.ts`,
// `recipe-reference-resolver.ts` and `cooklang-outlet-context.ts`. Free of the
// `vscode` import so it can be unit-tested; extension.ts passes
// `vscode.commands.executeCommand` and `vscode.commands.getCommands`.

export const Commands = {
    RENDER_REPORT: 'cooklang.api.renderReport',
    PARSE_PANTRY: 'cooklang.api.parsePantry',
    RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
    OPEN_PREVIEW: 'cooklang.api.openPreview',
    REFRESH_BADGES: 'cooklang.api.refreshBadges',
} as const;

/** Without these the plugin can't work; older editors get the "needs a newer Cook Editor" view. */
export const REQUIRED_COMMANDS: readonly string[] = [
    Commands.RENDER_REPORT,
    Commands.PARSE_PANTRY,
    Commands.RESOLVE_RECIPE_REFERENCES,
    Commands.OPEN_PREVIEW,
];

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };

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

/** A `@./recipe{}` reference; `path` is workspace-relative without a leading `./`. */
export interface ResolvedRecipeReference {
    path: string;
    /** Multiplier relative to the recipe holding the reference. */
    scale: number;
    children?: ResolvedRecipeReference[];
}

export interface PreviewOutletContext {
    version: 1;
    uri: string;
    /** Workspace-relative; `''` outside the workspace. */
    path: string;
    scale: number;
}

/** The `pill` kind of the editor's `PreviewBadge`. `text` is at most 24 UTF-16 units. */
export interface PillBadge {
    kind: 'pill';
    text: string;
    tone: 'neutral' | 'good' | 'warning' | 'bad';
    tooltipMarkdown: string;
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** True when every id is a registered command (editor API or another plugin). */
    async hasCommands(ids: readonly string[]): Promise<boolean> {
        const registered = new Set(await this.listCommands());
        return ids.every(id => registered.has(id));
    }

    supported(): Promise<boolean> {
        return this.hasCommands(REQUIRED_COMMANDS);
    }

    renderReport(args: { uri: string; template: string; scale: number }): Promise<PluginReportResult> {
        return this.call(Commands.RENDER_REPORT, args);
    }

    parsePantry(text: string): Promise<PantryContents> {
        return this.call(Commands.PARSE_PANTRY, { text });
    }

    /** Accepts a workspace-relative path or a `file://` URI inside the workspace; rejects when the recipe is missing. */
    resolveRecipeReferences(path: string): Promise<ResolvedRecipeReference[]> {
        return this.call(Commands.RESOLVE_RECIPE_REFERENCES, { path });
    }

    async openPreview(uri: string): Promise<void> {
        await this.call(Commands.OPEN_PREVIEW, { uri });
    }

    /** Asks open previews to re-query badges. False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.hasCommands([Commands.REFRESH_BADGES]))) {
            return false;
        }
        await this.call(Commands.REFRESH_BADGES);
        return true;
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}

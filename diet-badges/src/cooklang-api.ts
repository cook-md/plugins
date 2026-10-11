// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/plugin-report-types.ts`
// and `cooklang-outlet-context.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;
export const REPORT_COMMANDS = ['cooklang.api.hasFeature', 'cooklang.api.renderReport'] as const;
/** Added after `renderReport`; older editors refresh badges on the next edit instead. */
export const REFRESH_BADGES_COMMAND = 'cooklang.api.refreshBadges';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };

export interface PreviewOutletContext {
    version: 1;
    uri: string;
    path: string;
    scale: number;
}

/** The subset of the editor's `PreviewBadge` this plugin returns. `text` is at most 24 UTF-16 units. */
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

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    async supportsReports(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return REPORT_COMMANDS.every(command => commands.has(command));
    }

    hasFeature(name: string): Promise<boolean> {
        return this.call('cooklang.api.hasFeature', { name });
    }

    renderReport(args: { uri: string; template: string; scale: number }): Promise<PluginReportResult> {
        return this.call('cooklang.api.renderReport', args);
    }

    /** Asks open previews to re-query badges. False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.listCommands()).includes(REFRESH_BADGES_COMMAND)) {
            return false;
        }
        await this.call(REFRESH_BADGES_COMMAND);
        return true;
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}

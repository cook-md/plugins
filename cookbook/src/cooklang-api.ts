// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/plugin-report-types.ts`
// and `common/recipe-images.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand` and
// `vscode.commands.getCommands`.

/**
 * Every command the cookbook export needs. `exportPdf` and `recipeImages` were
 * added after `renderReport`; the editor feature-detects by command presence
 * (`cooklang.api.version` stays 1), so this plugin does too.
 */
export const REQUIRED_COMMANDS = [
    'cooklang.api.renderReport',
    'cooklang.api.hasFeature',
    'cooklang.api.exportPdf',
    'cooklang.api.recipeImages',
] as const;

export type PageSize = 'A4' | 'Letter';

export type PluginReportFailureReason = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: PluginReportFailureReason; message: string };

/**
 * Photos for one recipe: absolute URIs (or verbatim `http(s)` URLs from metadata).
 * `steps` is section index → step index → URI, both zero-based and counting only
 * steps (not text blocks), with section `0` also holding the linear `Recipe.N.jpg`
 * form; see {@link lookupStepImage} in `images.ts`.
 */
export interface RecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

export interface ExportPdfArgs {
    html: string;
    defaultFileName: string;
    pageSize: PageSize;
}

export interface ExportPdfResult {
    saved: boolean;
    path?: string;
    error?: string;
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

const FAILURE_REASONS: readonly PluginReportFailureReason[] = ['unauthenticated', 'forbidden', 'network', 'server', 'template'];

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** The required commands this editor lacks; empty when the cookbook export can run. */
    async missingCommands(): Promise<string[]> {
        const available = new Set(await this.listCommands());
        return REQUIRED_COMMANDS.filter(command => !available.has(command));
    }

    /** False on any error: signed out, offline, or an editor without the command. */
    async hasFeature(name: string): Promise<boolean> {
        try {
            return await this.execute('cooklang.api.hasFeature', { name }) === true;
        } catch {
            return false;
        }
    }

    /** Throws `Invalid arguments: …` like the editor does; render failures resolve to `ok: false`. */
    async renderReport(args: { uri: string; template: string }): Promise<PluginReportResult> {
        const result = await this.execute('cooklang.api.renderReport', { uri: args.uri, template: args.template, scale: 1 });
        if (isRecord(result) && result.ok === true && typeof result.output === 'string') {
            return { ok: true, output: result.output };
        }
        if (isRecord(result) && result.ok === false) {
            const reason = FAILURE_REASONS.find(candidate => candidate === result.reason) ?? 'template';
            const message = typeof result.message === 'string' && result.message !== '' ? result.message : 'The report engine failed.';
            return { ok: false, reason, message };
        }
        return { ok: false, reason: 'template', message: 'Unexpected response from cooklang.api.renderReport.' };
    }

    /** Malformed entries are dropped, so a bad payload means "no photos", never a crash. */
    async recipeImages(uri: string): Promise<RecipeImages> {
        return parseRecipeImages(await this.execute('cooklang.api.recipeImages', { uri }));
    }

    /**
     * The editor renders `html` in a hidden window, shows the save dialog and writes the PDF.
     * `filePath` is accepted as an alias of `path` (the name `ReportExportService` uses).
     */
    async exportPdf(args: ExportPdfArgs): Promise<ExportPdfResult> {
        const result = await this.execute('cooklang.api.exportPdf', args);
        if (!isRecord(result)) {
            return { saved: false, error: 'Unexpected response from cooklang.api.exportPdf.' };
        }
        const path = typeof result.path === 'string' ? result.path : typeof result.filePath === 'string' ? result.filePath : undefined;
        const error = typeof result.error === 'string' && result.error !== '' ? result.error : undefined;
        return { saved: result.saved === true, ...(path !== undefined ? { path } : {}), ...(error !== undefined ? { error } : {}) };
    }
}

export function parseRecipeImages(value: unknown): RecipeImages {
    const images: RecipeImages = { steps: {} };
    if (!isRecord(value)) {
        return images;
    }
    if (typeof value.title === 'string' && value.title.trim() !== '') {
        images.title = value.title;
    }
    if (isRecord(value.steps)) {
        for (const [section, steps] of Object.entries(value.steps)) {
            if (!/^\d+$/.test(section) || !isRecord(steps)) {
                continue;
            }
            for (const [step, uri] of Object.entries(steps)) {
                if (/^\d+$/.test(step) && typeof uri === 'string' && uri.trim() !== '') {
                    (images.steps[section] ??= {})[step] = uri;
                }
            }
        }
    }
    return images;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { badgeFor, lockedBadge, serviceErrorBadge } from './badge';
import { CooklangApi, PillBadge, PreviewOutletContext } from './cooklang-api';
import { computeMacros, normaliseScale } from './macros';
import { MACROS_TEMPLATE, MacrosOutput, parseMacrosOutput } from './nutrition-template';
import { parseServings } from './servings';
import { MacrosSettings } from './settings';

/** Reads a document's current text (unsaved edits included); undefined when it cannot be read. */
export type ReadText = (uri: string) => Promise<string | undefined>;

/** Whether a value is the version 1 context the editor passes to badge outlet commands. */
export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Whether a URI string names a `.menu` plan (the badge outlets pass no other hint). */
export function isMenuUri(uri: string): boolean {
    return /\.menu$/i.test(uri.replace(/[?#].*$/, ''));
}

/** Backs `cooklang.macros.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class MacrosBadgeProvider {

    static readonly CACHE_SIZE = 20;

    protected readonly logged = new Set<string>();
    /**
     * Validated recipe outputs keyed by `[uri, scale, text]`, least recently used first, so a
     * settings change (energy on/off, basis) or a repeated refresh re-uses the last render instead
     * of another round trip. Plans are not cached here: their totals also depend on the recipes they
     * reference, which the menu text does not capture.
     */
    protected readonly cache = new Map<string, MacrosOutput>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => MacrosSettings,
        protected readonly readText: ReadText,
    ) { }

    /** The badge for a preview context, or undefined for no badge. */
    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same one the
        // nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return lockedBadge(settings.showWhenLocked);
        }
        const isMenu = isMenuUri(context.uri);
        // The engine expands a menu's recipes at 1× whatever the menu scale, and per-person-per-day
        // figures do not depend on it; a recipe is rendered at the preview scale.
        const scale = isMenu ? 1 : normaliseScale(context.scale);
        let servings: number | undefined;
        let cacheKey: string | undefined;
        if (!isMenu) {
            const text = await this.readText(context.uri);
            if (text === undefined) {
                this.logOnce('read', 'could not read the recipe text; showing the whole recipe');
            } else {
                servings = parseServings(text);
                cacheKey = JSON.stringify([context.uri, scale, text]);
            }
        }
        let output = cacheKey === undefined ? undefined : this.recall(cacheKey);
        if (!output) {
            const result = await this.api.renderReport({ uri: context.uri, template: MACROS_TEMPLATE, scale });
            if (!result.ok) {
                this.logOnce(result.reason, result.message);
                // The cached subscription said yes but the service disagreed (expired sign-in, lapsed plan).
                if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                    return lockedBadge(settings.showWhenLocked);
                }
                // A template error is this plugin's bug, not something the user can act on: no pill.
                return result.reason === 'template' ? undefined : serviceErrorBadge(result.reason, result.message);
            }
            output = parseMacrosOutput(result.output);
            if (!output || output.kind !== (isMenu ? 'plan' : 'recipe')) {
                this.logOnce('output', 'unexpected template output');
                return undefined;
            }
            if (cacheKey !== undefined) {
                this.remember(cacheKey, output);
            }
        }
        // A badge is about to be shown: earlier failures are superseded. An unreadable document is
        // a standing condition, not a failure the success supersedes.
        const readFailed = this.logged.has('read');
        this.logged.clear();
        if (readFailed) {
            this.logged.add('read');
        }
        return badgeFor(computeMacros(output, { basis: settings.basis, servings, scale }), settings.showEnergy);
    }

    /** Forgets every cached render, e.g. after the nutrition service URL changed. */
    clearCache(): void {
        this.cache.clear();
    }

    protected recall(key: string): MacrosOutput | undefined {
        const output = this.cache.get(key);
        if (output) {
            this.cache.delete(key);
            this.cache.set(key, output);
        }
        return output;
    }

    protected remember(key: string, output: MacrosOutput): void {
        this.cache.set(key, output);
        if (this.cache.size > MacrosBadgeProvider.CACHE_SIZE) {
            this.cache.delete(this.cache.keys().next().value as string);
        }
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Macros unavailable (${reason}): ${message}`);
        }
    }
}

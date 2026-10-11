import { dietBadge, lockedBadge, unreachableBadge } from './badge';
import { CooklangApi, PillBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { DIET_TEMPLATE, DietOutput, parseDietOutput } from './diet-template';
import { evaluateDiets } from './rules';
import { DietSettings, isInactive } from './settings';

/** Badges remembered per open recipe version; oldest dropped first. */
export const CACHE_SIZE = 50;

/** Version of the open text document at `uri`, or undefined when it isn't open. */
export type DocumentVersion = (uri: string) => number | undefined;

type FailedResult = Extract<PluginReportResult, { ok: false }>;

/** Whether a URI string names a `.menu` plan (the badge outlets pass no other hint). */
export function isMenuUri(uri: string): boolean {
    return /\.menu$/i.test(uri.replace(/[?#].*$/, ''));
}

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

function isEmpty(output: DietOutput): boolean {
    return output.names.length === 0 && output.refs.length === 0 && output.missing.length === 0;
}

/** Backs `cooklang.dietBadges.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class DietBadgeProvider {

    protected readonly logged = new Set<string>();
    protected readonly cache = new Map<string, { badge: PillBadge | undefined }>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => DietSettings,
        protected readonly documentVersion: DocumentVersion = () => undefined,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        if (isInactive(settings)) {
            return undefined;
        }
        // Asked every time, before the cache: signing out or a lapsed plan must lock a cached badge.
        if (!(await this.api.hasFeature('nutrition_api'))) {
            return this.locked(settings);
        }
        const key = this.cacheKey(context.uri, settings);
        const hit = key === undefined ? undefined : this.cache.get(key);
        if (hit) {
            return hit.badge;
        }
        // Diets don't depend on scale; a fixed scale keeps the editor's render cache warm.
        const result = await this.api.renderReport({ uri: context.uri, template: DIET_TEMPLATE, scale: 1 });
        if (!result.ok) {
            return this.failed(result, settings);
        }
        const output = parseDietOutput(result.output);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        this.logged.clear();
        const badge = isEmpty(output) ? undefined : dietBadge(evaluateDiets(output, settings.extraNonVegan), settings.diets);
        if (key !== undefined) {
            this.remember(key, badge);
        }
        return badge;
    }

    protected failed(result: FailedResult, settings: DietSettings): PillBadge | undefined {
        this.logOnce(result.reason, result.message);
        switch (result.reason) {
            case 'unauthenticated':
            case 'forbidden':
                // The cached plan said yes but the service disagreed (expired sign-in, lapsed plan).
                return this.locked(settings);
            case 'network':
            case 'server':
                return unreachableBadge();
            default:
                return undefined;
        }
    }

    protected locked(settings: DietSettings): PillBadge | undefined {
        return settings.showWhenLocked ? lockedBadge() : undefined;
    }

    /**
     * Only open recipes are cached: a menu's verdict depends on the recipes it references,
     * whose edits don't change the menu's version.
     */
    protected cacheKey(uri: string, settings: DietSettings): string | undefined {
        if (isMenuUri(uri)) {
            return undefined;
        }
        const version = this.documentVersion(uri);
        return version === undefined ? undefined : JSON.stringify([uri, version, settings]);
    }

    protected remember(key: string, badge: PillBadge | undefined): void {
        this.cache.delete(key);
        this.cache.set(key, { badge });
        if (this.cache.size > CACHE_SIZE) {
            this.cache.delete(this.cache.keys().next().value as string);
        }
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Diet badges unavailable (${reason}): ${message}`);
        }
    }
}

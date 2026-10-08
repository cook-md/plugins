import { UNAVAILABLE_BADGE, badgeFor, lockedBadge } from './badge';
import { buildCheckSpec } from './check-spec';
import { CooklangApi, PillBadge, PreviewOutletContext } from './cooklang-api';
import { parseServings } from './servings';
import { CoreVitalsSettings } from './settings';
import { evaluate } from './verdict';
import { buildTemplate, parseVitalsOutput } from './vitals-template';

/** Reads a document's current text (unsaved edits included); undefined when it cannot be read. */
export type ReadText = (uri: string) => Promise<string | undefined>;

/** The context the editor passes to badge outlet commands (version 1). */
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

/** Backs `cooklang.corevitals.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class CoreVitalsBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => CoreVitalsSettings,
        protected readonly readText: ReadText,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same
        // one the nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return lockedBadge(settings.showWhenLocked);
        }
        const isMenu = isMenuUri(context.uri);
        const parsedServings = isMenu ? undefined : parseServings(await this.readText(context.uri) ?? '');
        const template = buildTemplate(buildCheckSpec(settings, parsedServings ?? 1), 'json');
        // Per-person results do not depend on the preview scale, so scale 1 keeps the cache warm.
        const result = await this.api.renderReport({ uri: context.uri, template, scale: 1 });
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            // The cached subscription said yes but the service disagreed (expired sign-in, lapsed plan).
            if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                return lockedBadge(settings.showWhenLocked);
            }
            return undefined;
        }
        const output = parseVitalsOutput(result.output);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return UNAVAILABLE_BADGE;
        }
        // A badge is about to be shown: any earlier failure has been superseded.
        this.logged.clear();
        return badgeFor(evaluate(output, { mealsPerDay: settings.mealsPerDay, servingsKnown: isMenu || parsedServings !== undefined }));
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Core Vitals unavailable (${reason}): ${message}`);
        }
    }
}

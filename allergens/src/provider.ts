import { NAMES_TEMPLATE, STANDARD_TEMPLATE, parseAllergenOutput } from './allergen-template';
import { CooklangApi, PillBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { badgeFor, findAllergens } from './evaluate';
import { AllergenSettings, isInactive } from './settings';

const NO_FINDINGS = { pillLabels: [], lines: [], unknown: [] };

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Backs `cooklang.allergens.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class AllergenBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => AllergenSettings,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        if (isInactive(settings)) {
            return undefined;
        }
        const wantsStandard = settings.classes.length > 0;
        // Only ask about the plan when a standard class is ticked: custom words are free.
        let standard = wantsStandard && await this.api.hasFeature('nutrition_api');
        if (wantsStandard && !standard && settings.customWords.length === 0) {
            return badgeFor(NO_FINDINGS, true, settings.showWhenLocked);
        }
        let result = await this.render(context, standard);
        if (!result.ok && standard && (result.reason === 'unauthenticated' || result.reason === 'forbidden')) {
            // The cached plan said yes but the service disagreed (expired sign-in, lapsed plan).
            this.logOnce(result.reason, result.message);
            standard = false;
            if (settings.customWords.length === 0) {
                return badgeFor(NO_FINDINGS, true, settings.showWhenLocked);
            }
            result = await this.render(context, false);
        }
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            return undefined;
        }
        const output = parseAllergenOutput(result.output, standard);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        // A badge is about to be computed: earlier failures are superseded.
        this.logged.clear();
        const findings = findAllergens(standard ? settings.classes : [], settings.customWords, output);
        return badgeFor(findings, wantsStandard && !standard, settings.showWhenLocked);
    }

    protected render(context: PreviewOutletContext, standard: boolean): Promise<PluginReportResult> {
        return this.api.renderReport({ uri: context.uri, template: standard ? STANDARD_TEMPLATE : NAMES_TEMPLATE, scale: context.scale });
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Allergens unavailable (${reason}): ${message}`);
        }
    }
}

import { AllergenOutput, NAMES_TEMPLATE, STANDARD_TEMPLATE, parseAllergenOutput } from './allergen-template';
import { CooklangApi, PillBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { badgeFor, findAllergens } from './evaluate';
import { AllergenFindings } from './hover';
import { AllergenSettings, isInactive } from './settings';

const NO_FINDINGS: AllergenFindings = { pillLabels: [], lines: [], unknown: [], standardUnchecked: false };

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
        const hasCustomWords = settings.customWords.length > 0;
        // Only ask about the plan when a standard class is ticked: custom words are free.
        let standard = wantsStandard && await this.api.hasFeature('nutrition_api');
        if (wantsStandard && !standard && !hasCustomWords) {
            return badgeFor(NO_FINDINGS, true, settings.showWhenLocked);
        }
        let locked = wantsStandard && !standard;
        let standardUnchecked = false;
        let result = await this.render(context, standard);
        let output = this.parse(result, standard);
        // Clearing the log is only safe when nothing went wrong on the way to the badge.
        const failed = output === undefined;
        if (!output && standard) {
            standard = false;
            if (!result.ok && (result.reason === 'unauthenticated' || result.reason === 'forbidden')) {
                // The cached plan said yes but the service disagreed (expired sign-in, lapsed plan).
                locked = true;
            } else {
                // Unreachable or broken: the standard classes are unchecked, which must never read as "none found".
                standardUnchecked = true;
            }
            if (!hasCustomWords) {
                return badgeFor({ ...NO_FINDINGS, standardUnchecked }, locked, settings.showWhenLocked);
            }
            result = await this.render(context, false);
            output = this.parse(result, false);
        }
        if (!output) {
            // The names-only render failed too: keep what is known about the standard classes
            // (unchecked or locked) rather than dropping the badge.
            return wantsStandard ? badgeFor({ ...NO_FINDINGS, standardUnchecked }, locked, settings.showWhenLocked) : undefined;
        }
        if (!failed) {
            this.logged.clear();
        }
        const findings = findAllergens(standard ? settings.classes : [], settings.customWords, output);
        return badgeFor({ ...findings, standardUnchecked }, locked, settings.showWhenLocked);
    }

    /** Parses a render result, logging (once per reason) why it's unusable. */
    protected parse(result: PluginReportResult, standard: boolean): AllergenOutput | undefined {
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            return undefined;
        }
        const output = parseAllergenOutput(result.output, standard);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
        }
        return output;
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

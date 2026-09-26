import { CooklangApi, NutriScoreBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { LOCKED_TOOLTIP } from './locked';
import { toPer100g } from './nutrition-input';
import { nutritionTemplate, parseNutritionOutput } from './nutrition-template';
import { nutriScore } from './nutriscore';
import { summarizeTrust, tooltipMarkdown } from './trust';

/** Category slugs of the nutrition service that count toward the fruit/vegetable/legume share. */
export const FVL_CATEGORIES = ['fruits', 'vegetables', 'legumes'];

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Backs `cooklang.nutriscore.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class NutriScoreBadgeProvider {

    protected readonly logged = new Set<string>();
    /**
     * Undefined until the first category-aware render either succeeds or fails with
     * "category not found". Once false, later calls skip straight to the no-categories
     * template instead of paying for a retry every time.
     */
    protected categoriesSupported: boolean | undefined;

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly showWhenLocked: () => boolean = () => true,
    ) { }

    async provide(context: unknown): Promise<NutriScoreBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same
        // one the nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return this.lockedBadge();
        }
        let categories: readonly string[] = this.categoriesSupported === false ? [] : FVL_CATEGORIES;
        let result = await this.render(context, categories);
        if (!result.ok && result.reason === 'template' && /category not found/i.test(result.message)) {
            this.categoriesSupported = false;
            categories = [];
            result = await this.render(context, categories);
        } else if (result.ok && categories.length > 0) {
            this.categoriesSupported = true;
        }
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            // The cached subscription said this recipe should get nutrition data, but the
            // service disagreed (e.g. the plan lapsed or the sign-in expired): treat it the
            // same as the feature being off rather than silently dropping the badge.
            if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                return this.lockedBadge();
            }
            return undefined;
        }
        const data = parseNutritionOutput(result.output, categories.length > 0);
        if (!data) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        const summary = summarizeTrust(data.aggregate);
        const per100g = toPer100g(data.aggregate, data.categoryMassG);
        const fvlPercent = data.categoryMassG === undefined ? undefined : per100g?.fvlPercent;
        const score = per100g && summary.reliable ? nutriScore(per100g) : undefined;
        // A badge is about to be shown: any earlier failure has been superseded, so let a
        // later recurrence of the same (or any) failure reason log again.
        this.logged.clear();
        return {
            kind: 'nutriscore',
            grade: score ? score.grade : 'unknown',
            tooltipMarkdown: tooltipMarkdown(score, summary, fvlPercent),
        };
    }

    protected render(context: PreviewOutletContext, categories: readonly string[]): Promise<PluginReportResult> {
        return this.api.renderReport({ uri: context.uri, template: nutritionTemplate(categories), scale: context.scale });
    }

    /** Greyed badge with an upgrade hint, or undefined if the user disabled it via `nutriscore.showWhenLocked`. */
    protected lockedBadge(): NutriScoreBadge | undefined {
        return this.showWhenLocked()
            ? { kind: 'nutriscore', grade: 'unknown', tooltipMarkdown: LOCKED_TOOLTIP }
            : undefined;
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Nutri-Score unavailable (${reason}): ${message}`);
        }
    }
}

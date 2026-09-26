import { CooklangApi, NutriScoreBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { toPer100g } from './nutrition-input';
import { nutritionTemplate, parseNutritionOutput } from './nutrition-template';
import { nutriScore } from './nutriscore';
import { summarizeTrust, tooltipMarkdown } from './trust';

/** Category slugs of the nutrition service that count toward the fruit/vegetable/legume share. */
export const FVL_CATEGORIES = ['fruits', 'vegetables', 'legumes'];

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && typeof context.uri === 'string' && typeof context.scale === 'number';
}

/** Backs `cooklang.nutriscore.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class NutriScoreBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) { }

    async provide(context: unknown): Promise<NutriScoreBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same
        // one the nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return undefined;
        }
        let categories: readonly string[] = FVL_CATEGORIES;
        let result = await this.render(context, categories);
        if (!result.ok && result.reason === 'template' && /category not found/i.test(result.message)) {
            categories = [];
            result = await this.render(context, categories);
        }
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
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
        return {
            kind: 'nutriscore',
            grade: score ? score.grade : 'unknown',
            tooltipMarkdown: tooltipMarkdown(score, summary, fvlPercent),
        };
    }

    protected render(context: PreviewOutletContext, categories: readonly string[]): Promise<PluginReportResult> {
        return this.api.renderReport({ uri: context.uri, template: nutritionTemplate(categories), scale: context.scale });
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Nutri-Score unavailable (${reason}): ${message}`);
        }
    }
}

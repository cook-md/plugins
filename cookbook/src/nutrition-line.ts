// The optional "Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat" line,
// from the Reports engine's `aggregate_nutrition` (cook.md nutrition service; needs
// the `nutrition_api` feature). Same `/aggregate` shape the nutriscore plugin reads.
import { isRecord } from './cooklang-api';

export const NUTRITION_TEMPLATE = '{{ aggregate_nutrition(ingredients) | tojson }}';

/** Below this share of matched ingredients the totals undercount too much to print. */
export const MIN_MATCH_RATIO = 0.7;

export const MAX_SERVINGS = 1000;

export interface NutritionSummary {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    /** Ingredients the service resolved (placeholders excluded). */
    matched: number;
    /** Every ingredient sent: resolved, placeholders and failures. */
    total: number;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** The service returns unresolved ingredients as items tagged `nutrition_placeholder`. */
function isPlaceholder(item: unknown): boolean {
    return isRecord(item) && Array.isArray(item.warnings) && item.warnings.some(warning =>
        warning === 'nutrition_placeholder' || (isRecord(warning) && warning.code === 'nutrition_placeholder'));
}

export function parseNutritionOutput(output: string): NutritionSummary | undefined {
    let value: unknown;
    try {
        value = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.failures) || !isRecord(value.totals)) {
        return undefined;
    }
    const macros = value.totals.macros;
    if (!isRecord(macros) || !finite(macros.kcal) || !finite(macros.protein_g) || !finite(macros.carb_g) || !finite(macros.fat_g)) {
        return undefined;
    }
    const placeholders = value.items.filter(isPlaceholder).length;
    return {
        kcal: macros.kcal,
        protein_g: macros.protein_g,
        carb_g: macros.carb_g,
        fat_g: macros.fat_g,
        matched: value.items.length - placeholders,
        total: value.items.length + value.failures.length,
    };
}

/** `servings`, `serves` or `yield` metadata (any case) as a whole number 1–1000: `4`, `"4"`, `"4 people"`. */
export function servingsFromMetadata(metadata: Record<string, unknown>): number | undefined {
    for (const [key, value] of Object.entries(metadata)) {
        if (!/^(servings|serves|yield)$/.test(key.toLowerCase().replace(/[_-]/g, ' ').trim())) {
            continue;
        }
        const match = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
        const leading = /^(\d+)/.exec(match);
        if (!leading) {
            continue;
        }
        const servings = Number.parseInt(leading[1], 10);
        return servings >= 1 && servings <= MAX_SERVINGS ? servings : undefined;
    }
    return undefined;
}

/** Undefined when nothing matched or under {@link MIN_MATCH_RATIO} of the ingredients matched. */
export function nutritionLine(summary: NutritionSummary, servings: number | undefined): string | undefined {
    if (summary.total === 0 || summary.matched / summary.total < MIN_MATCH_RATIO) {
        return undefined;
    }
    const divisor = servings ?? 1;
    const round = (value: number): number => Math.round(value / divisor);
    const label = servings === undefined ? 'Whole recipe' : 'Per serving';
    return `${label}: ${round(summary.kcal)} kcal · ${round(summary.protein_g)} g protein · ${round(summary.carb_g)} g carbs · ${round(summary.fat_g)} g fat`;
}

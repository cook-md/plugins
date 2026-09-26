import { NutritionAggregate } from './nutrition-template';
import { NutriScoreResult } from './nutriscore';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface TrustSummary {
    level: ConfidenceLevel;
    matched: number;
    total: number;
    unmatched: string[];
    /** Only items with confidence `estimated` -- `partial` items are counted separately, see `partial`. */
    estimated: Array<{ name: string; confidence: string }>;
    /** Count of items with confidence `partial`. The live service marks most matches 'partial' just
     * because no preparation was given, so listing every ingredient by name would be noise. */
    partial: number;
    sources: Array<{ source: string; count: number }>;
    /** At most 30 % of the ingredients unmatched. */
    reliable: boolean;
    /** The service could weigh the recipe. */
    weighed: boolean;
}

const CONFIDENCE_WEIGHT: Record<string, number> = { confirmed: 1, partial: 0.6, estimated: 0.3 };
export const MIN_MATCHED_SHARE = 0.7;

const SOURCE_LABELS: Record<string, string> = {
    usda_foundation: 'USDA Foundation',
    usda_sr_legacy: 'USDA SR Legacy',
    usda_fndds: 'USDA FNDDS',
    usda: 'USDA',
    off: 'Open Food Facts',
};

/** Formats a raw `source` value (e.g. `usda_foundation`) into a display label. */
export function formatSource(source: string): string {
    const known = SOURCE_LABELS[source];
    if (known) {
        return known;
    }
    const spaced = source.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Groups items by their raw `source` value, folding a missing/non-string/empty source into `unknown`. */
function sourceKey(source: string): string {
    return typeof source === 'string' && source.length > 0 ? source : 'unknown';
}

export function summarizeTrust(aggregate: NutritionAggregate): TrustSummary {
    const items = aggregate.items;
    const mass = items.reduce((sum, item) => sum + item.amount.mass_g, 0);
    const weighted = mass > 0
        ? items.reduce((sum, item) => sum + item.amount.mass_g * (CONFIDENCE_WEIGHT[item.confidence] ?? 0.3), 0) / mass
        : 0;
    const level: ConfidenceLevel = weighted >= 0.8 ? 'High' : weighted >= 0.5 ? 'Medium' : 'Low';
    const sources = new Map<string, number>();
    for (const item of items) {
        const key = sourceKey(item.source);
        sources.set(key, (sources.get(key) ?? 0) + 1);
    }
    // The validator only guarantees `ingredient` and `amount.mass_g`; only the arrays it produced are
    // trustworthy for counts, never `totals.included_count`/`failed_count`, which are passed through
    // verbatim from the service and may diverge from what the validator kept.
    const matched = items.length;
    const total = matched + aggregate.failures.length;
    return {
        level,
        matched,
        total,
        unmatched: aggregate.failures.map(failure => failure.ingredient),
        estimated: items.filter(item => item.confidence === 'estimated').map(item => ({ name: item.ingredient, confidence: item.confidence })),
        partial: items.filter(item => item.confidence === 'partial').length,
        sources: [...sources].map(([source, count]) => ({ source, count })),
        reliable: total > 0 && matched / total >= MIN_MATCHED_SHARE,
        weighed: aggregate.totals.mass_g > 0,
    };
}

export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, character => `\\${character}`);
}

/** `score` undefined means no grade (unreliable or not weighed). `fvlPercent` undefined means unknown. */
export function tooltipMarkdown(score: NutriScoreResult | undefined, summary: TrustSummary, fvlPercent: number | undefined): string {
    const lines: string[] = [];
    if (score) {
        const unit = Math.abs(score.score) === 1 ? 'point' : 'points';
        lines.push(`**Nutri-Score ${score.grade}** · ${score.score} ${unit} (negative ${score.negative}, positive ${score.positive})`);
    } else {
        lines.push('**Nutri-Score unavailable**');
        lines.push(!summary.weighed
            ? "Ingredient weights are missing, so the score can't be computed per 100 g."
            : `Only ${summary.matched} of ${summary.total} ingredients could be matched.`);
    }
    lines.push(`Confidence: **${summary.level}**`);
    lines.push(`Matched: ${summary.matched} of ${summary.total} ingredients`);
    if (summary.unmatched.length > 0) {
        lines.push(`Not matched: ${summary.unmatched.map(escapeMarkdown).join(', ')}`);
    }
    if (summary.estimated.length > 0) {
        lines.push(`Estimated: ${summary.estimated.map(e => escapeMarkdown(e.name)).join(', ')}`);
    }
    if (summary.partial > 0) {
        lines.push(`Partial matches: ${summary.partial} (e.g. preparation not specified)`);
    }
    if (summary.sources.length > 0) {
        lines.push(`Sources: ${summary.sources.map(s => `${escapeMarkdown(formatSource(s.source))} (${s.count})`).join(', ')}`);
    }
    lines.push(fvlPercent === undefined
        ? 'Fruit/veg/legumes: unknown (counted as 0 %)'
        : `Fruit/veg/legumes: ~${Math.round(fvlPercent)} % (estimated from categories)`);
    if (score && !score.proteinCounted) {
        lines.push('Protein not counted (Nutri-Score rule for 11+ negative points).');
    }
    lines.push('_Estimate from recipe ingredients, not a certified label._');
    return lines.join('\n\n');
}

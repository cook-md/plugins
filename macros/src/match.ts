import { NutritionAggregate, isPlaceholder } from './nutrition-template';

/** At least 70 % of the ingredients (by count) must have matched the nutrition database. */
export const MIN_MATCHED_SHARE = 0.7;

export interface MatchSummary {
    matched: number;
    /** Matched + placeholders + failures. */
    total: number;
    /** Failures first, then placeholders, in service order. */
    unmatched: string[];
}

/**
 * Counts how many ingredients the service resolved. `nutrition_placeholder` items (mass 0, zero
 * macros) and `failures[]` both count as unmatched, as in Nutri-Score and Core Vitals. Only the
 * validated arrays are trusted for counts, never the service's `included_count`/`failed_count`.
 */
export function summarizeMatch(aggregate: NutritionAggregate): MatchSummary {
    const placeholders = aggregate.items.filter(isPlaceholder);
    const matched = aggregate.items.length - placeholders.length;
    const unmatched = [...aggregate.failures.map(failure => failure.ingredient), ...placeholders.map(item => item.ingredient)];
    return { matched, total: matched + unmatched.length, unmatched };
}

/** True when there is something to show and at least {@link MIN_MATCHED_SHARE} of it matched. */
export function isConfident(summary: MatchSummary): boolean {
    return summary.total > 0 && summary.matched / summary.total >= MIN_MATCHED_SHARE;
}

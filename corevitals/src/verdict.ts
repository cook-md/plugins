import { CheckKind } from './check-spec';
import { VitalsOutput, VitalsRow } from './vitals-template';

/** Why no verdict is shown: nothing evaluated, a referenced recipe missing, too few ingredients matched, or no check had a daily value. */
export type WithheldReason = 'noData' | 'unmatched' | 'missingRecipes' | 'noChecks';
/** The service's weighted confidence, bucketed. */
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

/** A check that was not met. */
export interface Shortfall {
    label: string;
    kind: CheckKind;
    /** % of target, or the share of energy for macros. */
    percent: number;
    /** Macro band, % of energy. */
    lo: number;
    hi: number;
}

/** What the provider knows that the template output does not. */
export interface VerdictContext {
    /** `coreVitals.mealsPerDay`; only meaningful for recipes. */
    mealsPerDay: number;
    /** False when the recipe had no usable `servings:` and 1 was assumed. Always true for plans. */
    servingsKnown: boolean;
}

/** What the badge and hover show, derived from the template's output. */
export interface Verdict {
    kind: 'plan' | 'recipe';
    days: number;
    people: number;
    standard: string;
    /** Meals per day the recipe is judged against (from the context). */
    mealsPerDay: number;
    /** Whether the recipe's servings were known (from the context). */
    servingsKnown: boolean;
    /** Set when the data does not support a verdict; the counts are still filled in. */
    withheld?: WithheldReason;
    met: number;
    counted: number;
    below: Shortfall[];
    over: Shortfall[];
    /** Labels of checks without a daily value. */
    skipped: string[];
    matched: number;
    total: number;
    unmatched: string[];
    missingRecipes: string[];
    confidence: ConfidenceLevel;
}

/** At least 70 % of the ingredients must have matched the nutrition database. */
export const MIN_MATCHED_SHARE = 0.7;

/** Buckets the service's confidence string into High / Medium / Low. */
function confidenceLevel(confidence: string): ConfidenceLevel {
    switch (confidence) {
        case 'confirmed': return 'High';
        case 'partial': return 'Medium';
        default: return 'Low';
    }
}

/** Whether an unmet check fell short (below) or overshot (over). */
function isBelow(row: VitalsRow): boolean {
    switch (row.kind) {
        case 'min': return true;
        case 'max': return false;
        case 'energy': return row.percent < 100;
        case 'macroPercent': return row.actual < row.lo;
        default: {
            const never: never = row.kind;
            return never;
        }
    }
}

/** The part of an unmet row the badge and hover need. */
function shortfall(row: VitalsRow): Shortfall {
    return { label: row.label, kind: row.kind, percent: row.percent, lo: row.lo, hi: row.hi };
}

/** Judges a validated template output; the badge and hover are built from the result. */
export function evaluate(output: VitalsOutput, context: VerdictContext): Verdict {
    const counted = output.rows.filter(row => !row.skipped);
    const unmet = counted.filter(row => !row.ok);
    let withheld: WithheldReason | undefined;
    if (output.total === 0) {
        withheld = 'noData';
    } else if (output.missingRecipes.length > 0) {
        withheld = 'missingRecipes';
    } else if (output.matched / output.total < MIN_MATCHED_SHARE) {
        withheld = 'unmatched';
    } else if (counted.length === 0) {
        withheld = 'noChecks';
    }
    return {
        kind: output.kind,
        days: output.days,
        people: output.people,
        standard: output.standard,
        mealsPerDay: context.mealsPerDay,
        servingsKnown: context.servingsKnown,
        withheld,
        met: counted.filter(row => row.ok).length,
        counted: counted.length,
        below: unmet.filter(isBelow).map(shortfall),
        over: unmet.filter(row => !isBelow(row)).map(shortfall),
        skipped: output.rows.filter(row => row.skipped).map(row => row.label),
        matched: output.matched,
        total: output.total,
        unmatched: output.unmatched,
        missingRecipes: output.missingRecipes,
        confidence: confidenceLevel(output.confidence),
    };
}

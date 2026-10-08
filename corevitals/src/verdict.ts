import { CheckKind } from './check-spec';
import { VitalsOutput, VitalsRow } from './vitals-template';

export type WithheldReason = 'noData' | 'unmatched' | 'missingRecipes' | 'noChecks';
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

/** What the badge and hover show, derived from the template's output. */
export interface Verdict {
    kind: 'plan' | 'recipe';
    days: number;
    people: number;
    standard: string;
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
    }
}

function shortfall(row: VitalsRow): Shortfall {
    return { label: row.label, kind: row.kind, percent: row.percent, lo: row.lo, hi: row.hi };
}

/** Judges a validated template output; the badge and hover are built from the result. */
export function evaluate(output: VitalsOutput): Verdict {
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

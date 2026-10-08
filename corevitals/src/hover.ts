import { escapeMarkdown, formatNames, truncateName } from './markdown';
import { Shortfall, Verdict, WithheldReason } from './verdict';

/** The editor truncates `tooltipMarkdown` at 4000 characters; stay clear of it. */
export const MAX_HOVER_LENGTH = 3900;
/** Shortfalls listed per line before "and N more". */
const MAX_SHORTFALLS = 8;

/** Tooltip of the greyed "🔒 Vitals" pill. */
export const LOCKED_TOOLTIP = `**Core Vitals** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to check your plans and recipes against daily nutrient targets.

[See plans](https://cook.md/pricing)`;

/** Tooltip when the template answered with something the plugin could not read. */
export const UNAVAILABLE_TOOLTIP = `**Core Vitals** · unavailable

The nutrition report could not be read. See the Core Vitals output channel for details.`;

const MEAL_FRACTIONS: Readonly<Record<number, string>> = { 1: '1', 2: '½', 3: '⅓', 4: '¼', 5: '⅕', 6: '⅙', 8: '⅛' };

function mealFraction(mealsPerDay: number): string {
    return MEAL_FRACTIONS[mealsPerDay] ?? `1/${mealsPerDay}`;
}

function periodLine(verdict: Verdict): string {
    const standard = `${verdict.standard.toUpperCase()} daily values`;
    if (verdict.kind === 'plan') {
        const days = `${verdict.days} day${verdict.days === 1 ? '' : 's'}`;
        const people = `${verdict.people} ${verdict.people === 1 ? 'person' : 'people'}`;
        return `${days} · ${people} · ${standard}`;
    }
    const serving = verdict.servingsKnown
        ? `Per serving (${verdict.people} serving${verdict.people === 1 ? '' : 's'})`
        : 'Whole recipe (no servings in frontmatter)';
    return `${serving} · one meal = ${mealFraction(verdict.mealsPerDay)} of a day · ${standard}`;
}

function formatShortfall(entry: Shortfall): string {
    const label = escapeMarkdown(truncateName(entry.label));
    const percent = Math.round(entry.percent);
    if (entry.kind === 'macroPercent') {
        return `${label} ${percent} % of energy (${Math.round(entry.lo)}–${Math.round(entry.hi)})`;
    }
    return `${label} ${percent} %`;
}

function formatShortfalls(entries: readonly Shortfall[]): string {
    const shown = entries.slice(0, MAX_SHORTFALLS).map(formatShortfall);
    if (entries.length > MAX_SHORTFALLS) {
        shown.push(`and ${entries.length - MAX_SHORTFALLS} more`);
    }
    return shown.join(', ');
}

function withheldLine(verdict: Verdict, reason: WithheldReason): string {
    switch (reason) {
        case 'unmatched': return `Only ${verdict.matched} of ${verdict.total} ingredients matched the nutrition database.`;
        case 'missingRecipes': return `Missing recipes: ${formatNames(verdict.missingRecipes)}`;
        case 'noData': return verdict.kind === 'plan' ? 'This plan has no recipes that could be evaluated.' : 'This recipe has no ingredients that could be evaluated.';
        case 'noChecks': return 'No daily values for the chosen checks in this standard.';
        default: {
            const never: never = reason;
            return never;
        }
    }
}

/**
 * Title, period, shortfalls (or why the verdict was withheld), skipped keys,
 * data line. Untrusted names are escaped and capped; the whole text stays
 * under {@link MAX_HOVER_LENGTH}.
 */
export function hoverMarkdown(verdict: Verdict): string {
    const blocks: string[] = [];
    if (verdict.withheld) {
        blocks.push('**Core Vitals** · not enough data', periodLine(verdict), withheldLine(verdict, verdict.withheld));
    } else {
        blocks.push(`**Core Vitals** · ${verdict.met} of ${verdict.counted} targets met`, periodLine(verdict));
        if (verdict.below.length > 0) {
            blocks.push(`Below target: ${formatShortfalls(verdict.below)}`);
        }
        if (verdict.over.length > 0) {
            blocks.push(`Over limit: ${formatShortfalls(verdict.over)}`);
        }
    }
    if (verdict.skipped.length > 0) {
        blocks.push(`No daily value for: ${formatNames(verdict.skipped)}`);
    }
    blocks.push(`${verdict.matched} of ${verdict.total} ingredients matched (${verdict.confidence} confidence). Open the Core Vitals report for the full breakdown.`);
    const markdown = blocks.join('\n\n');
    // Last-resort guard: every list above is already capped, so this never fires with well-formed output.
    return markdown.length <= MAX_HOVER_LENGTH ? markdown : `${markdown.slice(0, MAX_HOVER_LENGTH - 1)}…`;
}

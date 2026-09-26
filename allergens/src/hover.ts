import { escapeMarkdown, formatNames, truncateName } from './markdown';

/** What was found; built by `findAllergens` in evaluate.ts. */
export interface AllergenFindings {
    /** Class labels (ticked classes, table order), then custom words: the pill text. */
    pillLabels: string[];
    /** One hover line per service label (e.g. "Wheat", "Almonds") or custom word. */
    lines: Array<{ label: string; ingredients: string[] }>;
    /** Ingredient names whose allergens couldn't be checked. */
    unknown: string[];
    /** Standard classes are ticked, but the nutrition service couldn't be reached (or answered nonsense). */
    standardUnchecked: boolean;
}

const MAX_LINES = 8;
export const DISCLAIMER = '_Informational only — always check product labels._';
export const UNCHECKED_LINE = "The standard allergens couldn't be checked: the cook.md nutrition service was unreachable or returned an error.";
export const LOCKED_LINE = 'Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)';

/** Tooltip of the neutral "🔒 Allergens" pill. */
export const LOCKED_TOOLTIP = `**Allergens** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to check recipes for the allergens you ticked in Settings.

[See plans](https://cook.md/pricing)`;

/** The editor truncates `tooltipMarkdown` at 4000 characters; stay clear of it. */
export const MAX_HOVER_LENGTH = 3900;

/**
 * Title, what wasn't checked, the hits, the locked line and the disclaimer. What wasn't
 * checked and the disclaimer always survive: to fit `MAX_HOVER_LENGTH`, hit lines are
 * dropped from the end and counted in an "and N more" line.
 * `locked`: add the "needs a Cook Basic or Pro plan" line.
 */
export function hoverMarkdown(findings: AllergenFindings, locked: boolean): string {
    const before = ['**Allergens**'];
    if (findings.standardUnchecked) {
        before.push(UNCHECKED_LINE);
    }
    if (findings.unknown.length > 0) {
        before.push(`Couldn't check: ${formatNames(findings.unknown)}`);
    }
    const after = locked ? [LOCKED_LINE, DISCLAIMER] : [DISCLAIMER];
    if (findings.lines.length === 0) {
        const none = findings.unknown.length > 0 ? ['None of your allergens were found in the ingredients that could be checked.'] : [];
        return [...before, ...none, ...after].join('\n\n');
    }
    const hitLines = findings.lines.map(line => `- **${escapeMarkdown(truncateName(line.label))}** — ${formatNames(line.ingredients)}`);
    const withHits = (shown: number): string => {
        const list = hitLines.slice(0, shown);
        if (shown < hitLines.length) {
            list.push(`- and ${hitLines.length - shown} more`);
        }
        return [...before, list.join('\n'), ...after].join('\n\n');
    };
    let shown = Math.min(hitLines.length, MAX_LINES);
    let markdown = withHits(shown);
    while (markdown.length > MAX_HOVER_LENGTH && shown > 0) {
        shown--;
        markdown = withHits(shown);
    }
    return markdown;
}

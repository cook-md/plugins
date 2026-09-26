import { escapeMarkdown, formatNames, truncateName } from './markdown';

/** What was found; built by `findAllergens` in evaluate.ts. */
export interface AllergenFindings {
    /** Class labels (ticked classes, table order), then custom words: the pill text. */
    pillLabels: string[];
    /** One hover line per service label (e.g. "Wheat", "Almonds") or custom word. */
    lines: Array<{ label: string; ingredients: string[] }>;
    /** Ingredient names whose allergens couldn't be checked. */
    unknown: string[];
}

const MAX_LINES = 8;
export const DISCLAIMER = '_Informational only — always check product labels._';
export const LOCKED_LINE = 'Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)';

/** Tooltip of the neutral "🔒 Allergens" pill. */
export const LOCKED_TOOLTIP = `**Allergens** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to check recipes for the allergens you ticked in Settings.

[See plans](https://cook.md/pricing)`;

export function hoverMarkdown(findings: AllergenFindings, locked: boolean): string {
    const blocks = ['**Allergens**'];
    if (findings.lines.length > 0) {
        const shown = findings.lines.slice(0, MAX_LINES)
            .map(line => `- **${escapeMarkdown(truncateName(line.label))}** — ${formatNames(line.ingredients)}`);
        if (findings.lines.length > MAX_LINES) {
            shown.push(`- and ${findings.lines.length - MAX_LINES} more`);
        }
        blocks.push(shown.join('\n'));
    } else if (findings.unknown.length > 0) {
        blocks.push('None of your allergens were found in the ingredients that could be checked.');
    }
    if (findings.unknown.length > 0) {
        blocks.push(`Couldn't check: ${formatNames(findings.unknown)}`);
    }
    if (locked) {
        blocks.push(LOCKED_LINE);
    }
    blocks.push(DISCLAIMER);
    return blocks.join('\n\n');
}

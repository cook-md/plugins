import { MacrosResult, Portion, WithheldReason } from './macros';
import { escapeMarkdown, formatNames } from './markdown';

/** The editor truncates `tooltipMarkdown` at 4000 characters; stay clear of it. */
export const MAX_HOVER_LENGTH = 3900;

export const FOOTER = '_Estimated from the cook.md nutrition service._';

/** Tooltip of the greyed `🔒 Macros` pill. */
export const LOCKED_TOOLTIP = `**Macros** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to see protein, carbs and fat per serving and per day.

[See plans](https://cook.md/pricing)`;

export const WHOLE_RECIPE_NOTE = 'No `servings:` in the frontmatter, so this is the whole recipe.';

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** `4` → `4`, `2.5` → `2.5`, `1.3333` → `1.33`: scaled servings can be fractional. */
function formatCount(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/** The basis line under the title. */
export function basisLine(portion: Portion): string {
    switch (portion.kind) {
        case 'serving': return `Per serving (${formatCount(portion.servings)} serving${portion.servings === 1 ? '' : 's'})`;
        case 'whole': return `Whole recipe · ${WHOLE_RECIPE_NOTE}`;
        case '100g': return 'Per 100 g';
        case 'day': return `Per person per day (${plural(portion.people, 'person', 'people')} × ${plural(portion.days, 'day', 'days')})`;
        default: {
            const never: never = portion;
            return never;
        }
    }
}

function withheldLine(result: MacrosResult, reason: WithheldReason): string {
    switch (reason) {
        case 'unmatched': return `Only ${result.match.matched} of ${result.match.total} ingredients matched the nutrition database, so the figures would be misleading.`;
        case 'missingRecipes': return `Missing recipes, so the totals would undercount: ${formatNames(result.missingRecipes)}`;
        case 'noData': return result.portion.kind === 'day' ? 'This plan has no recipes that could be evaluated.' : 'This recipe has no ingredients that could be evaluated.';
        case 'notWeighed': return "Ingredient weights are missing, so the figures can't be shown per 100 g.";
        default: {
            const never: never = reason;
            return never;
        }
    }
}

function share(value: number | undefined): string {
    return value === undefined ? '' : `${value} %`;
}

/** Title, basis, table (or why there is none), energy, match count, unmatched names, footer. */
export function hoverMarkdown(result: MacrosResult): string {
    const blocks: string[] = [];
    const { figures, shares } = result;
    if (result.withheld || !figures) {
        blocks.push('**Macros** · not enough data', basisLine(result.portion), withheldLine(result, result.withheld ?? 'noData'));
    } else {
        blocks.push('**Macros**', basisLine(result.portion));
        blocks.push([
            '| | g | % energy |',
            '|---|---:|---:|',
            `| Protein | ${figures.protein_g} | ${share(shares?.protein)} |`,
            `| Carbs | ${figures.carb_g} | ${share(shares?.carb)} |`,
            `| Fat | ${figures.fat_g} | ${share(shares?.fat)} |`,
            `| Fiber | ${figures.fiber_g} | |`,
            `| Sugar | ${figures.sugar_g} | |`,
            `| Saturated fat | ${figures.sat_fat_g} | |`,
        ].join('\n'));
        blocks.push(`Energy: **${figures.kcal} kcal**`);
    }
    blocks.push(`Ingredients matched: ${result.match.matched} / ${result.match.total}`);
    if (result.match.unmatched.length > 0) {
        blocks.push(`Not matched: ${formatNames(result.match.unmatched)}`);
    }
    blocks.push(FOOTER);
    const text = blocks.join('\n\n');
    return text.length > MAX_HOVER_LENGTH ? `${text.slice(0, MAX_HOVER_LENGTH - 1)}…` : text;
}

/** Tooltip for a nutrition service failure (network or server); the message is escaped. */
export function serviceErrorTooltip(reason: string, message: string): string {
    return [
        '**Macros** · unavailable',
        `The cook.md nutrition service did not answer (${escapeMarkdown(reason)}): ${escapeMarkdown(message.slice(0, 300))}`,
        'Try again later; the pill refreshes on the next edit.',
    ].join('\n\n');
}

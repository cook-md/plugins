import { AllergenClass } from './allergen-classes';
import { IngredientAllergens } from './allergen-template';
import { PillBadge } from './cooklang-api';
import { matchCustomWords } from './custom-match';
import { AllergenFindings, LOCKED_TOOLTIP, hoverMarkdown } from './hover';

/** The editor's `PreviewBadge.MAX_TEXT_LENGTH`, in UTF-16 units. */
export const MAX_PILL_TEXT = 24;
const WARNING_TEXT = '⚠ Check allergens';
const LOCKED_TEXT = '🔒 Allergens';

/**
 * `classes`: ticked classes the service checked (empty when it didn't). `ingredients`: the
 * service's per-ingredient data, undefined for the names-only template.
 */
export function findAllergens(
    classes: readonly AllergenClass[],
    customWords: readonly string[],
    names: readonly string[],
    ingredients: readonly IngredientAllergens[] | undefined,
): AllergenFindings {
    const findings: AllergenFindings = { pillLabels: [], lines: [], unknown: [] };
    for (const allergenClass of classes) {
        const byLabel = new Map<string, string[]>();
        for (const ingredient of ingredients ?? []) {
            for (const entry of ingredient.contains) {
                if (entry.class !== allergenClass.slug) {
                    continue;
                }
                const list = byLabel.get(entry.label) ?? [];
                if (!list.includes(ingredient.name)) {
                    list.push(ingredient.name);
                }
                byLabel.set(entry.label, list);
            }
        }
        if (byLabel.size > 0) {
            findings.pillLabels.push(allergenClass.label);
            for (const [label, list] of byLabel) {
                findings.lines.push({ label, ingredients: list });
            }
        }
    }
    for (const match of matchCustomWords(customWords, names)) {
        findings.pillLabels.push(match.word);
        findings.lines.push({ label: match.word, ingredients: match.ingredients });
    }
    if (classes.length > 0 && ingredients) {
        findings.unknown = [...new Set(ingredients.filter(i => i.status === 'unknown').map(i => i.name))];
    }
    return findings;
}

/** `⚠ ` + as many labels as fit in 24 characters, ` +N` for the rest; a single over-long label is cut with `…`. */
export function pillText(labels: readonly string[]): string {
    for (let shown = labels.length; shown >= 1; shown--) {
        const rest = labels.length - shown;
        const text = `⚠ ${labels.slice(0, shown).join(', ')}${rest > 0 ? ` +${rest}` : ''}`;
        if (text.length <= MAX_PILL_TEXT) {
            return text;
        }
    }
    const suffix = labels.length > 1 ? ` +${labels.length - 1}` : '';
    const room = MAX_PILL_TEXT - '⚠ '.length - '…'.length - suffix.length;
    return `⚠ ${labels[0].slice(0, room)}…${suffix}`;
}

/**
 * Red when something matched, amber when nothing matched but something couldn't be checked,
 * the neutral locked pill when the standard classes couldn't be checked at all, else nothing.
 * `locked`: standard classes are ticked but the plan doesn't include nutrition data.
 */
export function badgeFor(findings: AllergenFindings, locked: boolean, showWhenLocked: boolean): PillBadge | undefined {
    const showLock = locked && showWhenLocked;
    if (findings.pillLabels.length > 0) {
        return { kind: 'pill', text: pillText(findings.pillLabels), tone: 'bad', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (findings.unknown.length > 0) {
        return { kind: 'pill', text: WARNING_TEXT, tone: 'warning', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (showLock) {
        return { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP };
    }
    return undefined;
}

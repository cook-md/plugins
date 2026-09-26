import { AllergenClass } from './allergen-classes';
import { AllergenOutput } from './allergen-template';
import { PillBadge } from './cooklang-api';
import { matchCustomWords } from './custom-match';
import { AllergenFindings, LOCKED_TOOLTIP, hoverMarkdown } from './hover';

/** The editor's `PreviewBadge.MAX_TEXT_LENGTH`, in UTF-16 units. */
export const MAX_PILL_TEXT = 24;
const WARNING_TEXT = '⚠ Check allergens';
const LOCKED_TEXT = '🔒 Allergens';

/**
 * `classes`: ticked classes the service checked (empty when it didn't). `output.ingredients`:
 * the service's per-ingredient data, undefined for the names-only template. Linked recipes
 * (`output.refs`) are matched against custom words by name, but their contents are never
 * checked, so they are always reported as unknown while anything is being looked for.
 */
export function findAllergens(
    classes: readonly AllergenClass[],
    customWords: readonly string[],
    output: Readonly<AllergenOutput>,
): AllergenFindings {
    const { names, refs, ingredients } = output;
    const findings: AllergenFindings = { pillLabels: [], lines: [], unknown: [], standardUnchecked: false };
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
    for (const match of matchCustomWords(customWords, [...names, ...refs])) {
        findings.pillLabels.push(match.word);
        findings.lines.push({ label: match.word, ingredients: match.ingredients });
    }
    const unknown: string[] = [];
    if (classes.length > 0 && ingredients) {
        unknown.push(...ingredients.filter(i => i.status === 'unknown').map(i => i.name));
    }
    if (classes.length > 0 || customWords.length > 0) {
        unknown.push(...refs.map(ref => `${ref} (linked recipe)`));
    }
    findings.unknown = [...new Set(unknown)];
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
    // Cut on code points so an emoji is never split into a lone surrogate.
    let cut = '';
    for (const character of labels[0]) {
        if (cut.length + character.length > room) {
            break;
        }
        cut += character;
    }
    return `⚠ ${cut}…${suffix}`;
}

/**
 * Red when something matched; amber when nothing matched but something couldn't be checked
 * (unknown ingredients, linked recipes, or the service was unreachable); the neutral locked
 * pill when the plan doesn't cover the standard classes; else nothing.
 * `locked`: standard classes are ticked but the plan doesn't include nutrition data.
 */
export function badgeFor(findings: AllergenFindings, locked: boolean, showWhenLocked: boolean): PillBadge | undefined {
    const showLock = locked && showWhenLocked;
    if (findings.pillLabels.length > 0) {
        return { kind: 'pill', text: pillText(findings.pillLabels), tone: 'bad', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (findings.unknown.length > 0 || findings.standardUnchecked) {
        return { kind: 'pill', text: WARNING_TEXT, tone: 'warning', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (showLock) {
        return { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP };
    }
    return undefined;
}

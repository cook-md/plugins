import { PillBadge } from './cooklang-api';
import { matchesWord } from './custom-match';
import { formatNames } from './markdown';
import { DietVerdict, DietVerdicts, Violation } from './rules';
import { DietId } from './settings';

/** The editor's `PreviewBadge.MAX_TEXT_LENGTH`, in UTF-16 units: longer pills are dropped, not cut. */
export const MAX_PILL_TEXT = 24;

/** Strictest first. Dairy-free sits beside the ladder: Vegan implies it. */
const LADDER: readonly DietId[] = ['vegan', 'vegetarian', 'pescatarian'];

export const DIET_LABELS: Readonly<Record<DietId, string>> = {
    vegan: 'Vegan', vegetarian: 'Vegetarian', pescatarian: 'Pescatarian', dairyFree: 'Dairy-free',
};

export const FOOTER = '_Based on the cook.md nutrition service. Informational only — check labels of packaged products._';

export const LOCKED_TEXT = '🔒 Diet';
export const LOCKED_TOOLTIP = `**Diet badges** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to see which diets your recipes and meal plans fit: vegan, vegetarian, pescatarian and dairy-free.

[See plans](https://cook.md/pricing)`;

export const UNREACHABLE_TEXT = 'Diet ?';
export const UNREACHABLE_LINE = "Couldn't reach the nutrition service, so no diet could be checked.";

type EnabledDiets = Readonly<Record<DietId, boolean>>;

/** The strictest enabled ladder diet that didn't fail, plus Dairy-free when it didn't fail and Vegan isn't shown. */
function shownDiets(verdicts: DietVerdicts, enabled: EnabledDiets): DietId[] {
    const ladder = LADDER.find(id => enabled[id] && verdicts[id].status !== 'fail');
    const shown: DietId[] = ladder ? [ladder] : [];
    if (enabled.dairyFree && verdicts.dairyFree.status !== 'fail' && ladder !== 'vegan') {
        shown.push('dairyFree');
    }
    return shown;
}

/**
 * The next-stricter enabled ladder diet (it necessarily failed), or, when no ladder diet is
 * shown, the least strict enabled one; plus Dairy-free when it is enabled and failed.
 */
function failedDiets(verdicts: DietVerdicts, enabled: EnabledDiets, shown: readonly DietId[]): DietId[] {
    const enabledLadder = LADDER.filter(id => enabled[id]);
    const shownLadder = shown.find(id => id !== 'dairyFree');
    const candidates = shownLadder ? enabledLadder.slice(0, enabledLadder.indexOf(shownLadder)) : enabledLadder;
    const failed: DietId[] = candidates.length > 0 ? [candidates[candidates.length - 1]] : [];
    if (enabled.dairyFree && verdicts.dairyFree.status === 'fail') {
        failed.push('dairyFree');
    }
    return failed;
}

function label(verdict: DietVerdict): string {
    return `${DIET_LABELS[verdict.diet]}${verdict.status === 'unknown' ? '?' : ''}`;
}

/** Labels joined with ` · `; if over 24 units, with `·`; if still over, the first label alone. */
export function pillText(labels: readonly string[]): string {
    const spaced = labels.join(' · ');
    if (spaced.length <= MAX_PILL_TEXT) {
        return spaced;
    }
    const tight = labels.join('·');
    return tight.length <= MAX_PILL_TEXT ? tight : labels[0];
}

function violationText(violation: Violation): string {
    return matchesWord(violation.reason, violation.ingredient) ? violation.ingredient : `${violation.ingredient} (${violation.reason})`;
}

function shownLine(verdict: DietVerdict): string {
    const title = `**${label(verdict)}**`;
    if (verdict.status === 'pass') {
        return `- ${title}: every ingredient checked`;
    }
    const count = verdict.unknown.length;
    return `- ${title} ${count} ingredient${count === 1 ? '' : 's'} couldn't be checked: ${formatNames(verdict.unknown)}`;
}

function failedLine(verdict: DietVerdict): string {
    return `- Not ${DIET_LABELS[verdict.diet].toLowerCase()}: ${formatNames(verdict.violations.map(violationText))}`;
}

/** Green when every shown diet passed, amber when one is unknown, no pill when every enabled diet failed. */
export function dietBadge(verdicts: DietVerdicts, enabled: EnabledDiets): PillBadge | undefined {
    const shown = shownDiets(verdicts, enabled);
    if (shown.length === 0) {
        return undefined;
    }
    const tone = shown.every(id => verdicts[id].status === 'pass') ? 'good' : 'warning';
    const lines = [
        ...shown.map(id => shownLine(verdicts[id])),
        ...failedDiets(verdicts, enabled, shown).map(id => failedLine(verdicts[id])),
    ];
    return {
        kind: 'pill',
        text: pillText(shown.map(id => label(verdicts[id]))),
        tone,
        tooltipMarkdown: ['**Diet**', lines.join('\n'), FOOTER].join('\n\n'),
    };
}

export function lockedBadge(): PillBadge {
    return { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP };
}

export function unreachableBadge(): PillBadge {
    return { kind: 'pill', text: UNREACHABLE_TEXT, tone: 'warning', tooltipMarkdown: ['**Diet**', UNREACHABLE_LINE, FOOTER].join('\n\n') };
}

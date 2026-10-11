import { PillBadge } from './cooklang-api';
import { LOCKED_TOOLTIP, hoverMarkdown, serviceErrorTooltip } from './hover';
import { MacroFigures, MacrosResult, Portion } from './macros';

/** The editor drops pills whose text is longer than this (UTF-16 units). */
export const MAX_TEXT_LENGTH = 24;
export const LOCKED_TEXT = '🔒 Macros';
export const UNKNOWN_TEXT = 'Macros ?';

const SUFFIX: Readonly<Record<Portion['kind'], string>> = { serving: '', whole: ' · whole', '100g': '/100g', day: '/day' };

/**
 * `38P 52C 14F · 520 kcal`, with `/100g`, `/day` or ` · whole` for the other bases. The editor caps
 * pill text at 24 characters, so the energy is tightened (`520kcal`) and then dropped when it does
 * not fit; the hover always has it. The basis marker is never dropped: if even the bare figures do
 * not fit, the pill reads `Macros ?`.
 */
export function pillText(figures: MacroFigures, portion: Portion, showEnergy: boolean): string {
    const core = `${figures.protein_g}P ${figures.carb_g}C ${figures.fat_g}F`;
    const suffix = SUFFIX[portion.kind];
    const candidates: string[] = [];
    if (showEnergy) {
        candidates.push(`${core} · ${figures.kcal} kcal${suffix}`, `${core} · ${figures.kcal}kcal${suffix}`);
    }
    candidates.push(suffix.startsWith('/') ? `${core} ${suffix}` : `${core}${suffix}`);
    return candidates.find(text => text.length <= MAX_TEXT_LENGTH) ?? UNKNOWN_TEXT;
}

/** Neutral pill with the figures, or a warning `Macros ?` when they are withheld. */
export function badgeFor(result: MacrosResult, showEnergy: boolean): PillBadge {
    const tooltipMarkdown = hoverMarkdown(result);
    if (result.withheld || !result.figures) {
        return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'warning', tooltipMarkdown };
    }
    return { kind: 'pill', text: pillText(result.figures, result.portion, showEnergy), tone: 'neutral', tooltipMarkdown };
}

/** Greyed pill with an upgrade hint, or undefined when `macros.showWhenLocked` is off. */
export function lockedBadge(showWhenLocked: boolean): PillBadge | undefined {
    return showWhenLocked ? { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP } : undefined;
}

/** The nutrition service failed (network or server): `Macros ?` with the reason in the hover. */
export function serviceErrorBadge(reason: string, message: string): PillBadge {
    return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'warning', tooltipMarkdown: serviceErrorTooltip(reason, message) };
}

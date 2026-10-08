import { PillBadge } from './cooklang-api';
import { LOCKED_TOOLTIP, UNAVAILABLE_TOOLTIP, hoverMarkdown } from './hover';
import { Verdict } from './verdict';

export const GOOD_SHARE = 0.9;
export const WARNING_SHARE = 0.6;
export const LOCKED_TEXT = '🔒 Vitals';
export const UNKNOWN_TEXT = 'Vitals ?';

/** Shown when the template output could not be read. */
export const UNAVAILABLE_BADGE: PillBadge = { kind: 'pill', text: UNKNOWN_TEXT, tone: 'neutral', tooltipMarkdown: UNAVAILABLE_TOOLTIP };

/** Good from 90 % of targets met, warning from 60 %, bad below; neutral when nothing was counted. */
export function toneFor(met: number, counted: number): PillBadge['tone'] {
    if (counted === 0) {
        return 'neutral';
    }
    const share = met / counted;
    return share >= GOOD_SHARE ? 'good' : share >= WARNING_SHARE ? 'warning' : 'bad';
}

/** The verdict pill: `Vitals 14/17`, or `Vitals ?` when withheld; the hover explains either. */
export function badgeFor(verdict: Verdict): PillBadge {
    const tooltipMarkdown = hoverMarkdown(verdict);
    if (verdict.withheld) {
        return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'neutral', tooltipMarkdown };
    }
    // "Vitals " is 7 characters; two 3-digit counts and the slash fit in 24.
    return { kind: 'pill', text: `Vitals ${verdict.met}/${verdict.counted}`, tone: toneFor(verdict.met, verdict.counted), tooltipMarkdown };
}

/** Greyed badge with an upgrade hint, or undefined if the user disabled it via `coreVitals.showWhenLocked`. */
export function lockedBadge(showWhenLocked: boolean): PillBadge | undefined {
    return showWhenLocked ? { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP } : undefined;
}

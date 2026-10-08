import * as assert from 'assert';
import { UNAVAILABLE_BADGE, badgeFor, lockedBadge, toneFor } from './badge';
import { LOCKED_TOOLTIP, UNAVAILABLE_TOOLTIP } from './hover';
import { Verdict } from './verdict';

function verdict(overrides: Partial<Verdict>): Verdict {
    return {
        kind: 'plan', days: 2, people: 2, standard: 'fda', met: 14, counted: 17, below: [], over: [], skipped: [],
        matched: 18, total: 20, unmatched: [], missingRecipes: [], confidence: 'High', mealsPerDay: 3, servingsKnown: true,
        ...overrides,
    };
}

describe('toneFor', () => {
    it('is good from 90 %, warning from 60 %, bad below', () => {
        assert.strictEqual(toneFor(9, 10), 'good');
        assert.strictEqual(toneFor(8, 10), 'warning');
        assert.strictEqual(toneFor(6, 10), 'warning');
        assert.strictEqual(toneFor(5, 10), 'bad');
        assert.strictEqual(toneFor(0, 0), 'neutral');
    });
});

describe('badgeFor', () => {
    it('shows met over counted with the tone and the hover', () => {
        const badge = badgeFor(verdict({}));
        assert.strictEqual(badge.kind, 'pill');
        assert.strictEqual(badge.text, 'Vitals 14/17');
        assert.strictEqual(badge.tone, 'warning');
        assert.ok(badge.tooltipMarkdown.startsWith('**Core Vitals** · 14 of 17 targets met'));
    });

    it('shows a neutral question mark when withheld', () => {
        const badge = badgeFor(verdict({ withheld: 'unmatched', matched: 5 }));
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Vitals ?', tone: 'neutral' });
        assert.ok(badge.tooltipMarkdown.includes('Only 5 of 20 ingredients matched'));
    });

    it('keeps the pill within 24 characters even with large counts', () => {
        assert.ok(badgeFor(verdict({ met: 100, counted: 100 })).text.length <= 24);
    });
});

describe('lockedBadge and UNAVAILABLE_BADGE', () => {
    it('returns the greyed badge unless hidden by the setting', () => {
        assert.deepStrictEqual(lockedBadge(true), { kind: 'pill', text: '🔒 Vitals', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(lockedBadge(false), undefined);
        assert.deepStrictEqual(UNAVAILABLE_BADGE, { kind: 'pill', text: 'Vitals ?', tone: 'neutral', tooltipMarkdown: UNAVAILABLE_TOOLTIP });
    });
});

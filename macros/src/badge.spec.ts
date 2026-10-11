import * as assert from 'assert';
import { LOCKED_TEXT, MAX_TEXT_LENGTH, UNKNOWN_TEXT, badgeFor, lockedBadge, pillText, serviceErrorBadge } from './badge';
import { LOCKED_TOOLTIP, hoverMarkdown } from './hover';
import { MacroFigures, MacrosResult } from './macros';

const SERVING: MacroFigures = { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 };
const WHOLE: MacroFigures = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };
const PER_100G: MacroFigures = { kcal: 120, protein_g: 8, fat_g: 3, carb_g: 12, fiber_g: 1, sugar_g: 2, sat_fat_g: 1 };
const DAY: MacroFigures = { kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 };

describe('pillText', () => {
    it('shows macros and energy per serving', () => {
        assert.strictEqual(pillText(SERVING, { kind: 'serving', servings: 4 }, true), '38P 52C 14F · 520 kcal');
    });

    it('drops the energy when showEnergy is off', () => {
        assert.strictEqual(pillText(SERVING, { kind: 'serving', servings: 4 }, false), '38P 52C 14F');
    });

    it('marks the whole recipe, dropping energy that does not fit', () => {
        assert.strictEqual(pillText(WHOLE, { kind: 'whole' }, true), '152P 208C 56F · whole');
    });

    it('marks per 100 g, tightening the energy to fit', () => {
        assert.strictEqual(pillText(PER_100G, { kind: '100g' }, true), '8P 12C 3F · 120kcal/100g');
        assert.strictEqual(pillText(PER_100G, { kind: '100g' }, false), '8P 12C 3F /100g');
    });

    it('marks a plan per day', () => {
        assert.strictEqual(pillText(DAY, { kind: 'day', people: 2, days: 7 }, true), '150P 250C 80F /day');
        assert.strictEqual(pillText({ ...DAY, protein_g: 9, carb_g: 20, fat_g: 5, kcal: 160 }, { kind: 'day', people: 1, days: 1 }, true), '9P 20C 5F · 160 kcal/day');
    });

    it('never exceeds the editor limit', () => {
        const huge: MacroFigures = { ...WHOLE, protein_g: 123456, carb_g: 123456, fat_g: 123456, kcal: 9999990 };
        for (const portion of [{ kind: 'serving', servings: 1 }, { kind: 'whole' }, { kind: '100g' }, { kind: 'day', people: 1, days: 1 }] as const) {
            assert.ok(pillText(huge, portion, true).length <= MAX_TEXT_LENGTH);
            assert.ok(pillText(SERVING, portion, true).length <= MAX_TEXT_LENGTH);
        }
        assert.strictEqual(pillText(huge, { kind: 'whole' }, true), UNKNOWN_TEXT);
    });
});

describe('badgeFor', () => {
    const ok: MacrosResult = {
        portion: { kind: 'serving', servings: 4 }, figures: SERVING, shares: { protein: 31, carb: 43, fat: 26 },
        match: { matched: 4, total: 4, unmatched: [] }, missingRecipes: [],
    };

    it('is a neutral pill with the hover', () => {
        assert.deepStrictEqual(badgeFor(ok, true), { kind: 'pill', text: '38P 52C 14F · 520 kcal', tone: 'neutral', tooltipMarkdown: hoverMarkdown(ok) });
    });

    it('is a warning Macros ? when withheld', () => {
        const withheld: MacrosResult = { portion: ok.portion, withheld: 'unmatched', match: { matched: 1, total: 4, unmatched: ['a', 'b', 'c'] }, missingRecipes: [] };
        const badge = badgeFor(withheld, true);
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge.tooltipMarkdown.includes('Not matched: a, b, c'));
    });
});

describe('lockedBadge and serviceErrorBadge', () => {
    it('shows the grey lock unless turned off', () => {
        assert.deepStrictEqual(lockedBadge(true), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(lockedBadge(false), undefined);
        assert.ok(LOCKED_TEXT.length <= MAX_TEXT_LENGTH);
    });

    it('turns a service failure into a warning pill', () => {
        const badge = serviceErrorBadge('network', 'offline');
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge.tooltipMarkdown.includes('(network): offline'));
    });
});

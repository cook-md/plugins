import * as assert from 'assert';
import {
    FOOTER, LOCKED_TEXT, LOCKED_TOOLTIP, MAX_PILL_TEXT, UNREACHABLE_LINE, UNREACHABLE_TEXT,
    dietBadge, lockedBadge, pillText, unreachableBadge,
} from './badge';
import { DietStatus, DietVerdict, DietVerdicts, Violation } from './rules';
import { DietId } from './settings';

const v = (diet: DietId, status: DietStatus, extra: { violations?: Violation[]; unknown?: string[] } = {}): DietVerdict =>
    ({ diet, status, violations: extra.violations ?? [], unknown: extra.unknown ?? [] });
const verdicts = (partial: Partial<DietVerdicts>): DietVerdicts => ({
    vegan: v('vegan', 'pass'), vegetarian: v('vegetarian', 'pass'), pescatarian: v('pescatarian', 'pass'), dairyFree: v('dairyFree', 'pass'),
    ...partial,
});
const ALL_ON = { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true };
const hover = (...lines: string[]) => ['**Diet**', lines.join('\n'), FOOTER].join('\n\n');

describe('dietBadge', () => {
    it('shows only the strictest passing diet: Vegan implies the rest', () => {
        assert.deepStrictEqual(dietBadge(verdicts({}), ALL_ON), {
            kind: 'pill', text: 'Vegan', tone: 'good', tooltipMarkdown: hover('- **Vegan**: every ingredient checked'),
        });
    });

    it('appends Dairy-free when Vegan is not shown, and says why Vegan failed', () => {
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', { violations: [{ ingredient: 'eggs', reason: 'eggs' }] }) }), ALL_ON);
        assert.deepStrictEqual(badge, {
            kind: 'pill', text: 'Vegetarian · Dairy-free', tone: 'good',
            tooltipMarkdown: hover(
                '- **Vegetarian**: every ingredient checked',
                '- **Dairy-free**: every ingredient checked',
                '- Not vegan: eggs',
            ),
        });
    });

    it('names the reason unless the ingredient name already says it, and lists a failed Dairy-free', () => {
        const butter = { violations: [{ ingredient: 'butter', reason: 'dairy' }, { ingredient: 'eggs', reason: 'eggs' }] };
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', butter), dairyFree: v('dairyFree', 'fail', { violations: [{ ingredient: 'butter', reason: 'dairy' }] }) }), ALL_ON);
        assert.strictEqual(badge?.text, 'Vegetarian');
        assert.strictEqual(badge?.tooltipMarkdown, hover(
            '- **Vegetarian**: every ingredient checked',
            '- Not vegan: butter \\(dairy\\), eggs',
            '- Not dairy-free: butter \\(dairy\\)',
        ));
    });

    it('turns amber with `?` when nothing broke the diet but something couldn\'t be checked', () => {
        const unknown = ['miso paste', 'Pesto (linked recipe)'];
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'unknown', { unknown }), vegetarian: v('vegetarian', 'unknown', { unknown }),
            pescatarian: v('pescatarian', 'unknown', { unknown }), dairyFree: v('dairyFree', 'unknown', { unknown }),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan?', 'warning']);
        assert.strictEqual(badge?.tooltipMarkdown, hover("- **Vegan?** 2 ingredients couldn't be checked: miso paste, Pesto \\(linked recipe\\)"));
    });

    it('uses the singular for one unchecked ingredient', () => {
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'unknown', { unknown: ['miso'] }) }), ALL_ON);
        assert.ok(badge?.tooltipMarkdown.includes("- **Vegan?** 1 ingredient couldn't be checked: miso"), badge?.tooltipMarkdown);
    });

    it('puts `?` only on the diet that is unknown, and is amber if any shown diet is', () => {
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', { violations: [{ ingredient: 'eggs', reason: 'eggs' }] }),
            dairyFree: v('dairyFree', 'unknown', { unknown: ['cream substitute'] }),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegetarian · Dairy-free?', 'warning']);
    });

    it('keeps two `?` labels within the editor\'s 24-character limit', () => {
        const unknown = ['miso'];
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', { violations: [{ ingredient: 'prawns', reason: 'crustaceans' }] }),
            vegetarian: v('vegetarian', 'fail', { violations: [{ ingredient: 'prawns', reason: 'crustaceans' }] }),
            pescatarian: v('pescatarian', 'unknown', { unknown }), dairyFree: v('dairyFree', 'unknown', { unknown }),
        }), ALL_ON);
        assert.strictEqual(badge?.text, 'Pescatarian?·Dairy-free?');
        assert.ok(badge.text.length <= MAX_PILL_TEXT);
        assert.ok(badge.tooltipMarkdown.includes('- Not vegetarian: prawns \\(crustaceans\\)'), badge.tooltipMarkdown);
    });

    it('shows Dairy-free alone when every ladder diet failed, naming the least strict failure', () => {
        const chicken = { violations: [{ ingredient: 'chicken', reason: 'poultry' }] };
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', chicken), vegetarian: v('vegetarian', 'fail', chicken), pescatarian: v('pescatarian', 'fail', chicken),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Dairy-free', 'good']);
        assert.strictEqual(badge?.tooltipMarkdown, hover('- **Dairy-free**: every ingredient checked', '- Not pescatarian: chicken \\(poultry\\)'));
    });

    it('shows no pill when every enabled diet fails', () => {
        const steak = { violations: [{ ingredient: 'steak', reason: 'meat' }] };
        const butter = { violations: [{ ingredient: 'butter', reason: 'dairy' }] };
        assert.strictEqual(dietBadge(verdicts({
            vegan: v('vegan', 'fail', steak), vegetarian: v('vegetarian', 'fail', steak), pescatarian: v('pescatarian', 'fail', steak),
            dairyFree: v('dairyFree', 'fail', butter),
        }), ALL_ON), undefined);
        assert.strictEqual(dietBadge(verdicts({ dairyFree: v('dairyFree', 'fail', butter) }), { vegan: false, vegetarian: false, pescatarian: false, dairyFree: true }), undefined);
    });

    it('never shows or mentions a disabled diet', () => {
        const noVegan = { ...ALL_ON, vegan: false };
        assert.strictEqual(dietBadge(verdicts({}), noVegan)?.text, 'Vegetarian · Dairy-free');
        const fish = { violations: [{ ingredient: 'cod', reason: 'fish or shellfish' }] };
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', fish), vegetarian: v('vegetarian', 'fail', fish) }), noVegan);
        assert.strictEqual(badge?.text, 'Pescatarian · Dairy-free');
        assert.ok(badge?.tooltipMarkdown.includes('- Not vegetarian: cod \\(fish or shellfish\\)'));
        assert.ok(!badge?.tooltipMarkdown.includes('vegan'));
        assert.strictEqual(dietBadge(verdicts({}), { vegan: true, vegetarian: true, pescatarian: true, dairyFree: false })?.text, 'Vegan');
    });
});

describe('pillText', () => {
    it('joins with a spaced dot, then a tight dot, then keeps the first label', () => {
        assert.strictEqual(pillText(['Vegan']), 'Vegan');
        assert.strictEqual(pillText(['Pescatarian', 'Dairy-free']), 'Pescatarian · Dairy-free');
        assert.strictEqual(pillText(['Pescatarian?', 'Dairy-free?']), 'Pescatarian?·Dairy-free?');
        assert.strictEqual(pillText(['x'.repeat(20), 'y'.repeat(20)]), 'x'.repeat(20));
    });
});

describe('fixed pills', () => {
    it('locked: grey 🔒 Diet with an upgrade hint', () => {
        assert.deepStrictEqual(lockedBadge(), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(LOCKED_TEXT, '🔒 Diet');
        assert.ok(LOCKED_TOOLTIP.includes('[See plans](https://cook.md/pricing)'));
    });

    it('unreachable: amber Diet ? saying the service couldn\'t be reached', () => {
        assert.deepStrictEqual(unreachableBadge(), {
            kind: 'pill', text: UNREACHABLE_TEXT, tone: 'warning', tooltipMarkdown: ['**Diet**', UNREACHABLE_LINE, FOOTER].join('\n\n'),
        });
        assert.strictEqual(UNREACHABLE_TEXT, 'Diet ?');
        assert.ok(UNREACHABLE_LINE.startsWith("Couldn't reach the nutrition service"));
    });
});

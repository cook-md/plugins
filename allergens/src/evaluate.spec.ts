import * as assert from 'assert';
import { ALLERGEN_CLASSES } from './allergen-classes';
import { IngredientAllergens } from './allergen-template';
import { badgeFor, findAllergens, pillText } from './evaluate';
import { LOCKED_TOOLTIP, UNCHECKED_LINE } from './hover';

const cls = (...slugs: string[]) => ALLERGEN_CLASSES.filter(c => slugs.includes(c.slug));
const verified = (name: string, ...contains: IngredientAllergens['contains']): IngredientAllergens => ({ name, status: 'verified', contains });
const unknown = (name: string): IngredientAllergens => ({ name, status: 'unknown', contains: [] });

describe('findAllergens', () => {
    const ingredients = [
        verified('soy sauce', { class: 'gluten', subtype: 'wheat', label: 'Wheat' }, { class: 'soybeans', label: 'Soybeans' }),
        verified('butter', { class: 'milk', label: 'Milk' }),
        verified('parmesan', { class: 'milk', label: 'Milk' }),
        unknown('saffron'),
        unknown('saffron'),
    ];
    const names = ['soy sauce', 'butter', 'parmesan', 'saffron', 'fresh coriander'];

    it('collects hits for ticked classes only, in class order, then custom words', () => {
        const findings = findAllergens(cls('milk', 'gluten'), ['coriander'], { names, refs: [], ingredients });
        assert.deepStrictEqual(findings.pillLabels, ['Gluten', 'Milk', 'coriander']);
        assert.deepStrictEqual(findings.lines, [
            { label: 'Wheat', ingredients: ['soy sauce'] },
            { label: 'Milk', ingredients: ['butter', 'parmesan'] },
            { label: 'coriander', ingredients: ['fresh coriander'] },
        ]);
        assert.deepStrictEqual(findings.unknown, ['saffron']);
    });

    it('reports no unknowns when no class is checked', () => {
        const findings = findAllergens([], ['kiwi'], { names, refs: [], ingredients: undefined });
        assert.deepStrictEqual(findings, { pillLabels: [], lines: [], unknown: [], standardUnchecked: false });
    });

    it('matches custom words against linked recipes too, but still reports them as unchecked', () => {
        const findings = findAllergens([], ['pesto'], { names, refs: ['Pesto'], ingredients: undefined });
        assert.deepStrictEqual(findings.pillLabels, ['pesto']);
        assert.deepStrictEqual(findings.lines, [{ label: 'pesto', ingredients: ['Pesto'] }]);
        assert.deepStrictEqual(findings.unknown, ['Pesto (linked recipe)']);
    });

    it('always lists linked recipes as unchecked, after the service unknowns', () => {
        const withClasses = findAllergens(cls('milk'), [], { names, refs: ['Pesto', 'Pesto'], ingredients });
        assert.deepStrictEqual(withClasses.unknown, ['saffron', 'Pesto (linked recipe)']);
        const customOnly = findAllergens([], ['kiwi'], { names, refs: ['Hollandaise'], ingredients: undefined });
        assert.deepStrictEqual(customOnly.unknown, ['Hollandaise (linked recipe)']);
    });
});

describe('pillText', () => {
    it('fits as many labels as possible into 24 characters', () => {
        assert.strictEqual(pillText(['Milk']), '⚠ Milk');
        assert.strictEqual(pillText(['Milk', 'Tree nuts']), '⚠ Milk, Tree nuts');
        assert.strictEqual(pillText(['Milk', 'Tree nuts', 'Sesame']), '⚠ Milk, Tree nuts +1');
        for (const text of [pillText(['Crustaceans', 'Sulphites', 'Molluscs', 'Mustard']), pillText(['x'.repeat(40), 'Milk'])]) {
            assert.ok(text.length <= 24, text);
        }
        assert.strictEqual(pillText(['x'.repeat(40), 'Milk']), `⚠ ${'x'.repeat(18)}… +1`);
    });

    it('never cuts a label in the middle of a surrogate pair', () => {
        const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
        for (const labels of [['x' + '🥜'.repeat(12), 'Milk'], ['🥜'.repeat(12)], ['xx' + '🥜'.repeat(12), 'Milk']]) {
            const text = pillText(labels);
            assert.ok(text.length <= 24, text);
            assert.ok(!loneSurrogate.test(text), JSON.stringify(text));
        }
    });
});

describe('badgeFor', () => {
    const hit = { pillLabels: ['Milk'], lines: [{ label: 'Milk', ingredients: ['butter'] }], unknown: [], standardUnchecked: false };
    const unsure = { pillLabels: [], lines: [], unknown: ['saffron'], standardUnchecked: false };
    const clear = { pillLabels: [], lines: [], unknown: [], standardUnchecked: false };
    const unreachable = { ...clear, standardUnchecked: true };

    it('flags hits in red', () => {
        const badge = badgeFor(hit, false, true);
        assert.strictEqual(badge?.tone, 'bad');
        assert.strictEqual(badge?.text, '⚠ Milk');
    });

    it('warns in amber when nothing matched but something could not be checked', () => {
        assert.deepStrictEqual([badgeFor(unsure, false, true)?.tone, badgeFor(unsure, false, true)?.text], ['warning', '⚠ Check allergens']);
    });

    it('warns in amber when the standard classes could not be checked, even with nothing unknown', () => {
        const badge = badgeFor(unreachable, false, true);
        assert.deepStrictEqual([badge?.tone, badge?.text], ['warning', '⚠ Check allergens']);
        assert.ok(badge?.tooltipMarkdown.includes(UNCHECKED_LINE));
        assert.strictEqual(badgeFor({ ...hit, standardUnchecked: true }, false, true)?.tone, 'bad');
    });

    it('shows nothing when everything was checked and nothing matched', () => {
        assert.strictEqual(badgeFor(clear, false, true), undefined);
    });

    it('shows the locked pill when standard classes could not be checked', () => {
        assert.deepStrictEqual(badgeFor(clear, true, true), { kind: 'pill', text: '🔒 Allergens', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(badgeFor(clear, true, false), undefined);
    });

    it('adds the locked line to a red pill unless the hint is disabled', () => {
        assert.ok(badgeFor(hit, true, true)?.tooltipMarkdown.includes('Cook Basic or Pro'));
        assert.ok(!badgeFor(hit, true, false)?.tooltipMarkdown.includes('Cook Basic or Pro'));
    });
});

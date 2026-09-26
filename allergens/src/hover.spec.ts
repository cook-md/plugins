import * as assert from 'assert';
import { UNCHECKED_LINE, hoverMarkdown } from './hover';

describe('hoverMarkdown', () => {
    it('lists hits, unknowns and the disclaimer', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['Milk'],
            lines: [{ label: 'Milk', ingredients: ['butter', 'parmesan'] }],
            unknown: ['saffron'],
            standardUnchecked: false,
        }, false);
        assert.strictEqual(markdown, [
            '**Allergens**',
            "Couldn't check: saffron",
            '- **Milk** — butter, parmesan',
            '_Informational only — always check product labels._',
        ].join('\n\n'));
    });

    it('says nothing tracked was found when only unknowns remain', () => {
        const markdown = hoverMarkdown({ pillLabels: [], lines: [], unknown: ['saffron'], standardUnchecked: false }, false);
        assert.ok(markdown.includes('None of your allergens were found in the ingredients that could be checked.'));
    });

    it('escapes names and caps long lists', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['x'],
            lines: [{ label: '**x**', ingredients: ['[a](https://evil)', ...Array.from({ length: 10 }, (_, i) => `i${i}`)] }],
            unknown: [],
            standardUnchecked: false,
        }, false);
        assert.ok(markdown.includes('\\*\\*x\\*\\*'));
        assert.ok(markdown.includes('\\[a\\]\\(https\\://evil\\)'));
        assert.ok(markdown.includes('and 3 more'));
    });

    it('puts the standard-unchecked line right after the title', () => {
        const markdown = hoverMarkdown({ pillLabels: [], lines: [], unknown: ['saffron'], standardUnchecked: true }, false);
        assert.strictEqual(markdown.split('\n\n')[1], UNCHECKED_LINE);
        assert.strictEqual(UNCHECKED_LINE, "The standard allergens couldn't be checked: the cook.md nutrition service was unreachable or returned an error.");
    });

    it('truncates names on code points, not UTF-16 units', () => {
        const markdown = hoverMarkdown({ pillLabels: [], lines: [], unknown: ['x' + '🥜'.repeat(70)], standardUnchecked: false }, false);
        assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(markdown));
        assert.ok(markdown.includes(`x${'🥜'.repeat(59)}…`));
    });

    it('stays within 3900 characters by dropping hit lines, never what was unchecked or the disclaimer', () => {
        const long = (i: number): string => `${'*'.repeat(58)}${String(i).padStart(2, '0')}`;
        const names = Array.from({ length: 12 }, (_, i) => long(i));
        const markdown = hoverMarkdown({
            pillLabels: ['x'],
            lines: Array.from({ length: 10 }, (_, i) => ({ label: long(i), ingredients: names })),
            unknown: names,
            standardUnchecked: true,
        }, true);
        assert.ok(markdown.length <= 3900, String(markdown.length));
        assert.ok(markdown.includes(UNCHECKED_LINE));
        assert.ok(markdown.includes("Couldn't check: "));
        assert.ok(markdown.includes('Checking the standard allergens needs a Cook Basic or Pro plan.'));
        assert.ok(markdown.endsWith('_Informational only — always check product labels._'));
        const more = /- and (\d+) more/.exec(markdown);
        const shown = (markdown.match(/^- \*\*/gm) ?? []).length;
        assert.ok(more && shown >= 1, markdown);
        assert.strictEqual(shown + Number(more[1]), 10);
    });

    it('adds the locked line when asked', () => {
        assert.ok(hoverMarkdown({ pillLabels: [], lines: [], unknown: [], standardUnchecked: false }, true)
            .includes('Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)'));
    });
});

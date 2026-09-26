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
        assert.strictEqual(UNCHECKED_LINE, "Couldn't reach the cook.md nutrition service, so the standard allergens weren't checked.");
    });

    it('adds the locked line when asked', () => {
        assert.ok(hoverMarkdown({ pillLabels: [], lines: [], unknown: [], standardUnchecked: false }, true)
            .includes('Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)'));
    });
});

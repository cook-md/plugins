import * as assert from 'assert';
import { hoverMarkdown } from './hover';

describe('hoverMarkdown', () => {
    it('lists hits, unknowns and the disclaimer', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['Milk'],
            lines: [{ label: 'Milk', ingredients: ['butter', 'parmesan'] }],
            unknown: ['saffron'],
        }, false);
        assert.strictEqual(markdown, [
            '**Allergens**',
            '- **Milk** — butter, parmesan',
            "Couldn't check: saffron",
            '_Informational only — always check product labels._',
        ].join('\n\n'));
    });

    it('says nothing tracked was found when only unknowns remain', () => {
        const markdown = hoverMarkdown({ pillLabels: [], lines: [], unknown: ['saffron'] }, false);
        assert.ok(markdown.includes('None of your allergens were found in the ingredients that could be checked.'));
    });

    it('escapes names and caps long lists', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['x'],
            lines: [{ label: '**x**', ingredients: ['[a](https://evil)', ...Array.from({ length: 10 }, (_, i) => `i${i}`)] }],
            unknown: [],
        }, false);
        assert.ok(markdown.includes('\\*\\*x\\*\\*'));
        assert.ok(markdown.includes('\\[a\\]\\(https\\://evil\\)'));
        assert.ok(markdown.includes('and 3 more'));
    });

    it('adds the locked line when asked', () => {
        assert.ok(hoverMarkdown({ pillLabels: [], lines: [], unknown: [] }, true)
            .includes('Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)'));
    });
});

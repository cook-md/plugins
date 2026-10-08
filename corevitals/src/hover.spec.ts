import * as assert from 'assert';
import { LOCKED_TOOLTIP, MAX_HOVER_LENGTH, UNAVAILABLE_TOOLTIP, hoverMarkdown } from './hover';
import { Verdict } from './verdict';

function verdict(overrides: Partial<Verdict>): Verdict {
    return {
        kind: 'plan', days: 2, people: 2, standard: 'fda', met: 14, counted: 17,
        below: [{ label: 'Iron', kind: 'min', percent: 54.4, lo: 0, hi: 0 }, { label: 'Fiber', kind: 'min', percent: 71, lo: 0, hi: 0 }],
        over: [{ label: 'Sodium', kind: 'max', percent: 132, lo: 0, hi: 0 }],
        skipped: [], matched: 18, total: 20, unmatched: ['saffron', 'ghee'], missingRecipes: [], confidence: 'High',
        mealsPerDay: 3, servingsKnown: true,
        ...overrides,
    };
}

describe('hoverMarkdown', () => {
    it('renders the plan summary', () => {
        assert.strictEqual(hoverMarkdown(verdict({})), [
            '**Core Vitals** · 14 of 17 targets met',
            '2 days · 2 people · FDA daily values',
            'Below target: Iron 54 %, Fiber 71 %',
            'Over limit: Sodium 132 %',
            '18 of 20 ingredients matched (High confidence). Open the Core Vitals report for the full breakdown.',
        ].join('\n\n'));
    });

    it('renders the recipe period line with and without known servings', () => {
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 4 })).includes('Per serving (4 servings) · one meal = ⅓ of a day · FDA daily values'));
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 1 })).includes('Per serving (1 serving) · one meal = ⅓ of a day · FDA daily values'));
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 1, servingsKnown: false })).includes('Whole recipe (no servings in frontmatter) · one meal = ⅓ of a day · FDA daily values'));
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 2, mealsPerDay: 7 })).includes('one meal = 1/7 of a day'));
    });

    it('shows macro shortfalls as a share of energy with the band', () => {
        const markdown = hoverMarkdown(verdict({ below: [{ label: 'Protein', kind: 'macroPercent', percent: 8.2, lo: 10, hi: 35 }], over: [] }));
        assert.ok(markdown.includes('Below target: Protein 8 % of energy (10–35)'), markdown);
        assert.ok(!markdown.includes('Over limit'));
    });

    it('lists skipped keys', () => {
        assert.ok(hoverMarkdown(verdict({ skipped: ['Boron'] })).includes('No daily value for: Boron'));
    });

    it('explains a withheld verdict instead of counting', () => {
        const unmatched = hoverMarkdown(verdict({ withheld: 'unmatched', matched: 9 }));
        assert.ok(unmatched.startsWith('**Core Vitals** · not enough data\n\n2 days · 2 people · FDA daily values\n\nOnly 9 of 20 ingredients matched'), unmatched);
        assert.ok(!unmatched.includes('Below target'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'missingRecipes', missingRecipes: ['Pesto', 'Rice bowl'] })).includes('Missing recipes: Pesto, Rice bowl'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noData' })).includes('This plan has no recipes'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noData', kind: 'recipe' })).includes('This recipe has no ingredients'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noChecks' })).includes('No daily values for the chosen checks'));
    });

    it('escapes names and stays under the hover limit', () => {
        const markdown = hoverMarkdown(verdict({ withheld: 'missingRecipes', missingRecipes: ['[x](http://evil)'] }));
        assert.ok(markdown.includes('\\[x\\]\\(http\\://evil\\)'), markdown);
        const long = hoverMarkdown(verdict({ below: Array.from({ length: 200 }, (_, i) => ({ label: `Nutrient ${i}`, kind: 'min' as const, percent: 10, lo: 0, hi: 0 })) }));
        assert.ok(long.length <= MAX_HOVER_LENGTH);
        assert.ok(long.includes('and 192 more'));
    });

    it('exposes the locked and unavailable tooltips', () => {
        assert.ok(LOCKED_TOOLTIP.includes('[See plans](https://cook.md/pricing)'));
        assert.ok(UNAVAILABLE_TOOLTIP.startsWith('**Core Vitals** · unavailable'));
    });
});

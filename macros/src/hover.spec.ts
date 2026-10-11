import * as assert from 'assert';
import { FOOTER, MAX_HOVER_LENGTH, WHOLE_RECIPE_NOTE, basisLine, hoverMarkdown, serviceErrorTooltip } from './hover';
import { MacrosResult } from './macros';

const OK: MacrosResult = {
    portion: { kind: 'serving', servings: 4 },
    figures: { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 },
    shares: { protein: 31, carb: 43, fat: 26 },
    match: { matched: 9, total: 10, unmatched: ['salt'] },
    missingRecipes: [],
};

describe('basisLine', () => {
    it('names each basis', () => {
        assert.strictEqual(basisLine({ kind: 'serving', servings: 4 }), 'Per serving (4 servings)');
        assert.strictEqual(basisLine({ kind: 'serving', servings: 1 }), 'Per serving (1 serving)');
        assert.strictEqual(basisLine({ kind: 'serving', servings: 4 / 3 }), 'Per serving (1.33 servings)');
        assert.strictEqual(basisLine({ kind: 'whole' }), `Whole recipe · ${WHOLE_RECIPE_NOTE}`);
        assert.strictEqual(basisLine({ kind: '100g' }), 'Per 100 g');
        assert.strictEqual(basisLine({ kind: 'day', people: 2, days: 7 }), 'Per person per day (2 people × 7 days)');
        assert.strictEqual(basisLine({ kind: 'day', people: 1, days: 1 }), 'Per person per day (1 person × 1 day)');
    });
});

describe('hoverMarkdown', () => {
    it('shows the table, energy, match count, unmatched names and footer', () => {
        assert.strictEqual(hoverMarkdown(OK), [
            '**Macros**',
            'Per serving (4 servings)',
            [
                '| | g | % energy |',
                '|---|---:|---:|',
                '| Protein | 38 | 31 % |',
                '| Carbs | 52 | 43 % |',
                '| Fat | 14 | 26 % |',
                '| Fiber | 6 | |',
                '| Sugar | 9 | |',
                '| Saturated fat | 4 | |',
            ].join('\n'),
            'Energy: **520 kcal**',
            'Ingredients matched: 9 / 10',
            'Not matched: salt',
            FOOTER,
        ].join('\n\n'));
    });

    it('says why figures are withheld and escapes unmatched names', () => {
        const text = hoverMarkdown({
            portion: { kind: 'serving', servings: 4 }, withheld: 'unmatched',
            match: { matched: 2, total: 5, unmatched: ['# heading', '[x](https://evil)', 'ghee'] }, missingRecipes: [],
        });
        assert.ok(text.startsWith('**Macros** · not enough data\n\nPer serving (4 servings)\n\nOnly 2 of 5 ingredients matched'));
        assert.ok(text.includes('Not matched: \\# heading, \\[x\\]\\(https\\://evil\\), ghee'));
        assert.ok(!text.includes('| Protein'));
        assert.ok(text.endsWith(FOOTER));
    });

    it('lists missing plan recipes', () => {
        const text = hoverMarkdown({
            portion: { kind: 'day', people: 2, days: 7 }, withheld: 'missingRecipes',
            match: { matched: 10, total: 10, unmatched: [] }, missingRecipes: ['Curry'],
        });
        assert.ok(text.includes('Missing recipes, so the totals would undercount: Curry'));
    });

    it('stays under the editor limit with a huge unmatched list', () => {
        const names = Array.from({ length: 500 }, (_, index) => `ingredient number ${index} with a long name`.repeat(3));
        const text = hoverMarkdown({ ...OK, match: { matched: 500, total: 1000, unmatched: names } });
        assert.ok(text.length <= MAX_HOVER_LENGTH);
    });
});

describe('serviceErrorTooltip', () => {
    it('escapes the reason and message', () => {
        assert.strictEqual(
            serviceErrorTooltip('network', 'transport error: <b>'),
            '**Macros** · unavailable\n\nThe cook.md nutrition service did not answer (network): transport error\\: \\<b\\>\n\nTry again later; the pill refreshes on the next edit.',
        );
    });
});

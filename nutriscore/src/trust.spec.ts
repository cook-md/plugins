import * as assert from 'assert';
import { escapeMarkdown, formatSource, summarizeTrust, tooltipMarkdown } from './trust';
import { NutritionAggregate, NutritionItem } from './nutrition-template';

const item = (ingredient: string, mass: number, confidence: string, source = 'usda'): NutritionItem => ({
    ingredient, preparation: '', amount: { value: 1, unit: 'g', mass_g: mass },
    macros: { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 },
    micros: {}, source, confidence, warnings: [],
});

const aggregate = (items: NutritionItem[], failed: string[] = []): NutritionAggregate => ({
    items,
    failures: failed.map((ingredient, index) => ({ index, ingredient, error: { code: 'ingredient_not_found', message: 'not found' } })),
    totals: {
        mass_g: items.reduce((sum, i) => sum + i.amount.mass_g, 0),
        macros: { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 },
        micros: {}, confidence: '', confidence_weighted: '', is_partial: failed.length > 0,
        included_count: items.length, failed_count: failed.length,
    },
});

describe('summarizeTrust', () => {
    it('rolls confidence up by mass', () => {
        // (900*1 + 100*0.3) / 1000 = 0.93 -> High
        assert.strictEqual(summarizeTrust(aggregate([item('flour', 900, 'confirmed'), item('vanilla', 100, 'estimated')])).level, 'High');
        // (500*0.6 + 500*0.3) / 1000 = 0.45 -> Low
        assert.strictEqual(summarizeTrust(aggregate([item('a', 500, 'partial'), item('b', 500, 'estimated')])).level, 'Low');
        // (500*1 + 500*0.3) / 1000 = 0.65 -> Medium
        assert.strictEqual(summarizeTrust(aggregate([item('a', 500, 'confirmed'), item('b', 500, 'estimated')])).level, 'Medium');
    });

    it('counts matches, lists unmatched ingredients and groups sources', () => {
        const summary = summarizeTrust(aggregate(
            [item('flour', 500, 'confirmed'), item('milk', 300, 'partial', 'off'), item('egg', 100, 'confirmed')],
            ['pinch of magic'],
        ));
        assert.strictEqual(summary.matched, 3);
        assert.strictEqual(summary.total, 4);
        assert.deepStrictEqual(summary.unmatched, ['pinch of magic']);
        // Milk is only 'partial' (no preparation given), not 'estimated' -- it must not show up as estimated noise.
        assert.deepStrictEqual(summary.estimated, []);
        assert.strictEqual(summary.partial, 1);
        assert.deepStrictEqual(summary.sources, [{ source: 'usda', count: 2 }, { source: 'off', count: 1 }]);
        assert.strictEqual(summary.reliable, true);
    });

    it('lists items with estimated confidence under estimated, separate from partial', () => {
        const summary = summarizeTrust(aggregate(
            [item('flour', 500, 'confirmed'), item('milk', 300, 'partial', 'off'), item('vanilla', 200, 'estimated')],
        ));
        assert.deepStrictEqual(summary.estimated, [{ name: 'vanilla', confidence: 'estimated' }]);
        assert.strictEqual(summary.partial, 1);
    });

    it('is unreliable when more than 30 % of ingredients are unmatched', () => {
        const summary = summarizeTrust(aggregate([item('a', 1, 'confirmed'), item('b', 1, 'confirmed')], ['x']));
        assert.strictEqual(summary.reliable, false);
    });

    it('derives matched/total from items and failures, never from totals counts', () => {
        const good = aggregate([item('a', 1, 'confirmed'), item('b', 1, 'confirmed')], ['x']);
        // Simulate totals counts diverging from the validated arrays (the validator drops malformed
        // entries but totals are passed through verbatim from the service).
        (good.totals as { included_count: number }).included_count = 999;
        (good.totals as { failed_count: number }).failed_count = 999;
        const summary = summarizeTrust(good);
        assert.strictEqual(summary.matched, 2);
        assert.strictEqual(summary.total, 3);
    });

    it('treats a missing/non-string confidence as unknown weight and a missing/non-string source as unknown group', () => {
        const bare = { ...item('mystery', 100, 'confirmed') } as { source?: string; confidence?: string };
        delete bare.source;
        delete bare.confidence;
        const summary = summarizeTrust(aggregate([item('flour', 900, 'confirmed'), bare as unknown as NutritionItem]));
        // (900*1 + 100*0.3) / 1000 = 0.93 -> High, same weight as an 'estimated' item.
        assert.strictEqual(summary.level, 'High');
        assert.deepStrictEqual(summary.estimated, []);
        assert.strictEqual(summary.partial, 0);
        assert.deepStrictEqual(summary.sources, [{ source: 'usda', count: 1 }, { source: 'unknown', count: 1 }]);
    });
});

describe('formatSource', () => {
    it('formats known source codes', () => {
        assert.strictEqual(formatSource('usda_foundation'), 'USDA Foundation');
        assert.strictEqual(formatSource('usda_sr_legacy'), 'USDA SR Legacy');
        assert.strictEqual(formatSource('usda_fndds'), 'USDA FNDDS');
        assert.strictEqual(formatSource('usda'), 'USDA');
        assert.strictEqual(formatSource('off'), 'Open Food Facts');
    });

    it('falls back to underscore-to-space plus capitalised first letter for an unknown source', () => {
        assert.strictEqual(formatSource('some_db'), 'Some db');
    });
});

describe('tooltipMarkdown', () => {
    it('explains a graded score', () => {
        const summary = summarizeTrust(aggregate(
            [item('flour', 900, 'confirmed', 'usda_foundation'), item('milk', 100, 'partial', 'off')],
            ['salt'],
        ));
        const text = tooltipMarkdown({ grade: 'B', score: 1, negative: 7, positive: 6, proteinCounted: true }, summary, 35);
        assert.strictEqual(text, [
            '**Nutri-Score B** · 1 point (negative 7, positive 6)',
            '',
            'Confidence: **High**',
            '',
            'Matched: 2 of 3 ingredients',
            '',
            'Not matched: salt',
            '',
            'Partial matches: 1 (e.g. preparation not specified)',
            '',
            'Sources: USDA Foundation (1), Open Food Facts (1)',
            '',
            'Fruit/veg/legumes: ~35 % (estimated from categories)',
            '',
            '_Estimate from recipe ingredients, not a certified label._',
        ].join('\n'));
    });

    it('shows an Estimated line for items with estimated confidence', () => {
        const summary = summarizeTrust(aggregate([item('flour', 900, 'confirmed'), item('vanilla', 100, 'estimated')]));
        const text = tooltipMarkdown({ grade: 'A', score: -5, negative: 0, positive: 5, proteinCounted: true }, summary, 10);
        assert.ok(text.includes('Estimated: vanilla'));
        assert.ok(!text.includes('Partial matches'));
    });

    it('says why there is no grade and when the fruit/veg share is unknown', () => {
        const summary = summarizeTrust(aggregate([item('a', 1, 'confirmed')], ['x', 'y']));
        const text = tooltipMarkdown(undefined, summary, undefined);
        assert.ok(text.startsWith('**Nutri-Score unavailable**\n\nOnly 1 of 3 ingredients could be matched.'));
        assert.ok(text.includes('Fruit/veg/legumes: unknown (counted as 0 %)'));
    });

    it('says when the recipe could not be weighed', () => {
        const summary = summarizeTrust(aggregate([item('a', 0, 'confirmed')]));
        assert.ok(tooltipMarkdown(undefined, summary, undefined).includes("Ingredient weights are missing, so the score can't be computed per 100 g."));
    });
});

describe('escapeMarkdown', () => {
    it('escapes markdown and HTML specials in ingredient names', () => {
        assert.strictEqual(escapeMarkdown('[x](command:y) *b* <i>'), '\\[x\\]\\(command:y\\) \\*b\\* \\<i\\>');
    });
});

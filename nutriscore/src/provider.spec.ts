import * as assert from 'assert';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { LOCKED_TOOLTIP } from './locked';
import { NutritionAggregate, nutritionTemplate } from './nutrition-template';
import { FVL_CATEGORIES, NutriScoreBadgeProvider } from './provider';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };

const aggregate: NutritionAggregate = {
    items: [{
        ingredient: 'apple', preparation: '', amount: { value: 2, unit: '', mass_g: 300 },
        macros: { kcal: 156, protein_g: 0.9, fat_g: 0.5, carb_g: 41, fiber_g: 7.2, sugar_g: 31, sat_fat_g: 0.1 },
        micros: { sodium_mg: 3 }, source: 'usda', confidence: 'confirmed', warnings: [],
    }],
    failures: [],
    totals: {
        mass_g: 300,
        macros: { kcal: 156, protein_g: 0.9, fat_g: 0.5, carb_g: 41, fiber_g: 7.2, sugar_g: 31, sat_fat_g: 0.1 },
        micros: { sodium_mg: 3 }, confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 1, failed_count: 0,
    },
};

const rendered = (agg: NutritionAggregate, categoryIngredients: string[]): PluginReportResult =>
    ({ ok: true, output: JSON.stringify({ aggregate: agg, categoryIngredients }) });

function provider(options: { feature?: boolean; results?: PluginReportResult[]; showWhenLocked?: boolean }): {
    provider: NutriScoreBadgeProvider; calls: Array<{ command: string; arg: unknown }>; logs: string[];
} {
    const calls: Array<{ command: string; arg: unknown }> = [];
    const logs: string[] = [];
    const results = options.results ?? [rendered(aggregate, ['apple'])];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, arg: args[0] });
        if (command === 'cooklang.api.hasFeature') {
            return options.feature ?? true;
        }
        return results.shift();
    }, async () => []);
    return {
        provider: new NutriScoreBadgeProvider(api, message => logs.push(message), () => options.showWhenLocked ?? true),
        calls,
        logs,
    };
}

describe('NutriScoreBadgeProvider', () => {
    it('renders the nutrition template and returns a graded badge', async () => {
        const { provider: p, calls } = provider({});
        const badge = await p.provide(CONTEXT);
        // per 100 g: 218 kJ (0), sugars 10.3 (3), sat fat 0.03 (0), salt 0.0025 (0) => N 3;
        // fibre 2.4 (0), fvl 100 % (5), protein 0.3 (0) => P 5; score -2 => A.
        assert.strictEqual(badge?.grade, 'A');
        assert.ok(badge?.tooltipMarkdown.startsWith('**Nutri-Score A** · -2 points'));
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', arg: { name: 'nutrition_api' } },
            { command: 'cooklang.api.renderReport', arg: { uri: CONTEXT.uri, template: nutritionTemplate(FVL_CATEGORIES), scale: 2 } },
        ]);
    });

    it('retries without categories when the service does not know a slug', async () => {
        const { provider: p, calls } = provider({ results: [
            { ok: false, reason: 'template', message: 'category not found: legume' },
            rendered(aggregate, []),
        ] });
        const badge = await p.provide(CONTEXT);
        assert.strictEqual(calls.length, 3);
        assert.deepStrictEqual(calls[2].arg, { uri: CONTEXT.uri, template: nutritionTemplate([]), scale: 2 });
        assert.ok(badge?.tooltipMarkdown.includes('Fruit/veg/legumes: unknown (counted as 0 %)'));
    });

    it('shows a locked badge without the nutrition feature, and does not render', async () => {
        const { provider: p, calls } = provider({ feature: false });
        const badge = await p.provide(CONTEXT);
        assert.strictEqual(badge?.grade, 'unknown');
        assert.strictEqual(badge?.tooltipMarkdown, LOCKED_TOOLTIP);
        assert.strictEqual(calls.length, 1);
    });

    it('shows no badge without the nutrition feature when showWhenLocked is off', async () => {
        const { provider: p, calls } = provider({ feature: false, showWhenLocked: false });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(calls.length, 1);
    });

    it('shows a locked badge, still logged once, when the service disagrees with the cached subscription', async () => {
        for (const reason of ['unauthenticated', 'forbidden'] as const) {
            const failure: PluginReportResult = { ok: false, reason, message: 'nope' };
            const { provider: p, logs } = provider({ results: [failure, failure] });
            const badge = await p.provide(CONTEXT);
            assert.strictEqual(badge?.grade, 'unknown');
            assert.strictEqual(badge?.tooltipMarkdown, LOCKED_TOOLTIP);
            assert.ok(await p.provide(CONTEXT));
            assert.deepStrictEqual(logs, [`Nutri-Score unavailable (${reason}): nope`]);
        }
    });

    it('does not show a locked badge for unauthenticated/forbidden when showWhenLocked is off', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'forbidden', message: 'nope' };
        const { provider: p } = provider({ results: [failure], showWhenLocked: false });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
    });

    it('shows no badge on failures and logs each reason once', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const { provider: p, logs } = provider({ results: [failure, failure] });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Nutri-Score unavailable (network): offline']);
    });

    it('shows no badge when the output is not nutrition data', async () => {
        const { provider: p, logs } = provider({ results: [{ ok: true, output: 'nope' }] });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Nutri-Score unavailable (output): unexpected template output']);
    });

    it('returns an unknown grade when too few ingredients matched', async () => {
        const failing = { ...aggregate, failures: [{ index: 1, ingredient: 'x', error: { code: 'ingredient_not_found', message: '' } }] };
        const { provider: p } = provider({ results: [rendered(failing, ['apple'])] });
        assert.strictEqual((await p.provide(CONTEXT))?.grade, 'unknown');
    });

    it('ignores anything that is not a preview context', async () => {
        const { provider: p, calls } = provider({});
        assert.strictEqual(await p.provide({ uri: 3 }), undefined);
        assert.strictEqual(await p.provide({ ...CONTEXT, version: 2 }), undefined);
        assert.strictEqual(calls.length, 0);
    });

    it('remembers that categories are unsupported and skips the retry on later calls', async () => {
        const { provider: p, calls } = provider({ results: [
            { ok: false, reason: 'template', message: 'category not found: legume' },
            rendered(aggregate, []),
            rendered(aggregate, []),
        ] });
        await p.provide(CONTEXT);
        await p.provide(CONTEXT);
        const renderCalls = calls.filter(call => call.command === 'cooklang.api.renderReport');
        assert.strictEqual(renderCalls.length, 3);
        assert.deepStrictEqual(renderCalls[2].arg, { uri: CONTEXT.uri, template: nutritionTemplate([]), scale: 2 });
    });

    it('logs a failure again after a badge succeeds in between', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const { provider: p, logs } = provider({ results: [failure, rendered(aggregate, ['apple']), failure] });
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.ok(await p.provide(CONTEXT));
        assert.strictEqual(await p.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, [
            'Nutri-Score unavailable (network): offline',
            'Nutri-Score unavailable (network): offline',
        ]);
    });
});

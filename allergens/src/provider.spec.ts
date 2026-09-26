import * as assert from 'assert';
import { NAMES_TEMPLATE, STANDARD_TEMPLATE } from './allergen-template';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { LOCKED_TOOLTIP, UNCHECKED_LINE } from './hover';
import { AllergenBadgeProvider } from './provider';
import { AllergenSettings, readSettings } from './settings';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 };

const settings = (values: Record<string, unknown>): AllergenSettings => readSettings(key => values[key]);

const standardOutput: PluginReportResult = {
    ok: true,
    output: JSON.stringify({
        names: ['butter', 'saffron', 'coriander'],
        refs: [],
        aggregate: {
            items: [
                { ingredient: 'butter', allergens: { status: 'verified', contains: [{ class: 'milk', label: 'Milk' }], view: 'eu' } },
                { ingredient: 'saffron', allergens: { status: 'unverified', contains: [], view: 'eu' } },
                { ingredient: 'coriander', allergens: { status: 'verified', contains: [], view: 'eu' } },
            ],
            failures: [],
        },
    }),
};
const namesOutput: PluginReportResult = { ok: true, output: JSON.stringify({ names: ['butter', 'saffron', 'coriander'], refs: [] }) };

function setup(options: { values: Record<string, unknown>; feature?: boolean; results?: PluginReportResult[] }): {
    provider: AllergenBadgeProvider; templates: string[]; logs: string[]; featureChecks: number;
} {
    const state = { templates: [] as string[], logs: [] as string[], featureChecks: 0 };
    const results = options.results ?? [];
    const api = new CooklangApi(async (command, ...args) => {
        if (command === 'cooklang.api.hasFeature') {
            state.featureChecks += 1;
            return options.feature ?? true;
        }
        state.templates.push((args[0] as { template: string }).template);
        return results.shift();
    }, async () => []);
    const provider = new AllergenBadgeProvider(api, message => state.logs.push(message), () => settings(options.values));
    return { provider, get templates() { return state.templates; }, get logs() { return state.logs; }, get featureChecks() { return state.featureChecks; } };
}

describe('AllergenBadgeProvider', () => {
    it('does nothing when no allergen is chosen', async () => {
        const s = setup({ values: {} });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual([s.templates, s.featureChecks], [[], 0]);
    });

    it('ignores a malformed context', async () => {
        const s = setup({ values: { milk: true } });
        assert.strictEqual(await s.provider.provide({ uri: 1 }), undefined);
    });

    it('flags standard and custom hits from one standard render', async () => {
        const s = setup({ values: { milk: true, custom: ['coriander'] }, results: [standardOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.tone, badge?.text], ['bad', '⚠ Milk, coriander']);
        assert.ok(badge?.tooltipMarkdown.includes("Couldn't check: saffron"));
        assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE]);
    });

    it('uses the names template without a feature check when only custom words are set', async () => {
        const s = setup({ values: { custom: ['butter'] }, results: [namesOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ butter');
        assert.deepStrictEqual([s.templates, s.featureChecks], [[NAMES_TEMPLATE], 0]);
    });

    it('warns about linked recipes even when only custom words are set', async () => {
        const s = setup({ values: { custom: ['kiwi'] }, results: [{ ok: true, output: JSON.stringify({ names: ['butter'], refs: ['Pesto'] }) }] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.tone, badge?.text], ['warning', '⚠ Check allergens']);
        assert.ok(badge?.tooltipMarkdown.includes("Couldn't check: Pesto \\(linked recipe\\)"), badge?.tooltipMarkdown);
    });

    it('shows the locked pill without rendering when the plan lacks nutrition and there are no custom words', async () => {
        const s = setup({ values: { milk: true }, feature: false });
        assert.deepStrictEqual(await s.provider.provide(CONTEXT), { kind: 'pill', text: '🔒 Allergens', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.deepStrictEqual(s.templates, []);
    });

    it('still matches custom words for a plan without nutrition, with the locked line', async () => {
        const s = setup({ values: { milk: true, custom: ['coriander'] }, feature: false, results: [namesOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ coriander');
        assert.ok(badge?.tooltipMarkdown.includes('Cook Basic or Pro'));
        assert.deepStrictEqual(s.templates, [NAMES_TEMPLATE]);
    });

    it('falls back to custom words when the service refuses', async () => {
        const s = setup({
            values: { milk: true, custom: ['coriander'] },
            results: [{ ok: false, reason: 'forbidden', message: 'subscription required: x' }, namesOutput],
        });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ coriander');
        assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE, NAMES_TEMPLATE]);
    });

    it('shows the locked pill when the service refuses and there are no custom words', async () => {
        const s = setup({ values: { milk: true }, results: [{ ok: false, reason: 'unauthenticated', message: 'x' }] });
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, '🔒 Allergens');
    });

    it('logs a refusal once across provides on the custom-word fallback', async () => {
        const forbidden: PluginReportResult = { ok: false, reason: 'forbidden', message: 'subscription required: x' };
        const s = setup({ values: { milk: true, custom: ['coriander'] }, results: [forbidden, namesOutput, forbidden, namesOutput] });
        await s.provider.provide(CONTEXT);
        await s.provider.provide(CONTEXT);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (forbidden): subscription required: x']);
    });

    it('warns in amber without a second render when the service is unreachable and there are no custom words', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const s = setup({ values: { milk: true }, results: [failure, failure] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.tone, badge?.text], ['warning', '⚠ Check allergens']);
        assert.ok(badge?.tooltipMarkdown.includes(UNCHECKED_LINE));
        assert.ok(!badge?.tooltipMarkdown.includes('Cook Basic or Pro'));
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, '⚠ Check allergens');
        assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE, STANDARD_TEMPLATE]);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (network): offline']);
    });

    for (const reason of ['server', 'template'] as const) {
        it(`falls back to custom words and says the standard allergens weren't checked on a ${reason} failure`, async () => {
            const s = setup({ values: { milk: true, custom: ['coriander'] }, results: [{ ok: false, reason, message: 'x' }, namesOutput] });
            const badge = await s.provider.provide(CONTEXT);
            assert.deepStrictEqual([badge?.tone, badge?.text], ['bad', '⚠ coriander']);
            assert.ok(badge?.tooltipMarkdown.includes(UNCHECKED_LINE));
            assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE, NAMES_TEMPLATE]);
        });
    }

    it('treats malformed standard output as unchecked', async () => {
        const s = setup({ values: { milk: true }, results: [{ ok: true, output: '{}' }] });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ Check allergens');
        assert.ok(badge?.tooltipMarkdown.includes(UNCHECKED_LINE));
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (output): unexpected template output']);
    });

    it('shows nothing when the names-only render fails, logging each reason once', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const s = setup({ values: { milk: true, custom: ['coriander'] }, results: [failure, failure, failure, failure] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (network): offline']);
    });

    it('shows nothing for malformed names-only output', async () => {
        const s = setup({ values: { custom: ['coriander'] }, results: [{ ok: true, output: '{}' }] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (output): unexpected template output']);
    });

    it('logs a failure again after a successful render', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const s = setup({ values: { milk: true }, results: [failure, standardOutput, failure] });
        await s.provider.provide(CONTEXT);
        await s.provider.provide(CONTEXT);
        await s.provider.provide(CONTEXT);
        assert.strictEqual(s.logs.length, 2);
    });
});

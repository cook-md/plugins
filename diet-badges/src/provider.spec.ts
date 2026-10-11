import * as assert from 'assert';
import { LOCKED_TEXT, UNREACHABLE_TEXT } from './badge';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { DIET_TEMPLATE } from './diet-template';
import { DietBadgeProvider, isMenuUri } from './provider';
import { readSettings } from './settings';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };
const MENU = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 1 };

const verified = (...classes: string[]) => ({ status: 'verified', view: 'eu', contains: classes.map(c => ({ class: c, label: c })) });
const item = (ingredient: string, categories: string[] = [], allergens: unknown = verified()) => ({ ingredient, allergens, warnings: [], categories });
const out = (fields: { names?: string[]; refs?: string[]; missing?: string[]; items?: unknown[]; failures?: unknown[] }): PluginReportResult => ({
    ok: true,
    output: JSON.stringify({ names: fields.names ?? [], refs: fields.refs ?? [], missing: fields.missing ?? [], items: fields.items ?? [], failures: fields.failures ?? [] }),
});
const TOFU = out({ names: ['tofu', 'rice'], items: [item('tofu', [], verified('soybeans')), item('rice')] });
const fail = (reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template', message = 'boom'): PluginReportResult => ({ ok: false, reason, message });

interface Setup {
    provider: DietBadgeProvider;
    renders: Array<{ uri: string; template: string; scale: number }>;
    logs: string[];
    featureChecks: () => number;
}

function setup(options: { values?: Record<string, unknown>; feature?: boolean; results?: PluginReportResult[]; version?: (uri: string) => number | undefined } = {}): Setup {
    const renders: Setup['renders'] = [];
    const logs: string[] = [];
    let featureChecks = 0;
    const results = options.results ?? [];
    const values = options.values ?? {};
    const api = new CooklangApi(async (command, ...args) => {
        if (command === 'cooklang.api.hasFeature') {
            featureChecks += 1;
            return options.feature ?? true;
        }
        renders.push(args[0] as { uri: string; template: string; scale: number });
        return results.shift();
    }, async () => []);
    const provider = new DietBadgeProvider(api, message => logs.push(message), () => readSettings(key => values[key]), options.version);
    return { provider, renders, logs, featureChecks: () => featureChecks };
}

describe('isMenuUri', () => {
    it('recognises .menu files, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/Week.MENU?x=1#y'), true);
        assert.strictEqual(isMenuUri('file:///ws/a.cook'), false);
    });
});

describe('DietBadgeProvider', () => {
    it('ignores a malformed context', async () => {
        const s = setup();
        assert.strictEqual(await s.provider.provide({ uri: 1 }), undefined);
        assert.strictEqual(s.featureChecks(), 0);
    });

    it('does nothing when every diet is switched off', async () => {
        const s = setup({ values: { vegan: false, vegetarian: false, pescatarian: false, dairyFree: false } });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual([s.featureChecks(), s.renders.length], [0, 0]);
    });

    it('shows the locked pill without rendering when the plan lacks nutrition data', async () => {
        const s = setup({ feature: false });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.text, badge?.tone], [LOCKED_TEXT, 'neutral']);
        assert.strictEqual(s.renders.length, 0);
    });

    it('hides the locked pill when showWhenLocked is off', async () => {
        const s = setup({ feature: false, values: { showWhenLocked: false } });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
    });

    it('renders the diet template at scale 1 and returns the badge', async () => {
        const s = setup({ results: [TOFU] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan', 'good']);
        assert.deepStrictEqual(s.renders, [{ uri: CONTEXT.uri, template: DIET_TEMPLATE, scale: 1 }]);
    });

    it('treats an unauthenticated or forbidden render as locked', async () => {
        for (const reason of ['unauthenticated', 'forbidden'] as const) {
            const s = setup({ results: [fail(reason)] });
            assert.strictEqual((await s.provider.provide(CONTEXT))?.text, LOCKED_TEXT, reason);
        }
    });

    it('shows an amber Diet ? when the service is unreachable or erroring', async () => {
        for (const reason of ['network', 'server'] as const) {
            const s = setup({ results: [fail(reason)] });
            const badge = await s.provider.provide(CONTEXT);
            assert.deepStrictEqual([badge?.text, badge?.tone], [UNREACHABLE_TEXT, 'warning'], reason);
        }
    });

    it('shows nothing on a template error or malformed output, logging each reason once', async () => {
        const s = setup({ results: [fail('template', 'bad'), fail('template', 'bad'), { ok: true, output: 'nope' }, TOFU, fail('template', 'bad')] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Diet badges unavailable (template): bad', 'Diet badges unavailable (output): unexpected template output']);
        await s.provider.provide(CONTEXT);
        await s.provider.provide(CONTEXT);
        assert.strictEqual(s.logs.length, 3, 'a good render clears the log-once memory');
    });

    it('shows nothing for an empty recipe', async () => {
        const s = setup({ results: [out({})] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
    });

    it('warns about missing recipes in a menu', async () => {
        const s = setup({ results: [out({ names: ['rice'], items: [item('rice')], missing: ['Lasagne'] })] });
        const badge = await s.provider.provide(MENU);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan?', 'warning']);
        assert.ok(badge?.tooltipMarkdown.includes('Lasagne \\(recipe not found\\)'), badge?.tooltipMarkdown);
    });

    it('caches an open recipe\'s badge by uri, document version and settings', async () => {
        let version = 1;
        const values: Record<string, unknown> = {};
        const s = setup({ results: [TOFU, TOFU, TOFU], version: () => version, values });
        await s.provider.provide(CONTEXT);
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, 'Vegan');
        assert.strictEqual(s.renders.length, 1);
        version = 2;
        await s.provider.provide(CONTEXT);
        assert.strictEqual(s.renders.length, 2);
        values.vegan = false;
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, 'Vegetarian · Dairy-free');
        assert.strictEqual(s.renders.length, 3);
    });

    it('still checks the plan before using the cache', async () => {
        let feature = true;
        const renders: unknown[] = [];
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return feature;
            }
            renders.push(args[0]);
            return TOFU;
        }, async () => []);
        const provider = new DietBadgeProvider(api, () => undefined, () => readSettings(() => undefined), () => 1);
        assert.strictEqual((await provider.provide(CONTEXT))?.text, 'Vegan');
        feature = false;
        assert.strictEqual((await provider.provide(CONTEXT))?.text, LOCKED_TEXT);
        assert.strictEqual(renders.length, 1);
    });

    it('does not cache without a document version, for menus, or on errors', async () => {
        const noVersion = setup({ results: [TOFU, TOFU] });
        await noVersion.provider.provide(CONTEXT);
        await noVersion.provider.provide(CONTEXT);
        assert.strictEqual(noVersion.renders.length, 2);

        const menu = setup({ results: [TOFU, TOFU], version: () => 1 });
        await menu.provider.provide(MENU);
        await menu.provider.provide(MENU);
        assert.strictEqual(menu.renders.length, 2);

        const flaky = setup({ results: [fail('network'), TOFU], version: () => 1 });
        assert.strictEqual((await flaky.provider.provide(CONTEXT))?.text, UNREACHABLE_TEXT);
        assert.strictEqual((await flaky.provider.provide(CONTEXT))?.text, 'Vegan');
    });
});

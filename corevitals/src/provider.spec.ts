import * as assert from 'assert';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { CoreVitalsBadgeProvider, isMenuUri } from './provider';
import { CoreVitalsSettings } from './settings';
import { VitalsOutput } from './vitals-template';

const SETTINGS: CoreVitalsSettings = {
    standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

const OUTPUT: VitalsOutput = {
    kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20,
    rows: [{ key: 'kcal', label: 'Energy', kind: 'energy', unit: 'kcal', actual: 3800, target: 4000, lo: 0, hi: 0, percent: 95, ok: true, skipped: false }],
    matched: 18, total: 20, unmatched: [], missingRecipes: [], confidence: 'confirmed',
};

class Fixture {
    features = new Set<string>(['nutrition_api']);
    result: PluginReportResult = { ok: true, output: JSON.stringify(OUTPUT) };
    renders: Array<{ uri: string; template: string; scale: number }> = [];
    logs: string[] = [];
    texts = new Map<string, string>();
    settings: CoreVitalsSettings = SETTINGS;

    provider(): CoreVitalsBadgeProvider {
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return this.features.has((args[0] as { name: string }).name);
            }
            if (command === 'cooklang.api.renderReport') {
                this.renders.push(args[0] as { uri: string; template: string; scale: number });
                return this.result;
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => ['cooklang.api.hasFeature', 'cooklang.api.renderReport']);
        return new CoreVitalsBadgeProvider(api, message => this.logs.push(message), () => this.settings, async uri => this.texts.get(uri));
    }
}

const PLAN_CONTEXT = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 2 };
const RECIPE_CONTEXT = { version: 1, uri: 'file:///ws/Pancakes.cook', path: 'Pancakes.cook', scale: 1 };

describe('isMenuUri', () => {
    it('matches .menu case-insensitively, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/WEEK.MENU?x=1#top'), true);
        assert.strictEqual(isMenuUri('file:///ws/Pancakes.cook'), false);
    });
});

describe('CoreVitalsBadgeProvider', () => {
    it('ignores arguments that are not a preview context', async () => {
        assert.strictEqual(await new Fixture().provider().provide({ nope: true }), undefined);
    });

    it('renders the json template at scale 1 for a plan and returns the verdict pill', async () => {
        const fixture = new Fixture();
        const badge = await fixture.provider().provide(PLAN_CONTEXT);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Vitals 1/1', tone: 'good' });
        assert.ok(badge?.tooltipMarkdown.includes('2 days · 2 people · FDA daily values'));
        assert.strictEqual(fixture.renders.length, 1);
        assert.strictEqual(fixture.renders[0].uri, 'file:///ws/week.menu');
        assert.strictEqual(fixture.renders[0].scale, 1);
        assert.ok(fixture.renders[0].template.startsWith('{%- set mode = "json" -%}'));
        assert.ok(fixture.renders[0].template.includes('"servings": 1'));
    });

    it('reads the recipe servings from the document text and reports them as known', async () => {
        const fixture = new Fixture();
        fixture.texts.set('file:///ws/Pancakes.cook', '---\nservings: 4\n---\nMix @eggs{2}.');
        fixture.result = { ok: true, output: JSON.stringify({ ...OUTPUT, kind: 'recipe', days: 1, people: 4 }) };
        const badge = await fixture.provider().provide(RECIPE_CONTEXT);
        assert.ok(fixture.renders[0].template.includes('"servings": 4'), fixture.renders[0].template.slice(0, 400));
        assert.ok(badge?.tooltipMarkdown.includes('Per serving (4 servings) · one meal = ⅓ of a day'), badge?.tooltipMarkdown);
    });

    it('assumes one serving, reported as unknown, when the recipe has none', async () => {
        const fixture = new Fixture();
        fixture.result = { ok: true, output: JSON.stringify({ ...OUTPUT, kind: 'recipe', days: 1, people: 1 }) };
        const badge = await fixture.provider().provide(RECIPE_CONTEXT);
        assert.ok(fixture.renders[0].template.includes('"servings": 1'));
        assert.ok(badge?.tooltipMarkdown.includes('Whole recipe (no servings in frontmatter)'), badge?.tooltipMarkdown);
    });

    it('returns the locked badge without the plan feature, honouring showWhenLocked', async () => {
        const fixture = new Fixture();
        fixture.features.clear();
        assert.strictEqual((await fixture.provider().provide(PLAN_CONTEXT))?.text, '🔒 Vitals');
        assert.strictEqual(fixture.renders.length, 0);
        fixture.settings = { ...SETTINGS, showWhenLocked: false };
        assert.strictEqual(await fixture.provider().provide(PLAN_CONTEXT), undefined);
    });

    it('treats unauthenticated and forbidden renders as locked', async () => {
        const fixture = new Fixture();
        fixture.result = { ok: false, reason: 'forbidden', message: 'plan lapsed' };
        assert.strictEqual((await fixture.provider().provide(PLAN_CONTEXT))?.text, '🔒 Vitals');
    });

    it('returns no badge on network, server and template failures, logging once per reason', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        fixture.result = { ok: false, reason: 'network', message: 'offline' };
        assert.strictEqual(await provider.provide(PLAN_CONTEXT), undefined);
        assert.strictEqual(await provider.provide(PLAN_CONTEXT), undefined);
        assert.deepStrictEqual(fixture.logs, ['Core Vitals unavailable (network): offline']);
        fixture.result = { ok: false, reason: 'template', message: 'syntax' };
        await provider.provide(PLAN_CONTEXT);
        assert.strictEqual(fixture.logs.length, 2);
    });

    it('returns the unavailable pill when the output cannot be read, and logs again after a success', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        fixture.result = { ok: true, output: 'garbage' };
        assert.strictEqual((await provider.provide(PLAN_CONTEXT))?.text, 'Vitals ?');
        assert.deepStrictEqual(fixture.logs, ['Core Vitals unavailable (output): unexpected template output']);
        fixture.result = { ok: true, output: JSON.stringify(OUTPUT) };
        await provider.provide(PLAN_CONTEXT);
        fixture.result = { ok: true, output: 'garbage' };
        await provider.provide(PLAN_CONTEXT);
        assert.strictEqual(fixture.logs.length, 2);
    });
});

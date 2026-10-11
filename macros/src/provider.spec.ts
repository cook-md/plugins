import * as assert from 'assert';
import { LOCKED_TEXT } from './badge';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { LOCKED_TOOLTIP } from './hover';
import { MacrosBadgeProvider, isMenuUri } from './provider';
import { MACROS_TEMPLATE, NutritionAggregate, NutritionMacros } from './nutrition-template';
import { MacrosSettings } from './settings';

const MACROS: NutritionMacros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

function aggregate(factor = 1, failures: string[] = []): NutritionAggregate {
    const scaled = Object.fromEntries(Object.entries(MACROS).map(([key, value]) => [key, value * factor])) as unknown as NutritionMacros;
    return {
        items: ['chicken', 'rice', 'onion', 'oil'].map(ingredient => ({ ingredient, amount: { mass_g: 225 * factor }, warnings: [] })),
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: 900 * factor, macros: scaled },
    };
}

const recipeResult = (agg: NutritionAggregate = aggregate()): PluginReportResult => ({ ok: true, output: JSON.stringify({ kind: 'recipe', aggregate: agg }) });

const RECIPE = { version: 1, uri: 'file:///ws/Chicken.cook', path: 'Chicken.cook', scale: 1 };
const MENU = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 3 };
const FOUR_SERVINGS = '---\ntitle: Chicken and rice\nservings: 4\n---\nCook @chicken{600%g} with @rice{300%g}.';

class Fixture {
    features = new Set<string>(['nutrition_api']);
    results: PluginReportResult[] = [];
    renders: Array<{ uri: string; template: string; scale: number }> = [];
    logs: string[] = [];
    texts = new Map<string, string>([[RECIPE.uri, FOUR_SERVINGS]]);
    settings: MacrosSettings = { showEnergy: true, basis: 'serving', showWhenLocked: true };

    provider(): MacrosBadgeProvider {
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return this.features.has((args[0] as { name: string }).name);
            }
            if (command === 'cooklang.api.renderReport') {
                this.renders.push(args[0] as { uri: string; template: string; scale: number });
                return this.results.shift() ?? recipeResult();
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => ['cooklang.api.hasFeature', 'cooklang.api.renderReport']);
        return new MacrosBadgeProvider(api, message => this.logs.push(message), () => this.settings, async uri => this.texts.get(uri));
    }
}

describe('isMenuUri', () => {
    it('matches .menu case-insensitively, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/WEEK.MENU?x=1#top'), true);
        assert.strictEqual(isMenuUri('file:///ws/Chicken.cook'), false);
    });
});

describe('MacrosBadgeProvider', () => {
    it('ignores arguments that are not a preview context', async () => {
        assert.strictEqual(await new Fixture().provider().provide({ nope: true }), undefined);
    });

    it('renders the template at the preview scale and shows per-serving macros', async () => {
        const fixture = new Fixture();
        const badge = await fixture.provider().provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: '38P 52C 14F · 520 kcal', tone: 'neutral' });
        assert.ok(badge?.tooltipMarkdown.includes('Per serving (4 servings)'));
        assert.deepStrictEqual(fixture.renders, [{ uri: RECIPE.uri, template: MACROS_TEMPLATE, scale: 1 }]);
    });

    it('keeps per-serving numbers when the preview is scaled', async () => {
        const fixture = new Fixture();
        fixture.results = [recipeResult(aggregate(2))];
        const badge = await fixture.provider().provide({ ...RECIPE, scale: 2 });
        assert.strictEqual(badge?.text, '38P 52C 14F · 520 kcal');
        assert.ok(badge?.tooltipMarkdown.includes('Per serving (8 servings)'));
        assert.strictEqual(fixture.renders[0].scale, 2);
    });

    it('shows the whole recipe without servings, or when the text cannot be read', async () => {
        const fixture = new Fixture();
        fixture.texts.set(RECIPE.uri, 'Cook @chicken{600%g}.');
        const badge = await fixture.provider().provide(RECIPE);
        assert.strictEqual(badge?.text, '152P 208C 56F · whole');
        assert.ok(badge?.tooltipMarkdown.includes('No `servings:` in the frontmatter'));

        const unreadable = new Fixture();
        unreadable.texts.clear();
        assert.strictEqual((await unreadable.provider().provide(RECIPE))?.text, '152P 208C 56F · whole');
        assert.deepStrictEqual(unreadable.logs, ['Macros unavailable (read): could not read the recipe text; showing the whole recipe']);
    });

    it('renders a menu at scale 1 and divides by people × days', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(14), days: 7, people: 2, missingRecipes: [] }) }];
        const badge = await fixture.provider().provide(MENU);
        assert.strictEqual(badge?.text, '152P 208C 56F /day');
        assert.ok(badge?.tooltipMarkdown.includes('Per person per day (2 people × 7 days)'));
        assert.deepStrictEqual(fixture.renders, [{ uri: MENU.uri, template: MACROS_TEMPLATE, scale: 1 }]);
    });

    it('divides a menu by fractional people × days', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(5), days: 2, people: 2.5, missingRecipes: [] }) }];
        const badge = await fixture.provider().provide(MENU);
        // 5 × (152P 208C 56F) / (2.5 × 2) = 152P 208C 56F
        assert.strictEqual(badge?.text, '152P 208C 56F /day');
        assert.ok(badge?.tooltipMarkdown.includes('Per person per day (2.5 people × 2 days)'));
    });

    it('uses the per-100 g basis from the settings', async () => {
        const fixture = new Fixture();
        fixture.settings = { ...fixture.settings, basis: '100g' };
        const badge = await fixture.provider().provide(RECIPE);
        // 900 g: 231 kcal, 16.9 g protein, 23.1 g carbs, 6.2 g fat per 100 g; the energy does not fit in 24 characters.
        assert.strictEqual(badge?.text, '17P 23C 6F /100g');
        assert.ok(badge?.tooltipMarkdown.includes('Energy: **230 kcal**'));
    });

    it('shows Macros ? as a warning when too few ingredients matched', async () => {
        const fixture = new Fixture();
        fixture.results = [recipeResult(aggregate(1, ['ghee', 'garam masala']))];
        const badge = await fixture.provider().provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge?.tooltipMarkdown.includes('Not matched: ghee, garam masala'));
    });

    it('shows the locked pill without the nutrition feature, and does not render', async () => {
        const fixture = new Fixture();
        fixture.features.clear();
        assert.deepStrictEqual(await fixture.provider().provide(RECIPE), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(fixture.renders.length, 0);
        fixture.settings = { ...fixture.settings, showWhenLocked: false };
        assert.strictEqual(await fixture.provider().provide(RECIPE), undefined);
    });

    it('shows the locked pill when the service rejects the sign-in or plan', async () => {
        for (const reason of ['unauthenticated', 'forbidden'] as const) {
            const fixture = new Fixture();
            fixture.results = [{ ok: false, reason, message: 'nope' }];
            assert.strictEqual((await fixture.provider().provide(RECIPE))?.text, LOCKED_TEXT);
            assert.deepStrictEqual(fixture.logs, [`Macros unavailable (${reason}): nope`]);
        }
    });

    it('shows a warning pill with the reason on network and server errors, logging each reason once', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: false, reason: 'network', message: 'offline' }, { ok: false, reason: 'network', message: 'offline' }];
        const provider = fixture.provider();
        const badge = await provider.provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge?.tooltipMarkdown.includes('(network): offline'));
        await provider.provide(RECIPE);
        assert.deepStrictEqual(fixture.logs, ['Macros unavailable (network): offline']);
    });

    it('shows no pill on a template error or malformed output, and logs it', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: false, reason: 'template', message: 'undefined function' }, { ok: true, output: 'nope' }];
        const provider = fixture.provider();
        assert.strictEqual(await provider.provide(RECIPE), undefined);
        assert.strictEqual(await provider.provide(RECIPE), undefined);
        assert.deepStrictEqual(fixture.logs, ['Macros unavailable (template): undefined function', 'Macros unavailable (output): unexpected template output']);
    });

    it('rejects a plan payload for a recipe', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: [] }) }];
        assert.strictEqual(await fixture.provider().provide(RECIPE), undefined);
    });

    it('re-uses a cached render for the same recipe text and scale, e.g. after a settings change', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        await provider.provide(RECIPE);
        fixture.settings = { ...fixture.settings, showEnergy: false };
        assert.strictEqual((await provider.provide(RECIPE))?.text, '38P 52C 14F');
        assert.strictEqual(fixture.renders.length, 1);

        await provider.provide({ ...RECIPE, scale: 2 });
        fixture.texts.set(RECIPE.uri, `${FOUR_SERVINGS}\nServe.`);
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 3);

        provider.clearCache();
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 4);
    });

    it('does not cache menus or failures', async () => {
        const fixture = new Fixture();
        const plan: PluginReportResult = { ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: [] }) };
        fixture.results = [plan, plan, { ok: false, reason: 'network', message: 'offline' }];
        const provider = fixture.provider();
        await provider.provide(MENU);
        await provider.provide(MENU);
        await provider.provide(RECIPE);
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 4);
    });
});

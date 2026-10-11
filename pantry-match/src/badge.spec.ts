import * as assert from 'assert';
import { badgeFor, PantryBadgeProvider } from './badge';
import { PantryItem } from './cooklang-api';
import { PantryLookup, pantryLookup } from './match';
import { IngredientName, RenderedNames } from './names-template';

const CONTEXT = { version: 1, uri: 'file:///ws/Pasta.cook', path: 'Pasta.cook', scale: 1 };
const pantryItem = (name: string): PantryItem => ({ name, isLow: false, isOutOfStock: false });
const rendered = (...names: string[]): RenderedNames => ({ ok: true, names: { names: names.map(name => ({ name, optional: false })), refs: [] } });

function setup(options: { show?: boolean; lookup?: PantryLookup | undefined; result?: RenderedNames; extra?: IngredientName[] }): {
    provider: PantryBadgeProvider; logs: string[]; expanded: string[];
} {
    const logs: string[] = [];
    const expanded: string[] = [];
    const provider = new PantryBadgeProvider({
        showBadge: () => options.show ?? true,
        lookup: () => 'lookup' in options ? options.lookup : pantryLookup([pantryItem('pasta'), pantryItem('basil')], ['salt']),
        render: async () => options.result ?? rendered('pasta', 'basil', 'salt'),
        expand: async (path, own) => {
            expanded.push(path);
            return [...own.names, ...(options.extra ?? [])];
        },
        log: message => logs.push(message),
    });
    return { provider, logs, expanded };
}

describe('badgeFor', () => {
    it('is good with everything in stock', () => {
        assert.deepStrictEqual(badgeFor({ covered: 2, total: 2, missing: [], uses: new Set() }), {
            kind: 'pill', text: 'Have 2/2', tone: 'good', tooltipMarkdown: '**You have all 2 ingredients** in your pantry.',
        });
    });

    it('is neutral and lists what is missing', () => {
        assert.deepStrictEqual(badgeFor({ covered: 9, total: 11, missing: ['pine nuts', 'parmesan'], uses: new Set() }), {
            kind: 'pill', text: 'Have 9/11', tone: 'neutral', tooltipMarkdown: '**Have 9 of 11 ingredients.**\n\nMissing: pine nuts, parmesan',
        });
    });

    it('escapes ingredient names in the hover', () => {
        const badge = badgeFor({ covered: 0, total: 1, missing: ['[x](y)'], uses: new Set() });
        assert.strictEqual(badge?.tooltipMarkdown, '**Have 0 of 1 ingredients.**\n\nMissing: \\[x\\]\\(y\\)');
    });

    it('shows nothing when the recipe has nothing to check', () => {
        assert.strictEqual(badgeFor({ covered: 0, total: 0, missing: [], uses: new Set() }), undefined);
    });
});

describe('PantryBadgeProvider', () => {
    it('counts the recipe and its linked recipes, leaving alwaysHave out', async () => {
        const { provider, expanded } = setup({ extra: [{ name: 'pine nuts', optional: false }] });
        const badge = await provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, 'Have 2/3');
        assert.strictEqual(badge?.tone, 'neutral');
        assert.deepStrictEqual(expanded, ['Pasta.cook']);
    });

    it('returns nothing when turned off, without a usable pantry, or for a bad context', async () => {
        assert.strictEqual(await setup({ show: false }).provider.provide(CONTEXT), undefined);
        assert.strictEqual(await setup({ lookup: undefined }).provider.provide(CONTEXT), undefined);
        assert.strictEqual(await setup({}).provider.provide({ uri: 'x' }), undefined);
    });

    it('logs and returns nothing when the recipe cannot be rendered', async () => {
        const { provider, logs } = setup({ result: { ok: false, message: 'syntax error' } });
        assert.strictEqual(await provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Pantry Match: could not read Pasta.cook: syntax error']);
    });
});

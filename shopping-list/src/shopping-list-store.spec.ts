import * as assert from 'assert';
import { CheckEntry, CooklangApi, ShoppingListFile, ShoppingListResult } from './cooklang-api';
import { CHECKED_FILE, LIST_FILE, ListFiles, ShoppingListStore } from './shopping-list-store';

class FakeFiles implements ListFiles {
    files = new Map<string, string>();
    async read(name: string): Promise<string | undefined> { return this.files.get(name); }
    async write(name: string, text: string): Promise<void> { this.files.set(name, text); }
    async delete(name: string): Promise<void> { this.files.delete(name); }
}

/** Line formats mimic the real ones closely enough for the store's logic. */
class FakeApi extends CooklangApi {
    generate: (recipes: ReadonlyArray<{ path: string; scale: number }>) => Promise<ShoppingListResult> = async () => ({
        categories: [], other: { name: 'other', items: [{ name: 'flour', quantities: '' }] }, pantryItems: [],
    });
    generateCalls: Array<ReadonlyArray<{ path: string; scale: number }>> = [];

    constructor() { super(async () => undefined); }

    override async generateShoppingList(recipes: ReadonlyArray<{ path: string; scale: number }>): Promise<ShoppingListResult> {
        this.generateCalls.push(recipes);
        return this.generate(recipes);
    }
    override async parseShoppingList(text: string): Promise<ShoppingListFile> {
        if (text.trim() === 'GARBAGE') {
            throw new Error('unexpected token');
        }
        return { items: text.split('\n').filter(line => line.trim()).map(line => ({ type: 'recipe', path: line.trim(), children: [] })) };
    }
    override async writeShoppingList(list: ShoppingListFile): Promise<string> {
        return list.items.map(item => item.path).join('\n') + (list.items.length > 0 ? '\n' : '');
    }
    override async parseShoppingChecked(text: string): Promise<CheckEntry[]> {
        const entries: CheckEntry[] = [];
        for (const line of text.split('\n')) {
            if (line.startsWith('+ ')) { entries.push({ type: 'checked', name: line.slice(2) }); }
            if (line.startsWith('- ')) { entries.push({ type: 'unchecked', name: line.slice(2) }); }
        }
        return entries;
    }
    override async writeShoppingChecked(entries: readonly CheckEntry[]): Promise<string> {
        return entries.map(entry => `${entry.type === 'checked' ? '+' : '-'} ${entry.name}\n`).join('');
    }
    override async compactShoppingChecked(entries: readonly CheckEntry[], ingredients: readonly string[]): Promise<CheckEntry[]> {
        const present = new Set(ingredients.map(name => name.toLowerCase()));
        return entries.filter(entry => present.has(entry.name.toLowerCase()));
    }
}

function makeStore(): { store: ShoppingListStore; files: FakeFiles; api: FakeApi } {
    const files = new FakeFiles();
    const api = new FakeApi();
    const store = new ShoppingListStore(files, api);
    store.reloadDebounceMs = 5;
    return { store, files, api };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ShoppingListStore', () => {
    it('addRecipe appends to the list, persists it and regenerates', async () => {
        const { store, files, api } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        assert.strictEqual(store.getItems().length, 1);
        assert.strictEqual(files.files.get(LIST_FILE), 'pasta.cook\n');
        assert.deepStrictEqual(api.generateCalls, [[{ path: 'pasta.cook', scale: 1 }]]);
        assert.strictEqual(store.getResult()?.other.items[0].name, 'flour');
    });

    it('stores a scale other than 1 as the multiplier', async () => {
        const { store } = makeStore();
        await store.addRecipe('pasta.cook', 2);
        assert.strictEqual(store.getItems()[0].multiplier, 2);
    });

    it('addMenu creates a nested structure', async () => {
        const { store } = makeStore();
        await store.addMenu('weekday.menu', 1, [{ path: 'pasta.cook', scale: 1 }, { path: 'salad.cook', scale: 2 }]);
        const items = store.getItems();
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].children.length, 2);
        assert.strictEqual(items[0].children[1].multiplier, 2);
    });

    it('addMenu keeps references nested below the menu recipes (cookcli#509)', async () => {
        const { store } = makeStore();
        await store.addMenu('week.menu', 1, [
            { path: 'Dinner', scale: 1, children: [{ path: 'Sauce', scale: 0.5, children: [{ path: 'Prep', scale: 2 }] }] },
        ]);
        const dinner = store.getItems()[0].children[0];
        assert.strictEqual(dinner.path, 'Dinner');
        assert.strictEqual(dinner.children[0].path, 'Sauce');
        assert.strictEqual(dinner.children[0].multiplier, 0.5);
        assert.strictEqual(dinner.children[0].children[0].path, 'Prep');
        assert.strictEqual(dinner.children[0].children[0].multiplier, 2);
    });

    it('addRecipe strips ./ from references at every depth', async () => {
        const { store } = makeStore();
        await store.addRecipe('a.cook', 1, [{ path: './b', scale: 1, children: [{ path: './c', scale: 1, children: [{ path: 'd', scale: 1 }] }] }]);
        const b = store.getItems()[0].children[0];
        assert.strictEqual(b.path, 'b');
        assert.strictEqual(b.children[0].path, 'c');
        assert.strictEqual(b.children[0].children[0].path, 'd');
    });

    it('generates from the flattened tree with multipliers applied down', async () => {
        const { store, api } = makeStore();
        await store.addMenu('week.menu', 2, [{ path: 'Dinner', scale: 1, children: [{ path: 'Sauce', scale: 0.5 }] }]);
        assert.deepStrictEqual(api.generateCalls.at(-1), [
            { path: 'week.menu', scale: 2 }, { path: 'Dinner', scale: 2 }, { path: 'Sauce', scale: 1 },
        ]);
    });

    it('updateScale and removeRecipe persist and ignore bad indexes', async () => {
        const { store, files } = makeStore();
        await store.addRecipe('a.cook', 1);
        await store.addRecipe('b.cook', 1);
        await store.updateScale(0, 3);
        assert.strictEqual(store.getItems()[0].multiplier, 3);
        await store.updateScale(0, 1);
        assert.strictEqual(store.getItems()[0].multiplier, undefined);
        await store.removeRecipe(5);
        await store.removeRecipe(0);
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['b.cook']);
        assert.strictEqual(files.files.get(LIST_FILE), 'b.cook\n');
    });

    it('checkItem appends to .shopping-checked and updates the set case-insensitively', async () => {
        const { store, files } = makeStore();
        await store.checkItem('Flour');
        assert.strictEqual(store.isChecked('flour'), true);
        assert.strictEqual(files.files.get(CHECKED_FILE), '+ Flour\n');
    });

    it('uncheckItem reverses a prior check', async () => {
        const { store } = makeStore();
        await store.checkItem('flour');
        await store.uncheckItem('flour');
        assert.strictEqual(store.isChecked('flour'), false);
    });

    it('clearAll deletes both files and resets state', async () => {
        const { store, files } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        await store.checkItem('flour');
        await store.clearAll();
        assert.strictEqual(files.files.has(LIST_FILE), false);
        assert.strictEqual(files.files.has(CHECKED_FILE), false);
        assert.strictEqual(store.getItems().length, 0);
        assert.strictEqual(store.getResult(), undefined);
    });

    it('removeRecipe compacts stale checks', async () => {
        const { store, files, api } = makeStore();
        api.generate = async recipes => ({
            categories: [],
            other: {
                name: 'other',
                items: recipes.some(recipe => recipe.path === 'bread.cook')
                    ? [{ name: 'flour', quantities: '' }, { name: 'milk', quantities: '' }]
                    : [{ name: 'flour', quantities: '' }],
            },
            pantryItems: [],
        });
        await store.addRecipe('pasta.cook', 1);
        await store.addRecipe('bread.cook', 1);
        await store.checkItem('flour');
        await store.checkItem('milk');
        await store.removeRecipe(1);
        const checked = files.files.get(CHECKED_FILE) ?? '';
        assert.strictEqual(checked.includes('milk'), false);
        assert.strictEqual(checked.includes('+ flour'), true);
        assert.strictEqual(store.isChecked('milk'), false);
    });

    it('keeps the error when generation fails and clears it on success', async () => {
        const { store, api } = makeStore();
        api.generate = async () => { throw new Error('native exploded'); };
        await store.addRecipe('a.cook', 1);
        assert.strictEqual(store.getResult(), undefined);
        assert.match(store.getError() ?? '', /native exploded/);
        api.generate = async () => ({ categories: [], other: { name: 'other', items: [] }, pantryItems: [] });
        await store.regenerate();
        assert.strictEqual(store.getError(), undefined);
    });

    it('load reads both files', async () => {
        const { store, files } = makeStore();
        files.files.set(LIST_FILE, 'pasta.cook\nsoup.cook\n');
        files.files.set(CHECKED_FILE, '+ flour\n');
        await store.load();
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['pasta.cook', 'soup.cook']);
        assert.strictEqual(store.isChecked('flour'), true);
    });

    it('reloads after an external change and resets when the list is deleted', async () => {
        const { store, files } = makeStore();
        await store.load();
        let changes = 0;
        store.onDidChange(() => { changes += 1; });
        files.files.set(LIST_FILE, 'pasta.cook\n');
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.getItems().length, 1);
        assert.ok(changes > 0);
        files.files.delete(LIST_FILE);
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.getItems().length, 0);
        assert.strictEqual(store.getResult(), undefined);
    });

    it('an external unchecked entry wins', async () => {
        const { store, files } = makeStore();
        files.files.set(CHECKED_FILE, '+ flour\n- flour\n');
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(store.isChecked('flour'), false);
    });

    it('coalesces rapid reload requests into one load', async () => {
        const { store } = makeStore();
        let loads = 0;
        const original = store.load.bind(store);
        store.load = async () => { loads += 1; return original(); };
        for (let i = 0; i < 5; i += 1) { store.scheduleReload(); }
        await sleep(30);
        assert.strictEqual(loads, 1);
    });

    it('stops reloading after dispose()', async () => {
        const { store } = makeStore();
        let loads = 0;
        const original = store.load.bind(store);
        store.load = async () => { loads += 1; return original(); };
        store.scheduleReload();
        store.dispose();
        await sleep(30);
        store.scheduleReload();
        await sleep(30);
        assert.strictEqual(loads, 0);
    });

    it('handles the echo of its own write idempotently', async () => {
        const { store } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        await store.checkItem('flour');
        store.scheduleReload();
        await sleep(30);
        assert.deepStrictEqual(store.getItems().map(item => item.path), ['pasta.cook']);
        assert.strictEqual(store.isChecked('flour'), true);
    });

    it('keeps both of two concurrent checks', async () => {
        const { store, files } = makeStore();
        await Promise.all([store.checkItem('flour'), store.checkItem('milk')]);
        const checked = files.files.get(CHECKED_FILE) ?? '';
        assert.strictEqual(checked.includes('+ flour'), true);
        assert.strictEqual(checked.includes('+ milk'), true);
        assert.strictEqual(store.isChecked('flour'), true);
        assert.strictEqual(store.isChecked('milk'), true);
    });

    it('never overwrites an unreadable .shopping-list', async () => {
        const { store, files } = makeStore();
        files.files.set(LIST_FILE, 'GARBAGE');
        await store.load();
        assert.match(store.getError() ?? '', /\.shopping-list/);
        await store.regenerate();
        assert.match(store.getError() ?? '', /\.shopping-list/);
        await assert.rejects(store.addRecipe('pasta.cook', 1), /\.shopping-list/);
        await assert.rejects(store.updateScale(0, 2), /\.shopping-list/);
        await assert.rejects(store.removeRecipe(0), /\.shopping-list/);
        assert.strictEqual(files.files.get(LIST_FILE), 'GARBAGE');
        await store.clearAll();
        await store.addRecipe('pasta.cook', 1);
        assert.strictEqual(files.files.get(LIST_FILE), 'pasta.cook\n');
    });

    it('a successful load clears the unreadable state', async () => {
        const { store, files } = makeStore();
        files.files.set(LIST_FILE, 'GARBAGE');
        await store.load();
        files.files.set(LIST_FILE, 'pasta.cook\n');
        await store.load();
        assert.strictEqual(store.getError(), undefined);
        await store.addRecipe('soup.cook', 1);
        assert.strictEqual(files.files.get(LIST_FILE), 'pasta.cook\nsoup.cook\n');
    });

    it('discards a stale regenerate result', async () => {
        const { store, api } = makeStore();
        await store.addRecipe('pasta.cook', 1);
        let releaseFirst: () => void = () => undefined;
        const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
        let call = 0;
        api.generate = async () => {
            call += 1;
            if (call === 1) {
                await firstGate;
                return { categories: [], other: { name: 'other', items: [{ name: 'stale', quantities: '' }] }, pantryItems: [] };
            }
            return { categories: [], other: { name: 'other', items: [{ name: 'fresh', quantities: '' }] }, pantryItems: [] };
        };
        const first = store.regenerate();
        const second = store.regenerate();
        await second;
        releaseFirst();
        await first;
        assert.strictEqual(store.getResult()?.other.items[0].name, 'fresh');
    });
});

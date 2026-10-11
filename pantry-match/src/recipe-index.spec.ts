import * as assert from 'assert';
import { RenderedNames } from './names-template';
import { IndexDeps, mapInBatches, RecipeFile, RecipeIndex } from './recipe-index';

const ok = (...names: string[]): RenderedNames => ({ ok: true, names: { names: names.map(name => ({ name, optional: false })), refs: [] } });
const file = (path: string): RecipeFile => ({ uri: `file:///ws/${path}`, path });
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

class FakeWorkspace implements IndexDeps {
    files: RecipeFile[] = [];
    mtimes = new Map<string, number>();
    results = new Map<string, RenderedNames>();
    renders: string[] = [];
    lists = 0;
    inFlight = 0;
    maxInFlight = 0;

    add(path: string, mtime = 1, result: RenderedNames = ok(path)): RecipeFile {
        const recipe = file(path);
        this.files.push(recipe);
        this.mtimes.set(recipe.uri, mtime);
        this.results.set(recipe.uri, result);
        return recipe;
    }

    async list(): Promise<RecipeFile[]> {
        this.lists++;
        return [...this.files];
    }

    async mtime(uri: string): Promise<number | undefined> {
        return this.mtimes.get(uri);
    }

    async render(uri: string): Promise<RenderedNames> {
        this.renders.push(uri);
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await tick();
        this.inFlight--;
        return this.results.get(uri) ?? { ok: false, message: 'gone' };
    }
}

describe('mapInBatches', () => {
    it('runs at most `size` at once, keeps order and reports progress', async () => {
        let inFlight = 0;
        let max = 0;
        const progress: number[] = [];
        const out = await mapInBatches([1, 2, 3, 4, 5], 2, async n => {
            inFlight++;
            max = Math.max(max, inFlight);
            await tick();
            inFlight--;
            return n * 10;
        }, done => progress.push(done));
        assert.deepStrictEqual(out, [10, 20, 30, 40, 50]);
        assert.strictEqual(max, 2);
        assert.deepStrictEqual(progress, [2, 4, 5]);
    });
});

describe('RecipeIndex', () => {
    it('renders every recipe in batches of 10 and reports progress', async () => {
        const ws = new FakeWorkspace();
        for (let i = 0; i < 12; i++) {
            ws.add(`r${String(i).padStart(2, '0')}.cook`);
        }
        const index = new RecipeIndex(ws);
        const progress: Array<[number, number]> = [];
        await index.refresh((done, total) => progress.push([done, total]));
        assert.strictEqual(ws.renders.length, 12);
        assert.strictEqual(ws.maxInFlight, 10);
        assert.deepStrictEqual(progress, [[0, 12], [10, 12], [12, 12]]);
        assert.deepStrictEqual(index.entries().map(entry => entry.path), ws.files.map(recipe => recipe.path));
    });

    it('reuses a cached render while the mtime is unchanged', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        await index.refresh();
        assert.strictEqual(ws.renders.length, 1);
    });

    it('re-renders when the mtime changes', async () => {
        const ws = new FakeWorkspace();
        const recipe = ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        ws.mtimes.set(recipe.uri, 2);
        ws.results.set(recipe.uri, ok('rice'));
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
        assert.deepStrictEqual(index.byPath('a.cook')?.result, ok('rice'));
    });

    it('re-renders an invalidated file even with the same mtime, and hides it from byPath until then', async () => {
        const ws = new FakeWorkspace();
        const recipe = ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        index.invalidate(recipe.uri);
        assert.strictEqual(index.byPath('a.cook'), undefined);
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
        assert.ok(index.byPath('a.cook'));
    });

    it('drops files that are no longer listed or cannot be stat-ed', async () => {
        const ws = new FakeWorkspace();
        const a = ws.add('a.cook');
        ws.add('b.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        ws.files = [a];
        await index.refresh();
        assert.deepStrictEqual(index.entries().map(entry => entry.path), ['a.cook']);
        ws.mtimes.delete(a.uri);
        await index.refresh();
        assert.deepStrictEqual(index.entries(), []);
    });

    it('keeps failed renders so the view can list them', async () => {
        const ws = new FakeWorkspace();
        ws.add('bad.cook', 1, { ok: false, message: 'syntax error' });
        const index = new RecipeIndex(ws);
        await index.refresh();
        assert.deepStrictEqual(index.entries()[0].result, { ok: false, message: 'syntax error' });
    });

    it('coalesces overlapping refreshes into one extra pass', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        const first = index.refresh();
        const second = index.refresh();
        const third = index.refresh();
        assert.strictEqual(first, second);
        await Promise.all([first, second, third]);
        assert.strictEqual(ws.lists, 2);
    });

    it('clear forgets every cached render', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        index.clear();
        assert.deepStrictEqual(index.entries(), []);
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
    });
});

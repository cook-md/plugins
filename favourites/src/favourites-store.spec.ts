import * as assert from 'assert';
import { BookmarksFile, FavouritesStore, NoWorkspaceError } from './favourites-store';

/** An in-memory `.bookmarks`; `text === undefined` means the file does not exist. */
class FakeFile implements BookmarksFile {
    writes: string[] = [];
    constructor(public text: string | undefined) { }
    async read(): Promise<string | undefined> {
        return this.text;
    }
    async write(text: string): Promise<void> {
        this.writes.push(text);
        this.text = text;
    }
}

describe('FavouritesStore', () => {

    async function storeWith(text: string | undefined): Promise<{ store: FavouritesStore; file: FakeFile; changes: number[] }> {
        const store = new FavouritesStore();
        const file = new FakeFile(text);
        const changes: number[] = [];
        store.onDidChange(() => changes.push(store.paths().length));
        await store.setFile(file);
        return { store, file, changes };
    }

    it('starts empty when the file does not exist and does not create it', async () => {
        const { store, file } = await storeWith(undefined);
        assert.deepStrictEqual(store.paths(), []);
        assert.deepStrictEqual(file.writes, []);
    });

    it('loads the file and fires a change for the initial load', async () => {
        const { store, changes } = await storeWith('a.cook\n# c\nb.cook\n');
        assert.deepStrictEqual(store.paths(), ['a.cook', 'b.cook']);
        assert.strictEqual(store.has('b.cook'), true);
        assert.deepStrictEqual(changes, [2]);
    });

    it('add creates the file and reports whether anything changed', async () => {
        const { store, file } = await storeWith(undefined);
        assert.strictEqual(await store.add('a.cook'), true);
        assert.strictEqual(await store.add('a.cook'), false);
        assert.deepStrictEqual(file.writes, ['a.cook\n']);
        assert.deepStrictEqual(store.paths(), ['a.cook']);
    });

    it('remove reports whether anything changed', async () => {
        const { store } = await storeWith('a.cook\n');
        assert.strictEqual(await store.remove('b.cook'), false);
        assert.strictEqual(await store.remove('a.cook'), true);
        assert.deepStrictEqual(store.paths(), []);
    });

    it('toggle returns the new state', async () => {
        const { store } = await storeWith('');
        assert.strictEqual(await store.toggle('a.cook'), true);
        assert.strictEqual(await store.toggle('a.cook'), false);
        assert.deepStrictEqual(store.paths(), []);
    });

    it('keeps edits made to the file between two operations (read-modify-write)', async () => {
        const { store, file } = await storeWith('a.cook\n');
        file.text = 'a.cook\nexternal.cook\n';
        await store.add('b.cook');
        assert.strictEqual(file.text, 'a.cook\nexternal.cook\nb.cook\n');
        assert.deepStrictEqual(store.paths(), ['a.cook', 'external.cook', 'b.cook']);
    });

    it('serialises concurrent mutations', async () => {
        const { store, file } = await storeWith('');
        await Promise.all([store.add('a.cook'), store.add('b.cook'), store.remove('a.cook')]);
        assert.strictEqual(file.text, 'b.cook\n');
    });

    it('reload fires a change only when the list differs', async () => {
        const { store, file, changes } = await storeWith('a.cook\n');
        await store.reload();
        file.text = '# comment added\na.cook\n';
        await store.reload();
        file.text = 'a.cook\nb.cook\n';
        await store.reload();
        assert.deepStrictEqual(changes, [1, 2]);
    });

    it('applyRenames renames files, moves folders and drops a rename to a non-recipe', async () => {
        const { store, file } = await storeWith('a.cook\nOld/b.cook\nOld/Sub/c.cook\nd.cook\n');
        await store.applyRenames([
            { from: 'a.cook', to: 'Dinner/a.cook' },
            { from: 'Old', to: 'New' },
            { from: 'd.cook', to: 'd.txt' },
        ]);
        assert.strictEqual(file.text, 'Dinner/a.cook\nNew/b.cook\nNew/Sub/c.cook\n');
    });

    it('applyDeletes removes files and folder contents', async () => {
        const { store, file } = await storeWith('a.cook\nOld/b.cook\nOlder/c.cook\n');
        await store.applyDeletes(['a.cook', 'Old']);
        assert.strictEqual(file.text, 'Older/c.cook\n');
    });

    it('empty rename and delete lists do not touch the file', async () => {
        const { store, file } = await storeWith('a.cook\n');
        await store.applyRenames([]);
        await store.applyDeletes([]);
        assert.deepStrictEqual(file.writes, []);
    });

    it('rejects mutations without a workspace', async () => {
        const store = new FavouritesStore();
        await assert.rejects(store.add('a.cook'), NoWorkspaceError);
        assert.strictEqual(store.hasWorkspace(), false);
    });

    it('has() normalises its argument', async () => {
        const { store } = await storeWith('Breakfast/Pancakes.cook\n');
        assert.strictEqual(store.has('./Breakfast\\Pancakes.cook'), true);
    });

    it('a failed write rejects and leaves the list unchanged', async () => {
        class FailingFile extends FakeFile {
            async write(): Promise<void> {
                throw new Error('disk full');
            }
        }
        const store = new FavouritesStore();
        await store.setFile(new FailingFile('a.cook\n'));
        await assert.rejects(store.add('b.cook'), /disk full/);
        assert.deepStrictEqual(store.paths(), ['a.cook']);
    });

    it('setFile(undefined) clears the list', async () => {
        const { store, changes } = await storeWith('a.cook\n');
        await store.setFile(undefined);
        assert.deepStrictEqual(store.paths(), []);
        assert.deepStrictEqual(changes, [1, 0]);
    });
});

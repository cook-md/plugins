import * as assert from 'assert';
import { CooklangApi, PantryContents, PantryEdit } from './cooklang-api';
import { PantryFiles, PantryStore, STARTER_PANTRY } from './pantry-store';

class FakeFiles implements PantryFiles {
    text: string | undefined;
    writes: string[] = [];
    failRead = false;
    failWrite = false;
    async read(): Promise<string | undefined> {
        if (this.failRead) { throw new Error('EACCES'); }
        return this.text;
    }
    async write(text: string): Promise<void> {
        if (this.failWrite) { throw new Error('EACCES write'); }
        this.text = text;
        this.writes.push(text);
    }
}

/** Lines are `section/name`; `GARBAGE` fails to parse; edits append/remove lines. */
class FakeApi extends CooklangApi {
    edits: PantryEdit[] = [];
    constructor() { super(async () => undefined, async () => []); }
    override async parsePantry(text: string): Promise<PantryContents> {
        if (text.includes('GARBAGE')) { throw new Error('parsePantry: bad TOML'); }
        const sections = new Map<string, string[]>();
        for (const line of text.split('\n').filter(l => l.includes('/'))) {
            const [section, name] = line.split('/');
            sections.set(section, [...(sections.get(section) ?? []), name]);
        }
        return {
            sections: [...sections].map(([name, items]) => ({ name, items: items.map(item => ({ name: item, isLow: false, isOutOfStock: false })) })),
        };
    }
    override async editPantry(text: string, edit: PantryEdit): Promise<string> {
        this.edits.push(edit);
        const line = `${edit.section}/${edit.name}`;
        if (edit.op === 'add') { return `${text}${line}\n`; }
        if (!text.split('\n').includes(line)) { throw new Error(`editPantry: item '${edit.name}' not found in section '${edit.section}'`); }
        return edit.op === 'remove' ? text.split('\n').filter(l => l !== line).join('\n') : text;
    }
}

function makeStore(): { store: PantryStore; files: FakeFiles; api: FakeApi } {
    const files = new FakeFiles();
    const api = new FakeApi();
    const store = new PantryStore(files, api);
    store.reloadDebounceMs = 5;
    return { store, files, api };
}

describe('PantryStore', () => {
    it('reports a missing file, a parse error and a loaded pantry', async () => {
        const { store, files } = makeStore();
        assert.deepStrictEqual(store.getState(), { kind: 'loading' });
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'noFile' });
        files.text = 'GARBAGE';
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'parseError', message: 'parsePantry: bad TOML' });
        files.text = 'fridge/milk\n';
        await store.load();
        assert.deepStrictEqual(store.getState(), {
            kind: 'loaded', sections: [{ name: 'fridge', items: [{ name: 'milk', isLow: false, isOutOfStock: false }] }],
        });
    });

    it('reports an unreadable file as a parse error', async () => {
        const { store, files } = makeStore();
        files.failRead = true;
        await store.load();
        assert.deepStrictEqual(store.getState(), { kind: 'parseError', message: 'Could not read config/pantry.conf: EACCES' });
    });

    it('creates the starter file only when there is none', async () => {
        const { store, files } = makeStore();
        await store.create();
        assert.deepStrictEqual(files.writes, [STARTER_PANTRY]);
        assert.deepStrictEqual(store.getState(), { kind: 'loaded', sections: [] });
        await store.create();
        assert.strictEqual(files.writes.length, 1);
    });

    it('applies edits to the current file text, in order, and reloads', async () => {
        const { store, files, api } = makeStore();
        files.text = '';
        await Promise.all([
            store.edit({ op: 'add', section: 'fridge', name: 'milk' }),
            store.edit({ op: 'add', section: 'fridge', name: 'eggs' }),
        ]);
        assert.strictEqual(files.text, 'fridge/milk\nfridge/eggs\n');
        assert.deepStrictEqual(api.edits.map(e => e.name), ['milk', 'eggs']);
        const state = store.getState();
        assert.ok(state.kind === 'loaded' && state.sections[0].items.length === 2);
    });

    it('keeps a failed edit as an error, reloads, and clears it on success or dismiss', async () => {
        const { store, files } = makeStore();
        files.text = 'fridge/milk\n';
        await store.edit({ op: 'remove', section: 'fridge', name: 'eggs' });
        assert.strictEqual(store.getEditError(), "editPantry: item 'eggs' not found in section 'fridge'");
        assert.strictEqual(files.writes.length, 0);
        assert.strictEqual(store.getState().kind, 'loaded');
        store.dismissEditError();
        assert.strictEqual(store.getEditError(), undefined);
        await store.edit({ op: 'remove', section: 'fridge', name: 'eggs' });
        await store.edit({ op: 'remove', section: 'fridge', name: 'milk' });
        assert.strictEqual(store.getEditError(), undefined);
    });

    it('refuses to edit when there is no pantry file', async () => {
        const { store } = makeStore();
        await store.edit({ op: 'add', section: 'fridge', name: 'milk' });
        assert.strictEqual(store.getEditError(), 'There is no config/pantry.conf to edit.');
    });

    it('keeps a throwing listener from breaking edit() or blocking other listeners', async () => {
        const { store, files } = makeStore();
        files.text = '';
        let calls = 0;
        store.onDidChange(() => { calls++; throw new Error('boom'); });
        store.onDidChange(() => { calls++; });
        await store.edit({ op: 'add', section: 'fridge', name: 'milk' });
        assert.strictEqual(calls, 2);
        assert.strictEqual(store.getEditError(), undefined);
    });

    it('skips the write when an edit does not change the file text', async () => {
        const { store, files } = makeStore();
        files.text = 'fridge/milk\n';
        const writesBefore = files.writes.length;
        await store.edit({ op: 'update', section: 'fridge', name: 'milk', fields: {} });
        assert.strictEqual(files.writes.length, writesBefore);
        assert.strictEqual(store.getEditError(), undefined);
        assert.strictEqual(store.getState().kind, 'loaded');
    });

    it('does not reject when create() fails to write, and reports the edit error instead', async () => {
        const { store, files } = makeStore();
        files.failWrite = true;
        await store.create();
        assert.strictEqual(store.getEditError(), 'EACCES write');
        assert.strictEqual(store.getState().kind, 'noFile');
    });

    it('does not notify again when a reload finds the text it just wrote', async () => {
        const { store, files } = makeStore();
        files.text = 'fridge/milk\n';
        await store.load();
        let changes = 0;
        store.onDidChange(() => changes++);
        await store.edit({ op: 'add', section: 'fridge', name: 'eggs' });
        assert.strictEqual(changes, 1, 'the edit notifies');
        // The file watcher fires for our own write: same text, nothing to re-render.
        await store.load();
        assert.strictEqual(changes, 1, 'the watcher reload is a no-op');
        files.text = 'fridge/milk\nfreezer/peas\n';
        await store.load();
        assert.strictEqual(changes, 2, 'an external change still notifies');
    });

    it('still notifies when only the edit error changes', async () => {
        const { store, files } = makeStore();
        files.text = 'fridge/milk\n';
        await store.load();
        let changes = 0;
        store.onDidChange(() => changes++);
        await store.edit({ op: 'remove', section: 'fridge', name: 'eggs' });
        assert.strictEqual(changes, 1, 'the failed edit notifies with its error');
        await store.edit({ op: 'update', section: 'fridge', name: 'milk', fields: {} });
        assert.strictEqual(changes, 2, 'the error clearing notifies');
    });

    it('notifies listeners and debounces scheduled reloads', async () => {
        const { store, files } = makeStore();
        let changes = 0;
        store.onDidChange(() => changes++);
        files.text = 'fridge/milk\n';
        store.scheduleReload();
        store.scheduleReload();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(changes, 1);
        store.dispose();
        store.scheduleReload();
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.strictEqual(changes, 1);
    });
});

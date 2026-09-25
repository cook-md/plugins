import { CheckEntry, CooklangApi, ResolvedRecipeReference, ShoppingListFile, ShoppingListRecipeItem, ShoppingListResult } from './cooklang-api';

export const LIST_FILE = '.shopping-list';
export const CHECKED_FILE = '.shopping-checked';

/** File access at the workspace root, by file name. `read` returns undefined for a missing file. */
export interface ListFiles {
    read(name: string): Promise<string | undefined>;
    write(name: string, text: string): Promise<void>;
    /** Must not throw when the file is already gone. */
    delete(name: string): Promise<void>;
}

export interface StoreDisposable {
    dispose(): void;
}

/**
 * The shopping list for one workspace root: the `.shopping-list` recipe tree,
 * the append-only `.shopping-checked` log, and the aggregated result. All
 * format work goes through the Cooklang API (the editor's Rust crates).
 */
export class ShoppingListStore {

    /** Debounce for `scheduleReload`. Overridable in tests. */
    reloadDebounceMs = 100;

    protected list: ShoppingListFile = { items: [] };
    protected checkedLog: CheckEntry[] = [];
    protected checkedSet = new Set<string>();
    protected result: ShoppingListResult | undefined;
    protected error: string | undefined;
    /** Discards results of superseded `regenerate()` calls. */
    protected regenerationSeq = 0;
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly files: ListFiles, protected readonly api: CooklangApi) { }

    onDidChange(listener: () => void): StoreDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    getItems(): readonly ShoppingListRecipeItem[] {
        return this.list.items;
    }

    getResult(): ShoppingListResult | undefined {
        return this.result;
    }

    getError(): string | undefined {
        return this.error;
    }

    /** Lower-cased names of checked ingredients. */
    getCheckedNames(): string[] {
        return [...this.checkedSet];
    }

    isChecked(name: string): boolean {
        return this.checkedSet.has(name.toLowerCase());
    }

    async load(): Promise<void> {
        try {
            const text = await this.files.read(LIST_FILE);
            this.list = text === undefined ? { items: [] } : await this.api.parseShoppingList(text);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-list:', e);
            this.list = { items: [] };
        }
        try {
            const text = await this.files.read(CHECKED_FILE);
            this.checkedLog = text === undefined ? [] : await this.api.parseShoppingChecked(text);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-checked:', e);
            this.checkedLog = [];
        }
        this.checkedSet = checkedSetOf(this.checkedLog);
        if (this.list.items.length > 0) {
            await this.regenerate();
        } else {
            this.result = undefined;
            this.error = undefined;
            this.fire();
        }
    }

    async addRecipe(path: string, scale = 1, references?: readonly ResolvedRecipeReference[]): Promise<void> {
        this.list.items.push({
            type: 'recipe',
            path,
            multiplier: scale === 1 ? undefined : scale,
            children: (references ?? []).map(toRecipeItem),
        });
        await this.save();
        await this.regenerate();
    }

    /** A menu is one top-level item whose children are its recipes (each with its own references). */
    async addMenu(path: string, scale: number, recipes: readonly ResolvedRecipeReference[]): Promise<void> {
        await this.addRecipe(path, scale, recipes);
    }

    async removeRecipe(index: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items.splice(index, 1);
        await this.save();
        await this.regenerate();
        await this.compactCheckedLog();
    }

    async updateScale(index: number, scale: number): Promise<void> {
        if (index < 0 || index >= this.list.items.length) {
            return;
        }
        this.list.items[index].multiplier = scale === 1 ? undefined : scale;
        await this.save();
        await this.regenerate();
    }

    async clearAll(): Promise<void> {
        // Invalidate any in-flight regenerate() so it cannot resurrect the result.
        ++this.regenerationSeq;
        this.list = { items: [] };
        this.checkedLog = [];
        this.checkedSet = new Set();
        this.result = undefined;
        this.error = undefined;
        await this.files.delete(LIST_FILE);
        await this.files.delete(CHECKED_FILE);
        this.fire();
    }

    async checkItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'checked', name });
    }

    async uncheckItem(name: string): Promise<void> {
        await this.appendCheckEntry({ type: 'unchecked', name });
    }

    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;
        if (this.list.items.length === 0) {
            this.result = undefined;
            this.error = undefined;
            this.fire();
            return;
        }
        let result: ShoppingListResult | undefined;
        let error: string | undefined;
        try {
            result = await this.api.generateShoppingList(this.flattenForGeneration());
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            console.error('[shopping-list] Failed to generate shopping list:', e);
        }
        if (seq !== this.regenerationSeq) {
            return;
        }
        this.result = result;
        this.error = error;
        this.fire();
    }

    /** Debounced `load()` — call on any external change to the list, log or config files. */
    scheduleReload(): void {
        if (this.disposed) {
            return;
        }
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.load().catch(err => console.error('[shopping-list] Reload failed:', err));
        }, this.reloadDebounceMs);
    }

    dispose(): void {
        this.disposed = true;
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = undefined;
        }
        this.listeners.clear();
    }

    /**
     * `{ path, scale }` for every node: a parent contributes its own
     * ingredients and each child is scaled by its parent's multiplier.
     */
    protected flattenForGeneration(): Array<{ path: string; scale: number }> {
        const out: Array<{ path: string; scale: number }> = [];
        const walk = (item: ShoppingListRecipeItem, parentScale: number): void => {
            const scale = (item.multiplier ?? 1) * parentScale;
            out.push({ path: item.path, scale });
            item.children.forEach(child => walk(child, scale));
        };
        this.list.items.forEach(item => walk(item, 1));
        return out;
    }

    protected async save(): Promise<void> {
        await this.files.write(LIST_FILE, await this.api.writeShoppingList(this.list));
    }

    protected async appendCheckEntry(entry: CheckEntry): Promise<void> {
        const line = await this.api.writeShoppingChecked([entry]);
        const existing = (await this.files.read(CHECKED_FILE)) ?? '';
        await this.files.write(CHECKED_FILE, existing + line);
        this.checkedLog.push(entry);
        applyEntry(this.checkedSet, entry);
        this.fire();
    }

    /** Keep only log entries whose ingredient is still in the result (cookcli policy). */
    protected async compactCheckedLog(): Promise<void> {
        if (!this.result) {
            return;
        }
        const names = [
            ...this.result.categories.flatMap(category => category.items.map(item => item.name)),
            ...this.result.other.items.map(item => item.name),
        ];
        const compacted = await this.api.compactShoppingChecked(this.checkedLog, names);
        if (compacted.length === 0) {
            await this.files.delete(CHECKED_FILE);
        } else {
            await this.files.write(CHECKED_FILE, await this.api.writeShoppingChecked(compacted));
        }
        this.checkedLog = compacted;
        this.checkedSet = checkedSetOf(compacted);
        this.fire();
    }

    protected fire(): void {
        this.listeners.forEach(listener => listener());
    }
}

function toRecipeItem(reference: ResolvedRecipeReference): ShoppingListRecipeItem {
    return {
        type: 'recipe',
        path: reference.path.replace(/^\.\//, ''),
        multiplier: reference.scale === 1 ? undefined : reference.scale,
        children: (reference.children ?? []).map(toRecipeItem),
    };
}

/** Last write wins; names compare lower-cased, as in cooklang-rs. */
function checkedSetOf(entries: readonly CheckEntry[]): Set<string> {
    const set = new Set<string>();
    entries.forEach(entry => applyEntry(set, entry));
    return set;
}

function applyEntry(set: Set<string>, entry: CheckEntry): void {
    const key = entry.name.toLowerCase();
    if (entry.type === 'checked') {
        set.add(key);
    } else {
        set.delete(key);
    }
}

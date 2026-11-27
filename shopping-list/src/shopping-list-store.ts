import {
    CheckEntry, CooklangApi, ResolvedRecipeReference, ShoppingListEntry, ShoppingListFile, ShoppingListIngredientItem, ShoppingListRecipeItem,
    ShoppingListResult,
} from './cooklang-api';
import { addQuantities, FreeHandLine } from './ingredients';

/** A top-level free-hand line as a caller last saw it. */
export interface FreeHandRef {
    index: number;
    name: string;
    quantity?: string;
}

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
    /** Serializes loads and mutations so read-modify-write sequences never interleave. */
    protected queue: Promise<void> = Promise.resolve();
    /** Set when `.shopping-list` exists but cannot be parsed; list-saving mutations refuse to run. */
    protected listUnreadable = false;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly files: ListFiles, protected readonly api: CooklangApi) { }

    onDidChange(listener: () => void): StoreDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Every top-level entry, free-hand lines included; recipe row indices point into this. */
    getItems(): readonly ShoppingListEntry[] {
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

    load(): Promise<void> {
        return this.enqueue(() => this.doLoad());
    }

    addRecipe(path: string, scale = 1, references?: readonly ResolvedRecipeReference[]): Promise<void> {
        return this.enqueue(() => this.doAddRecipe(path, scale, references));
    }

    /** A menu is one top-level item whose children are its recipes (each with its own references). */
    addMenu(path: string, scale: number, recipes: readonly ResolvedRecipeReference[]): Promise<void> {
        return this.enqueue(() => this.doAddRecipe(path, scale, recipes));
    }

    removeRecipe(index: number): Promise<void> {
        return this.enqueue(() => this.doRemoveRecipe(index));
    }

    updateScale(index: number, scale: number): Promise<void> {
        return this.enqueue(() => this.doUpdateScale(index, scale));
    }

    clearAll(): Promise<void> {
        return this.enqueue(() => this.doClearAll());
    }

    /**
     * Adds free-hand lines at the top level, folding each into a same-name
     * line when the amounts add up (see `placeFreeHand`). Unticks the names,
     * since there is more to buy. Returns the names as listed.
     */
    addFreeHand(lines: readonly FreeHandLine[]): Promise<string[]> {
        return this.enqueue(() => this.doAddFreeHand(lines));
    }

    /** Replaces one top-level free-hand line in place. */
    editFreeHand(ref: FreeHandRef, line: FreeHandLine): Promise<void> {
        return this.enqueue(() => this.doEditFreeHand(ref, line));
    }

    removeFreeHand(ref: FreeHandRef): Promise<void> {
        return this.enqueue(() => this.doRemoveFreeHand(ref));
    }

    /** Removes every top-level free-hand line; recipes stay. */
    removeAllFreeHand(): Promise<void> {
        return this.enqueue(() => this.doRemoveAllFreeHand());
    }

    checkItem(name: string): Promise<void> {
        return this.enqueue(() => this.appendCheckEntry({ type: 'checked', name }));
    }

    uncheckItem(name: string): Promise<void> {
        return this.enqueue(() => this.appendCheckEntry({ type: 'unchecked', name }));
    }

    /** Flips the checked state, deciding inside the queue so concurrent toggles see each other's result. */
    toggleItem(name: string): Promise<void> {
        return this.enqueue(() => this.appendCheckEntry({ type: this.isChecked(name) ? 'unchecked' : 'checked', name }));
    }

    protected async doLoad(): Promise<void> {
        let listError: string | undefined;
        let text: string | undefined;
        try {
            text = await this.files.read(LIST_FILE);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-list:', e);
        }
        try {
            this.list = text === undefined ? { items: [] } : await this.api.parseShoppingList(text);
            this.listUnreadable = false;
        } catch (e) {
            console.error('[shopping-list] Failed to parse .shopping-list:', e);
            const message = e instanceof Error ? e.message : String(e);
            listError = `Could not read ${LIST_FILE}: ${message}. Fix or delete the file.`;
            this.list = { items: [] };
            this.listUnreadable = true;
        }
        try {
            const text = await this.files.read(CHECKED_FILE);
            this.checkedLog = text === undefined ? [] : await this.api.parseShoppingChecked(text);
        } catch (e) {
            console.error('[shopping-list] Failed to read .shopping-checked:', e);
            this.checkedLog = [];
        }
        this.checkedSet = checkedSetOf(this.checkedLog);
        if (listError !== undefined) {
            ++this.regenerationSeq;
            this.result = undefined;
            this.error = listError;
            this.fire();
        } else if (this.list.items.length > 0) {
            await this.regenerate();
        } else {
            this.result = undefined;
            this.error = undefined;
            this.fire();
        }
    }

    protected async doAddRecipe(path: string, scale: number, references?: readonly ResolvedRecipeReference[]): Promise<void> {
        this.assertListWritable();
        this.list.items.push({
            type: 'recipe',
            path,
            multiplier: scale === 1 ? undefined : scale,
            children: (references ?? []).map(toRecipeItem),
        });
        await this.save();
        await this.regenerate();
    }

    protected async doRemoveRecipe(index: number): Promise<void> {
        this.assertListWritable();
        if (this.list.items[index]?.type !== 'recipe') {
            return;
        }
        this.list.items.splice(index, 1);
        await this.save();
        await this.regenerate();
        await this.compactCheckedLog();
    }

    protected async doUpdateScale(index: number, scale: number): Promise<void> {
        this.assertListWritable();
        const item = this.list.items[index];
        if (item?.type !== 'recipe') {
            return;
        }
        item.multiplier = scale === 1 ? undefined : scale;
        await this.save();
        await this.regenerate();
    }

    protected async doAddFreeHand(lines: readonly FreeHandLine[]): Promise<string[]> {
        this.assertListWritable();
        const added: string[] = [];
        await this.mutateList(async () => {
            for (const line of lines) {
                if (line.name.trim() === '') {
                    continue;
                }
                added.push(this.placeFreeHand(line));
            }
            return added.length > 0;
        });
        if (added.length === 0) {
            return added;
        }
        for (const name of new Set(added.map(name => name.toLowerCase()))) {
            if (this.checkedSet.has(name)) {
                await this.appendCheckEntry({ type: 'unchecked', name });
            }
        }
        await this.regenerate();
        return added;
    }

    /**
     * Folds `line` into a top-level free-hand line of the same name (ignoring
     * case) when their amounts add up, else appends it. Returns the name as listed.
     */
    protected placeFreeHand(line: FreeHandLine): string {
        const key = line.name.toLowerCase();
        for (const item of this.list.items) {
            if (item.type !== 'ingredient' || item.name.toLowerCase() !== key) {
                continue;
            }
            const sum = addQuantities(item.quantity, line.quantity);
            if (sum !== 'not-addable') {
                if (sum === undefined) {
                    delete item.quantity;
                } else {
                    item.quantity = sum;
                }
                return item.name;
            }
        }
        this.list.items.push(toIngredientItem(line));
        return line.name;
    }

    protected async doEditFreeHand(ref: FreeHandRef, line: FreeHandLine): Promise<void> {
        this.assertListWritable();
        const index = this.findFreeHand(ref);
        if (index === undefined || line.name.trim() === '') {
            return;
        }
        await this.mutateList(async () => {
            this.list.items[index] = toIngredientItem(line);
            return true;
        });
        await this.regenerate();
        await this.compactCheckedLog();
    }

    protected async doRemoveFreeHand(ref: FreeHandRef): Promise<void> {
        this.assertListWritable();
        const index = this.findFreeHand(ref);
        if (index === undefined) {
            return;
        }
        await this.mutateList(async () => {
            this.list.items.splice(index, 1);
            return true;
        });
        await this.regenerate();
        await this.compactCheckedLog();
    }

    protected async doRemoveAllFreeHand(): Promise<void> {
        this.assertListWritable();
        const kept = this.list.items.filter(item => item.type !== 'ingredient');
        if (kept.length === this.list.items.length) {
            return;
        }
        await this.mutateList(async () => {
            this.list.items = kept;
            return true;
        });
        await this.regenerate();
        await this.compactCheckedLog();
    }

    /**
     * Runs `change` on the in-memory list and saves it when `change` returns
     * true. A failed save (the editor refuses a line, the disk is full) puts
     * the list back as it was, so memory never drifts from the file.
     */
    protected async mutateList(change: () => Promise<boolean>): Promise<void> {
        const before: ShoppingListFile = JSON.parse(JSON.stringify(this.list));
        try {
            if (await change()) {
                await this.save();
            }
        } catch (e) {
            this.list = before;
            throw e;
        }
    }

    /**
     * The index of the line `ref` names: `ref.index` when it still holds that
     * line, else the first top-level line with the same name and quantity.
     */
    protected findFreeHand(ref: FreeHandRef): number | undefined {
        const matches = (item: ShoppingListEntry | undefined): boolean =>
            item?.type === 'ingredient' && item.name === ref.name && item.quantity === ref.quantity;
        if (matches(this.list.items[ref.index])) {
            return ref.index;
        }
        const index = this.list.items.findIndex(matches);
        return index < 0 ? undefined : index;
    }

    protected async doClearAll(): Promise<void> {
        // Invalidate any in-flight regenerate() so it cannot resurrect the result.
        ++this.regenerationSeq;
        this.listUnreadable = false;
        this.list = { items: [] };
        this.checkedLog = [];
        this.checkedSet = new Set();
        this.result = undefined;
        this.error = undefined;
        await this.files.delete(LIST_FILE);
        await this.files.delete(CHECKED_FILE);
        this.fire();
    }

    async regenerate(): Promise<void> {
        const seq = ++this.regenerationSeq;
        if (this.listUnreadable) {
            // Keep the "could not read" error visible until the file is fixed or cleared.
            return;
        }
        const recipes = this.flattenForGeneration();
        const freeHand = this.freeHandForGeneration();
        if (recipes.length === 0 && freeHand.length === 0) {
            this.result = undefined;
            this.error = undefined;
            this.fire();
            return;
        }
        let result: ShoppingListResult | undefined;
        let error: string | undefined;
        try {
            result = await this.api.generateShoppingList(recipes, freeHand);
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
     * Free-hand lines are not recipes and are skipped.
     */
    protected flattenForGeneration(): Array<{ path: string; scale: number }> {
        const out: Array<{ path: string; scale: number }> = [];
        const walk = (item: ShoppingListEntry, parentScale: number): void => {
            if (item.type !== 'recipe') {
                return;
            }
            const scale = (item.multiplier ?? 1) * parentScale;
            out.push({ path: item.path, scale });
            item.children.forEach(child => walk(child, scale));
        };
        this.list.items.forEach(item => walk(item, 1));
        return out;
    }

    /**
     * Top-level free-hand lines, as CookCLI aggregates them. Lines nested
     * under a recipe belong to that recipe's entry and are left out, like in
     * CookCLI; `? ` selection lines pick a recipe's optional ingredients,
     * which the editor already lists.
     */
    protected freeHandForGeneration(): Array<{ name: string; quantity?: string }> {
        return this.list.items.flatMap(item => item.type === 'ingredient'
            ? [item.quantity === undefined ? { name: item.name } : { name: item.name, quantity: item.quantity }]
            : []);
    }

    protected enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work);
        // Keep the queue alive when a unit of work fails; the caller still sees the rejection.
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    protected assertListWritable(): void {
        if (this.listUnreadable) {
            throw new Error(this.error ?? `Could not read ${LIST_FILE}. Fix or delete the file.`);
        }
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

    /** Keep only log entries whose ingredient is still in the result or on a free-hand line (cookcli policy). */
    protected async compactCheckedLog(): Promise<void> {
        if (!this.result) {
            return;
        }
        const names = [
            ...this.result.categories.flatMap(category => category.items.map(item => item.name)),
            ...this.result.other.items.map(item => item.name),
            ...freeHandNames(this.list.items),
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

function toIngredientItem(line: FreeHandLine): ShoppingListIngredientItem {
    return line.quantity === undefined ? { type: 'ingredient', name: line.name } : { type: 'ingredient', name: line.name, quantity: line.quantity };
}

/** Names of free-hand lines, top-level and nested. */
function freeHandNames(items: readonly ShoppingListEntry[]): string[] {
    return items.flatMap(item => item.type === 'ingredient' ? [item.name] : freeHandNames(item.children));
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

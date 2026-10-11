// Cache of every recipe's ingredient names, keyed by URI and file mtime. The vscode
// layer supplies listing (`workspace.findFiles`), mtimes (`workspace.fs.stat`) and
// renders (`renderNames`), and calls `invalidate` from its FileSystemWatcher.
import { RenderedNames } from './names-template';

export const BATCH_SIZE = 10;

export interface RecipeFile {
    /** URI string. */
    uri: string;
    /** Workspace-relative, `/`-separated. */
    path: string;
}

export interface IndexEntry extends RecipeFile {
    mtime: number;
    result: RenderedNames;
}

export interface IndexDeps {
    list(): Promise<RecipeFile[]>;
    /** Undefined when the file is gone. */
    mtime(uri: string): Promise<number | undefined>;
    render(uri: string): Promise<RenderedNames>;
}

export type Progress = (done: number, total: number) => void;

/** Runs `fn` over `items` with at most `size` calls in flight, in order; `onBatch` gets the running count. */
export async function mapInBatches<T, R>(
    items: readonly T[],
    size: number,
    fn: (item: T) => Promise<R>,
    onBatch?: (done: number) => void,
): Promise<R[]> {
    const results: R[] = [];
    for (let start = 0; start < items.length; start += size) {
        results.push(...await Promise.all(items.slice(start, start + size).map(fn)));
        onBatch?.(results.length);
    }
    return results;
}

export class RecipeIndex {

    protected readonly files = new Map<string, IndexEntry>();
    protected readonly byPathMap = new Map<string, string>();
    protected readonly stale = new Set<string>();
    protected running: Promise<void> | undefined;
    protected rerun = false;

    constructor(protected readonly deps: IndexDeps, protected readonly batchSize = BATCH_SIZE) { }

    /** Brings the cache up to date. A call during a refresh returns the running promise and schedules one more pass. */
    refresh(onProgress?: Progress): Promise<void> {
        if (this.running) {
            this.rerun = true;
            return this.running;
        }
        const run = async (): Promise<void> => {
            try {
                do {
                    this.rerun = false;
                    await this.scan(onProgress);
                } while (this.rerun);
            } finally {
                this.running = undefined;
            }
        };
        this.running = run();
        return this.running;
    }

    /** Forces a re-render on the next refresh (a watcher saw the file change). */
    invalidate(uri: string): void {
        this.stale.add(uri);
    }

    clear(): void {
        this.files.clear();
        this.byPathMap.clear();
        this.stale.clear();
    }

    size(): number {
        return this.files.size;
    }

    entries(): IndexEntry[] {
        return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    /** The cached, up-to-date entry for a workspace-relative path. */
    byPath(path: string): IndexEntry | undefined {
        const uri = this.byPathMap.get(path);
        const entry = uri === undefined ? undefined : this.files.get(uri);
        return entry && !this.stale.has(entry.uri) ? entry : undefined;
    }

    protected async scan(onProgress?: Progress): Promise<void> {
        const listed = await this.deps.list();
        const present = new Set(listed.map(recipe => recipe.uri));
        for (const uri of [...this.files.keys()]) {
            if (!present.has(uri)) {
                this.forget(uri);
            }
        }
        onProgress?.(0, listed.length);
        await mapInBatches(listed, this.batchSize, recipe => this.update(recipe), done => onProgress?.(done, listed.length));
    }

    protected async update(recipe: RecipeFile): Promise<void> {
        const mtime = await this.deps.mtime(recipe.uri);
        if (mtime === undefined) {
            this.forget(recipe.uri);
            return;
        }
        const cached = this.files.get(recipe.uri);
        if (cached && cached.mtime === mtime && !this.stale.has(recipe.uri)) {
            return;
        }
        // Cleared before the render, so an invalidation during it marks the file stale again.
        this.stale.delete(recipe.uri);
        const result = await this.deps.render(recipe.uri);
        this.files.set(recipe.uri, { ...recipe, mtime, result });
        this.byPathMap.set(recipe.path, recipe.uri);
    }

    protected forget(uri: string): void {
        const entry = this.files.get(uri);
        if (entry && this.byPathMap.get(entry.path) === uri) {
            this.byPathMap.delete(entry.path);
        }
        this.files.delete(uri);
        this.stale.delete(uri);
    }
}

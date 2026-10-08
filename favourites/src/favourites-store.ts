// The favourite list and its `.bookmarks` file. Free of the `vscode` import
// so it can be unit-tested; extension.ts supplies a `BookmarksFile` backed by
// `workspace.fs` and calls `reload()` from a file watcher.
import * as bookmarks from './bookmarks';

export const BOOKMARKS_FILE = '.bookmarks';

export class NoWorkspaceError extends Error {
    constructor() {
        super('Open a recipe folder to use favourites.');
        this.name = 'NoWorkspaceError';
    }
}

/** The `.bookmarks` file of the current workspace root. */
export interface BookmarksFile {
    /** The file text, or `undefined` when the file does not exist. */
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
}

export interface Disposable {
    dispose(): void;
}

export interface Rename {
    from: string;
    to: string;
}

export class FavouritesStore {

    private file: BookmarksFile | undefined;
    private current: readonly string[] = [];
    private readonly listeners = new Set<() => void>();
    /** Mutations run one after another so two quick toggles cannot race on the file. */
    private queue: Promise<unknown> = Promise.resolve();

    onDidChange(listener: () => void): Disposable {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    /** Normalised workspace-relative paths in file order. */
    paths(): readonly string[] {
        return this.current;
    }

    has(path: string): boolean {
        return this.current.includes(bookmarks.normalizePath(path));
    }

    hasWorkspace(): boolean {
        return this.file !== undefined;
    }

    /** Switches to another workspace root's file (or none) and reloads. */
    async setFile(file: BookmarksFile | undefined): Promise<void> {
        this.file = file;
        await this.reload();
    }

    /** Re-reads the file; fires `onDidChange` only when the list differs. */
    async reload(): Promise<void> {
        await this.enqueue(async () => {
            const text = this.file ? await this.file.read() : undefined;
            this.setCurrent(bookmarks.parse(text ?? ''));
        });
    }

    /** True when the path was not a favourite before. */
    add(path: string): Promise<boolean> {
        return this.mutate(text => bookmarks.add(text, path));
    }

    /** True when the path was a favourite before. */
    remove(path: string): Promise<boolean> {
        return this.mutate(text => bookmarks.remove(text, path));
    }

    /** Adds or removes; resolves to the new state (true = now a favourite). */
    async toggle(path: string): Promise<boolean> {
        let added = false;
        await this.mutate(text => {
            added = !bookmarks.parse(text).includes(bookmarks.normalizePath(path));
            return added ? bookmarks.add(text, path) : bookmarks.remove(text, path);
        });
        return added;
    }

    /**
     * Applies editor renames. Each covers the favourite equal to `from` and
     * every favourite under `from/`; a file renamed to a non-`.cook` name is
     * dropped. Paths are workspace-relative.
     */
    async applyRenames(renames: readonly Rename[]): Promise<void> {
        if (renames.length === 0) {
            return;
        }
        await this.mutate(text => {
            for (const { from, to } of renames) {
                text = bookmarks.isRecipePath(to) ? bookmarks.rename(text, from, to) : bookmarks.remove(text, from);
                text = bookmarks.renamePrefix(text, from, to);
            }
            return text;
        });
    }

    /** Drops each path and everything under it. */
    async applyDeletes(paths: readonly string[]): Promise<void> {
        if (paths.length === 0) {
            return;
        }
        await this.mutate(text => {
            for (const path of paths) {
                text = bookmarks.removePrefix(bookmarks.remove(text, path), path);
            }
            return text;
        });
    }

    /** Read-modify-write; resolves to whether the text changed. */
    private mutate(edit: (text: string) => string): Promise<boolean> {
        return this.enqueue(async () => {
            const file = this.file;
            if (!file) {
                throw new NoWorkspaceError();
            }
            const before = (await file.read()) ?? '';
            const after = edit(before);
            if (after !== before) {
                await file.write(after);
            }
            this.setCurrent(bookmarks.parse(after));
            return after !== before;
        });
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(task);
        this.queue = next.catch(() => undefined);
        return next;
    }

    private setCurrent(paths: string[]): void {
        if (paths.length === this.current.length && paths.every((path, index) => path === this.current[index])) {
            return;
        }
        this.current = paths;
        for (const listener of this.listeners) {
            listener();
        }
    }
}

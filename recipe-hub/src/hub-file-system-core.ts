// The logic behind the read-only `cooklang-hub:` file system, free of the
// `vscode` import so it can be unit-tested; hub-file-system.ts adapts it to
// `vscode.FileSystemProvider`.

import { HubClient, HubError } from './hub-client';
import { isDirectoryPath, parseRecipePath } from './hub-uri';
import { isTrustedContentUrl, serverOrigin } from './hub-urls';

export const CACHE_CAPACITY = 50;

export type HubFsErrorCode = 'FileNotFound' | 'NoPermissions' | 'Unavailable';

/** A file-system failure, translated to `vscode.FileSystemError` by the adapter. */
export class HubFsError extends Error {
    constructor(readonly code: HubFsErrorCode, message: string) {
        super(message);
        this.name = 'HubFsError';
    }
}

export type HubFsEntryType = 'file' | 'directory';

export interface HubFsStat {
    type: HubFsEntryType;
    size: number;
}

/** Recipe sources by id: least-recently-used eviction, one load per id at a time, failures not cached. */
export class RecipeContentCache {

    protected readonly entries = new Map<number, string>();
    protected readonly pending = new Map<number, Promise<string>>();
    /** Bumped by `clear()`, so loads started before it are not stored. */
    protected generation = 0;

    constructor(protected readonly load: (id: number) => Promise<string>, readonly capacity: number = CACHE_CAPACITY) { }

    get(id: number): Promise<string> {
        const cached = this.entries.get(id);
        if (cached !== undefined) {
            this.remember(id, cached);
            return Promise.resolve(cached);
        }
        const inFlight = this.pending.get(id);
        if (inFlight) {
            return inFlight;
        }
        const generation = this.generation;
        const promise: Promise<string> = this.load(id)
            .then(content => {
                if (generation === this.generation) {
                    this.remember(id, content);
                }
                return content;
            })
            .finally(() => {
                if (this.pending.get(id) === promise) {
                    this.pending.delete(id);
                }
            });
        this.pending.set(id, promise);
        return promise;
    }

    has(id: number): boolean {
        return this.entries.has(id);
    }

    get size(): number {
        return this.entries.size;
    }

    clear(): void {
        this.generation += 1;
        this.entries.clear();
        this.pending.clear();
    }

    /** Stores `content` as the most recently used entry, evicting the oldest beyond capacity. */
    protected remember(id: number, content: string): void {
        this.entries.delete(id);
        this.entries.set(id, content);
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value as number;
            this.entries.delete(oldest);
        }
    }
}

/** `cooklang-hub:` operations on URI paths. */
export class HubFileSystemCore {

    readonly cache: RecipeContentCache;

    constructor(load: (id: number) => Promise<string>, capacity: number = CACHE_CAPACITY) {
        this.cache = new RecipeContentCache(load, capacity);
    }

    async stat(path: string): Promise<HubFsStat> {
        if (isDirectoryPath(path)) {
            return { type: 'directory', size: 0 };
        }
        return { type: 'file', size: (await this.readFile(path)).byteLength };
    }

    async readFile(path: string): Promise<Uint8Array> {
        const ref = parseRecipePath(path);
        if (!ref) {
            throw new HubFsError('FileNotFound', `No Recipe Hub recipe at ${path}.`);
        }
        try {
            return new TextEncoder().encode(await this.cache.get(ref.id));
        } catch (e) {
            throw toFsError(e);
        }
    }

    /** Folders are never listed with recipes: only the id in a path is meaningful. */
    readDirectory(path: string): Array<[string, HubFsEntryType]> {
        if (path === '' || path === '/') {
            return [['recipes', 'directory']];
        }
        if (isDirectoryPath(path)) {
            return [];
        }
        throw new HubFsError('FileNotFound', `No Recipe Hub folder at ${path}.`);
    }

    denyWrite(path: string): never {
        throw new HubFsError('NoPermissions', `Recipe Hub recipes are read-only (${path}). Use "Save to Drafts" to get an editable copy.`);
    }

    clear(): void {
        this.cache.clear();
    }
}

function toFsError(e: unknown): HubFsError {
    if (e instanceof HubFsError) {
        return e;
    }
    if (e instanceof HubError && e.kind === 'notFound') {
        return new HubFsError('FileNotFound', e.message);
    }
    return new HubFsError('Unavailable', e instanceof Error ? e.message : String(e));
}

export type ContentSource = Pick<HubClient, 'download' | 'recipe' | 'fetchText' | 'baseUrl'>;

/**
 * A recipe's Cooklang source: `GET /api/recipes/:id/download`, falling back to
 * the feed's `enclosure_url` when the index has no stored content (404) or
 * fails (5xx). Network errors are not retried elsewhere. The fallback is only
 * followed when it is a trusted URL (`isTrustedContentUrl`); anything else
 * (a non-http(s) scheme, or plain http off the configured server) rethrows
 * the original download failure instead.
 */
export async function loadRecipeContent(client: ContentSource, id: number): Promise<string> {
    try {
        return await client.download(id);
    } catch (e) {
        if (!(e instanceof HubError) || (e.kind !== 'notFound' && e.kind !== 'server')) {
            throw e;
        }
        const detail = await client.recipe(id);
        if (detail.enclosureUrl === undefined || !isTrustedContentUrl(detail.enclosureUrl, serverOrigin(client.baseUrl) ?? '')) {
            throw e;
        }
        return client.fetchText(detail.enclosureUrl);
    }
}

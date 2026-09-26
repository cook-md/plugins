import { CooklangApi, PantryEdit, PantrySection } from './cooklang-api';

export const PANTRY_FILE = 'config/pantry.conf';

/** Written by "Create pantry". Comment-only: the parser drops empty sections anyway. */
export const STARTER_PANTRY = `# Pantry for Cook Editor and CookCLI.
# Each [section] lists items as  name = "quantity"  or
#   name = { quantity = "500%g", low = "100%g", bought = "2026-09-26", expire = "2026-10-03" }
`;

/** Access to `config/pantry.conf` in the workspace. `read` returns undefined when it does not exist. */
export interface PantryFiles {
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
}

export interface StoreDisposable {
    dispose(): void;
}

export type PantryState =
    | { kind: 'loading' }
    | { kind: 'noFile' }
    | { kind: 'parseError'; message: string }
    | { kind: 'loaded'; sections: PantrySection[] };

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * `config/pantry.conf` for one workspace folder. Every edit re-reads the file
 * and goes through `cooklang.api.editPantry`, so external changes are never
 * overwritten; loads and edits run one at a time.
 */
export class PantryStore {

    /** Debounce for `scheduleReload`. Overridable in tests. */
    reloadDebounceMs = 100;

    protected state: PantryState = { kind: 'loading' };
    protected editError: string | undefined;
    protected queue: Promise<void> = Promise.resolve();
    protected reloadTimer: ReturnType<typeof setTimeout> | undefined;
    protected disposed = false;
    protected readonly listeners = new Set<() => void>();

    constructor(protected readonly files: PantryFiles, protected readonly api: CooklangApi) { }

    onDidChange(listener: () => void): StoreDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    getState(): PantryState {
        return this.state;
    }

    /** Message of the last failed edit, until dismissed or a later edit succeeds. */
    getEditError(): string | undefined {
        return this.editError;
    }

    load(): Promise<void> {
        return this.enqueue(() => this.doLoad());
    }

    /** Writes the starter file if there is no pantry yet. */
    create(): Promise<void> {
        return this.enqueue(async () => {
            if (await this.files.read() === undefined) {
                await this.files.write(STARTER_PANTRY);
            }
            await this.doLoad();
        });
    }

    /** Never rejects: a failure becomes `getEditError()`. */
    edit(edit: PantryEdit): Promise<void> {
        return this.enqueue(async () => {
            try {
                const text = await this.files.read();
                if (text === undefined) {
                    throw new Error(`There is no ${PANTRY_FILE} to edit.`);
                }
                await this.files.write(await this.api.editPantry(text, edit));
                this.editError = undefined;
            } catch (e) {
                this.editError = messageOf(e);
            }
            await this.doLoad();
        });
    }

    dismissEditError(): void {
        this.editError = undefined;
        this.emit();
    }

    scheduleReload(): void {
        if (this.disposed) {
            return;
        }
        if (this.reloadTimer !== undefined) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            this.load().catch(err => console.error('[pantry] Reload failed:', err));
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

    protected async doLoad(): Promise<void> {
        let text: string | undefined;
        try {
            text = await this.files.read();
        } catch (e) {
            this.state = { kind: 'parseError', message: `Could not read ${PANTRY_FILE}: ${messageOf(e)}` };
            this.emit();
            return;
        }
        if (text === undefined) {
            this.state = { kind: 'noFile' };
        } else {
            try {
                this.state = { kind: 'loaded', sections: (await this.api.parsePantry(text)).sections };
            } catch (e) {
                this.state = { kind: 'parseError', message: messageOf(e) };
            }
        }
        this.emit();
    }

    protected enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work);
        // Keep the queue alive when a unit of work fails; the caller still sees the rejection.
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    protected emit(): void {
        if (this.disposed) {
            return;
        }
        this.listeners.forEach(listener => listener());
    }
}

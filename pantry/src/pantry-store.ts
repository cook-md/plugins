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

/** The error text for the user, without the native caller prefix (`editPantry: …`). */
function messageOf(e: unknown): string {
    const message = e instanceof Error ? e.message : String(e);
    return message.replace(/^(?:editPantry|parsePantry): (?:Error parsing input: )?/, '');
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
    /** File text and what listeners were last told, so a reload of unchanged text (our own write) stays quiet. */
    protected lastText: string | undefined;
    protected lastEmitted: string | undefined;
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

    /** Never rejects: a failure becomes `getEditError()`. Writes the starter file if there is no pantry yet. */
    create(): Promise<void> {
        return this.enqueue(async () => {
            try {
                if (await this.files.read() === undefined) {
                    await this.files.write(STARTER_PANTRY);
                }
                this.editError = undefined;
            } catch (e) {
                this.editError = messageOf(e);
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
                const newText = await this.api.editPantry(text, edit);
                if (newText !== text) {
                    await this.files.write(newText);
                }
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
            this.lastText = undefined;
            this.state = { kind: 'parseError', message: `Could not read ${PANTRY_FILE}: ${messageOf(e)}` };
            this.emitIfChanged();
            return;
        }
        const unchanged = text !== undefined && text === this.lastText && this.state.kind !== 'loading';
        this.lastText = text;
        if (unchanged) {
            // Same text parses to the same state; only a changed edit error needs telling.
            this.emitIfChanged();
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
        this.emitIfChanged();
    }

    protected enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work);
        // Keep the queue alive when a unit of work fails; the caller still sees the rejection.
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    /** Emits unless the state and edit error are exactly what listeners last saw. */
    protected emitIfChanged(): void {
        if (this.snapshot() !== this.lastEmitted) {
            this.emit();
        }
    }

    protected snapshot(): string {
        return JSON.stringify({ state: this.state, editError: this.editError });
    }

    protected emit(): void {
        if (this.disposed) {
            return;
        }
        this.lastEmitted = this.snapshot();
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch (e) {
                console.error('[pantry] listener failed:', e);
            }
        });
    }
}

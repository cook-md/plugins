// Remembers the Recipe Hub panel's filters per workspace, across editor
// restarts. No `vscode` import: `context.workspaceState` satisfies
// `StateMemento`, and the specs use a fake.

import { PanelState, parsePanelState } from './protocol';

export const PANEL_STATE_KEY = 'recipeHub.panelState';

/** Typing in the search box reports every keystroke; write once it settles. */
const DEFAULT_WRITE_DELAY_MS = 500;

/** The part of `vscode.Memento` the store uses. */
export interface StateMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export class PanelStateStore {

    protected pending: PanelState | undefined;
    protected timer: ReturnType<typeof setTimeout> | undefined;

    constructor(protected readonly memento: StateMemento, protected readonly delayMs = DEFAULT_WRITE_DELAY_MS) { }

    /** The remembered state; anything stored that is not a valid state reads as nothing. */
    read(): PanelState | undefined {
        return this.pending ?? parsePanelState(this.memento.get<unknown>(PANEL_STATE_KEY));
    }

    write(state: PanelState): void {
        this.pending = state;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => this.flush(), this.delayMs);
    }

    /** Writes a pending state now. */
    flush(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        const state = this.pending;
        if (state === undefined) {
            return;
        }
        this.pending = undefined;
        this.memento.update(PANEL_STATE_KEY, state).then(undefined, (e: unknown) =>
            console.warn('[recipe-hub] could not remember the search filters:', e));
    }

    dispose(): void {
        this.flush();
    }
}

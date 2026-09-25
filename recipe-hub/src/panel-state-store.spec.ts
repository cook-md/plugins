import * as assert from 'assert';
import { PANEL_STATE_KEY, PanelStateStore, StateMemento } from './panel-state-store';
import { PanelState } from './protocol';
import { emptyFilters } from './search-query';

class FakeMemento implements StateMemento {
    readonly values = new Map<string, unknown>();
    writes = 0;
    get<T>(key: string): T | undefined {
        return this.values.get(key) as T | undefined;
    }
    async update(key: string, value: unknown): Promise<void> {
        this.writes += 1;
        this.values.set(key, value);
    }
}

function state(q: string, filtersOpen = false): PanelState {
    return { filters: { ...emptyFilters('en'), q }, filtersOpen, localeTouched: false };
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('PanelStateStore', () => {
    it('reads nothing when nothing was stored', () => {
        assert.strictEqual(new PanelStateStore(new FakeMemento(), 10).read(), undefined);
    });

    it('reads corrupt stored state as nothing', () => {
        const memento = new FakeMemento();
        memento.values.set(PANEL_STATE_KEY, { filters: { q: 3 }, filtersOpen: true });
        assert.strictEqual(new PanelStateStore(memento, 10).read(), undefined);
        memento.values.set(PANEL_STATE_KEY, 'garbage');
        assert.strictEqual(new PanelStateStore(memento, 10).read(), undefined);
    });

    it('debounces writes and keeps only the latest state', async () => {
        const memento = new FakeMemento();
        const store = new PanelStateStore(memento, 10);
        store.write(state('p'));
        store.write(state('pa'));
        store.write(state('pasta', true));
        assert.strictEqual(memento.writes, 0);
        await wait(30);
        assert.strictEqual(memento.writes, 1);
        assert.deepStrictEqual(new PanelStateStore(memento, 10).read(), state('pasta', true));
    });

    it('reads back the pending state before it is written', () => {
        const store = new PanelStateStore(new FakeMemento(), 1000);
        store.write(state('soup'));
        assert.deepStrictEqual(store.read(), state('soup'));
        store.dispose();
    });

    it('flushes a pending write on dispose', () => {
        const memento = new FakeMemento();
        const store = new PanelStateStore(memento, 1000);
        store.write(state('soup'));
        store.dispose();
        assert.strictEqual(memento.writes, 1);
        assert.deepStrictEqual(memento.values.get(PANEL_STATE_KEY), state('soup'));
    });

    it('does nothing on dispose without a pending write', () => {
        const memento = new FakeMemento();
        new PanelStateStore(memento, 10).dispose();
        assert.strictEqual(memento.writes, 0);
    });
});

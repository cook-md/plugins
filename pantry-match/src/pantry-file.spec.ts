import * as assert from 'assert';
import { PantryContents, PantryItem } from './cooklang-api';
import { loadPantry, PANTRY_FILE } from './pantry-file';

const item = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const unused = async (): Promise<PantryContents> => { throw new Error('parse should not be called'); };

describe('loadPantry', () => {
    it('lives at config/pantry.conf, like the Shopping List and Pantry plugins', () => {
        assert.strictEqual(PANTRY_FILE, 'config/pantry.conf');
    });

    it('is missing when the file does not exist', async () => {
        assert.deepStrictEqual(await loadPantry({ read: async () => undefined, parse: unused }), { kind: 'missing' });
    });

    it('flattens every section in file order', async () => {
        const texts: string[] = [];
        const state = await loadPantry({
            read: async () => '[fridge]\nmilk\n[pantry]\nrice\nflour\n',
            parse: async text => {
                texts.push(text);
                return { sections: [{ name: 'fridge', items: [item('milk')] }, { name: 'pantry', items: [item('rice'), item('flour')] }] };
            },
        });
        assert.deepStrictEqual(texts, ['[fridge]\nmilk\n[pantry]\nrice\nflour\n']);
        assert.deepStrictEqual(state, { kind: 'ok', items: [item('milk'), item('rice'), item('flour')] });
    });

    it('reports a read failure', async () => {
        const state = await loadPantry({ read: async () => { throw new Error('EACCES'); }, parse: unused });
        assert.deepStrictEqual(state, { kind: 'error', message: 'Could not read config/pantry.conf: EACCES' });
    });

    it('reports a parse failure with the editor message', async () => {
        const state = await loadPantry({ read: async () => '[fridge', parse: async () => { throw new Error('line 1: expected ]'); } });
        assert.deepStrictEqual(state, { kind: 'error', message: 'config/pantry.conf has an error: line 1: expected ]' });
    });

    it('rejects an unexpected parse result', async () => {
        const state = await loadPantry({ read: async () => '', parse: async () => ({}) as PantryContents });
        assert.deepStrictEqual(state, { kind: 'error', message: 'config/pantry.conf: unexpected result from the editor' });
    });
});

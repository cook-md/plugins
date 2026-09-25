import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';

function recorder(result: unknown): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    });
    return { api, calls };
}

describe('CooklangApi', () => {
    it('calls each cooklang.api command with one JSON argument', async () => {
        const { api, calls } = recorder(undefined);
        await api.version();
        await api.generateShoppingList([{ path: 'a.cook', scale: 2 }]);
        await api.resolveRecipeReferences('week.menu');
        await api.parseShoppingList('text');
        await api.writeShoppingList({ items: [] });
        await api.parseShoppingChecked('log');
        await api.writeShoppingChecked([{ type: 'checked', name: 'flour' }]);
        await api.compactShoppingChecked([{ type: 'checked', name: 'flour' }], ['flour']);
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.version', args: [] },
            { command: 'cooklang.api.generateShoppingList', args: [{ recipes: [{ path: 'a.cook', scale: 2 }] }] },
            { command: 'cooklang.api.resolveRecipeReferences', args: [{ path: 'week.menu' }] },
            { command: 'cooklang.api.parseShoppingList', args: [{ text: 'text' }] },
            { command: 'cooklang.api.writeShoppingList', args: [{ list: { items: [] } }] },
            { command: 'cooklang.api.parseShoppingChecked', args: [{ text: 'log' }] },
            { command: 'cooklang.api.writeShoppingChecked', args: [{ entries: [{ type: 'checked', name: 'flour' }] }] },
            { command: 'cooklang.api.compactShoppingChecked', args: [{ entries: [{ type: 'checked', name: 'flour' }], ingredients: ['flour'] }] },
        ]);
    });

    it('returns what the command returns', async () => {
        const { api } = recorder(1);
        assert.strictEqual(await api.version(), 1);
    });
});

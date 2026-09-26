import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';

function recorder(result: unknown, commands: string[] = []): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('calls each cooklang.api command with one JSON argument', async () => {
        const { api, calls } = recorder(undefined);
        await api.version();
        await api.parsePantry('text');
        await api.editPantry('text', { op: 'remove', section: 'fridge', name: 'milk' });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.version', args: [] },
            { command: 'cooklang.api.parsePantry', args: [{ text: 'text' }] },
            { command: 'cooklang.api.editPantry', args: [{ text: 'text', edit: { op: 'remove', section: 'fridge', name: 'milk' } }] },
        ]);
    });

    it('reports pantry support only when both pantry commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.parsePantry', 'cooklang.api.editPantry', 'x']).api.supportsPantry(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.parsePantry']).api.supportsPantry(), false);
        assert.strictEqual(await recorder(undefined, []).api.supportsPantry(), false);
    });
});

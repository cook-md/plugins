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
    it('calls hasFeature and renderReport with one JSON argument', async () => {
        const { api, calls } = recorder(true);
        await api.hasFeature('nutrition_api');
        await api.renderReport({ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', args: [{ name: 'nutrition_api' }] },
            { command: 'cooklang.api.renderReport', args: [{ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 }] },
        ]);
    });

    it('reports support only when both report commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.hasFeature', 'cooklang.api.renderReport']).api.supportsReports(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.renderReport']).api.supportsReports(), false);
    });

    it('refreshes badges only when the editor has the command', async () => {
        const old = recorder(undefined, []);
        assert.strictEqual(await old.api.refreshBadges(), false);
        assert.deepStrictEqual(old.calls, []);
        const current = recorder(undefined, ['cooklang.api.refreshBadges']);
        assert.strictEqual(await current.api.refreshBadges(), true);
        assert.deepStrictEqual(current.calls, [{ command: 'cooklang.api.refreshBadges', args: [] }]);
    });
});

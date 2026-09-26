import * as assert from 'assert';
import { CooklangApi, REFRESH_BADGES_COMMAND } from './cooklang-api';

describe('CooklangApi.refreshBadges', () => {
    it('calls the command when the editor has it', async () => {
        const calls: string[] = [];
        const api = new CooklangApi(async command => { calls.push(command); }, async () => [REFRESH_BADGES_COMMAND]);
        assert.strictEqual(await api.refreshBadges(), true);
        assert.deepStrictEqual(calls, [REFRESH_BADGES_COMMAND]);
    });

    it('does nothing on an editor without it', async () => {
        const calls: string[] = [];
        const api = new CooklangApi(async command => { calls.push(command); }, async () => []);
        assert.strictEqual(await api.refreshBadges(), false);
        assert.deepStrictEqual(calls, []);
    });
});

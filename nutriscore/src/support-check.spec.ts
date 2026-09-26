import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';
import { SupportCheck } from './support-check';

function api(options: { version?: number; commands?: string[]; versionError?: boolean }): { api: CooklangApi; calls: string[] } {
    const calls: string[] = [];
    const cooklangApi = new CooklangApi(async command => {
        calls.push(command);
        if (command === 'cooklang.api.version') {
            if (options.versionError) {
                throw new Error('boom');
            }
            return options.version ?? 1;
        }
        return undefined;
    }, async () => options.commands ?? ['cooklang.api.hasFeature', 'cooklang.api.renderReport']);
    return { api: cooklangApi, calls };
}

describe('SupportCheck', () => {
    it('does not re-check within recheckMs once unsupported', async () => {
        const { api: cooklangApi, calls } = api({ commands: [] });
        let now = 0;
        const check = new SupportCheck(cooklangApi, () => now, 30000);
        assert.strictEqual(await check.isSupported(), false);
        assert.strictEqual(calls.length, 1);
        now = 10000;
        assert.strictEqual(await check.isSupported(), false);
        assert.strictEqual(calls.length, 1);
    });

    it('re-checks once recheckMs has elapsed', async () => {
        const { api: cooklangApi, calls } = api({ commands: [] });
        let now = 0;
        const check = new SupportCheck(cooklangApi, () => now, 30000);
        assert.strictEqual(await check.isSupported(), false);
        now = 30001;
        assert.strictEqual(await check.isSupported(), false);
        assert.strictEqual(calls.length, 2);
    });

    it('caches a supported result forever, with no further calls', async () => {
        const { api: cooklangApi, calls } = api({});
        let now = 0;
        const check = new SupportCheck(cooklangApi, () => now, 30000);
        assert.strictEqual(await check.isSupported(), true);
        now = 1_000_000;
        assert.strictEqual(await check.isSupported(), true);
        assert.strictEqual(calls.length, 1);
    });

    it('is unsupported on a version mismatch', async () => {
        const { api: cooklangApi } = api({ version: 2 });
        const check = new SupportCheck(cooklangApi);
        assert.strictEqual(await check.isSupported(), false);
    });

    it('is unsupported when the check throws', async () => {
        const { api: cooklangApi } = api({ versionError: true });
        const check = new SupportCheck(cooklangApi);
        assert.strictEqual(await check.isSupported(), false);
    });

    it('flags the first-ever unsupported result exactly once', async () => {
        const { api: cooklangApi } = api({ commands: [] });
        let now = 0;
        const check = new SupportCheck(cooklangApi, () => now, 30000);
        await check.isSupported();
        assert.strictEqual(check.consumeFirstUnsupportedWarning(), true);
        assert.strictEqual(check.consumeFirstUnsupportedWarning(), false);
        now = 30001;
        await check.isSupported();
        assert.strictEqual(check.consumeFirstUnsupportedWarning(), false);
    });
});

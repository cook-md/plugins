import * as assert from 'assert';
import { SupportCheck } from './support-check';

describe('SupportCheck', () => {
    it('caches true forever', async () => {
        let calls = 0;
        const check = new SupportCheck(async () => { calls++; return true; });
        assert.strictEqual(await check.isSupported(), true);
        assert.strictEqual(await check.isSupported(), true);
        assert.strictEqual(calls, 1);
    });

    it('does not cache false, so an updated editor is picked up', async () => {
        const answers = [false, true];
        const check = new SupportCheck(async () => answers.shift() ?? true);
        assert.strictEqual(await check.isSupported(), false);
        assert.strictEqual(await check.isSupported(), true);
    });

    it('treats a throw as false and retries next time', async () => {
        let calls = 0;
        const check = new SupportCheck(async () => {
            if (calls++ === 0) {
                throw new Error('boom');
            }
            return true;
        });
        assert.strictEqual(await check.isSupported(), false);
        assert.strictEqual(await check.isSupported(), true);
    });

    it('shares one round trip between concurrent callers', async () => {
        let calls = 0;
        const check = new SupportCheck(async () => { calls++; return true; });
        await Promise.all([check.isSupported(), check.isSupported()]);
        assert.strictEqual(calls, 1);
    });
});

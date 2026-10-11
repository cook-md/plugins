import * as assert from 'assert';
import { readSettings } from './settings';

describe('readSettings', () => {
    it('uses the defaults when nothing is set', () => {
        assert.deepStrictEqual(readSettings(() => undefined), { exclude: ['Drafts', 'config'], nutrition: true, pageSize: 'A4' });
    });

    it('reads valid values and drops invalid ones', () => {
        const values: Record<string, unknown> = { exclude: [' Old ', '', 3, 'Drafts/2019'], nutrition: false, pageSize: 'Letter' };
        assert.deepStrictEqual(readSettings(key => values[key]), { exclude: ['Old', 'Drafts/2019'], nutrition: false, pageSize: 'Letter' });
        assert.strictEqual(readSettings(key => (key === 'pageSize' ? 'A3' : undefined)).pageSize, 'A4');
        assert.deepStrictEqual(readSettings(key => (key === 'exclude' ? [] : undefined)).exclude, []);
    });
});

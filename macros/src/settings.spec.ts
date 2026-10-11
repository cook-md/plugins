import * as assert from 'assert';
import { readSettings } from './settings';

function reader(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

describe('readSettings', () => {
    it('defaults to energy on, per serving, locked pill shown', () => {
        assert.deepStrictEqual(readSettings(reader({})), { showEnergy: true, basis: 'serving', showWhenLocked: true });
    });

    it('reads explicit values', () => {
        assert.deepStrictEqual(
            readSettings(reader({ showEnergy: false, basis: '100g', showWhenLocked: false })),
            { showEnergy: false, basis: '100g', showWhenLocked: false },
        );
    });

    it('falls back to defaults for malformed values', () => {
        assert.deepStrictEqual(
            readSettings(reader({ showEnergy: 'no', basis: 'portion', showWhenLocked: 0 })),
            { showEnergy: true, basis: 'serving', showWhenLocked: true },
        );
    });
});

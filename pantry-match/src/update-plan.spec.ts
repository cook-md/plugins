import * as assert from 'assert';
import { blockedState, planUpdate, resultState } from './update-plan';

describe('blockedState', () => {
    it('is noWorkspace without a folder, unsupported on an old editor, otherwise undefined', () => {
        assert.strictEqual(blockedState(false, true), 'noWorkspace');
        assert.strictEqual(blockedState(true, false), 'unsupported');
        assert.strictEqual(blockedState(true, true), undefined);
    });
});

describe('planUpdate', () => {
    it('shows noPantry for a missing pantry', () => {
        assert.deepStrictEqual(planUpdate('missing', true, false), { action: 'show-empty', state: 'noPantry', pantryMessage: false });
    });

    it('shows pantryError with the message for a malformed pantry', () => {
        assert.deepStrictEqual(planUpdate('error', true, false), { action: 'show-empty', state: 'pantryError', pantryMessage: true });
    });

    it('does not scan until the view has been shown', () => {
        assert.deepStrictEqual(planUpdate('ok', false, true), { action: 'idle' });
    });

    it('scans once viewed, announcing "indexing" only when there is nothing to show yet', () => {
        assert.deepStrictEqual(planUpdate('ok', true, true), { action: 'scan', announceIndexing: true });
        assert.deepStrictEqual(planUpdate('ok', true, false), { action: 'scan', announceIndexing: false });
    });
});

describe('resultState', () => {
    it('is empty or ready', () => {
        assert.strictEqual(resultState(true), 'empty');
        assert.strictEqual(resultState(false), 'ready');
    });
});

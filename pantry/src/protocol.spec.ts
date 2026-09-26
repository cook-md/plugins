import * as assert from 'assert';
import { isValidMessage } from './protocol';

describe('isValidMessage', () => {
    it('accepts well-formed messages', () => {
        for (const message of [
            { type: 'ready' }, { type: 'create' }, { type: 'openFile' }, { type: 'dismissError' },
            { type: 'add', section: 'fridge', name: 'milk', attributes: { quantity: '1%L' } },
            { type: 'update', section: 'fridge', name: 'milk', fields: { expire: '' } },
            { type: 'remove', section: 'fridge', name: 'milk' },
        ]) {
            assert.strictEqual(isValidMessage(message), true, JSON.stringify(message));
        }
    });

    it('rejects anything else', () => {
        for (const message of [
            undefined, null, 'ready', { type: 'nope' },
            { type: 'remove', section: '', name: 'milk' },
            { type: 'remove', section: 'fridge' },
            { type: 'add', section: 'fridge', name: 'milk' },
            { type: 'add', section: 'fridge', name: 'milk', attributes: { quantity: 1 } },
            { type: 'update', section: 'fridge', name: 'milk', fields: [] },
            { type: 'add', section: 'fridge', name: 'milk', attributes: { op: 'remove' } },
            { type: 'update', section: 'fridge', name: 'milk', fields: { shelf: 'x' } },
        ]) {
            assert.strictEqual(isValidMessage(message), false, JSON.stringify(message));
        }
    });
});

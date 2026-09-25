import * as assert from 'assert';
import { HubError } from './hub-client';
import { asHubError, ResponseGate } from './response-gate';

describe('ResponseGate', () => {
    it('keeps a seq-numbered response current when nothing newer has started', () => {
        const gate = new ResponseGate();
        const current = gate.startRequest(1);
        assert.strictEqual(current(), true);
    });

    it('drops a stale seq-numbered response once a newer request has started', () => {
        const gate = new ResponseGate();
        const first = gate.startRequest(1);
        const second = gate.startRequest(2);
        assert.strictEqual(first(), false);
        assert.strictEqual(second(), true);
    });

    it('keeps a generation-only response current when nothing has restarted', () => {
        const gate = new ResponseGate();
        const current = gate.startGenerationRequest();
        assert.strictEqual(current(), true);
    });

    it('drops in-flight responses (seq-numbered and generation-only) once restart() bumps the generation', () => {
        const gate = new ResponseGate();
        const seqCheck = gate.startRequest(5);
        const genCheck = gate.startGenerationRequest();
        gate.restart();
        assert.strictEqual(seqCheck(), false);
        assert.strictEqual(genCheck(), false);
    });

    it('a request started after restart() is current again, even reusing the same seq', () => {
        const gate = new ResponseGate();
        gate.startRequest(1);
        gate.restart();
        const afterRestart = gate.startRequest(1);
        assert.strictEqual(afterRestart(), true);
    });
});

describe('asHubError', () => {
    it('passes an existing HubError through unchanged', () => {
        const error = new HubError('badQuery', 'nope');
        assert.strictEqual(asHubError(error), error);
    });

    it('maps a plain Error to the network kind, keeping its message', () => {
        const error = asHubError(new Error('boom'));
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'boom');
    });

    it('maps a non-Error throw to the network kind via String()', () => {
        const error = asHubError('plain string');
        assert.strictEqual(error.kind, 'network');
        assert.strictEqual(error.message, 'plain string');
    });
});

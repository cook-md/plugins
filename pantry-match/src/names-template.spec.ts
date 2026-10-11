import * as assert from 'assert';
import { PluginReportResult } from './cooklang-api';
import { NAMES_TEMPLATE, parseNamesOutput, renderNames } from './names-template';

describe('NAMES_TEMPLATE', () => {
    it('makes no nutrition call and emits names and refs as JSON', () => {
        assert.ok(!NAMES_TEMPLATE.includes('aggregate_nutrition'));
        assert.ok(NAMES_TEMPLATE.includes('"names": names.list'));
        assert.ok(NAMES_TEMPLATE.includes('"refs": refs.list'));
        assert.ok(NAMES_TEMPLATE.includes('tojson'));
    });
});

describe('parseNamesOutput', () => {
    it('marks names with a leading ? as optional and strips it', () => {
        const parsed = parseNamesOutput(JSON.stringify({ names: ['?parsley', ' flour ', '??chives'], refs: [] }));
        assert.deepStrictEqual(parsed, {
            names: [{ name: 'parsley', optional: true }, { name: 'flour', optional: false }, { name: 'chives', optional: true }],
            refs: [],
        });
    });

    it('drops empty names', () => {
        assert.deepStrictEqual(parseNamesOutput(JSON.stringify({ names: ['', '?', '  '], refs: [] }))?.names, []);
    });

    it('keeps refs, trimmed', () => {
        assert.deepStrictEqual(parseNamesOutput(JSON.stringify({ names: [], refs: [' ./Sauces/Pesto '] }))?.refs, ['./Sauces/Pesto']);
    });

    it('rejects malformed output', () => {
        for (const output of ['not json', '[]', JSON.stringify({ names: 'x', refs: [] }), JSON.stringify({ names: [1], refs: [] }), JSON.stringify({ names: [] })]) {
            assert.strictEqual(parseNamesOutput(output), undefined, output);
        }
    });
});

describe('renderNames', () => {
    function fakeApi(result: PluginReportResult | Error): { renderReport: (args: { uri: string; template: string; scale: number }) => Promise<PluginReportResult>; calls: unknown[] } {
        const calls: unknown[] = [];
        return {
            calls,
            renderReport: async args => {
                calls.push(args);
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            },
        };
    }

    it('renders the names template at scale 1', async () => {
        const api = fakeApi({ ok: true, output: JSON.stringify({ names: ['rice'], refs: [] }) });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: true, names: { names: [{ name: 'rice', optional: false }], refs: [] } });
        assert.deepStrictEqual(api.calls, [{ uri: 'file:///ws/a.cook', template: NAMES_TEMPLATE, scale: 1 }]);
    });

    it('passes on render failures', async () => {
        const api = fakeApi({ ok: false, reason: 'template', message: 'syntax error' });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'syntax error' });
    });

    it('treats malformed output as a failure', async () => {
        const api = fakeApi({ ok: true, output: '{}' });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'unexpected template output' });
    });

    it('turns a thrown error into a failure', async () => {
        const api = fakeApi(new Error('Invalid arguments: bad uri'));
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'Invalid arguments: bad uri' });
    });
});

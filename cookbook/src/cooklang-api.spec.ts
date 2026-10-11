import * as assert from 'assert';
import { CooklangApi, REQUIRED_COMMANDS, parseRecipeImages } from './cooklang-api';

function recorder(result: unknown, commands: readonly string[] = REQUIRED_COMMANDS): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('lists the required commands the editor lacks', async () => {
        assert.deepStrictEqual(await recorder(undefined).api.missingCommands(), []);
        assert.deepStrictEqual(await recorder(undefined, ['cooklang.api.renderReport', 'cooklang.api.hasFeature']).api.missingCommands(),
            ['cooklang.api.exportPdf', 'cooklang.api.recipeImages']);
    });

    it('renders a report at scale 1 and passes results through', async () => {
        const { api, calls } = recorder({ ok: true, output: '{}' });
        assert.deepStrictEqual(await api.renderReport({ uri: 'file:///b/a.cook', template: '{{ 1 }}' }), { ok: true, output: '{}' });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.renderReport', args: [{ uri: 'file:///b/a.cook', template: '{{ 1 }}', scale: 1 }] }]);
    });

    it('normalises render failures and unexpected payloads', async () => {
        assert.deepStrictEqual(await recorder({ ok: false, reason: 'forbidden', message: 'Subscription required' }).api.renderReport({ uri: 'u', template: 't' }),
            { ok: false, reason: 'forbidden', message: 'Subscription required' });
        assert.deepStrictEqual(await recorder({ ok: false, reason: 'weird' }).api.renderReport({ uri: 'u', template: 't' }),
            { ok: false, reason: 'template', message: 'The report engine failed.' });
        assert.strictEqual((await recorder('nope').api.renderReport({ uri: 'u', template: 't' })).ok, false);
    });

    it('treats hasFeature errors and non-true results as false', async () => {
        assert.strictEqual(await recorder(true).api.hasFeature('nutrition_api'), true);
        assert.strictEqual(await recorder('yes').api.hasFeature('nutrition_api'), false);
        const throwing = new CooklangApi(async () => { throw new Error('offline'); }, async () => []);
        assert.strictEqual(await throwing.hasFeature('nutrition_api'), false);
    });

    it('calls exportPdf with one argument and accepts path or filePath', async () => {
        const { api, calls } = recorder({ saved: true, filePath: '/tmp/Book.pdf' });
        const args = { html: '<p>x</p>', defaultFileName: 'Book.pdf', pageSize: 'A4' as const };
        assert.deepStrictEqual(await api.exportPdf(args), { saved: true, path: '/tmp/Book.pdf' });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.exportPdf', args: [args] }]);
        assert.deepStrictEqual(await recorder({ saved: false }).api.exportPdf(args), { saved: false });
        assert.deepStrictEqual(await recorder({ saved: false, error: 'disk full' }).api.exportPdf(args), { saved: false, error: 'disk full' });
        assert.strictEqual((await recorder(undefined).api.exportPdf(args)).saved, false);
    });

    it('asks for recipe images by uri', async () => {
        const { api, calls } = recorder({ title: 'file:///b/a.jpg', steps: { 0: { 1: 'file:///b/a.1.jpg' } } });
        assert.deepStrictEqual(await api.recipeImages('file:///b/a.cook'), { title: 'file:///b/a.jpg', steps: { 0: { 1: 'file:///b/a.1.jpg' } } });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.recipeImages', args: [{ uri: 'file:///b/a.cook' }] }]);
    });
});

describe('parseRecipeImages', () => {
    it('drops malformed entries', () => {
        assert.deepStrictEqual(parseRecipeImages({ title: '  ', steps: { a: { 0: 'x' }, 1: { b: 'y', 2: 3, 3: 'file:///s.jpg' }, 2: 'z' } }),
            { steps: { 1: { 3: 'file:///s.jpg' } } });
        assert.deepStrictEqual(parseRecipeImages(null), { steps: {} });
        assert.deepStrictEqual(parseRecipeImages([1]), { steps: {} });
    });
});

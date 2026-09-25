import * as assert from 'assert';
import { CooklangApi, CooklangApiCommands, ListCommands } from './cooklang-api';
import { SaveDraftArgs } from './recipe-draft';

function recorder(reply: (command: string) => unknown, listCommands: ListCommands = async () => []):
    { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return reply(command);
    }, listCommands);
    return { api, calls };
}

const ARGS: SaveDraftArgs = { version: 1, content: 'Boil @pasta{400%g}.\n', title: 'Pasta', frontmatter: { source: 'https://blog.example/pasta' } };

describe('CooklangApi', () => {
    it('calls the editor commands with the documented arguments', async () => {
        const { api, calls } = recorder(command => command === CooklangApiCommands.SAVE_DRAFT ? 'file:///ws/Drafts/Pasta.cook' : undefined);
        assert.strictEqual(await api.saveDraft(ARGS), 'file:///ws/Drafts/Pasta.cook');
        await api.openPreview('cooklang-hub:/recipes/7/Pasta.cook');
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.saveDraft', args: [ARGS] },
            { command: 'cooklang.api.openPreview', args: [{ uri: 'cooklang-hub:/recipes/7/Pasta.cook' }] },
        ]);
    });

    it('detects the commands from the command list, not a version number', async () => {
        const full = recorder(() => undefined, async () => ['cooklang.api.version', 'cooklang.api.saveDraft', 'cooklang.api.openPreview']);
        assert.deepStrictEqual([await full.api.canSaveDrafts(), await full.api.canOpenPreviews()], [true, true]);
        const old = recorder(() => 1, async () => ['cooklang.api.version', 'cooklang.api.generateShoppingList']);
        assert.deepStrictEqual([await old.api.canSaveDrafts(), await old.api.canOpenPreviews()], [false, false]);
        const failing = recorder(() => undefined, async () => { throw new Error('no command registry'); });
        assert.strictEqual(await failing.api.canSaveDrafts(), false);
        assert.deepStrictEqual(full.calls, []);
    });

    it('rejects when the editor returns no draft URI', async () => {
        const { api } = recorder(() => undefined);
        await assert.rejects(api.saveDraft(ARGS), /did not return/);
    });
});

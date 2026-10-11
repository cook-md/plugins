import * as assert from 'assert';
import { Commands, CooklangApi, REQUIRED_COMMANDS } from './cooklang-api';

function recordingApi(commands: readonly string[], result: unknown = undefined): {
    api: CooklangApi; calls: Array<{ command: string; args: unknown[] }>;
} {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('is supported only when every required command exists', async () => {
        assert.strictEqual(await recordingApi(REQUIRED_COMMANDS).api.supported(), true);
        const withoutRender = REQUIRED_COMMANDS.filter(command => command !== Commands.RENDER_REPORT);
        assert.strictEqual(await recordingApi(withoutRender).api.supported(), false);
    });

    it('detects other plugins\' commands', async () => {
        const { api } = recordingApi(['shoppingList.addRecipe']);
        assert.strictEqual(await api.hasCommands(['shoppingList.addRecipe']), true);
        assert.strictEqual(await api.hasCommands(['pantry.show']), false);
    });

    it('passes the documented argument shapes', async () => {
        const { api, calls } = recordingApi([]);
        await api.renderReport({ uri: 'file:///ws/a.cook', template: 'T', scale: 1 });
        await api.parsePantry('[fridge]\n');
        await api.resolveRecipeReferences('Dinners/Pasta.cook');
        await api.openPreview('file:///ws/a.cook');
        assert.deepStrictEqual(calls, [
            { command: Commands.RENDER_REPORT, args: [{ uri: 'file:///ws/a.cook', template: 'T', scale: 1 }] },
            { command: Commands.PARSE_PANTRY, args: [{ text: '[fridge]\n' }] },
            { command: Commands.RESOLVE_RECIPE_REFERENCES, args: [{ path: 'Dinners/Pasta.cook' }] },
            { command: Commands.OPEN_PREVIEW, args: [{ uri: 'file:///ws/a.cook' }] },
        ]);
    });

    it('refreshes badges only on editors that have the command', async () => {
        const present = recordingApi([Commands.REFRESH_BADGES]);
        assert.strictEqual(await present.api.refreshBadges(), true);
        assert.deepStrictEqual(present.calls.map(call => call.command), [Commands.REFRESH_BADGES]);
        const absent = recordingApi([]);
        assert.strictEqual(await absent.api.refreshBadges(), false);
        assert.deepStrictEqual(absent.calls, []);
    });
});

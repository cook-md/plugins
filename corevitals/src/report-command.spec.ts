import * as assert from 'assert';
import { CooklangApi, OpenReportArgs } from './cooklang-api';
import { OpenReportCommand, uriFromArgument } from './report-command';
import { CoreVitalsSettings } from './settings';

const SETTINGS: CoreVitalsSettings = {
    standard: 'uk', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: [], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

describe('uriFromArgument', () => {
    it('takes the uri from a preview outlet context', () => {
        assert.strictEqual(uriFromArgument({ version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 1 }, undefined), 'file:///ws/week.menu');
    });

    it('stringifies a URI-like object (editor/title passes the resource)', () => {
        assert.strictEqual(uriFromArgument({ scheme: 'file', path: '/ws/a.cook', toString: () => 'file:///ws/a.cook' }, undefined), 'file:///ws/a.cook');
        assert.strictEqual(uriFromArgument({ scheme: 'file', path: '/ws/notes.md', toString: () => 'file:///ws/notes.md' }, 'file:///ws/a.cook'), undefined);
    });

    it('falls back to the active editor, and only for .cook/.menu', () => {
        assert.strictEqual(uriFromArgument(undefined, 'file:///ws/a.cook'), 'file:///ws/a.cook');
        assert.strictEqual(uriFromArgument(undefined, 'file:///ws/notes.md'), undefined);
        assert.strictEqual(uriFromArgument(undefined, undefined), undefined);
    });
});

describe('OpenReportCommand', () => {
    function fixture(commands: string[]): { command: OpenReportCommand; opened: OpenReportArgs[]; texts: Map<string, string> } {
        const opened: OpenReportArgs[] = [];
        const texts = new Map<string, string>();
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.openReport') {
                opened.push(args[0] as OpenReportArgs);
                return undefined;
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => commands);
        return { command: new OpenReportCommand(api, () => SETTINGS, async uri => texts.get(uri)), opened, texts };
    }

    it('opens the html template for a plan with the Core Vitals label', async () => {
        const { command, opened } = fixture(['cooklang.api.openReport']);
        assert.strictEqual(await command.open('file:///ws/week.menu'), true);
        assert.strictEqual(opened.length, 1);
        assert.deepStrictEqual({ uri: opened[0].uri, label: opened[0].label, outputFormat: opened[0].outputFormat, scale: opened[0].scale },
            { uri: 'file:///ws/week.menu', label: 'Core Vitals', outputFormat: 'html', scale: 1 });
        assert.ok(opened[0].template.startsWith('{%- set mode = "html" -%}'));
        assert.ok(opened[0].template.includes('"standard": "uk"'));
    });

    it('uses the recipe servings', async () => {
        const { command, opened, texts } = fixture(['cooklang.api.openReport']);
        texts.set('file:///ws/a.cook', '---\nservings: 2\n---\n');
        await command.open('file:///ws/a.cook');
        assert.ok(opened[0].template.includes('"servings": 2'));
    });

    it('reports an older editor', async () => {
        const { command, opened } = fixture([]);
        assert.strictEqual(await command.open('file:///ws/week.menu'), false);
        assert.strictEqual(opened.length, 0);
    });
});

import * as assert from 'assert';
import { CooklangApi, ExportPdfArgs, REQUIRED_COMMANDS } from './cooklang-api';
import {
    BookFolder, CookbookExporter, CookbookUi, CookbookWorkspace, EDITOR_DOWNLOAD_URL, MAX_RECIPES, UPDATE_MESSAGE,
    folderChoices, mapLimit, pdfFileName,
} from './export-command';
import { CookbookSettings } from './settings';

const FOLDER: BookFolder = { uri: 'file:///ws/Book', name: 'Book' };
const SETTINGS: CookbookSettings = { exclude: ['Drafts', 'config'], nutrition: true, pageSize: 'A4' };

const recipeJson = (title: string, ingredient = 'egg'): string => JSON.stringify({
    metadata: { title, servings: 2 },
    ingredients: [{ name: ingredient, quantity: '1', note: '', reference: false }],
    cookware: [],
    sections: [{ name: '', blocks: [{ kind: 'step', number: 1, text: `Cook ${ingredient}.` }] }],
});

const aggregate = JSON.stringify({
    items: [{ ingredient: 'egg', amount: { mass_g: 50 }, warnings: [] }],
    failures: [],
    totals: { mass_g: 50, macros: { kcal: 144, protein_g: 12.6, carb_g: 0.8, fat_g: 9.6 }, micros: {} },
});

interface Fixture {
    exporter: CookbookExporter;
    calls: Array<{ command: string; args: unknown[] }>;
    ui: { messages: string[]; opened: string[]; progress: string[] };
    exported: () => ExportPdfArgs | undefined;
}

interface Options {
    commands?: readonly string[];
    files?: Record<string, string>;
    paths?: string[];
    hasFeature?: boolean;
    renders?: Record<string, unknown>;
    nutrition?: unknown;
    images?: Record<string, unknown>;
    exportResult?: unknown;
    choice?: string;
    cancelAfter?: number;
    settings?: Partial<CookbookSettings>;
}

function fixture(options: Options = {}): Fixture {
    const files = options.files ?? {};
    const calls: Array<{ command: string; args: unknown[] }> = [];
    let renderCount = 0;
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        const arg = args[0] as { uri: string; template?: string };
        switch (command) {
            case 'cooklang.api.hasFeature':
                return options.hasFeature ?? false;
            case 'cooklang.api.renderReport':
                if (arg.template!.includes('aggregate_nutrition')) {
                    return options.nutrition ?? { ok: true, output: aggregate };
                }
                renderCount++;
                return options.renders?.[arg.uri] ?? { ok: true, output: recipeJson(decodeURIComponent(arg.uri.split('/').pop()!.replace('.cook', ''))) };
            case 'cooklang.api.recipeImages':
                return options.images?.[arg.uri] ?? { steps: {} };
            case 'cooklang.api.exportPdf':
                return options.exportResult ?? { saved: true, path: '/Users/me/Book.pdf' };
        }
        throw new Error(`unexpected ${command}`);
    }, async () => options.commands ?? REQUIRED_COMMANDS);
    const workspace: CookbookWorkspace = {
        listFiles: async () => options.paths ?? Object.keys(files),
        uriOf: (folder, path) => `${folder.uri}/${path.split('/').map(encodeURIComponent).join('/')}`,
        readText: async uri => files[decodeURIComponent(uri.slice(FOLDER.uri.length + 1))],
        images: {
            size: async uri => (uri.endsWith('.jpg') ? 3 : undefined),
            read: async () => new Uint8Array([1, 2, 3]),
        },
    };
    const state = { messages: [] as string[], opened: [] as string[], progress: [] as string[] };
    const ui: CookbookUi = {
        withProgress: (_title, task) => task(message => state.progress.push(message), {
            get isCancellationRequested() { return options.cancelAfter !== undefined && renderCount >= options.cancelAfter; },
        }),
        showInformation: async (message, ...actions) => { state.messages.push(`info: ${message} [${actions.join(',')}]`); return options.choice; },
        showWarning: async (message, ...actions) => { state.messages.push(`warning: ${message} [${actions.join(',')}]`); return options.choice; },
        showError: async message => { state.messages.push(`error: ${message}`); },
        openExternal: async url => { state.opened.push(url); },
        openFile: async path => { state.opened.push(`file:${path}`); },
    };
    const exporter = new CookbookExporter(api, workspace, ui, () => ({ ...SETTINGS, ...options.settings }), () => '10 October 2026');
    const exported = (): ExportPdfArgs | undefined => calls.find(call => call.command === 'cooklang.api.exportPdf')?.args[0] as ExportPdfArgs | undefined;
    return { exporter, calls, ui: state, exported };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('pdfFileName', () => {
    it('removes reserved and control characters and caps the length', () => {
        assert.strictEqual(pdfFileName('Soups / Stews: "best"'), 'Soups Stews best.pdf');
        assert.strictEqual(pdfFileName('a\u0000b'), 'a b.pdf');
        assert.strictEqual(pdfFileName(' ?? '), 'Cookbook.pdf');
        assert.strictEqual(pdfFileName('x'.repeat(300)).length, 200);
    });
});

describe('mapLimit', () => {
    it('keeps at most `limit` calls in flight and preserves order', async () => {
        let active = 0;
        let peak = 0;
        const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async value => {
            active++;
            peak = Math.max(peak, active);
            await tick();
            active--;
            return value * 2;
        });
        assert.strictEqual(peak, 4);
        assert.deepStrictEqual(results, [2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    it('stops starting work once cancelled', async () => {
        let started = 0;
        const results = await mapLimit([1, 2, 3, 4, 5], 1, async value => { started++; return value; }, () => started >= 2);
        assert.deepStrictEqual(results, [1, 2, undefined, undefined, undefined]);
    });
});

describe('folderChoices', () => {
    it('lists every folder holding recipes, root first, without excluded folders', () => {
        assert.deepStrictEqual(folderChoices(['Soups/Tomato.cook', 'Mains/Pasta/Carbonara.cook', 'Drafts/x.cook', 'toast.cook'], ['Drafts']),
            ['', 'Mains', 'Mains/Pasta', 'Soups']);
    });
});

describe('CookbookExporter', () => {
    it('asks for an editor update when exportPdf or recipeImages is missing', async () => {
        const { exporter, calls, ui } = fixture({ commands: ['cooklang.api.renderReport', 'cooklang.api.hasFeature'], choice: 'Get Cook Editor' });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'unsupported', missing: ['cooklang.api.exportPdf', 'cooklang.api.recipeImages'] });
        await tick();
        assert.deepStrictEqual(ui.messages, [`warning: ${UPDATE_MESSAGE} [Get Cook Editor]`]);
        assert.deepStrictEqual(ui.opened, [EDITOR_DOWNLOAD_URL]);
        assert.deepStrictEqual(calls, []);
    });

    it('reports a folder without recipes', async () => {
        const { exporter, ui } = fixture({ files: { 'README.md': '# Hi' } });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'empty' });
        assert.deepStrictEqual(ui.messages, ['info: No recipes to export in Book. []']);
    });

    it(`refuses more than ${MAX_RECIPES} recipes before rendering`, async () => {
        const paths = Array.from({ length: MAX_RECIPES + 1 }, (_, index) => `r${index}.cook`);
        const { exporter, calls } = fixture({ paths });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'tooLarge', count: MAX_RECIPES + 1 });
        assert.ok(!calls.some(call => call.command === 'cooklang.api.renderReport'));
    });

    it('renders the book, exports it with the title as file name and offers to open it', async () => {
        const { exporter, ui, exported } = fixture({
            files: { 'README.md': '---\ntitle: Family: Book\n---\nHello.', 'Soups/Tomato.cook': '', 'toast.cook': '' },
            choice: 'Open',
        });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'saved', path: '/Users/me/Book.pdf', notIncluded: 0 });
        const args = exported()!;
        assert.strictEqual(args.defaultFileName, 'Family Book.pdf');
        assert.strictEqual(args.pageSize, 'A4');
        assert.ok(args.html.includes('<h1 class="book-title">Family: Book</h1>'));
        assert.ok(args.html.includes('<p class="generated">Generated on 10 October 2026</p>'));
        assert.ok(args.html.includes('<a href="#r-2">Tomato</a>'));
        assert.ok(args.html.indexOf('id="r-1"') < args.html.indexOf('id="c-1"'));
        assert.deepStrictEqual(ui.progress, ['Rendering 0/2 recipes…', 'Rendering 1/2 recipes…', 'Rendering 2/2 recipes…', 'Creating the PDF…']);
        await tick();
        assert.deepStrictEqual(ui.messages, ['info: Cookbook saved: Book.pdf [Open]']);
        assert.deepStrictEqual(ui.opened, ['file:/Users/me/Book.pdf']);
    });

    it('lists recipes that fail to render under "Not included" and warns', async () => {
        const { exporter, ui, exported } = fixture({
            files: { 'a.cook': '', 'b.cook': '', 'c.cook': '' },
            renders: {
                'file:///ws/Book/b.cook': { ok: false, reason: 'template', message: 'syntax error: unexpected }' },
                'file:///ws/Book/c.cook': { ok: true, output: 'not json' },
            },
        });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'saved', path: '/Users/me/Book.pdf', notIncluded: 2 });
        const html = exported()!.html;
        assert.ok(html.includes('<li><code>b.cook</code>: syntax error: unexpected }</li>'));
        assert.ok(html.includes('<li><code>c.cook</code>: The report engine returned something unexpected.</li>'));
        assert.ok(ui.messages.includes('warning: 2 recipes could not be rendered. See "Not included" at the end of the book. []'));
    });

    it('adds the nutrition line only with the feature and the setting', async () => {
        const withFeature = fixture({ files: { 'a.cook': '' }, hasFeature: true });
        await withFeature.exporter.export(FOLDER);
        assert.ok(withFeature.exported()!.html.includes('<p class="nutrition">Per serving: 72 kcal · 6 g protein · 0 g carbs · 5 g fat</p>'));

        const settingOff = fixture({ files: { 'a.cook': '' }, hasFeature: true, settings: { nutrition: false } });
        await settingOff.exporter.export(FOLDER);
        assert.ok(!settingOff.exported()!.html.includes('class="nutrition"'));
        assert.ok(!settingOff.calls.some(call => call.command === 'cooklang.api.hasFeature'));

        const noFeature = fixture({ files: { 'a.cook': '' }, hasFeature: false });
        await noFeature.exporter.export(FOLDER);
        assert.ok(!noFeature.exported()!.html.includes('class="nutrition"'));
    });

    it('stops asking for nutrition after a plan error', async () => {
        const { exporter, calls } = fixture({
            files: { 'a.cook': '', 'b.cook': '', 'c.cook': '', 'd.cook': '', 'e.cook': '', 'f.cook': '' },
            hasFeature: true,
            nutrition: { ok: false, reason: 'forbidden', message: 'Subscription required' },
        });
        await exporter.export(FOLDER);
        const nutritionCalls = calls.filter(call => call.command === 'cooklang.api.renderReport' && (call.args[0] as { template: string }).template.includes('aggregate_nutrition'));
        assert.ok(nutritionCalls.length <= 4, `asked ${nutritionCalls.length} times`);
    });

    it('inlines recipe photos and README images', async () => {
        const { exporter, exported } = fixture({
            files: { 'README.md': '![Cover](img/cover.jpg)', 'a.cook': '' },
            images: { 'file:///ws/Book/a.cook': { title: 'file:///ws/Book/a.jpg', steps: { 0: { 0: 'file:///ws/Book/a.0.jpg' } } } },
        });
        await exporter.export(FOLDER);
        const html = exported()!.html;
        assert.ok(html.includes('<img class="title-image" src="data:image/jpeg;base64,AQID" alt="">'));
        assert.ok(html.includes('<img class="step-image" src="data:image/jpeg;base64,AQID" alt="">'));
        assert.ok(html.includes('<img src="data:image/jpeg;base64,AQID" alt="Cover">'));
    });

    it('stops without exporting when cancelled', async () => {
        const { exporter, exported, ui } = fixture({ files: { 'a.cook': '', 'b.cook': '', 'c.cook': '', 'd.cook': '', 'e.cook': '' }, cancelAfter: 1 });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'cancelled' });
        assert.strictEqual(exported(), undefined);
        assert.deepStrictEqual(ui.messages, []);
    });

    it('stays quiet when the save dialog is cancelled and reports export errors', async () => {
        const cancelled = fixture({ files: { 'a.cook': '' }, exportResult: { saved: false } });
        assert.deepStrictEqual(await cancelled.exporter.export(FOLDER), { status: 'notSaved' });
        assert.deepStrictEqual(cancelled.ui.messages, []);

        const failed = fixture({ files: { 'a.cook': '' }, exportResult: { saved: false, error: 'Disk full' } });
        assert.deepStrictEqual(await failed.exporter.export(FOLDER), { status: 'failed', error: 'Disk full' });
        assert.deepStrictEqual(failed.ui.messages, ['error: Could not export the cookbook: Disk full']);
    });

    it('passes the Letter page size through', async () => {
        const { exporter, exported } = fixture({ files: { 'a.cook': '' }, settings: { pageSize: 'Letter' } });
        await exporter.export(FOLDER);
        assert.strictEqual(exported()!.pageSize, 'Letter');
        assert.ok(exported()!.html.includes('@page { size: Letter;'));
    });
});

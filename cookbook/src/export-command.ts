// The "Export as Cookbook (PDF)…" flow, free of the `vscode` import so it can be
// unit-tested: extension.ts passes the workspace and UI adapters. Renders every
// recipe through the editor's Reports engine (4 at a time), assembles the book and
// hands it to `cooklang.api.exportPdf`, which shows the save dialog and writes it.
import { NotIncluded, RenderedRecipe, bookIntros, buildBookHtml, recipeIds } from './book-html';
import {
    BookTree, RecipeEntry, buildBookTree, chaptersInOrder, compareNames, isExcluded, readmePaths, recipesInOrder, resolveRelativeImage,
} from './book-tree';
import { CooklangApi, RecipeImages } from './cooklang-api';
import { ImageFiles, ImageInliner, MAX_IMAGE_BYTES } from './images';
import { IndexedRecipe, buildIngredientIndex } from './ingredient-index';
import { markdownImageSources } from './markdown';
import { NUTRITION_TEMPLATE, nutritionLine, parseNutritionOutput, servingsFromMetadata } from './nutrition-line';
import { renderRecipeHtml } from './recipe-html';
import { RECIPE_TEMPLATE, parseRecipeOutput, recipeTitle } from './recipe-template';
import { CookbookSettings } from './settings';

/** Fail fast above this: keeps the HTML well under the editor's 100 M character export limit. */
export const MAX_RECIPES = 500;
export const RENDER_CONCURRENCY = 4;
/** The editor rejects export HTML over 100 M characters. */
export const MAX_HTML_CHARS = 100 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = 'This book is too large to export as one PDF. Export a subfolder instead.';
export const EDITOR_DOWNLOAD_URL = 'https://cook.md/editor';
export const UPDATE_MESSAGE = 'Update Cook Editor to export cookbooks.';
export const UPDATE_ACTION = 'Get Cook Editor';
export const OPEN_ACTION = 'Open';

export interface BookFolder {
    /** Absolute URI of the folder. */
    uri: string;
    /** Display name: the folder's last path segment. */
    name: string;
}

export interface CookbookWorkspace {
    /** `.cook` files and READMEs under the folder, `/`-separated and relative to it. */
    listFiles(folder: BookFolder): Promise<string[]>;
    /** Absolute URI of a path relative to the folder. */
    uriOf(folder: BookFolder, relativePath: string): string;
    /** Undefined when the file can't be read. */
    readText(uri: string): Promise<string | undefined>;
    images: ImageFiles;
}

export interface CancellationFlag {
    readonly isCancellationRequested: boolean;
}

export interface CookbookUi {
    /** Runs `task` under a cancellable progress notification. */
    withProgress<T>(title: string, task: (report: (message: string) => void, token: CancellationFlag) => Promise<T>): Promise<T>;
    showInformation(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, ...actions: string[]): Promise<string | undefined>;
    showError(message: string): Promise<unknown>;
    openExternal(url: string): Promise<unknown>;
    /** Opens a saved file with the system's default app. */
    openFile(path: string): Promise<unknown>;
}

export type ExportOutcome =
    | { status: 'unsupported'; missing: string[] }
    | { status: 'empty' }
    | { status: 'tooLarge'; count: number }
    | { status: 'cancelled' }
    | { status: 'busy' }
    | { status: 'notSaved' }
    | { status: 'failed'; error: string }
    | { status: 'saved'; path?: string; notIncluded: number };

type RecipeRender = { recipe: RenderedRecipe; indexed: IndexedRecipe } | { failure: NotIncluded };

/** `<Book title>.pdf` without path separators, control or reserved characters, at most 200 characters. */
export function pdfFileName(title: string): string {
    const cleaned = title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim();
    const base = Array.from(cleaned).slice(0, 196).join('').trim();
    return `${base === '' ? 'Cookbook' : base}.pdf`;
}

/** Runs `fn` over `items` with at most `limit` in flight; stops starting new ones once `cancelled()`. */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
    cancelled: () => boolean = () => false,
): Promise<Array<R | undefined>> {
    const results = new Array<R | undefined>(items.length).fill(undefined);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (!cancelled() && next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** Folders (relative, `''` = the workspace root) that hold `.cook` files directly or below, for the command palette. */
export function folderChoices(recipePaths: readonly string[], exclude: readonly string[]): string[] {
    const folders = new Set<string>();
    for (const path of recipePaths) {
        if (isExcluded(path, exclude)) {
            continue;
        }
        const segments = path.split('/').slice(0, -1);
        for (let depth = 0; depth <= segments.length; depth++) {
            folders.add(segments.slice(0, depth).join('/'));
        }
    }
    return [...folders].sort(compareNames);
}

export class CookbookExporter {

    constructor(
        protected readonly api: CooklangApi,
        protected readonly workspace: CookbookWorkspace,
        protected readonly ui: CookbookUi,
        protected readonly settings: () => CookbookSettings,
        protected readonly today: () => string = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        protected readonly maxHtmlChars: number = MAX_HTML_CHARS,
    ) { }

    protected running = false;

    /** One export at a time: a second request while one runs is turned away. */
    async export(folder: BookFolder): Promise<ExportOutcome> {
        if (this.running) {
            void this.ui.showInformation('A cookbook export is already running.');
            return { status: 'busy' };
        }
        this.running = true;
        try {
            return await this.run(folder);
        } finally {
            this.running = false;
        }
    }

    protected async run(folder: BookFolder): Promise<ExportOutcome> {
        const missing = await this.api.missingCommands();
        if (missing.length > 0) {
            void this.ui.showWarning(UPDATE_MESSAGE, UPDATE_ACTION).then(choice => {
                if (choice === UPDATE_ACTION) {
                    void this.ui.openExternal(EDITOR_DOWNLOAD_URL);
                }
            });
            return { status: 'unsupported', missing };
        }
        const settings = this.settings();
        const paths = await this.workspace.listFiles(folder);
        const readmes = new Map<string, string>();
        for (const readme of readmePaths(paths, settings.exclude)) {
            const text = await this.workspace.readText(this.workspace.uriOf(folder, readme));
            if (text !== undefined) {
                readmes.set(readme, text);
            }
        }
        const tree = buildBookTree({ rootName: folder.name, paths, readmes, exclude: settings.exclude });
        const entries = recipesInOrder(tree);
        if (entries.length === 0) {
            void this.ui.showInformation(`No recipes to export in ${folder.name}.`);
            return { status: 'empty' };
        }
        if (entries.length > MAX_RECIPES) {
            void this.ui.showWarning(`${folder.name} has ${entries.length} recipes; a cookbook holds up to ${MAX_RECIPES}. Export a subfolder instead.`);
            return { status: 'tooLarge', count: entries.length };
        }
        const nutrition = { enabled: settings.nutrition && await this.api.hasFeature('nutrition_api'), unavailable: 0 };
        const inliner = new ImageInliner(this.workspace.images);
        const ids = recipeIds(tree);

        let unavailable = 0;
        let result: { saved: { saved: boolean; path?: string; error?: string }; notIncluded: number } | undefined;
        try {
            result = await this.ui.withProgress('Cookbook', async (report, token) => {
                let done = 0;
                // README photos first, so a tight image budget drops recipe photos before the cover's.
                const images = await this.readmeImages(folder, tree, readmes, inliner);
                report(`Rendering 0/${entries.length} recipes…`);
                const renders = await mapLimit(entries, RENDER_CONCURRENCY, async entry => {
                    const render = await this.renderRecipe(folder, entry, ids.get(entry.path)!, inliner, nutrition);
                    done++;
                    report(`Rendering ${done}/${entries.length} recipes…`);
                    return render;
                }, () => token.isCancellationRequested);
                if (token.isCancellationRequested) {
                    return undefined;
                }
                const recipes = new Map<string, RenderedRecipe>();
                const notIncluded: NotIncluded[] = [];
                const indexed: IndexedRecipe[] = [];
                for (const render of renders) {
                    if (render === undefined) {
                        continue;
                    }
                    if ('failure' in render) {
                        notIncluded.push(render.failure);
                    } else {
                        recipes.set(render.recipe.path, render.recipe);
                        indexed.push(render.indexed);
                    }
                }
                const html = buildBookHtml({
                    tree, recipes, notIncluded,
                    intros: bookIntros(tree, readmes, (readme, src) => images.get(`${readme}\n${src}`)),
                    index: buildIngredientIndex(indexed),
                    generatedOn: this.today(),
                    pageSize: settings.pageSize,
                });
                inliner.clear();
                if (token.isCancellationRequested) {
                    return undefined;
                }
                if (html.length > this.maxHtmlChars) {
                    throw new Error(TOO_LARGE_MESSAGE);
                }
                report('Creating the PDF…');
                const saved = await this.api.exportPdf({ html, defaultFileName: pdfFileName(tree.title), pageSize: settings.pageSize });
                unavailable = nutrition.unavailable;
                return { saved, notIncluded: notIncluded.length };
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void this.ui.showError(message === TOO_LARGE_MESSAGE ? message : `Could not export the cookbook: ${message}`);
            return { status: 'failed', error: message };
        }
        if (result === undefined) {
            return { status: 'cancelled' };
        }
        const { saved, notIncluded } = result;
        if (!saved.saved) {
            if (saved.error !== undefined) {
                void this.ui.showError(`Could not export the cookbook: ${saved.error}`);
                return { status: 'failed', error: saved.error };
            }
            return { status: 'notSaved' };
        }
        const path = saved.path;
        const fileName = path !== undefined ? path.split(/[\\/]/).pop()! : pdfFileName(tree.title);
        void this.ui.showInformation(`Cookbook saved: ${fileName}`, ...(path !== undefined ? [OPEN_ACTION] : [])).then(choice => {
            if (choice === OPEN_ACTION && path !== undefined) {
                void this.ui.openFile(path);
            }
        });
        if (notIncluded > 0) {
            void this.ui.showWarning(`${notIncluded} recipe${notIncluded === 1 ? '' : 's'} could not be rendered. See "Not included" at the end of the book.`);
        }
        if (inliner.skipped > 0) {
            void this.ui.showWarning(`${inliner.skipped} photo${inliner.skipped === 1 ? ' was' : 's were'} left out: over ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB, or the book reached its size limit.`);
        }
        if (unavailable > 0) {
            void this.ui.showWarning(`${unavailable} recipe${unavailable === 1 ? ' has' : 's have'} no nutrition line because the nutrition service could not be reached.`);
        }
        return { status: 'saved', ...(path !== undefined ? { path } : {}), notIncluded };
    }

    protected async renderRecipe(
        folder: BookFolder, entry: RecipeEntry, id: string, inliner: ImageInliner, nutrition: { enabled: boolean; unavailable: number },
    ): Promise<RecipeRender> {
        const uri = this.workspace.uriOf(folder, entry.path);
        try {
            const result = await this.api.renderReport({ uri, template: RECIPE_TEMPLATE });
            if (!result.ok) {
                return { failure: { path: entry.path, reason: result.message } };
            }
            const data = parseRecipeOutput(result.output);
            if (!data) {
                return { failure: { path: entry.path, reason: 'The report engine returned something unexpected.' } };
            }
            const title = recipeTitle(data, entry.title);
            const images = await this.recipeImages(uri, inliner);
            const line = nutrition.enabled ? await this.nutritionLine(uri, data.metadata, nutrition) : undefined;
            const html = renderRecipeHtml({ id, title, data, images, ...(line !== undefined ? { nutritionLine: line } : {}) });
            return { recipe: { id, path: entry.path, title, html }, indexed: { id, title, ingredients: data.ingredients } };
        } catch (error) {
            return { failure: { path: entry.path, reason: error instanceof Error ? error.message : String(error) } };
        }
    }

    /** No photos on any error: a missing photo never drops a recipe. */
    protected async recipeImages(uri: string, inliner: ImageInliner): Promise<RecipeImages> {
        try {
            return await inliner.inlineAll(await this.api.recipeImages(uri));
        } catch {
            return { steps: {} };
        }
    }

    /** Any failure leaves the line out; an auth or plan failure turns nutrition off for the rest of the book. */
    protected async nutritionLine(uri: string, metadata: Record<string, unknown>, nutrition: { enabled: boolean; unavailable: number }): Promise<string | undefined> {
        try {
            const result = await this.api.renderReport({ uri, template: NUTRITION_TEMPLATE });
            if (!result.ok) {
                if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                    nutrition.enabled = false;
                } else if (result.reason === 'network' || result.reason === 'server') {
                    nutrition.unavailable++;
                }
                return undefined;
            }
            const summary = parseNutritionOutput(result.output);
            return summary ? nutritionLine(summary, servingsFromMetadata(metadata)) : undefined;
        } catch {
            return undefined;
        }
    }

    /** `readme + "\n" + src` → data URI, for the READMEs the book shows. */
    protected async readmeImages(folder: BookFolder, tree: BookTree, readmes: ReadonlyMap<string, string>, inliner: ImageInliner): Promise<Map<string, string>> {
        const shown = [tree.readme, ...chaptersInOrder(tree).map(chapter => chapter.readme)].filter((readme): readme is string => readme !== undefined);
        const images = new Map<string, string>();
        for (const readme of shown) {
            for (const src of markdownImageSources(readmes.get(readme) ?? '')) {
                const path = resolveRelativeImage(readme, src);
                const dataUri = path !== undefined ? await inliner.inline(this.workspace.uriOf(folder, path)) : undefined;
                if (dataUri?.startsWith('data:')) {
                    images.set(`${readme}\n${src}`, dataUri);
                }
            }
        }
        return images;
    }
}

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BookHtmlInput, NotIncluded, RenderedRecipe, bookCss, bookIntros, buildBookHtml, chapterIds, recipeIds } from './book-html';
import { BookTree, buildBookTree, readmePaths, recipesInOrder } from './book-tree';
import { IndexedRecipe, buildIngredientIndex } from './ingredient-index';
import { renderRecipeHtml } from './recipe-html';
import { parseRecipeOutput, recipeTitle } from './recipe-template';

const FIXTURE = path.resolve(__dirname, '../test-fixtures/family-book');
const SNAPSHOT = path.resolve(__dirname, '../test-fixtures/family-book.snapshot.html');
const EXCLUDE = ['Drafts', 'config'];

function tree(paths: string[], readmes: Record<string, string> = {}): BookTree {
    return buildBookTree({ rootName: 'Book', paths, readmes: new Map(Object.entries(readmes)), exclude: EXCLUDE });
}

function recipe(id: string, path: string, title: string): RenderedRecipe {
    return { id, path, title, html: `<article class="recipe" id="${id}">${title}</article>` };
}

function input(overrides: Partial<BookHtmlInput>): BookHtmlInput {
    return {
        tree: tree(['a.cook']), recipes: new Map(), intros: new Map(), index: [], notIncluded: [],
        generatedOn: '10 October 2026', pageSize: 'A4', ...overrides,
    };
}

describe('recipeIds and chapterIds', () => {
    it('number recipes and chapters in reading order', () => {
        const book = tree(['z.cook', 'B/b.cook', 'A/a.cook', 'A/Sub/s.cook']);
        assert.deepStrictEqual([...recipeIds(book)], [['z.cook', 'r-1'], ['A/a.cook', 'r-2'], ['A/Sub/s.cook', 'r-3'], ['B/b.cook', 'r-4']]);
        assert.deepStrictEqual([...chapterIds(book)], [['A', 'c-1'], ['A/Sub', 'c-2'], ['B', 'c-3']]);
    });
});

describe('bookIntros', () => {
    it('shifts cover headings by 1 and chapter headings by depth, dropping a heading used as the title', () => {
        const readmes = { 'README.md': '# My Book\n\n## Hello', 'A/README.md': '# Intro', 'A/Sub/README.md': '# Deeper' };
        const book = tree(['README.md', 'A/README.md', 'A/a.cook', 'A/Sub/README.md', 'A/Sub/s.cook'], readmes);
        assert.deepStrictEqual([...bookIntros(book, new Map(Object.entries(readmes)))], [
            ['README.md', '<h3>Hello</h3>'],
            ['A/README.md', '<h2>Intro</h2>'],
            ['A/Sub/README.md', '<h3>Deeper</h3>'],
        ]);
    });

    it('resolves README images through the callback with the README path', () => {
        const readmes = { 'A/README.md': '![Bowl](bowl.jpg)' };
        const book = tree(['A/README.md', 'A/a.cook'], readmes);
        const seen: string[] = [];
        const intros = bookIntros(book, new Map(Object.entries(readmes)), (readme, src) => {
            seen.push(`${readme}:${src}`);
            return 'data:image/jpeg;base64,AAAA';
        });
        assert.deepStrictEqual(seen, ['A/README.md:bowl.jpg']);
        assert.strictEqual(intros.get('A/README.md'), '<p><img src="data:image/jpeg;base64,AAAA" alt="Bowl"></p>');
    });
});

describe('bookCss', () => {
    it('sets the page size and breaks pages before chapters and recipes', () => {
        assert.ok(bookCss('Letter').includes('@page { size: Letter;'));
        const css = bookCss('A4');
        assert.ok(css.includes('.chapter, .recipe, .index, .appendix { break-before: page; page-break-before: always; }'));
        assert.ok(css.includes('.ingredients { break-inside: avoid;'));
    });

    it('lets a chapter heading without an intro share its page with what follows', () => {
        const css = bookCss('A4');
        assert.ok(css.includes('.chapter-title + .recipe { break-before: auto; page-break-before: auto; }'));
        assert.ok(css.includes('.chapter-title + .chapter:not(.has-intro) { break-before: auto; page-break-before: auto; }'));
    });

    it('keeps headings with their content and never forces the method onto a new page', () => {
        const css = bookCss('A4');
        assert.ok(css.includes('h3, .section-name { break-after: avoid; page-break-after: avoid; }'));
        assert.ok(css.includes('.step { position: relative; padding-left: 9mm; margin: 0 0 2.5mm; break-inside: avoid;'));
        assert.ok(!/\.method\s*\{[^}]*break-(before|inside)/.test(css));
        assert.ok(css.includes('max-height: 90mm'));
        assert.ok(css.includes('padding-left: 6mm'));
    });

    it('marks chapters that have an intro', () => {
        const book = tree(['A/README.md', 'A/a.cook', 'B/b.cook'], { 'A/README.md': 'Hi' });
        const html = buildBookHtml(input({
            tree: book, intros: new Map([['A/README.md', '<p>Hi</p>']]),
            recipes: new Map([['A/a.cook', recipe('r-1', 'A/a.cook', 'A1')], ['B/b.cook', recipe('r-2', 'B/b.cook', 'B1')]]),
        }));
        assert.ok(html.includes('<section class="chapter depth-1 has-intro" id="c-1">'));
        assert.ok(html.includes('<section class="chapter depth-1" id="c-2">'));
    });
});

describe('buildBookHtml', () => {
    it('links the contents to recipes and chapters and leaves out recipes that failed', () => {
        const book = tree(['top.cook', 'A/a.cook', 'A/gone.cook']);
        const html = buildBookHtml(input({
            tree: book,
            recipes: new Map([['top.cook', recipe('r-1', 'top.cook', 'Top')], ['A/a.cook', recipe('r-2', 'A/a.cook', 'A & B')]]),
            notIncluded: [{ path: 'A/gone.cook', reason: 'Template error: <bad>' }],
        }));
        assert.ok(html.includes('<ul><li class="toc-recipe"><a href="#r-1">Top</a></li><li class="toc-chapter"><a href="#c-1">A</a><ul><li class="toc-recipe"><a href="#r-2">A &amp; B</a></li></ul></li><li class="toc-extra"><a href="#not-included">Not included</a></li></ul>'));
        assert.ok(html.includes('<section class="chapter depth-1" id="c-1">\n<h1 class="chapter-title">A</h1>\n<article class="recipe" id="r-2">A & B</article>\n</section>'));
        assert.ok(html.includes('<li><code>A/gone.cook</code>: Template error: &lt;bad&gt;</li>'));
        assert.ok(!html.includes('id="index"'));
    });

    it('groups the index by first letter with links', () => {
        const html = buildBookHtml(input({
            index: [{ name: '7up', recipes: [{ id: 'r-1', title: 'Fizz' }] }, { name: 'apple', recipes: [{ id: 'r-1', title: 'Fizz' }, { id: 'r-2', title: 'Pie' }] }],
        }));
        assert.ok(html.includes('<h2 class="index-letter">#</h2>\n<p class="index-entry"><span class="index-name">7up</span> <a href="#r-1">Fizz</a></p>\n<h2 class="index-letter">A</h2>'));
        assert.ok(html.includes('<span class="index-name">apple</span> <a href="#r-1">Fizz</a>, <a href="#r-2">Pie</a>'));
        assert.ok(html.includes('<li class="toc-extra"><a href="#index">Index of ingredients</a></li>'));
    });

    it('groups accented names under their base letter', () => {
        const entry = (name: string) => ({ name, recipes: [{ id: 'r-1', title: 'T' }] });
        const html = buildBookHtml(input({ index: [entry('apple'), entry('äpfel'), entry('egg'), entry('élan'), entry('łosoś')] }));
        const letters = [...html.matchAll(/<h2 class="index-letter">([^<]*)<\/h2>/g)].map(match => match[1]);
        assert.deepStrictEqual(letters, ['A', 'E', 'Ł']);
    });

    it('scopes the uppercase headings to recipes', () => {
        assert.ok(bookCss('A4').includes('.recipe h3 { font-size: 11pt;'));
    });

    it('escapes the title and the generated date', () => {
        const html = buildBookHtml(input({ tree: tree(['README.md', 'a.cook'], { 'README.md': '---\ntitle: <Ours>\n---\n' }), generatedOn: '<today>' }));
        assert.ok(html.includes('<title>&lt;Ours&gt;</title>'));
        assert.ok(html.includes('<h1 class="book-title">&lt;Ours&gt;</h1>'));
        assert.ok(html.includes('<p class="generated">Generated on &lt;today&gt;</p>'));
    });
});

function walk(dir: string, prefix = ''): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(path.join(dir, entry.name), relative) : [relative];
    });
}

/** Builds the fixture book the way the export command does, with each `.json` standing in for the editor's render. */
function fixtureBook(): string {
    const paths = walk(FIXTURE);
    const readmes = new Map(readmePaths(paths, EXCLUDE).map(readme => [readme, fs.readFileSync(path.join(FIXTURE, readme), 'utf8')]));
    const book = buildBookTree({ rootName: 'family-book', paths, readmes, exclude: EXCLUDE });
    const ids = recipeIds(book);
    const recipes = new Map<string, RenderedRecipe>();
    const notIncluded: NotIncluded[] = [];
    const indexed: IndexedRecipe[] = [];
    for (const entry of recipesInOrder(book)) {
        const json = path.join(FIXTURE, entry.path.replace(/\.cook$/, '.json'));
        const data = fs.existsSync(json) ? parseRecipeOutput(fs.readFileSync(json, 'utf8')) : undefined;
        if (!data) {
            notIncluded.push({ path: entry.path, reason: 'syntax error: unexpected end of input' });
            continue;
        }
        const id = ids.get(entry.path)!;
        const title = recipeTitle(data, entry.title);
        const nutritionLine = entry.path === '2 Soups/Tomato Soup.cook' ? 'Per serving: 180 kcal · 4 g protein · 20 g carbs · 9 g fat' : undefined;
        recipes.set(entry.path, { id, path: entry.path, title, html: renderRecipeHtml({ id, title, data, images: { steps: {} }, nutritionLine }) });
        indexed.push({ id, title, ingredients: data.ingredients });
    }
    return buildBookHtml({
        tree: book, recipes, intros: bookIntros(book, readmes), index: buildIngredientIndex(indexed),
        notIncluded, generatedOn: '10 October 2026', pageSize: 'A4',
    });
}

describe('fixture book', () => {
    it('matches the reviewed snapshot (UPDATE_SNAPSHOT=1 rewrites it)', () => {
        const html = fixtureBook();
        if (process.env.UPDATE_SNAPSHOT === '1') {
            fs.writeFileSync(SNAPSHOT, html);
        }
        assert.ok(fs.existsSync(SNAPSHOT), `Missing ${SNAPSHOT}; run UPDATE_SNAPSHOT=1 npm test and review it`);
        assert.strictEqual(html, fs.readFileSync(SNAPSHOT, 'utf8'));
    });

    it('orders chapters by README order then numeric name and skips Drafts', () => {
        const html = fixtureBook();
        const order = ['id="c-1"', 'Soups &amp; Stews', 'Tomato Soup', 'Breakfast', 'Fluffy Pancakes', 'Mains', 'Pasta', 'Carbonara', 'id="index"', 'id="not-included"']
            .map(marker => html.indexOf(marker, html.indexOf('</nav>')));
        assert.ok(order.every(position => position > 0), String(order));
        assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
        assert.ok(!html.includes('Idea'));
        assert.ok(html.includes('<li><code>Broken.cook</code>: syntax error: unexpected end of input</li>'));
    });
});

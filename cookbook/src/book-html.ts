// Assembles the whole book as one HTML document with print CSS: cover, contents,
// chapters with intros and recipes, the ingredient index and the "Not included"
// appendix. Links are in-document anchors, which Chromium keeps as PDF links.
import { BookTree, Chapter, chaptersInOrder, recipesInOrder } from './book-tree';
import { PageSize } from './cooklang-api';
import { IndexEntry } from './ingredient-index';
import { escapeHtml, markdownToHtml } from './markdown';

export interface RenderedRecipe {
    id: string;
    path: string;
    title: string;
    /** The `<article>` from `renderRecipeHtml`. */
    html: string;
}

export interface NotIncluded {
    path: string;
    reason: string;
}

export interface BookHtmlInput {
    tree: BookTree;
    /** By recipe path; recipes missing here are left out (and listed in {@link notIncluded}). */
    recipes: ReadonlyMap<string, RenderedRecipe>;
    /** README path → intro HTML, from {@link bookIntros}. */
    intros: ReadonlyMap<string, string>;
    index: readonly IndexEntry[];
    notIncluded: readonly NotIncluded[];
    /** E.g. `10 October 2026`. */
    generatedOn: string;
    pageSize: PageSize;
}

/** `r-1`, `r-2`, … in reading order. */
export function recipeIds(tree: BookTree): Map<string, string> {
    return new Map(recipesInOrder(tree).map((recipe, index) => [recipe.path, `r-${index + 1}`]));
}

/** `c-1`, `c-2`, … in reading order. */
export function chapterIds(tree: BookTree): Map<string, string> {
    return new Map(chaptersInOrder(tree).map((chapter, index) => [chapter.path, `c-${index + 1}`]));
}

/**
 * Intro HTML for the cover README and every chapter README. Cover headings start at
 * `<h2>` (and its first `#` heading is dropped when it is the book title); a chapter
 * at depth d shifts its headings below its own `<h{d}>`.
 */
export function bookIntros(
    tree: BookTree,
    readmes: ReadonlyMap<string, string>,
    resolveImage?: (readmePath: string, src: string) => string | undefined,
): Map<string, string> {
    const intros = new Map<string, string>();
    const add = (readme: string | undefined, headingShift: number, dropFirstHeading: boolean): void => {
        const text = readme !== undefined ? readmes.get(readme) : undefined;
        if (readme === undefined || text === undefined) {
            return;
        }
        const html = markdownToHtml(text, { headingShift, dropFirstHeading, resolveImage: src => resolveImage?.(readme, src) });
        if (html !== '') {
            intros.set(readme, html);
        }
    };
    add(tree.readme, 1, tree.titleFromHeading);
    for (const chapter of chaptersInOrder(tree)) {
        add(chapter.readme, chapter.depth, false);
    }
    return intros;
}

/** Usable page height minus a margin, so the cover never spills onto a second page. */
const COVER_HEIGHT: Record<PageSize, string> = { A4: '252mm', Letter: '234mm' };

export function bookCss(pageSize: PageSize): string {
    return `
@page { size: ${pageSize}; margin: 18mm 16mm 20mm; }
html { font-size: 11pt; }
body { margin: 0; color: #1d1d1b; background: #fff; font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; line-height: 1.45; }
h1, h2, h3, h4, .meta, .step-number, .toc, .index-letter, .generated { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
a { color: inherit; text-decoration: none; }
img { max-width: 100%; }
blockquote { border-left: 0.8mm solid #d8d8d0; margin: 3mm 0; padding-left: 4mm; color: #4a4a45; }
.cover { position: relative; height: ${COVER_HEIGHT[pageSize]}; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; page-break-after: always; }
.book-title { font-size: 34pt; line-height: 1.15; margin: 0 0 10mm; }
.cover-intro { max-width: 130mm; margin: 0 auto; text-align: left; }
.generated { position: absolute; left: 0; right: 0; bottom: 0; margin: 0; font-size: 9pt; color: #6b6b66; }
.toc h1 { font-size: 24pt; margin: 0 0 8mm; }
.toc ul { list-style: none; padding-left: 0; margin: 0; }
.toc ul ul { padding-left: 6mm; }
.toc li { margin: 1.4mm 0; }
.toc-chapter > .toc-line { font-weight: 600; }
.toc-line { display: flex; align-items: baseline; gap: 2mm; }
.toc-dots { flex: 1 1 auto; min-width: 4mm; border-bottom: 0.3mm dotted #b5b5ae; }
.toc [data-page-ref] { min-width: 8mm; text-align: right; font-variant-numeric: tabular-nums; }
.index-entry [data-page-ref] { color: #6b6b66; font-variant-numeric: tabular-nums; }
.chapter, .recipe, .index, .appendix { break-before: page; page-break-before: always; }
.chapter-title + .recipe { break-before: auto; page-break-before: auto; }
.chapter-title + .chapter:not(.has-intro) { break-before: auto; page-break-before: auto; }
.chapter-title { font-size: 26pt; margin: 12mm 0 8mm; break-after: avoid; page-break-after: avoid; }
.depth-2 > .chapter-title { font-size: 21pt; }
.depth-3 > .chapter-title { font-size: 17pt; }
.recipe-title { font-size: 20pt; margin: 0 0 4mm; }
.title-image { display: block; width: 100%; max-height: 90mm; object-fit: cover; margin: 0 0 4mm; border-radius: 2mm; }
.meta, .source, .tags, .nutrition { font-size: 9.5pt; color: #4a4a45; margin: 1mm 0; }
.tag { border: 0.3mm solid #c9c9c2; border-radius: 3mm; padding: 0 2mm; }
.nutrition { font-weight: 600; }
h3, .section-name { break-after: avoid; page-break-after: avoid; }
.recipe h3 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.06em; margin: 6mm 0 2mm; }
.section-name { font-size: 11pt; margin: 4mm 0 2mm; }
.ingredients { break-inside: avoid; page-break-inside: avoid; }
.ingredients ul, .cookware ul { columns: 2; column-gap: 8mm; padding-left: 6mm; margin: 0; }
.qty { font-weight: 600; }
.note, .optional { color: #6b6b66; }
.optional { font-style: italic; font-size: 9pt; }
.text { font-style: italic; color: #4a4a45; }
.step { position: relative; padding-left: 9mm; margin: 0 0 2.5mm; break-inside: avoid; page-break-inside: avoid; }
.step-number { position: absolute; left: 0; top: 0; font-weight: 700; }
.step p { margin: 0; }
.step-image { display: block; max-width: 60%; margin: 2mm 0 0; border-radius: 1.5mm; }
.index-columns { columns: 2; column-gap: 10mm; font-size: 9.5pt; }
.index-letter { font-size: 12pt; margin: 4mm 0 1mm; break-after: avoid; page-break-after: avoid; }
.index-entry { margin: 0.6mm 0; break-inside: avoid; page-break-inside: avoid; }
.index-name { font-weight: 600; }
.appendix code { font-size: 9pt; }
`.trim();
}

/**
 * A contents line: title, dot leader and an empty page-number placeholder that
 * `cooklang.api.exportPdf` fills (`pageNumbers: true`) with the page `#id` starts on.
 */
function tocLine(id: string, title: string): string {
    return `<a class="toc-line" href="#${id}"><span class="toc-title">${escapeHtml(title)}</span><span class="toc-dots"></span>${pageRef(id)}</a>`;
}

/** Placeholder for the page number of `#id`; the editor only fills this exact form. */
function pageRef(id: string): string {
    return `<span data-page-ref="${id}"></span>`;
}

function tocRecipes(entries: readonly { path: string }[], recipes: ReadonlyMap<string, RenderedRecipe>): string[] {
    return entries.flatMap(entry => {
        const recipe = recipes.get(entry.path);
        return recipe ? [`<li class="toc-recipe">${tocLine(recipe.id, recipe.title)}</li>`] : [];
    });
}

export function buildBookHtml(input: BookHtmlInput): string {
    const { tree, recipes, intros } = input;
    const chapterId = chapterIds(tree);
    const recipeHtml = (entries: readonly { path: string }[]): string[] =>
        entries.flatMap(entry => recipes.get(entry.path)?.html ?? []);

    const tocChapter = (chapter: Chapter): string => {
        const children = [...tocRecipes(chapter.recipes, recipes), ...chapter.chapters.map(tocChapter)];
        const list = children.length > 0 ? `<ul>${children.join('')}</ul>` : '';
        return `<li class="toc-chapter">${tocLine(chapterId.get(chapter.path)!, chapter.title)}${list}</li>`;
    };

    const chapterHtml = (chapter: Chapter): string => {
        const level = Math.min(chapter.depth, 3);
        const intro = chapter.readme !== undefined ? intros.get(chapter.readme) : undefined;
        return [
            `<section class="chapter depth-${chapter.depth}${intro !== undefined ? ' has-intro' : ''}" id="${chapterId.get(chapter.path)}">`,
            `<h${level} class="chapter-title">${escapeHtml(chapter.title)}</h${level}>`,
            ...(intro !== undefined ? [`<div class="intro">${intro}</div>`] : []),
            ...recipeHtml(chapter.recipes),
            ...chapter.chapters.map(chapterHtml),
            '</section>',
        ].join('\n');
    };

    const cover = tree.readme !== undefined ? intros.get(tree.readme) : undefined;
    const toc = [
        ...tocRecipes(tree.recipes, recipes),
        ...tree.chapters.map(tocChapter),
        ...(input.index.length > 0 ? [`<li class="toc-extra">${tocLine('index', 'Index of ingredients')}</li>`] : []),
        ...(input.notIncluded.length > 0 ? [`<li class="toc-extra">${tocLine('not-included', 'Not included')}</li>`] : []),
    ];

    const parts: string[] = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        `<title>${escapeHtml(tree.title)}</title>`,
        `<style>\n${bookCss(input.pageSize)}\n</style>`,
        '</head>',
        '<body>',
        '<section class="cover">',
        `<h1 class="book-title">${escapeHtml(tree.title)}</h1>`,
        ...(cover !== undefined ? [`<div class="cover-intro">${cover}</div>`] : []),
        `<p class="generated">Generated on ${escapeHtml(input.generatedOn)}</p>`,
        '</section>',
        '<nav class="toc">',
        '<h1>Contents</h1>',
        `<ul>${toc.join('')}</ul>`,
        '</nav>',
        ...recipeHtml(tree.recipes),
        ...tree.chapters.map(chapterHtml),
    ];

    if (input.index.length > 0) {
        parts.push('<section class="index" id="index">', '<h1>Index of ingredients</h1>', '<div class="index-columns">');
        const collator = new Intl.Collator('en', { sensitivity: 'base' });
        let letter = '';
        for (const entry of input.index) {
            const first = entry.name.normalize('NFD').toUpperCase().charAt(0);
            const group = /\p{L}/u.test(first) ? first : '#';
            if (letter === '' || (group !== letter && !(group !== '#' && letter !== '#' && collator.compare(group, letter) === 0))) {
                letter = group;
                parts.push(`<h2 class="index-letter">${escapeHtml(group)}</h2>`);
            }
            const links = entry.recipes.map(recipe => `<a href="#${recipe.id}">${escapeHtml(recipe.title)}</a> ${pageRef(recipe.id)}`).join(', ');
            parts.push(`<p class="index-entry"><span class="index-name">${escapeHtml(entry.name)}</span> ${links}</p>`);
        }
        parts.push('</div>', '</section>');
    }

    if (input.notIncluded.length > 0) {
        parts.push(
            '<section class="appendix" id="not-included">',
            '<h1>Not included</h1>',
            '<p>These recipes could not be rendered. Open each one in Cook Editor to see what is wrong.</p>',
            `<ul>${input.notIncluded.map(entry => `<li><code>${escapeHtml(entry.path)}</code>: ${escapeHtml(entry.reason)}</li>`).join('')}</ul>`,
            '</section>',
        );
    }

    parts.push('</body>', '</html>', '');
    return parts.join('\n');
}

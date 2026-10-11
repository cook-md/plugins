import { firstHeading, parseFrontmatter } from './frontmatter';

/** Chapters nest at most this deep; recipes in deeper folders join their depth-3 ancestor. */
export const MAX_CHAPTER_DEPTH = 3;

export interface RecipeEntry {
    /** Relative to the book folder, `/`-separated. */
    path: string;
    /** File name without `.cook` and without a leading number prefix; the recipe's `title` metadata wins later. */
    title: string;
}

export interface Chapter {
    /** Folder path relative to the book folder. */
    path: string;
    title: string;
    /** 1 for a folder directly in the book, up to {@link MAX_CHAPTER_DEPTH}. */
    depth: number;
    /** README path relative to the book folder, when the folder has one. */
    readme?: string;
    recipes: RecipeEntry[];
    chapters: Chapter[];
}

export interface BookTree {
    title: string;
    /** The root README, which becomes the cover text. */
    readme?: string;
    /** True when the cover title is the README's first `#` heading (the cover drops that heading from the body). */
    titleFromHeading: boolean;
    /** Recipes directly in the book folder, before the first chapter. */
    recipes: RecipeEntry[];
    chapters: Chapter[];
}

export interface BookTreeInput {
    /** Display name of the book folder (its last path segment). */
    rootName: string;
    /** Files under the book folder, relative to it; anything other than `.cook` and READMEs is ignored. */
    paths: readonly string[];
    /** README path → text, for the READMEs listed by {@link readmePaths}. */
    readmes: ReadonlyMap<string, string>;
    /** Folder names (any depth) or folder paths (`Drafts/old`) to skip, case-insensitive. */
    exclude: readonly string[];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Case-insensitive and numeric-aware (`2 Soups` before `10 Mains`), with a stable tie-break. */
export function compareNames(a: string, b: string): number {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** `01-Pancakes` → `Pancakes`, `2 Soups` → `Soups`; a name that is only a number is kept. */
export function stripNumericPrefix(name: string): string {
    const stripped = name.replace(/^\d+(?:\s*-\s*|\s+)/, '').trim();
    return stripped === '' ? name : stripped;
}

export function isReadme(fileName: string): boolean {
    return /^readme\.(md|markdown)$/i.test(fileName);
}

export function isRecipe(fileName: string): boolean {
    return /\.cook$/i.test(fileName) && !fileName.startsWith('.');
}

function normalisePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** Dot-folders, `node_modules` and the `exclude` entries are skipped wherever they appear. */
export function isExcluded(path: string, exclude: readonly string[]): boolean {
    const segments = normalisePath(path).split('/');
    const folders = segments.slice(0, -1).map(segment => segment.toLowerCase());
    if (segments[segments.length - 1].startsWith('.') || folders.some(folder => folder.startsWith('.') || folder === 'node_modules')) {
        return true;
    }
    const folderPath = folders.join('/');
    return exclude.some(entry => {
        const name = entry.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
        if (name === '') {
            return false;
        }
        return name.includes('/') ? folderPath === name || folderPath.startsWith(`${name}/`) : folders.includes(name);
    });
}

/** The READMEs the tree may use; read them and pass them back as {@link BookTreeInput.readmes}. */
export function readmePaths(paths: readonly string[], exclude: readonly string[]): string[] {
    return paths.map(normalisePath)
        .filter(path => isReadme(path.split('/').pop() ?? '') && !isExcluded(path, exclude))
        .sort(compareNames);
}

interface Folder {
    path: string;
    name: string;
    recipes: string[];
    folders: Map<string, Folder>;
    readme?: string;
    hasRecipes: boolean;
}

function folderAt(root: Folder, segments: readonly string[]): Folder {
    let folder = root;
    for (const segment of segments) {
        let child = folder.folders.get(segment);
        if (!child) {
            child = { path: folder.path === '' ? segment : `${folder.path}/${segment}`, name: segment, recipes: [], folders: new Map(), hasRecipes: false };
            folder.folders.set(segment, child);
        }
        folder = child;
    }
    return folder;
}

export function buildBookTree(input: BookTreeInput): BookTree {
    const root: Folder = { path: '', name: input.rootName, recipes: [], folders: new Map(), hasRecipes: false };
    for (const path of [...input.paths].map(normalisePath).sort(compareNames)) {
        if (path === '' || isExcluded(path, input.exclude)) {
            continue;
        }
        const segments = path.split('/');
        const fileName = segments.pop()!;
        if (isRecipe(fileName)) {
            const folder = folderAt(root, segments);
            folder.recipes.push(path);
            let ancestor = root;
            ancestor.hasRecipes = true;
            for (const segment of segments) {
                ancestor = ancestor.folders.get(segment)!;
                ancestor.hasRecipes = true;
            }
        } else if (isReadme(fileName)) {
            const folder = folderAt(root, segments);
            // README.md wins over readme.markdown when a folder has both.
            if (folder.readme === undefined || /\.md$/i.test(fileName)) {
                folder.readme = path;
            }
        }
    }

    const frontmatterOf = (folder: Folder) => parseFrontmatter(folder.readme !== undefined ? input.readmes.get(folder.readme) ?? '' : '');

    const sortedFolders = (folder: Folder): Folder[] => {
        const children = [...folder.folders.values()].filter(child => child.hasRecipes)
            .map(child => ({ child, order: frontmatterOf(child).order }));
        children.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
                return a.order - b.order;
            }
            if (a.order !== undefined && b.order === undefined) {
                return -1;
            }
            if (a.order === undefined && b.order !== undefined) {
                return 1;
            }
            return compareNames(a.child.name, b.child.name);
        });
        return children.map(entry => entry.child);
    };

    const entries = (paths: readonly string[]): RecipeEntry[] => [...paths].sort(compareNames).map(path => ({
        path,
        title: stripNumericPrefix((path.split('/').pop() ?? path).replace(/\.cook$/i, '')),
    }));

    const flattened = (folder: Folder): RecipeEntry[] =>
        [...entries(folder.recipes), ...sortedFolders(folder).flatMap(flattened)];

    const chapter = (folder: Folder, depth: number): Chapter => {
        const frontmatter = frontmatterOf(folder);
        return {
            path: folder.path,
            title: frontmatter.title ?? stripNumericPrefix(folder.name),
            depth,
            ...(folder.readme !== undefined ? { readme: folder.readme } : {}),
            recipes: depth >= MAX_CHAPTER_DEPTH ? flattened(folder) : entries(folder.recipes),
            chapters: depth >= MAX_CHAPTER_DEPTH ? [] : sortedFolders(folder).map(child => chapter(child, depth + 1)),
        };
    };

    const cover = frontmatterOf(root);
    const heading = cover.title === undefined ? firstHeading(cover.body) : undefined;
    return {
        title: cover.title ?? heading ?? stripNumericPrefix(input.rootName),
        ...(root.readme !== undefined ? { readme: root.readme } : {}),
        titleFromHeading: cover.title === undefined && heading !== undefined,
        recipes: entries(root.recipes),
        chapters: sortedFolders(root).map(child => chapter(child, 1)),
    };
}

/** Every recipe in reading order: root recipes, then each chapter's recipes before its sub-chapters. */
export function recipesInOrder(tree: BookTree): RecipeEntry[] {
    const walk = (chapter: Chapter): RecipeEntry[] => [...chapter.recipes, ...chapter.chapters.flatMap(walk)];
    return [...tree.recipes, ...tree.chapters.flatMap(walk)];
}

/** Every chapter in reading order, depth-first. */
export function chaptersInOrder(tree: BookTree): Chapter[] {
    const walk = (chapter: Chapter): Chapter[] => [chapter, ...chapter.chapters.flatMap(walk)];
    return tree.chapters.flatMap(walk);
}

/**
 * A README's relative image `src`, resolved against the README's folder, as a path
 * relative to the book folder. Undefined for URLs, absolute paths and paths that
 * leave the book folder.
 */
export function resolveRelativeImage(readmePath: string, src: string): string | undefined {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('\\')) {
        return undefined;
    }
    let decoded: string;
    try {
        decoded = decodeURIComponent(src.split(/[?#]/)[0]);
    } catch {
        return undefined;
    }
    const folder = readmePath.includes('/') ? readmePath.slice(0, readmePath.lastIndexOf('/')) : '';
    const parts: string[] = [];
    for (const segment of [...folder.split('/'), ...decoded.replace(/\\/g, '/').split('/')]) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (parts.length === 0) {
                return undefined;
            }
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}

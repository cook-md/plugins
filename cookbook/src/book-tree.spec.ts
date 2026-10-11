import * as assert from 'assert';
import {
    BookTree, buildBookTree, chaptersInOrder, compareNames, isExcluded, readmePaths, recipesInOrder,
    resolveRelativeImage, stripNumericPrefix,
} from './book-tree';

function tree(paths: string[], readmes: Record<string, string> = {}, exclude: string[] = ['Drafts', 'config']): BookTree {
    return buildBookTree({ rootName: 'Recipes', paths, readmes: new Map(Object.entries(readmes)), exclude });
}

describe('compareNames', () => {
    it('sorts case-insensitively and numeric-aware', () => {
        assert.deepStrictEqual(['10 Mains', 'apple', '2 Soups', 'Banana'].sort(compareNames), ['2 Soups', '10 Mains', 'apple', 'Banana']);
    });
});

describe('stripNumericPrefix', () => {
    it('strips NN- and NN prefixes only', () => {
        assert.strictEqual(stripNumericPrefix('01-Pancakes'), 'Pancakes');
        assert.strictEqual(stripNumericPrefix('2 Soups'), 'Soups');
        assert.strictEqual(stripNumericPrefix('03 - Mains'), 'Mains');
        assert.strictEqual(stripNumericPrefix('7up Cake'), '7up Cake');
        assert.strictEqual(stripNumericPrefix('42'), '42');
    });
});

describe('isExcluded', () => {
    it('skips dot-folders, node_modules and excluded folder names at any depth', () => {
        assert.strictEqual(isExcluded('.git/a.cook', []), true);
        assert.strictEqual(isExcluded('x/node_modules/a.cook', []), true);
        assert.strictEqual(isExcluded('.hidden.cook', []), true);
        assert.strictEqual(isExcluded('Mains/drafts/a.cook', ['Drafts']), true);
        assert.strictEqual(isExcluded('config/a.cook', ['config']), true);
        assert.strictEqual(isExcluded('Mains/a.cook', ['Drafts']), false);
        assert.strictEqual(isExcluded('Drafts.cook', ['Drafts']), false);
    });

    it('matches an exclude entry with a slash as a folder path prefix', () => {
        assert.strictEqual(isExcluded('Mains/old/a.cook', ['mains/old']), true);
        assert.strictEqual(isExcluded('Other/Mains/old/a.cook', ['Mains/old']), false);
    });
});

describe('readmePaths', () => {
    it('lists non-excluded READMEs in either spelling', () => {
        assert.deepStrictEqual(readmePaths(['README.md', 'Soups/readme.markdown', 'Drafts/README.md', 'Soups/notes.md', 'a.cook'], ['Drafts']),
            ['README.md', 'Soups/readme.markdown']);
    });
});

describe('buildBookTree', () => {
    it('puts root recipes first and orders chapters numerically with prefixes stripped', () => {
        const book = tree(['Toast.cook', '10 Mains/Pasta.cook', '2 Soups/Tomato.cook', '2 Soups/01-Leek.cook']);
        assert.strictEqual(book.title, 'Recipes');
        assert.deepStrictEqual(book.recipes, [{ path: 'Toast.cook', title: 'Toast' }]);
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.title), ['Soups', 'Mains']);
        assert.deepStrictEqual(book.chapters[0].recipes, [
            { path: '2 Soups/01-Leek.cook', title: 'Leek' },
            { path: '2 Soups/Tomato.cook', title: 'Tomato' },
        ]);
    });

    it('drops folders without recipes and skips excluded folders', () => {
        const book = tree(['Empty/README.md', 'Drafts/Idea.cook', 'config/x.cook', 'Mains/a.cook'], { 'Empty/README.md': '# Empty' });
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.path), ['Mains']);
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path), ['Mains/a.cook']);
    });

    it('applies README frontmatter title and order; unordered chapters follow ordered ones', () => {
        const book = tree(['A/x.cook', 'B/x.cook', 'C/x.cook', 'D/x.cook', 'C/README.md', 'D/README.md'], {
            'C/README.md': '---\norder: 1\n---\n',
            'D/README.md': '---\ntitle: Desserts\norder: 0\n---\nSweet things.',
        });
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.title), ['Desserts', 'C', 'A', 'B']);
        assert.strictEqual(book.chapters[0].readme, 'D/README.md');
    });

    it('takes the cover title from frontmatter, then the first # heading, then the folder', () => {
        assert.strictEqual(tree(['a.cook', 'README.md'], { 'README.md': '---\ntitle: Family Book\n---\n# Ignored' }).title, 'Family Book');
        const fromHeading = tree(['a.cook', 'README.md'], { 'README.md': 'Intro\n\n# Our Kitchen\n' });
        assert.strictEqual(fromHeading.title, 'Our Kitchen');
        assert.strictEqual(fromHeading.titleFromHeading, true);
        assert.strictEqual(fromHeading.readme, 'README.md');
        assert.strictEqual(tree(['a.cook']).titleFromHeading, false);
        assert.strictEqual(buildBookTree({ rootName: '01 Recipes', paths: ['a.cook'], readmes: new Map(), exclude: [] }).title, 'Recipes');
    });

    it('nests chapters up to depth 3 and flattens deeper folders into the depth-3 chapter', () => {
        const book = tree(['A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook', 'A/B/C/a2.cook', 'A/a.cook']);
        const [a] = book.chapters;
        assert.strictEqual(a.depth, 1);
        const [b] = a.chapters;
        assert.strictEqual(b.depth, 2);
        const [c] = b.chapters;
        assert.strictEqual(c.depth, 3);
        assert.deepStrictEqual(c.chapters, []);
        assert.deepStrictEqual(c.recipes.map(recipe => recipe.path), ['A/B/C/a2.cook', 'A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook']);
        assert.deepStrictEqual(chaptersInOrder(book).map(chapter => chapter.path), ['A', 'A/B', 'A/B/C']);
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path),
            ['A/a.cook', 'A/B/C/a2.cook', 'A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook']);
    });

    it('prefers README.md over readme.markdown and ignores menus and other files', () => {
        const book = tree(['S/readme.markdown', 'S/README.md', 'S/a.cook', 'S/week.menu', 'S/photo.jpg']);
        assert.strictEqual(book.chapters[0].readme, 'S/README.md');
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path), ['S/a.cook']);
    });

    it('returns an empty book for a folder without recipes', () => {
        const book = tree(['README.md', 'notes/x.md']);
        assert.deepStrictEqual(recipesInOrder(book), []);
        assert.deepStrictEqual(book.chapters, []);
    });
});

describe('resolveRelativeImage', () => {
    it('resolves against the README folder and stays inside the book', () => {
        assert.strictEqual(resolveRelativeImage('Soups/README.md', 'img/bowl.jpg'), 'Soups/img/bowl.jpg');
        assert.strictEqual(resolveRelativeImage('Soups/README.md', '../cover%20photo.jpg'), 'cover photo.jpg');
        assert.strictEqual(resolveRelativeImage('README.md', './a.png?x=1'), 'a.png');
        assert.strictEqual(resolveRelativeImage('README.md', '../outside.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', '/etc/a.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', 'https://x.org/a.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', 'data:image/png;base64,AA'), undefined);
    });
});

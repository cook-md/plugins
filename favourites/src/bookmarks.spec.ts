import * as assert from 'assert';
import { add, normalizePath, parse, remove, removePrefix, rename, renamePrefix } from './bookmarks';

describe('bookmarks', () => {

    describe('normalizePath', () => {
        it('trims, uses forward slashes and drops a leading ./', () => {
            assert.strictEqual(normalizePath('  .\\Breakfast\\Pancakes.cook \n'), 'Breakfast/Pancakes.cook');
            assert.strictEqual(normalizePath('././a.cook'), 'a.cook');
        });
    });

    describe('parse', () => {
        it('returns one path per non-blank, non-comment line, deduplicated in order', () => {
            const text = '# favourites\n\nBreakfast/Pancakes.cook\n  # indented comment\r\n./Dinner/Soup.cook\nBreakfast\\Pancakes.cook\n';
            assert.deepStrictEqual(parse(text), ['Breakfast/Pancakes.cook', 'Dinner/Soup.cook']);
        });

        it('returns [] for empty text', () => {
            assert.deepStrictEqual(parse(''), []);
        });
    });

    describe('add', () => {
        it('appends as the last line with a trailing newline', () => {
            assert.strictEqual(add('# mine\na.cook\n', 'b.cook'), '# mine\na.cook\nb.cook\n');
        });

        it('starts a file from empty text', () => {
            assert.strictEqual(add('', 'a.cook'), 'a.cook\n');
        });

        it('adds a trailing newline to text that lacks one', () => {
            assert.strictEqual(add('a.cook', 'b.cook'), 'a.cook\nb.cook\n');
        });

        it('is a no-op when the path is already listed', () => {
            assert.strictEqual(add('a.cook\n', './a.cook'), 'a.cook\n');
        });
    });

    describe('remove', () => {
        it('deletes every matching line and keeps comments and order', () => {
            assert.strictEqual(remove('# c\na.cook\nb.cook\na.cook\n', 'a.cook'), '# c\nb.cook\n');
        });

        it('leaves text without the path untouched', () => {
            assert.strictEqual(remove('a.cook\n', 'b.cook'), 'a.cook\n');
        });

        it('returns empty text when the last entry goes', () => {
            assert.strictEqual(remove('a.cook\n', 'a.cook'), '');
        });
    });

    describe('rename', () => {
        it('rewrites the matching line in place', () => {
            assert.strictEqual(rename('a.cook\n# c\nb.cook\n', 'b.cook', 'Dinner/b.cook'), 'a.cook\n# c\nDinner/b.cook\n');
        });

        it('drops the old line when the target is already listed', () => {
            assert.strictEqual(rename('a.cook\nb.cook\n', 'b.cook', 'a.cook'), 'a.cook\n');
        });
    });

    describe('renamePrefix', () => {
        it('moves every entry under the folder', () => {
            assert.strictEqual(
                renamePrefix('Old/a.cook\nOld/Sub/b.cook\nOlder/c.cook\n', 'Old', 'New'),
                'New/a.cook\nNew/Sub/b.cook\nOlder/c.cook\n');
        });

        it('accepts a trailing slash on the folders', () => {
            assert.strictEqual(renamePrefix('Old/a.cook\n', 'Old/', 'New/'), 'New/a.cook\n');
        });
    });

    describe('removePrefix', () => {
        it('drops every entry under the folder but not look-alike folders', () => {
            assert.strictEqual(removePrefix('Old/a.cook\nOlder/c.cook\n# keep\n', 'Old'), 'Older/c.cook\n# keep\n');
        });
    });
});

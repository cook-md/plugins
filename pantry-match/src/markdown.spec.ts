import * as assert from 'assert';
import { escapeMarkdown, formatNames, truncateName } from './markdown';

describe('markdown helpers', () => {
    it('escapes markdown specials and folds newlines', () => {
        assert.strictEqual(escapeMarkdown('a*b_[c](d)\nx'), 'a\\*b\\_\\[c\\]\\(d\\) x');
    });

    it('truncates long names at 60 characters', () => {
        assert.strictEqual(truncateName('x'.repeat(61)), `${'x'.repeat(60)}…`);
    });

    it('caps a list at 8 names', () => {
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        assert.strictEqual(formatNames(names), 'a, b, c, d, e, f, g, h, and 2 more');
    });
});

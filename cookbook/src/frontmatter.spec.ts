import * as assert from 'assert';
import { firstHeading, parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
    it('reads title and order and returns the body', () => {
        assert.deepStrictEqual(parseFrontmatter('---\ntitle: "Soups & Stews"\norder: 2\n---\nHot bowls.\n'),
            { title: 'Soups & Stews', order: 2, body: 'Hot bowls.\n' });
        assert.deepStrictEqual(parseFrontmatter('﻿---\r\nTitle: Breakfast\r\norder: -1.5\r\n---\r\nEggs.'),
            { title: 'Breakfast', order: -1.5, body: 'Eggs.' });
    });

    it('ignores a non-numeric order and an empty title', () => {
        assert.deepStrictEqual(parseFrontmatter("---\ntitle: ''\norder: first\n---\nx"), { body: 'x' });
    });

    it('treats text without a closed block as body', () => {
        assert.deepStrictEqual(parseFrontmatter('# Hello\n'), { body: '# Hello\n' });
        assert.deepStrictEqual(parseFrontmatter('---\ntitle: x\n'), { body: '---\ntitle: x\n' });
    });
});

describe('firstHeading', () => {
    it('finds the first level-1 heading only', () => {
        assert.strictEqual(firstHeading('intro\n## Not this\n# Family Cookbook #\n# Second'), 'Family Cookbook');
        assert.strictEqual(firstHeading('## Only h2\n#hashtag'), undefined);
    });
});

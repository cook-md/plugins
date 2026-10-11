import * as assert from 'assert';
import { escapeHtml, inlineMarkdown, markdownImageSources, markdownToHtml } from './markdown';

const md = (source: string, headingShift = 0): string => markdownToHtml(source, { headingShift });

describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
        assert.strictEqual(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    });
});

describe('markdownToHtml', () => {
    it('renders headings shifted below the chapter heading, capped at h6', () => {
        assert.strictEqual(md('# One\n## Two\n### Three', 1), '<h2>One</h2>\n<h3>Two</h3>\n<h4>Three</h4>');
        assert.strictEqual(md('### Deep', 4), '<h6>Deep</h6>');
        assert.strictEqual(md('#### Four'), '<p>#### Four</p>');
    });

    it('drops the first # heading when asked', () => {
        assert.strictEqual(markdownToHtml('# Title\n\nText\n\n# Again', { headingShift: 1, dropFirstHeading: true }), '<p>Text</p>\n<h2>Again</h2>');
    });

    it('joins paragraph lines and splits on blank lines', () => {
        assert.strictEqual(md('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
    });

    it('renders emphasis, strong and inline code', () => {
        assert.strictEqual(md('*soft* and **bold** with `a < b`'), '<p><em>soft</em> and <strong>bold</strong> with <code>a &lt; b</code></p>');
    });

    it('renders one-level lists with continuation lines', () => {
        assert.strictEqual(md('- eggs\n- flour\n  sifted\n\n1. mix\n2) bake'), '<ul><li>eggs</li><li>flour sifted</li></ul>\n<ol><li>mix</li><li>bake</li></ol>');
        assert.strictEqual(md('- a\n1. b'), '<ul><li>a</li></ul>\n<ol><li>b</li></ol>');
    });

    it('renders blockquotes and horizontal rules', () => {
        assert.strictEqual(md('> Cook with\n> love\n\n---\n\n***'), '<blockquote><p>Cook with love</p></blockquote>\n<hr>\n<hr>');
    });

    it('keeps http(s) links and renders other links as text', () => {
        assert.strictEqual(md('[site](https://cooklang.org/?a=1&b=2) [bad](javascript:void0) [mail](mailto:x@y.z) [doc](notes.md)'),
            '<p><a href="https://cooklang.org/?a=1&amp;b=2">site</a> bad mail doc</p>');
    });

    it('escapes all HTML in the source', () => {
        assert.strictEqual(md('<script>alert(1)</script>\n\n**<b>x</b>**'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
        assert.strictEqual(md('[x"><img src=x onerror=alert(1)>](https://a.b)'),
            '<p><a href="https://a.b">x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</a></p>');
        assert.strictEqual(md('[x](https://a.b/"onmouseover="alert(1))'), '<p>[x](https://a.b/&quot;onmouseover=&quot;alert(1))</p>');
    });

    it('strips frontmatter', () => {
        assert.strictEqual(md('---\ntitle: Soups\norder: 2\n---\nHot.'), '<p>Hot.</p>');
    });

    it('inlines relative images through the resolver and keeps http(s) images', () => {
        const resolveImage = (src: string): string | undefined => src === 'bowl.jpg' ? 'data:image/jpeg;base64,AAAA' : undefined;
        assert.strictEqual(markdownToHtml('![Bowl](bowl.jpg) ![Gone](gone.png) ![Web](https://x.org/a.png)', { headingShift: 0, resolveImage }),
            '<p><img src="data:image/jpeg;base64,AAAA" alt="Bowl"> Gone <img src="https://x.org/a.png" alt="Web"></p>');
    });

    it('rejects resolver output that is not an image data URI', () => {
        assert.strictEqual(inlineMarkdown('![a](b.png)', { headingShift: 0, resolveImage: () => 'javascript:alert(1)' }), 'a');
        assert.strictEqual(inlineMarkdown('![a](data:text/html,x)', { headingShift: 0, resolveImage: () => 'data:image/png;base64,AA' }), 'a');
    });
});

describe('markdownImageSources', () => {
    it('lists distinct relative image sources outside the frontmatter', () => {
        assert.deepStrictEqual(markdownImageSources('---\ntitle: x\n---\n![a](a.jpg) ![b](https://x/b.png) ![c](img/c.png) ![a2](a.jpg)'), ['a.jpg', 'img/c.png']);
    });
});

import * as assert from 'assert';
import { ingredientName, renderRecipeHtml } from './recipe-html';
import { RecipeData } from './recipe-template';

const DATA: RecipeData = {
    metadata: { title: 'Soup', servings: 4, 'prep time': '10 min', cook_time: 20, source: { name: 'Gran <3', url: 'https://example.com/soup' }, tags: ['soup', '<b>'] },
    ingredients: [
        { name: 'onion', quantity: '1', note: 'diced', optional: false, reference: false },
        { name: 'salt', quantity: '', note: '', optional: true, reference: false },
        { name: './Sauces/Pesto', quantity: '1 tbsp', note: '', optional: false, reference: true },
    ],
    cookware: [{ name: 'pot', quantity: '1', note: '' }],
    sections: [
        { name: '', blocks: [{ kind: 'text', text: 'Serve <hot> & fresh.' }, { kind: 'step', number: 1, text: 'Chop 1 onion.' }, { kind: 'step', number: 2, text: 'Fry.' }] },
        { name: 'Finish', blocks: [{ kind: 'step', number: 1, text: 'Blend.' }] },
    ],
};

const IMG = 'data:image/jpeg;base64,AAAA';

describe('ingredientName', () => {
    it('shows a referenced recipe by its file name', () => {
        assert.strictEqual(ingredientName(DATA.ingredients[2]), 'Pesto');
        assert.strictEqual(ingredientName(DATA.ingredients[0]), 'onion');
    });
});

describe('renderRecipeHtml', () => {
    const html = renderRecipeHtml({ id: 'r-1', title: 'Soup & <Co>', data: DATA, images: { steps: {} }, nutritionLine: 'Per serving: 1 kcal · 0 g protein · 0 g carbs · 0 g fat' });

    it('renders an article with an escaped title and anchor id', () => {
        assert.ok(html.startsWith('<article class="recipe" id="r-1">\n<h2 class="recipe-title">Soup &amp; &lt;Co&gt;</h2>'));
        assert.ok(html.endsWith('</section>\n</article>'));
    });

    it('renders the metadata line, source link, tags and nutrition line', () => {
        assert.ok(html.includes('<p class="meta">Serves 4 · Prep 10 min · Cook 20 min</p>'));
        assert.ok(html.includes('<p class="source">Source: <a href="https://example.com/soup">Gran &lt;3</a></p>'));
        assert.ok(html.includes('<span class="tag">&lt;b&gt;</span>'));
        assert.ok(html.includes('<p class="nutrition">Per serving: 1 kcal · 0 g protein · 0 g carbs · 0 g fat</p>'));
    });

    it('renders ingredients with quantity, note, optional marker and reference names', () => {
        assert.ok(html.includes('<li><span class="qty">1</span> onion <span class="note">(diced)</span></li>'));
        assert.ok(html.includes('<li>salt <span class="optional">optional</span></li>'));
        assert.ok(html.includes('<li><span class="qty">1 tbsp</span> Pesto</li>'));
        assert.ok(html.includes('<section class="cookware"><h3>Cookware</h3><ul><li><span class="qty">1</span> pot</li></ul></section>'));
    });

    it('renders text blocks, numbered steps and named sections', () => {
        assert.ok(html.includes('<p class="text">Serve &lt;hot&gt; &amp; fresh.</p>'));
        assert.ok(html.includes('<div class="step"><span class="step-number">2</span><p>Fry.</p></div>'));
        assert.ok(html.includes('<h4 class="section-name">Finish</h4>\n<div class="step"><span class="step-number">1</span><p>Blend.</p></div>'));
    });

    it('omits empty parts', () => {
        const bare = renderRecipeHtml({ id: 'r-2', title: 'Bare', data: { metadata: {}, ingredients: [], cookware: [], sections: [] }, images: { steps: {} } });
        assert.strictEqual(bare, '<article class="recipe" id="r-2">\n<h2 class="recipe-title">Bare</h2>\n<section class="method"><h3>Method</h3>\n</section>\n</article>');
    });

    it('places the title image and step images by section and step index', () => {
        const withImages = renderRecipeHtml({
            id: 'r-3', title: 'Soup', data: DATA,
            images: { title: IMG, steps: { 0: { 1: IMG }, 1: { 0: 'https://x.org/blend.jpg' } } },
        });
        assert.ok(withImages.includes(`<h2 class="recipe-title">Soup</h2>\n<img class="title-image" src="${IMG}" alt="">`));
        assert.ok(withImages.includes(`<p>Fry.</p><img class="step-image" src="${IMG}" alt=""></div>`));
        assert.ok(withImages.includes('<p>Blend.</p><img class="step-image" src="https://x.org/blend.jpg" alt=""></div>'));
        assert.ok(withImages.includes('<p>Chop 1 onion.</p></div>'));
    });

    it('drops unsafe image sources and links', () => {
        const unsafe = renderRecipeHtml({
            id: 'r-4', title: 'X',
            data: { ...DATA, metadata: { source: 'javascript:alert(1)' } },
            images: { title: 'javascript:alert(1)', steps: { 0: { 0: 'file:///etc/passwd' } } },
        });
        assert.ok(!unsafe.includes('<img'));
        assert.ok(unsafe.includes('<p class="source">Source: javascript:alert(1)</p>'));
    });

    it('links a plain URL source', () => {
        const linked = renderRecipeHtml({ id: 'r-5', title: 'X', data: { ...DATA, metadata: { source: 'https://a.b/c' } }, images: { steps: {} } });
        assert.ok(linked.includes('<p class="source">Source: <a href="https://a.b/c">https://a.b/c</a></p>'));
    });
});

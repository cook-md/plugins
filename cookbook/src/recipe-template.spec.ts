import * as assert from 'assert';
import { RECIPE_TEMPLATE, parseRecipeOutput, recipeTitle } from './recipe-template';

/** Real cooklang-reports 0.5.2 output of RECIPE_TEMPLATE for a soup recipe (two sections, text blocks, a reference). */
const SOUP = '{"metadata":{"title":"Tomato Soup","servings":4,"prep time":"10 min","tags":["soup","vegan"],"source":{"name":"Grandma","url":"https://example.com/soup"}},"ingredients":[{"name":"onion","quantity":"1","note":"diced","reference":false},{"name":"garlic","quantity":"2 cloves","note":"","reference":false},{"name":"olive oil","quantity":"2 tbsp","note":"","reference":false},{"name":"Pesto","quantity":"1 tbsp","note":"","reference":true},{"name":"salt","quantity":"","note":"","reference":false}],"cookware":[{"name":"pot","quantity":"","note":""}],"sections":[{"name":"","blocks":[{"kind":"text","text":"A family favourite. \\"Best\\" \\u003cserved\\u003e hot \\u0026 fresh."},{"kind":"step","number":1,"text":"Chop 1 onion and 2 cloves garlic."},{"kind":"step","number":2,"text":"Fry in pot with 2 tbsp olive oil for 5 minutes."}]},{"name":"Finish","blocks":[{"kind":"text","text":"Taste first."},{"kind":"step","number":1,"text":"Blend 1 tbsp Pesto and salt until smooth."}]}]}';

/** Real output for `Add @?salt{} and @-pepper{} and @&onion{}.` (the engine keeps modifiers in names). */
const MODIFIERS = '{"metadata":{},"ingredients":[{"name":"?salt","quantity":"","note":"","reference":false},{"name":"-pepper","quantity":"","note":"","reference":false},{"name":"\\u0026onion","quantity":"","note":"","reference":false}],"cookware":[],"sections":[{"name":"","blocks":[{"kind":"step","number":1,"text":"Add ?salt and -pepper and \\u0026onion."}]}]}';

describe('RECIPE_TEMPLATE', () => {
    it('emits one JSON document through tojson and stays far below the 64K template limit', () => {
        assert.ok(RECIPE_TEMPLATE.trimEnd().endsWith('| tojson }}'));
        assert.ok(RECIPE_TEMPLATE.includes('text is startingwith(prefix)'));
        assert.ok(RECIPE_TEMPLATE.length < 4096);
    });
});

describe('parseRecipeOutput', () => {
    it('reads metadata, ingredients, cookware and sections with steps and text blocks', () => {
        const data = parseRecipeOutput(SOUP)!;
        assert.strictEqual(data.metadata.title, 'Tomato Soup');
        assert.deepStrictEqual(data.ingredients[0], { name: 'onion', quantity: '1', note: 'diced', optional: false, reference: false });
        assert.deepStrictEqual(data.ingredients[3], { name: 'Pesto', quantity: '1 tbsp', note: '', optional: false, reference: true });
        assert.deepStrictEqual(data.cookware, [{ name: 'pot', quantity: '', note: '' }]);
        assert.strictEqual(data.sections.length, 2);
        assert.deepStrictEqual(data.sections[0].blocks[0], { kind: 'text', text: 'A family favourite. "Best" <served> hot & fresh.' });
        assert.deepStrictEqual(data.sections[0].blocks[2], { kind: 'step', number: 2, text: 'Fry in pot with 2 tbsp olive oil for 5 minutes.' });
        assert.strictEqual(data.sections[1].name, 'Finish');
        assert.deepStrictEqual(data.sections[1].blocks[1], { kind: 'step', number: 1, text: 'Blend 1 tbsp Pesto and salt until smooth.' });
    });

    it('marks ?optional ingredients, drops -hidden and &reused ones and cleans the step text', () => {
        const data = parseRecipeOutput(MODIFIERS)!;
        assert.deepStrictEqual(data.ingredients, [{ name: 'salt', quantity: '', note: '', optional: true, reference: false }]);
        assert.deepStrictEqual(data.sections[0].blocks, [{ kind: 'step', number: 1, text: 'Add salt and pepper and onion.' }]);
    });

    it('drops malformed entries and rejects a malformed document', () => {
        const data = parseRecipeOutput(JSON.stringify({
            metadata: [],
            ingredients: [{ name: '' }, { quantity: '1' }, 'x', { name: 'egg', quantity: 2 }],
            cookware: [null, { name: 'pan' }],
            sections: [{ blocks: [{ kind: 'step', number: 0, text: 'x' }, { kind: 'step', number: 1, text: 'Go.' }, { kind: 'odd', text: 'y' }] }, 'bad'],
        }))!;
        assert.deepStrictEqual(data.metadata, {});
        assert.deepStrictEqual(data.ingredients, [{ name: 'egg', quantity: '2', note: '', optional: false, reference: false }]);
        assert.deepStrictEqual(data.cookware, [{ name: 'pan', quantity: '', note: '' }]);
        assert.deepStrictEqual(data.sections, [{ name: '', blocks: [{ kind: 'step', number: 1, text: 'Go.' }] }]);
        assert.strictEqual(parseRecipeOutput('not json'), undefined);
        assert.strictEqual(parseRecipeOutput('{"ingredients":[]}'), undefined);
    });
});

describe('recipeTitle', () => {
    it('prefers the title metadata', () => {
        assert.strictEqual(recipeTitle(parseRecipeOutput(SOUP)!, 'Tomato'), 'Tomato Soup');
        assert.strictEqual(recipeTitle(parseRecipeOutput(MODIFIERS)!, 'Seasoning'), 'Seasoning');
    });
});

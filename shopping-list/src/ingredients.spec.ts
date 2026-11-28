import * as assert from 'assert';
import { addQuantities, editedLine, editText, recognizeLine, recognizeList } from './ingredients';

// These run the real cooklang-ingredient-parser (wasm): the plugin only
// adapts its answers to `.shopping-list` lines.
describe('ingredients', () => {
    const aisle = '[produce]\ntomatoes|tomato\nlemons\n\n[dairy]\nmilk\n';

    it('reads an amount at either end of a typed line, with the chip it shows', () => {
        assert.deepStrictEqual(recognizeLine('Sugar 1.5kg'), { name: 'Sugar', quantity: '1.5%kg', chip: '1.5 kg' });
        assert.deepStrictEqual(recognizeLine('Milk 2 l'), { name: 'Milk', quantity: '2%l', chip: '2 l' });
        assert.deepStrictEqual(recognizeLine('3 lemons'), { name: 'lemons', quantity: '3', chip: 'x3' });
        assert.deepStrictEqual(recognizeLine('1/2 cup sugar'), { name: 'sugar', quantity: '0.5%cup', chip: '0.5 cup' });
        assert.deepStrictEqual(recognizeLine('Bread'), { name: 'Bread' });
        assert.deepStrictEqual(recognizeLine('7up'), { name: '7up' });
        assert.strictEqual(recognizeLine('   '), undefined);
    });

    it('takes the aisle configuration spelling of a name', () => {
        assert.deepStrictEqual(recognizeLine('Milk 2 l', aisle), { name: 'milk', quantity: '2%l', chip: '2 l' });
        assert.strictEqual(recognizeLine('Tomato', aisle)?.name, 'tomato');
    });

    it('cleans names so the line reads back from .shopping-list unchanged', () => {
        assert.strictEqual(recognizeLine('./? half--and--half {x}')?.name, 'half-and-half x');
    });

    it('splits pasted text, dropping bullets, checkboxes and headings', () => {
        assert.deepStrictEqual(recognizeList('## Dairy\n- Milk 2 l\n\n• Bread\n[x] Avocado').map(row => row.name), ['Milk', 'Bread', 'Avocado']);
    });

    it('adds quantities only when they add up', () => {
        assert.strictEqual(addQuantities('1%l', '0.5%l'), '1.5%l');
        assert.strictEqual(addQuantities('3', '2'), '5');
        assert.strictEqual(addQuantities(undefined, undefined), undefined);
        assert.strictEqual(addQuantities('1%l', '200%ml'), 'not-addable');
        assert.strictEqual(addQuantities('a pinch', '1'), 'not-addable');
        assert.strictEqual(addQuantities(undefined, '2'), 'not-addable');
        assert.strictEqual(addQuantities('1/2%cup', '1/2%cup'), '1%cup');
        // A stored quantity that does not read back the same is left alone.
        assert.strictEqual(addQuantities('2}%l', '1%l'), 'not-addable');
    });

    it('gives the text an edit box starts with', () => {
        assert.strictEqual(editText({ name: 'Milk', quantity: '2%l' }), 'Milk 2 l');
        // Amounts the rules would not read back the same are left out.
        assert.strictEqual(editText({ name: 'salt', quantity: 'a pinch' }), 'salt');
        assert.strictEqual(editText({ name: 'x', quantity: '2}%l' }), 'x');
    });

    it('edits without re-reading lines that were not changed', () => {
        // Lines other tools wrote, saved as they are.
        assert.strictEqual(editedLine({ name: 'Heinz 57' }, 'Heinz 57'), 'unchanged');
        assert.strictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, ' salt '), 'unchanged');
        assert.strictEqual(editedLine({ name: 'Milk', quantity: '2%l' }, 'Milk  2 l'), 'unchanged');
        // A rename keeps an amount the edit box could not show.
        assert.deepStrictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, 'sea salt'), { name: 'sea salt', quantity: 'a pinch' });
        assert.deepStrictEqual(editedLine({ name: 'wine', quantity: '1%glass' }, 'red wine'), { name: 'red wine', quantity: '1%glass' });
        // A shown amount is edited like any typed line.
        assert.deepStrictEqual(editedLine({ name: 'Milk', quantity: '2%l' }, 'Milk 3 l'), { name: 'Milk', quantity: '3%l' });
        assert.deepStrictEqual(editedLine({ name: 'Milk', quantity: '2%l' }, 'Milk'), { name: 'Milk' });
        assert.strictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, '  '), undefined);
    });
});

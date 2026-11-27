import * as assert from 'assert';
import type { ShoppingListEntry } from './cooklang-api';
import {
    cleanName, cleanQuantity, displayQuantity, editedLine, editText, formatStoredQuantity, parseStoredQuantity, placeFreeHand, recognizeLine, splitPastedText,
} from './free-hand';

describe('free-hand', () => {
    it('recognizes an amount at the end of a typed line', () => {
        assert.deepStrictEqual(recognizeLine('Sugar 1.5kg'), { name: 'Sugar', quantity: '1.5%kg' });
        assert.deepStrictEqual(recognizeLine('Milk 2 l'), { name: 'Milk', quantity: '2%l' });
        assert.deepStrictEqual(recognizeLine('Lemons 3'), { name: 'Lemons', quantity: '3' });
        assert.deepStrictEqual(recognizeLine('olive oil 200 ml'), { name: 'olive oil', quantity: '200%ml' });
        assert.deepStrictEqual(recognizeLine('Butter 1,5 kg'), { name: 'Butter', quantity: '1.5%kg' });
        assert.deepStrictEqual(recognizeLine('Eggs 6 pcs'), { name: 'Eggs', quantity: '6' });
        assert.deepStrictEqual(recognizeLine('Rice 2 Cups'), { name: 'Rice', quantity: '2%cup' });
    });

    it('recognizes an amount at the start of a typed line', () => {
        assert.deepStrictEqual(recognizeLine('2 l milk'), { name: 'milk', quantity: '2%l' });
        assert.deepStrictEqual(recognizeLine('3 lemons'), { name: 'lemons', quantity: '3' });
        assert.deepStrictEqual(recognizeLine('500g flour'), { name: 'flour', quantity: '500%g' });
        assert.deepStrictEqual(recognizeLine('1/2 cup sugar'), { name: 'sugar', quantity: '0.5%cup' });
    });

    it('keeps the whole line as the name when there is no amount', () => {
        assert.deepStrictEqual(recognizeLine('Bread'), { name: 'Bread' });
        assert.deepStrictEqual(recognizeLine('7up'), { name: '7up' });
        assert.deepStrictEqual(recognizeLine('Milk2l'), { name: 'Milk2l' });
        assert.deepStrictEqual(recognizeLine('24/7 snacks'), { name: '24/7 snacks' });
        assert.deepStrictEqual(recognizeLine('3'), { name: '3' });
        assert.deepStrictEqual(recognizeLine('2 l'), { name: '2 l' });
        assert.deepStrictEqual(recognizeLine('Can you grab on the way home'), { name: 'Can you grab on the way home' });
        assert.strictEqual(recognizeLine('   '), undefined);
    });

    it('cleans names so the line reads back unchanged', () => {
        assert.strictEqual(cleanName('  half--and--half  '), 'half-and-half');
        assert.strictEqual(cleanName('x [- y'), 'x [ y');
        assert.strictEqual(cleanName('a{b}'), 'ab');
        assert.strictEqual(cleanName('./x'), 'x');
        assert.strictEqual(cleanName('? ./ ? milk'), 'milk');
        assert.strictEqual(cleanName('milk\n\tbread'), 'milk bread');
        assert.strictEqual(cleanName('mi​lk'), 'milk');
        assert.strictEqual(cleanName('{}'), '');
        assert.strictEqual(cleanQuantity(' a -- b '), 'a - b');
        assert.strictEqual(cleanQuantity('{}'), undefined);
    });

    it('reads and writes stored quantities', () => {
        assert.deepStrictEqual(parseStoredQuantity('2%l'), { kind: 'number', value: 2, unit: 'l' });
        assert.deepStrictEqual(parseStoredQuantity('3'), { kind: 'number', value: 3 });
        assert.deepStrictEqual(parseStoredQuantity('1/2%cup'), { kind: 'number', value: 0.5, unit: 'cup' });
        assert.deepStrictEqual(parseStoredQuantity('a pinch'), { kind: 'text', text: 'a pinch' });
        assert.deepStrictEqual(parseStoredQuantity('1,000%g'), { kind: 'text', text: '1,000%g' });
        assert.strictEqual(formatStoredQuantity(0.1 + 0.2, 'kg'), '0.3%kg');
        assert.strictEqual(formatStoredQuantity(3), '3');
        assert.strictEqual(displayQuantity('2%l'), '2 l');
        assert.strictEqual(displayQuantity(undefined), '');
        assert.strictEqual(editText({ name: 'Milk', quantity: '2%l' }), 'Milk 2 l');
    });

    it('splits pasted text into lines, dropping list markers', () => {
        assert.deepStrictEqual(splitPastedText('- Milk 2 l\n* Lemons, 3\n\n• Bread\r\n[x] Avocado\n  [ ] Parmigiano  '),
            ['Milk 2 l', 'Lemons, 3', 'Bread', 'Avocado', 'Parmigiano']);
    });

    it('folds a same-name line with a compatible amount', () => {
        const items: ShoppingListEntry[] = [
            { type: 'recipe', path: 'Pasta.cook', children: [] },
            { type: 'ingredient', name: 'Milk', quantity: '1%l' },
            { type: 'ingredient', name: 'bread' },
            { type: 'ingredient', name: 'salt', quantity: 'a pinch' },
        ];
        assert.deepStrictEqual(placeFreeHand(items, { name: 'milk', quantity: '0.5%L' }), { index: 1, quantity: '1.5%l' });
        assert.deepStrictEqual(placeFreeHand(items, { name: 'Bread' }), { index: 2 });
        assert.strictEqual(placeFreeHand(items, { name: 'milk', quantity: '500%ml' }), undefined);
        assert.strictEqual(placeFreeHand(items, { name: 'milk' }), undefined);
        assert.strictEqual(placeFreeHand(items, { name: 'salt', quantity: 'to taste' }), undefined);
        assert.strictEqual(placeFreeHand(items, { name: 'Pasta.cook' }), undefined);
    });

    it('edits without re-reading what was not changed', () => {
        // Lines other tools wrote, saved as they are.
        assert.strictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, 'salt a pinch'), 'unchanged');
        assert.strictEqual(editedLine({ name: 'wine', quantity: '1%glass' }, ' wine  1 glass '), 'unchanged');
        assert.strictEqual(editedLine({ name: 'Heinz 57' }, 'Heinz 57'), 'unchanged');
        // A new name keeps the stored amount verbatim, even one the recognizer does not know.
        assert.deepStrictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, 'sea salt a pinch'), { name: 'sea salt', quantity: 'a pinch' });
        assert.deepStrictEqual(editedLine({ name: 'wine', quantity: '1%glass' }, 'red wine 1 glass'), { name: 'red wine', quantity: '1%glass' });
        // A new amount is read as typed.
        assert.deepStrictEqual(editedLine({ name: 'milk', quantity: '2%l' }, 'milk 3 l'), { name: 'milk', quantity: '3%l' });
        assert.deepStrictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, 'salt'), { name: 'salt' });
        assert.strictEqual(editedLine({ name: 'salt', quantity: 'a pinch' }, '  '), undefined);
    });
});

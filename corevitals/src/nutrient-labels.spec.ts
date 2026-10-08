import * as assert from 'assert';
import { labelFor, prettify, unitFor } from './nutrient-labels';

describe('labelFor', () => {
    it('uses the table for known keys', () => {
        assert.strictEqual(labelFor('kcal'), 'Energy');
        assert.strictEqual(labelFor('sat_fat_g'), 'Saturated fat');
        assert.strictEqual(labelFor('vit_b12_ug'), 'Vitamin B12');
        assert.strictEqual(labelFor('vit_a_rae_ug'), 'Vitamin A');
    });

    it('prettifies unknown keys', () => {
        assert.strictEqual(labelFor('boron_ug'), 'Boron');
        assert.strictEqual(labelFor('pantothenic_acid_mg'), 'Pantothenic acid');
        assert.strictEqual(labelFor('vit_k_mk4_ug'), 'Vitamin K MK4');
    });
});

describe('prettify', () => {
    // Documents the fallback only: readSettings filters out keys whose label the template would refuse.
    it('returns the key itself when it has no words', () => {
        assert.strictEqual(prettify('_g'), '_g');
    });
});

describe('unitFor', () => {
    it('derives the unit from the key suffix', () => {
        assert.strictEqual(unitFor('kcal'), 'kcal');
        assert.strictEqual(unitFor('fiber_g'), 'g');
        assert.strictEqual(unitFor('iron_mg'), 'mg');
        assert.strictEqual(unitFor('folate_ug'), 'µg');
        assert.strictEqual(unitFor('vit_d_iu'), 'IU');
        assert.strictEqual(unitFor('mystery'), '');
    });
});

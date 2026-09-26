import * as assert from 'assert';
import { toPer100g } from './nutrition-input';
import { NutritionAggregate } from './nutrition-template';

const aggregate = (mass: number, micros: Record<string, number> = { sodium_mg: 400 }): NutritionAggregate => ({
    items: [],
    failures: [],
    totals: {
        mass_g: mass,
        macros: { kcal: 400, protein_g: 10, fat_g: 5, carb_g: 50, fiber_g: 6, sugar_g: 8, sat_fat_g: 2 },
        micros,
        confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 2, failed_count: 0,
    },
});

describe('toPer100g', () => {
    it('scales totals to 100 g, converts kcal to kJ and sodium to salt', () => {
        const values = toPer100g(aggregate(200), 50)!;
        assert.strictEqual(Math.round(values.energyKj * 100) / 100, 836.8);
        assert.strictEqual(values.proteinG, 5);
        assert.strictEqual(values.fibreG, 3);
        assert.strictEqual(values.sugarsG, 4);
        assert.strictEqual(values.satFatG, 1);
        assert.strictEqual(values.saltG, 0.5);
        assert.strictEqual(values.fvlPercent, 25);
    });

    it('prefers the service energy_kj over converting kcal', () => {
        assert.strictEqual(toPer100g(aggregate(200, { energy_kj: 1000 }), undefined)!.energyKj, 500);
    });

    it('treats an unknown fruit/veg share as 0 and missing sodium as 0', () => {
        const values = toPer100g(aggregate(100, {}), undefined)!;
        assert.strictEqual(values.fvlPercent, 0);
        assert.strictEqual(values.saltG, 0);
    });

    it('returns undefined without a total mass', () => {
        assert.strictEqual(toPer100g(aggregate(0), undefined), undefined);
    });

    it('caps the fruit/veg share at 100 %', () => {
        assert.strictEqual(toPer100g(aggregate(100), 150)!.fvlPercent, 100);
    });
});

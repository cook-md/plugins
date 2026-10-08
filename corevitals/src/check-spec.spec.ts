import * as assert from 'assert';
import { buildCheckSpec } from './check-spec';
import { CoreVitalsSettings } from './settings';

const DEFAULTS: CoreVitalsSettings = {
    standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg', 'vit_c_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

describe('buildCheckSpec', () => {
    it('lists energy, the three macros, fiber, the two limits, then the micronutrients', () => {
        const spec = buildCheckSpec(DEFAULTS, 4);
        assert.deepStrictEqual(spec.checks.map(check => `${check.key}:${check.kind}`), [
            'kcal:energy', 'protein_g:macroPercent', 'carb_g:macroPercent', 'fat_g:macroPercent',
            'fiber_g:min', 'sat_fat_g:max', 'sodium_mg:max', 'iron_mg:min', 'vit_c_mg:min',
        ]);
        assert.deepStrictEqual({ standard: spec.standard, tol: spec.tol, mealsPerDay: spec.mealsPerDay, servings: spec.servings },
            { standard: 'fda', tol: 20, mealsPerDay: 3, servings: 4 });
        assert.strictEqual(buildCheckSpec(DEFAULTS, 4).servingsKnown, true);
        assert.strictEqual(buildCheckSpec(DEFAULTS, 1, false).servingsKnown, false);
    });

    it('uses AMDR bands and kcal-per-gram factors for macros without overrides', () => {
        const [, protein, carb, fat] = buildCheckSpec(DEFAULTS, 1).checks;
        assert.deepStrictEqual(protein, { key: 'protein_g', label: 'Protein', kind: 'macroPercent', unit: '% energy', factor: 4, band: [10, 35] });
        assert.deepStrictEqual(carb.band, [45, 65]);
        assert.strictEqual(carb.factor, 4);
        assert.deepStrictEqual(fat.band, [20, 35]);
        assert.strictEqual(fat.factor, 9);
    });

    it('turns overrides into fixed targets and omits the band', () => {
        const spec = buildCheckSpec({ ...DEFAULTS, energyKcal: 2500, fatPercent: 30 }, 1);
        assert.deepStrictEqual(spec.checks[0], { key: 'kcal', label: 'Energy', kind: 'energy', unit: 'kcal', target: 2500 });
        assert.strictEqual(spec.checks[3].target, 30);
        assert.strictEqual(spec.checks[3].band, undefined);
    });

    it('labels and units micronutrients and never passes servings below 1', () => {
        const spec = buildCheckSpec(DEFAULTS, 0);
        assert.deepStrictEqual(spec.checks[8], { key: 'vit_c_mg', label: 'Vitamin C', kind: 'min', unit: 'mg' });
        assert.strictEqual(spec.servings, 1);
    });

    it('embeds as plain JSON and does not share the AMDR arrays', () => {
        const spec = buildCheckSpec(DEFAULTS, 2);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(spec)), spec);
        (spec.checks[1].band as unknown as number[])[0] = 99;
        assert.deepStrictEqual(buildCheckSpec(DEFAULTS, 2).checks[1].band, [10, 35]);
    });
});

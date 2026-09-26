import { NutritionAggregate } from './nutrition-template';
import { Per100g } from './nutriscore';

/** Micro keys the service uses for sodium in mg, most likely first. */
export const SODIUM_KEYS = ['sodium_mg'];
const KJ_PER_KCAL = 4.184;

/**
 * Recipe totals as per-100 g Nutri-Score input. `categoryMassG` is the weight
 * of fruit/vegetable/legume ingredients, or undefined when unknown (counted
 * as 0 %). Undefined when the service could not weigh the recipe.
 */
export function toPer100g(aggregate: NutritionAggregate, categoryMassG: number | undefined): Per100g | undefined {
    const mass = aggregate.totals.mass_g;
    if (!(mass > 0)) {
        return undefined;
    }
    const factor = 100 / mass;
    const macros = aggregate.totals.macros;
    // The service reports energy in kJ directly; fall back to converting kcal.
    const energyKj = typeof aggregate.totals.micros.energy_kj === 'number'
        ? aggregate.totals.micros.energy_kj
        : macros.kcal * KJ_PER_KCAL;
    const sodiumKey = SODIUM_KEYS.find(key => typeof aggregate.totals.micros[key] === 'number');
    const sodiumMg = sodiumKey ? aggregate.totals.micros[sodiumKey] : 0;
    return {
        energyKj: energyKj * factor,
        sugarsG: macros.sugar_g * factor,
        satFatG: macros.sat_fat_g * factor,
        saltG: sodiumMg * 2.5 / 1000 * factor,
        proteinG: macros.protein_g * factor,
        fibreG: macros.fiber_g * factor,
        fvlPercent: Math.min(100, ((categoryMassG ?? 0) / mass) * 100),
    };
}

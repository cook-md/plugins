import { labelFor, unitFor } from './nutrient-labels';
import { CoreVitalsSettings, Standard } from './settings';

/** energy: within ± tol of the target; macroPercent: share of energy inside a band; min: at least; max: at most. */
export type CheckKind = 'energy' | 'macroPercent' | 'min' | 'max';

/** One check the template evaluates. Plain JSON: it is embedded in the template. */
export interface Check {
    key: string;
    label: string;
    kind: CheckKind;
    unit: string;
    /** Fixed daily target (energy) or share of energy (macro); unset means "look up the daily value" / "use the band". */
    target?: number;
    /** Acceptable share of energy, macros only. */
    band?: readonly [number, number];
    /** kcal per gram, macros only. */
    factor?: number;
}

/** Everything the template needs to evaluate a plan or recipe; embedded verbatim as a Jinja dict literal, so it must stay plain JSON. */
export interface CheckSpec {
    standard: Standard;
    tol: number;
    mealsPerDay: number;
    /** Recipe servings (ignored for plans, which carry their own). */
    servings: number;
    checks: Check[];
}

type MacroKey = 'protein_g' | 'carb_g' | 'fat_g';

/** Acceptable macronutrient distribution ranges, % of energy. */
export const AMDR: Readonly<Record<MacroKey, readonly [number, number]>> = {
    protein_g: [10, 35],
    carb_g: [45, 65],
    fat_g: [20, 35],
};

const KCAL_PER_GRAM: Readonly<Record<MacroKey, number>> = { protein_g: 4, carb_g: 4, fat_g: 9 };

function macroCheck(key: MacroKey, override: number): Check {
    const check: Check = { key, label: labelFor(key), kind: 'macroPercent', unit: '% energy', factor: KCAL_PER_GRAM[key] };
    if (override > 0) {
        check.target = override;
    } else {
        check.band = [AMDR[key][0], AMDR[key][1]];
    }
    return check;
}

/** Builds the checks for already-normalised settings; `servings` (recipes only) is clamped to at least 1. */
export function buildCheckSpec(settings: CoreVitalsSettings, servings: number): CheckSpec {
    const energy: Check = { key: 'kcal', label: labelFor('kcal'), kind: 'energy', unit: 'kcal' };
    if (settings.energyKcal > 0) {
        energy.target = settings.energyKcal;
    }
    const checks: Check[] = [
        energy,
        macroCheck('protein_g', settings.proteinPercent),
        macroCheck('carb_g', settings.carbPercent),
        macroCheck('fat_g', settings.fatPercent),
        { key: 'fiber_g', label: labelFor('fiber_g'), kind: 'min', unit: 'g' },
        { key: 'sat_fat_g', label: labelFor('sat_fat_g'), kind: 'max', unit: 'g' },
        { key: 'sodium_mg', label: labelFor('sodium_mg'), kind: 'max', unit: 'mg' },
        ...settings.micronutrients.map((key): Check => ({ key, label: labelFor(key), kind: 'min', unit: unitFor(key) })),
    ];
    return {
        standard: settings.standard,
        tol: settings.tolerancePercent,
        mealsPerDay: settings.mealsPerDay,
        servings: Number.isFinite(servings) && servings >= 1 ? servings : 1,
        checks,
    };
}

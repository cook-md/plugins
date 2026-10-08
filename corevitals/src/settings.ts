import { LABEL_TEXT, labelFor } from './nutrient-labels';

export const STANDARDS = ['fda', 'eu', 'uk'] as const;
export type Standard = typeof STANDARDS[number];

/** Keys the plugin always checks; they are dropped from the micronutrient list. */
export const ALWAYS_CHECKED_KEYS: readonly string[] = ['kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'sat_fat_g', 'sodium_mg'];
export const DEFAULT_MICRONUTRIENTS: readonly string[] = [
    'calcium_mg', 'iron_mg', 'potassium_mg', 'magnesium_mg', 'zinc_mg',
    'vit_a_rae_ug', 'vit_c_mg', 'vit_d_ug', 'vit_b12_ug', 'folate_ug',
];
export const MAX_MICRONUTRIENTS = 30;
/** Nutrient keys are embedded in the template, so they must be plain slugs. */
export const NUTRIENT_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const DEFAULT_TOLERANCE_PERCENT = 20;
export const DEFAULT_MEALS_PER_DAY = 3;

export interface CoreVitalsSettings {
    standard: Standard;
    /** Daily energy target; 0 means "use the standard's value". */
    energyKcal: number;
    /** Macro shares of energy; 0 means "use the AMDR band". */
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
    micronutrients: readonly string[];
    /** Band width around a target, 0–100. */
    tolerancePercent: number;
    /** A recipe serving is judged against a day divided by this, 1–10. */
    mealsPerDay: number;
    showWhenLocked: boolean;
}

/** Reads one setting under `coreVitals.`; extension.ts passes `getConfiguration('coreVitals').get`. */
export type ReadSetting = (key: string) => unknown;

function finiteNonNegative(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A macro override is a share of energy in 1–100; anything else means "not set". */
function percentOverride(value: unknown): number {
    const percent = finiteNonNegative(value, 0);
    return percent >= 1 && percent <= 100 ? percent : 0;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** Normalises the raw `coreVitals.*` values; anything malformed falls back to its default. */
export function readSettings(read: ReadSetting): CoreVitalsSettings {
    const rawStandard = read('standard');
    const standard = (STANDARDS as readonly unknown[]).includes(rawStandard) ? rawStandard as Standard : 'fda';
    const rawMicronutrients = read('micronutrients');
    const seen = new Set<string>(ALWAYS_CHECKED_KEYS);
    const micronutrients: string[] = [];
    for (const entry of Array.isArray(rawMicronutrients) ? rawMicronutrients : DEFAULT_MICRONUTRIENTS) {
        if (typeof entry !== 'string') {
            continue;
        }
        const key = entry.trim().toLowerCase();
        // A key whose label the template would refuse (e.g. `a__b_mg`) is dropped here rather than throwing later.
        if (!NUTRIENT_KEY.test(key) || seen.has(key) || !LABEL_TEXT.test(labelFor(key))) {
            continue;
        }
        seen.add(key);
        micronutrients.push(key);
        if (micronutrients.length === MAX_MICRONUTRIENTS) {
            break;
        }
    }
    let proteinPercent = percentOverride(read('proteinPercent'));
    let carbPercent = percentOverride(read('carbPercent'));
    let fatPercent = percentOverride(read('fatPercent'));
    // Set shares of energy that add up to more than 100 are a typo; use the bands instead (no further feasibility check).
    if (proteinPercent + carbPercent + fatPercent > 100) {
        proteinPercent = 0;
        carbPercent = 0;
        fatPercent = 0;
    }
    return {
        standard,
        energyKcal: finiteNonNegative(read('energyKcal'), 0),
        proteinPercent,
        carbPercent,
        fatPercent,
        micronutrients,
        tolerancePercent: clamp(finiteNonNegative(read('tolerancePercent'), DEFAULT_TOLERANCE_PERCENT), 0, 100),
        mealsPerDay: clamp(Math.round(finiteNonNegative(read('mealsPerDay'), DEFAULT_MEALS_PER_DAY)), 1, 10),
        showWhenLocked: read('showWhenLocked') !== false,
    };
}

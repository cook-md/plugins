import { MatchSummary, isConfident, summarizeMatch } from './match';
import { MacrosOutput, NutritionMacros } from './nutrition-template';
import { Basis } from './settings';

/** What the figures are per. `servings` is the frontmatter value times the preview scale. */
export type Portion =
    | { kind: 'serving'; servings: number }
    | { kind: 'whole' }
    | { kind: '100g' }
    | { kind: 'day'; people: number; days: number };

/** Why no figures are shown: nothing to evaluate, too few matches, a plan recipe missing, or no weight for per-100 g. */
export type WithheldReason = 'noData' | 'unmatched' | 'missingRecipes' | 'notWeighed';

/** Rounded figures: grams to whole numbers, kcal to the nearest 10. */
export type MacroFigures = NutritionMacros;

/** Protein, carbohydrate and fat as whole % of the energy they supply (4 / 4 / 9 kcal per g). */
export interface EnergyShares {
    protein: number;
    carb: number;
    fat: number;
}

export interface MacrosResult {
    portion: Portion;
    /** Set when the figures are not shown; `figures` and `shares` are then undefined. */
    withheld?: WithheldReason;
    figures?: MacroFigures;
    /** Undefined when the macros supply no energy. */
    shares?: EnergyShares;
    match: MatchSummary;
    missingRecipes: string[];
}

export interface MacrosOptions {
    basis: Basis;
    /** Recipe `servings:` from the frontmatter; undefined when absent. Ignored for plans. */
    servings: number | undefined;
    /** The scale the recipe was rendered at (the engine scales the ingredients by it). */
    scale: number;
}

/** A usable preview scale; anything else renders at 1. */
export function normaliseScale(scale: number): number {
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function roundGrams(grams: number): number {
    return Math.round(grams) + 0;
}

export function roundKcal(kcal: number): number {
    return Math.round(kcal / 10) * 10 + 0;
}

function portionFor(output: MacrosOutput, options: MacrosOptions): Portion {
    if (output.kind === 'plan') {
        return { kind: 'day', people: output.people, days: output.days };
    }
    if (options.basis === '100g') {
        return { kind: '100g' };
    }
    if (options.servings !== undefined) {
        // The engine scaled the ingredients, so scale the servings too: per-serving figures stay put.
        return { kind: 'serving', servings: options.servings * normaliseScale(options.scale) };
    }
    return { kind: 'whole' };
}

function divisorFor(portion: Portion, massG: number): number {
    switch (portion.kind) {
        case 'serving': return portion.servings;
        case 'whole': return 1;
        case '100g': return massG / 100;
        case 'day': return portion.people * portion.days;
        default: {
            const never: never = portion;
            return never;
        }
    }
}

function energyShares(macros: NutritionMacros): EnergyShares | undefined {
    const protein = macros.protein_g * 4;
    const carb = macros.carb_g * 4;
    const fat = macros.fat_g * 9;
    const energy = protein + carb + fat;
    if (!(energy > 0)) {
        return undefined;
    }
    return {
        protein: Math.round(protein / energy * 100),
        carb: Math.round(carb / energy * 100),
        fat: Math.round(fat / energy * 100),
    };
}

/** Turns a validated template output into the figures the badge and hover show. */
export function computeMacros(output: MacrosOutput, options: MacrosOptions): MacrosResult {
    const portion = portionFor(output, options);
    const match = summarizeMatch(output.aggregate);
    const missingRecipes = output.kind === 'plan' ? output.missingRecipes : [];
    const totals = output.aggregate.totals;
    let withheld: WithheldReason | undefined;
    if (missingRecipes.length > 0) {
        withheld = 'missingRecipes';
    } else if (match.total === 0) {
        withheld = 'noData';
    } else if (!isConfident(match)) {
        withheld = 'unmatched';
    } else if (portion.kind === '100g' && !(totals.mass_g > 0)) {
        withheld = 'notWeighed';
    }
    if (withheld) {
        return { portion, withheld, match, missingRecipes };
    }
    const divisor = divisorFor(portion, totals.mass_g);
    const m = totals.macros;
    const figures: MacroFigures = {
        kcal: roundKcal(m.kcal / divisor),
        protein_g: roundGrams(m.protein_g / divisor),
        fat_g: roundGrams(m.fat_g / divisor),
        carb_g: roundGrams(m.carb_g / divisor),
        fiber_g: roundGrams(m.fiber_g / divisor),
        sugar_g: roundGrams(m.sugar_g / divisor),
        sat_fat_g: roundGrams(m.sat_fat_g / divisor),
    };
    return { portion, figures, shares: energyShares(m), match, missingRecipes };
}

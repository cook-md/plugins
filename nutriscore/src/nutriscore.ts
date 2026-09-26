// Nutri-Score, 2023 algorithm for general foods (not beverages, cheese, or
// fats/oils/nuts). Thresholds are "strictly greater than": a value earns one
// point per threshold it exceeds. Source: Nutri-Score Scientific Committee
// update report (2022), as implemented by Open Food Facts.
//
// Out of scope (cannot be detected from recipe data, so not implemented
// here): the "red meat" protein-point cap — Open Food Facts caps protein
// points at 2 for beef/veal/pork/lamb/game/horse/donkey/goat/camel/kangaroo
// products, including for general foods (not just a beverage/cheese/fat
// exception) — so a protein-heavy red-meat dish may score slightly better
// here than the official Nutri-Score label. The non-nutritive-sweeteners
// penalty (+4 negative points) is NOT relevant here: Open Food Facts only
// applies it when `is_beverage` is true, never to general foods.

export type NutriGrade = 'A' | 'B' | 'C' | 'D' | 'E';

/** Values per 100 g of the dish. */
export interface Per100g {
    energyKj: number;
    sugarsG: number;
    satFatG: number;
    saltG: number;
    proteinG: number;
    fibreG: number;
    /** Share of fruit, vegetables and legumes by weight, 0–100. */
    fvlPercent: number;
}

export interface NutriScoreResult {
    grade: NutriGrade;
    score: number;
    negative: number;
    positive: number;
    /** False when negative points are 11 or more: protein then does not count. */
    proteinCounted: boolean;
}

const ENERGY_KJ = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS_G = [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51];
const SAT_FAT_G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SALT_G = Array.from({ length: 20 }, (_, index) => Math.round((index + 1) * 2) / 10);
const PROTEIN_G = [2.4, 4.8, 7.2, 9.6, 12, 14, 17];
const FIBRE_G = [3.0, 4.1, 5.2, 6.3, 7.4];

function points(value: number, thresholds: readonly number[]): number {
    return thresholds.filter(threshold => value > threshold).length;
}

function fvlPoints(percent: number): number {
    if (percent > 80) {
        return 5;
    }
    if (percent > 60) {
        return 2;
    }
    return percent > 40 ? 1 : 0;
}

export function gradeFor(score: number): NutriGrade {
    if (score <= 0) {
        return 'A';
    }
    if (score <= 2) {
        return 'B';
    }
    if (score <= 10) {
        return 'C';
    }
    return score <= 18 ? 'D' : 'E';
}

export function nutriScore(values: Per100g): NutriScoreResult {
    const negative = points(values.energyKj, ENERGY_KJ) + points(values.sugarsG, SUGARS_G)
        + points(values.satFatG, SAT_FAT_G) + points(values.saltG, SALT_G);
    const proteinCounted = negative < 11;
    const positive = points(values.fibreG, FIBRE_G) + fvlPoints(values.fvlPercent)
        + (proteinCounted ? points(values.proteinG, PROTEIN_G) : 0);
    const score = negative - positive;
    return { grade: gradeFor(score), score, negative, positive, proteinCounted };
}

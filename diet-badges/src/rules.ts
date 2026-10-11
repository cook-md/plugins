import { matchesWord } from './custom-match';
import { DietIngredient, DietOutput } from './diet-template';
import { DIET_IDS, DietId } from './settings';

export type DietStatus = 'pass' | 'unknown' | 'fail';

export interface Violation {
    /** Recipe ingredient name, or `<name> (linked recipe)`. */
    ingredient: string;
    /** Why it breaks the diet, e.g. `dairy`, `poultry`, `honey`. */
    reason: string;
}

export interface DietVerdict {
    diet: DietId;
    /** `fail`: any violation. `unknown`: none, but something couldn't be checked. `pass`: everything checked, nothing found. */
    status: DietStatus;
    violations: Violation[];
    /** Names that couldn't be checked (unknown ingredients, linked and missing recipes), deduplicated. */
    unknown: string[];
}

export type DietVerdicts = Record<DietId, DietVerdict>;

/** Matched on whole words, plurals tolerated (`custom-match.ts`); `anchovies` is listed because `y → ies` isn't. */
export const NON_VEGAN_WORDS: readonly string[] = [
    'honey', 'gelatin', 'gelatine', 'fish sauce', 'anchovy', 'anchovies', 'worcestershire', 'ghee', 'whey', 'casein', 'lard', 'suet',
];

export interface DietRule {
    /** Allergen class slug → reason. Checked first. */
    allergens: Readonly<Record<string, string>>;
    /** Category slug → reason. */
    categories: Readonly<Record<string, string>>;
    /** Also fail on `NON_VEGAN_WORDS` and `dietBadges.extraNonVegan`. */
    words: boolean;
}

const PESCATARIAN: DietRule = {
    allergens: {},
    categories: { meat: 'meat', poultry: 'poultry', animal_fat: 'animal fat' },
    words: false,
};
const VEGETARIAN: DietRule = {
    allergens: { fish: 'fish', crustaceans: 'crustaceans', molluscs: 'molluscs' },
    categories: { ...PESCATARIAN.categories, fish_and_shellfish: 'fish or shellfish' },
    words: false,
};
const VEGAN: DietRule = {
    allergens: { ...VEGETARIAN.allergens, milk: 'dairy', eggs: 'eggs' },
    categories: { ...VEGETARIAN.categories, dairy_and_egg: 'dairy or egg' },
    words: true,
};
const DAIRY_FREE: DietRule = {
    allergens: { milk: 'dairy' },
    categories: { milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy' },
    words: false,
};

export const DIET_RULES: Readonly<Record<DietId, DietRule>> = {
    vegan: VEGAN, vegetarian: VEGETARIAN, pescatarian: PESCATARIAN, dairyFree: DAIRY_FREE,
};

function matchingWord(rule: DietRule, name: string, words: readonly string[]): string | undefined {
    return rule.words ? words.find(word => matchesWord(word, name)) : undefined;
}

/** The first reason this ingredient breaks the rule: allergen classes, then categories, then words. */
function reasonFor(rule: DietRule, ingredient: DietIngredient, words: readonly string[]): string | undefined {
    for (const [cls, reason] of Object.entries(rule.allergens)) {
        if (ingredient.allergenClasses.includes(cls)) {
            return reason;
        }
    }
    const categories: readonly string[] = ingredient.categories;
    for (const [slug, reason] of Object.entries(rule.categories)) {
        if (categories.includes(slug)) {
            return reason;
        }
    }
    return matchingWord(rule, ingredient.name, words);
}

function evaluateDiet(diet: DietId, output: DietOutput, words: readonly string[]): DietVerdict {
    const rule = DIET_RULES[diet];
    const violations: Violation[] = [];
    const violating = new Set<string>();
    const unknown: string[] = [];
    const addViolation = (ingredient: string, reason: string): void => {
        if (!violating.has(ingredient)) {
            violating.add(ingredient);
            violations.push({ ingredient, reason });
        }
    };
    for (const ingredient of output.ingredients) {
        const reason = reasonFor(rule, ingredient, words);
        if (reason !== undefined) {
            addViolation(ingredient.name, reason);
        } else if (ingredient.status === 'unknown') {
            unknown.push(ingredient.name);
        }
    }
    // Linked recipes are never expanded: only their name can be judged.
    for (const ref of output.refs) {
        const name = `${ref} (linked recipe)`;
        const word = matchingWord(rule, ref, words);
        if (word !== undefined) {
            addViolation(name, word);
        } else {
            unknown.push(name);
        }
    }
    for (const missing of output.missing) {
        unknown.push(`${missing} (recipe not found)`);
    }
    const unchecked = [...new Set(unknown)].filter(name => !violating.has(name));
    const status: DietStatus = violations.length > 0 ? 'fail' : unchecked.length > 0 ? 'unknown' : 'pass';
    return { diet, status, violations, unknown: unchecked };
}

/** One verdict per diet, enabled or not; `badge.ts` decides what to show. */
export function evaluateDiets(output: DietOutput, extraNonVegan: readonly string[]): DietVerdicts {
    const words = [...NON_VEGAN_WORDS, ...extraNonVegan];
    const verdicts = {} as DietVerdicts;
    for (const diet of DIET_IDS) {
        verdicts[diet] = evaluateDiet(diet, output, words);
    }
    return verdicts;
}

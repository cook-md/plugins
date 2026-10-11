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

/**
 * Words matched on whole words, plurals tolerated (`custom-match.ts`), split by the strictest diet
 * each word breaks. Each list applies to that diet and every stricter one (Pescatarian → Vegetarian
 * → Vegan). They catch what the service's categories miss: it assigns categories from USDA/CNF food
 * groups only, so CoFID, branded and seed items such as `pancetta` get none, and nothing is tagged
 * `animal_fat`. `anchovies` is listed because the matcher doesn't turn `y` into `ies`.
 */
export const NON_PESCATARIAN_WORDS: readonly string[] = [
    'lard', 'suet', 'tallow', 'dripping', 'schmaltz', 'gelatin', 'gelatine',
    'bacon', 'lardons', 'ham', 'pancetta', 'guanciale', 'prosciutto', 'chorizo', 'salami', 'sausage', 'pepperoni', 'mortadella', 'bresaola',
    'beef', 'pork', 'veal', 'lamb', 'venison', 'steak', 'chicken', 'turkey', 'duck',
];
/** Fish and shellfish products: fine for Pescatarian, not for Vegetarian or Vegan. */
export const NON_VEGETARIAN_WORDS: readonly string[] = [
    'fish sauce', 'anchovy', 'anchovies', 'worcestershire', 'oyster sauce', 'shrimp paste', 'bonito',
];
/** Dairy, egg and bee products: fine for Vegetarian, not for Vegan. */
export const NON_VEGAN_WORDS: readonly string[] = ['honey', 'whey', 'casein', 'ghee'];

export interface DietRule {
    /** Allergen class slug → reason. Checked first. */
    allergens: Readonly<Record<string, string>>;
    /** Category slug → reason. */
    categories: Readonly<Record<string, string>>;
    /** Built-in words that break this diet. */
    words: readonly string[];
    /** Also fail on `dietBadges.extraNonVegan` (documented as vegan-only). */
    userWords: boolean;
    /**
     * An audited item that matched no animal category and no plant-only group is not known to be
     * free of meat or fish, so it counts as unchecked. Dairy-free is decided by the audited allergens.
     */
    needsClassification: boolean;
}

const PESCATARIAN: DietRule = {
    allergens: {},
    categories: { meat: 'meat', poultry: 'poultry', animal_fat: 'animal fat' },
    words: NON_PESCATARIAN_WORDS,
    userWords: false,
    needsClassification: true,
};
const VEGETARIAN: DietRule = {
    allergens: { fish: 'fish', crustaceans: 'crustaceans', molluscs: 'molluscs' },
    categories: { ...PESCATARIAN.categories, fish_and_shellfish: 'fish or shellfish' },
    words: [...NON_PESCATARIAN_WORDS, ...NON_VEGETARIAN_WORDS],
    userWords: false,
    needsClassification: true,
};
const VEGAN: DietRule = {
    allergens: { ...VEGETARIAN.allergens, milk: 'dairy', eggs: 'eggs' },
    categories: { ...VEGETARIAN.categories, dairy_and_egg: 'dairy or egg' },
    words: [...VEGETARIAN.words, ...NON_VEGAN_WORDS],
    userWords: true,
    needsClassification: true,
};
const DAIRY_FREE: DietRule = {
    allergens: { milk: 'dairy' },
    categories: { milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy' },
    words: [],
    userWords: false,
    needsClassification: false,
};

export const DIET_RULES: Readonly<Record<DietId, DietRule>> = {
    vegan: VEGAN, vegetarian: VEGETARIAN, pescatarian: PESCATARIAN, dairyFree: DAIRY_FREE,
};

function matchingWord(rule: DietRule, name: string, userWords: readonly string[]): string | undefined {
    return [...rule.words, ...(rule.userWords ? userWords : [])].find(word => matchesWord(word, name));
}

/** The first reason this ingredient breaks the rule: allergen classes, then categories, then words. */
function reasonFor(rule: DietRule, ingredient: DietIngredient, userWords: readonly string[]): string | undefined {
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
    return matchingWord(rule, ingredient.name, userWords);
}

function evaluateDiet(diet: DietId, output: DietOutput, userWords: readonly string[]): DietVerdict {
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
        const reason = reasonFor(rule, ingredient, userWords);
        if (reason !== undefined) {
            addViolation(ingredient.name, reason);
        } else if (ingredient.status === 'unknown' || (rule.needsClassification && !ingredient.classified)) {
            unknown.push(ingredient.name);
        }
    }
    // Linked recipes are never expanded: only their name can be judged.
    for (const ref of output.refs) {
        const name = `${ref} (linked recipe)`;
        const word = matchingWord(rule, ref, userWords);
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
    const verdicts = {} as DietVerdicts;
    for (const diet of DIET_IDS) {
        verdicts[diet] = evaluateDiet(diet, output, extraNonVegan);
    }
    return verdicts;
}

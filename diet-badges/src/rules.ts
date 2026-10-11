import { matchRange, matchesWord } from './custom-match';
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
    'beef', 'pork', 'veal', 'lamb', 'venison', 'chicken', 'turkey', 'duck',
];
/** Fish and shellfish products: fine for Pescatarian, not for Vegetarian or Vegan. */
export const NON_VEGETARIAN_WORDS: readonly string[] = [
    'fish sauce', 'anchovy', 'anchovies', 'worcestershire', 'oyster sauce', 'shrimp paste', 'bonito',
];
/** Dairy, egg and bee products: fine for Vegetarian, not for Vegan. */
export const NON_VEGAN_WORDS: readonly string[] = ['honey', 'whey', 'casein', 'ghee'];

/**
 * Phrases that contain a meat word but are plants, mushrooms or condiments. Removed from a name
 * before word matching. `duck egg` is removed too: it is still caught as an egg by the allergen
 * class (Vegan only), not as poultry.
 */
export const EXEMPT_PHRASES: readonly RegExp[] = [
    /\bbeef(?:steak)?\s+tomato(?:e?s)?\b/giu,
    /\blamb'?s?\s+lettuce\b/giu,
    /\bchicken\s+of\s+the\s+woods\b/giu,
    /\bhen\s+of\s+the\s+woods\b/giu,
    /\bduck\s+sauce\b/giu,
    /\bduck\s+eggs?\b/giu,
];

/**
 * Words that mark an analogue ("vegan sausage", "coconut bacon"). A word hit they are attached to is
 * unknown rather than a fail; it is never a pass, and categories and allergens still decide first.
 * Attached means directly before the word or with one word in between ("plant-based mince beef"),
 * or after it as `<word>-style`, `<word> style` or `<word>-free`.
 */
export const ANALOGUE_QUALIFIERS: readonly string[] = [
    'vegan', 'vegetarian', 'veggie', 'plant-based', 'plant based', 'meat-free', 'meat free', 'meatless', 'mock', 'faux', 'imitation',
    'tofu', 'tempeh', 'seitan', 'jackfruit',
];
/**
 * Ingredients that are also real foods ("coconut chicken curry", "chicken and mushroom soup"), so
 * they only mark an analogue directly before a cured-meat word that they commonly imitate ("coconut bacon").
 */
export const WEAK_QUALIFIERS: readonly string[] = ['coconut', 'mushroom', 'soy'];
const CONJUNCTIONS: readonly string[] = ['and', 'or', '&', 'with'];
export const IMITATED_WORDS: readonly string[] = [
    'bacon', 'lardons', 'ham', 'pancetta', 'guanciale', 'prosciutto', 'chorizo', 'salami', 'sausage', 'pepperoni', 'mortadella', 'bresaola',
];

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
    /** Whether the `beverages` group counts as plant-based (not for Vegan: wine and beer fining). */
    beveragesArePlant: boolean;
}

const PESCATARIAN: DietRule = {
    allergens: {},
    categories: { meat: 'meat', poultry: 'poultry', animal_fat: 'animal fat' },
    words: NON_PESCATARIAN_WORDS,
    userWords: false,
    needsClassification: true,
    beveragesArePlant: true,
};
const VEGETARIAN: DietRule = {
    allergens: { fish: 'fish', crustaceans: 'crustaceans', molluscs: 'molluscs' },
    categories: { ...PESCATARIAN.categories, fish_and_shellfish: 'fish or shellfish' },
    words: [...NON_PESCATARIAN_WORDS, ...NON_VEGETARIAN_WORDS],
    userWords: false,
    needsClassification: true,
    beveragesArePlant: true,
};
const VEGAN: DietRule = {
    allergens: { ...VEGETARIAN.allergens, milk: 'dairy', eggs: 'eggs' },
    categories: { ...VEGETARIAN.categories, dairy_and_egg: 'dairy or egg' },
    words: [...VEGETARIAN.words, ...NON_VEGAN_WORDS],
    userWords: true,
    needsClassification: true,
    beveragesArePlant: false,
};
const DAIRY_FREE: DietRule = {
    allergens: { milk: 'dairy' },
    categories: { milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy' },
    words: [],
    userWords: false,
    needsClassification: false,
    beveragesArePlant: true,
};

export const DIET_RULES: Readonly<Record<DietId, DietRule>> = {
    vegan: VEGAN, vegetarian: VEGETARIAN, pescatarian: PESCATARIAN, dairyFree: DAIRY_FREE,
};

interface WordHit {
    word: string;
    /** An analogue qualifier is present: the word is probably describing a substitute. */
    qualified: boolean;
}

function normalize(name: string): string {
    return name.normalize('NFC').replace(/[’‘]/g, "'");
}

function stripExempt(name: string): string {
    return EXEMPT_PHRASES.reduce((text, phrase) => text.replace(phrase, ' '), normalize(name));
}

/** Whether a qualifier sits right before (at most one word between) or right after (`-style`, ` style`, `-free`) the word hit. */
function isQualifiedHit(text: string, word: string): boolean {
    const range = matchRange(word, text);
    if (range === undefined) {
        return false;
    }
    const before = text.slice(0, range.index).split(/\s+/).filter(token => token !== '');
    // Strong qualifiers may have one word between them and the matched word, but not a conjunction
    // ("veggie and chicken stir fry"). Weak ones must sit directly before it.
    const sizeOf = (qualifier: string): number => qualifier.split(/\s+/).length;
    const directlyBefore = (qualifier: string): boolean => matchesWord(qualifier, before.slice(-sizeOf(qualifier)).join(' '));
    const precedes = (qualifier: string): boolean => {
        if (directlyBefore(qualifier)) {
            return true;
        }
        const window = before.slice(-(sizeOf(qualifier) + 1));
        const between = window[window.length - 1];
        return window.length > sizeOf(qualifier) && !CONJUNCTIONS.includes(between.toLowerCase())
            && matchesWord(qualifier, window.slice(0, -1).join(' '));
    };
    if (ANALOGUE_QUALIFIERS.some(precedes)) {
        return true;
    }
    if (IMITATED_WORDS.some(imitated => matchesWord(imitated, word)) && WEAK_QUALIFIERS.some(directlyBefore)) {
        return true;
    }
    return /^(?:-|\s+)(?:style(?![\p{L}\p{N}])|free(?![\p{L}\p{N}])(?![\s-]*range))/iu.test(text.slice(range.end));
}

/**
 * A built-in or user word found in any of the names, after removing the exempt phrases. Qualified
 * when a qualifier is attached to the word in any name that has it.
 */
function matchingWord(rule: DietRule, names: readonly string[], userWords: readonly string[]): WordHit | undefined {
    const words = [...rule.words, ...(rule.userWords ? userWords : [])];
    let first: WordHit | undefined;
    for (const text of names.map(stripExempt)) {
        const word = words.find(candidate => matchesWord(candidate, text));
        if (word !== undefined) {
            const qualified = isQualifiedHit(text, word);
            if (qualified) {
                return { word, qualified };
            }
            first ??= { word, qualified };
        }
    }
    return first;
}

function isClassified(rule: DietRule, ingredient: DietIngredient): boolean {
    if (ingredient.categories.length > 0) {
        return true;
    }
    return ingredient.plant !== undefined && (ingredient.plant !== 'beverages' || rule.beveragesArePlant);
}

function ingredientNames(ingredient: DietIngredient): string[] {
    return ingredient.canonical !== undefined && ingredient.canonical !== ingredient.name ? [ingredient.name, ingredient.canonical] : [ingredient.name];
}

/** Why the ingredient breaks the rule (allergen classes, then categories, then unqualified words), or that a qualified word only makes it unknown. */
function reasonFor(rule: DietRule, ingredient: DietIngredient, userWords: readonly string[]): { reason: string; soft: boolean } | undefined {
    for (const [cls, reason] of Object.entries(rule.allergens)) {
        if (ingredient.allergenClasses.includes(cls)) {
            return { reason, soft: false };
        }
    }
    const categories: readonly string[] = ingredient.categories;
    for (const [slug, reason] of Object.entries(rule.categories)) {
        if (categories.includes(slug)) {
            return { reason, soft: false };
        }
    }
    const hit = matchingWord(rule, ingredientNames(ingredient), userWords);
    return hit && { reason: hit.word, soft: hit.qualified };
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
        const found = reasonFor(rule, ingredient, userWords);
        if (found !== undefined && !found.soft) {
            addViolation(ingredient.name, found.reason);
        } else if (found !== undefined || ingredient.status === 'unknown' || (rule.needsClassification && !isClassified(rule, ingredient))) {
            unknown.push(ingredient.name);
        }
    }
    // Linked recipes are never expanded: only their name can be judged.
    for (const ref of output.refs) {
        const name = `${ref} (linked recipe)`;
        const hit = matchingWord(rule, [ref], userWords);
        if (hit !== undefined && !hit.qualified) {
            addViolation(name, hit.word);
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

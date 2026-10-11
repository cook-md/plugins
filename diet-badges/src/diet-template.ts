// The Jinja template this plugin asks the editor's Reports engine to render, and the strict
// validation of what comes back. Output is untrusted: every field is checked.

/**
 * Animal-product categories, checked in this order with `is_in_category` for every item the
 * service returned; the first hit stops the search. The check is tree-aware, so `oily_fish` counts
 * as `fish_and_shellfish` and `animal_fat` (a child of `fats_and_oils`) is its own slug. An unknown
 * slug fails the whole render, so every slug here must exist in the service's taxonomy
 * (db-reference-intakes migrations 0009_taxonomy and 0011_expand_categories; the spec checks them).
 */
export const ANIMAL_SLUGS = ['meat', 'poultry', 'animal_fat', 'fish_and_shellfish', 'dairy_and_egg'] as const;
/** Children of `dairy_and_egg`; only checked when the parent matched (a child implies its parent). */
export const DAIRY_SLUGS = ['milk', 'cheese', 'yogurt', 'butter'] as const;
/**
 * Top-level (or leaf) groups that hold no animal products, checked only when no animal slug matched,
 * most common in recipes first so the search usually stops early. `beverages` can hold wine and beer
 * (fined with isinglass or gelatine), so `rules.ts` doesn't accept it for Vegan.
 * Classification uses an item's main food group: a composite item (canned beans with pork) can slip through.
 * Mixed groups are left out on purpose: `fats_and_oils` (lard), `sweets` (honey), `baked_products`
 * and `prepared_foods` (anything), so only their plant-only children `vegetable_oil` and `sugar`
 * are listed. The service assigns categories only from USDA/CNF food groups, so an item in none of
 * these is not known to be plant-based, however well its allergens were audited.
 */
export const PLANT_SLUGS = ['spices_and_herbs', 'vegetables', 'grains', 'fruits', 'legumes', 'nuts_and_seeds', 'vegetable_oil', 'sugar', 'beverages'] as const;
export type PlantSlug = typeof PLANT_SLUGS[number];
export type CategorySlug = typeof ANIMAL_SLUGS[number] | typeof DAIRY_SLUGS[number];
const ANIMAL_RESULT_SLUGS: readonly string[] = [...ANIMAL_SLUGS, ...DAIRY_SLUGS];

/**
 * `ings`: for a `.menu`, the engine's expanded plan (`plan.all_ingredients`, nested references
 * resolved). A menu's own `ingredients` are its `@./Recipe{}` references, which
 * `aggregate_nutrition` skips. For a recipe it is `ingredients`.
 * `names`: ingredient names in the order `aggregate_nutrition` sends them, recipe references
 * skipped, so `names[i]` is the i-th item sent to the service. `refs`: linked recipes inside a
 * recipe (never expanded). `missing`: menu references the engine couldn't resolve.
 * Items are slimmed to what the rules need: the animal categories they matched and whether they
 * are in a plant-only group. Placeholder items (unresolved ingredients) match nothing, so they
 * skip the category calls, which are uncached HTTP requests.
 */
export const DIET_TEMPLATE = [
    '{%- set is_plan = plan is defined -%}',
    '{%- set ings = plan.all_ingredients if is_plan else ingredients -%}',
    '{%- set names = namespace(list=[]) -%}',
    '{%- set refs = namespace(list=[]) -%}',
    '{%- for ing in ings -%}',
    '{%- if ing.reference -%}{%- set refs.list = refs.list + [ing.name | string] -%}',
    '{%- else -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- set agg = aggregate_nutrition(ings, "eu") -%}',
    '{%- set slim = namespace(list=[]) -%}',
    // Bracket access, not `agg.items`: minijinja resolves `.items` on a dict to its `items()` method.
    '{%- for item in agg["items"] -%}',
    '{%- set warnings = item.warnings if item.warnings is defined else [] -%}',
    '{%- set placeholder = namespace(found=false) -%}',
    '{%- for warning in warnings -%}',
    '{%- if warning == "nutrition_placeholder" or warning.code == "nutrition_placeholder" -%}{%- set placeholder.found = true -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- set hit = namespace(list=[], plant="") -%}',
    '{%- if not placeholder.found -%}',
    `{%- for slug in ${JSON.stringify(ANIMAL_SLUGS)} -%}`,
    '{%- if not hit.list and is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- if "dairy_and_egg" in hit.list -%}',
    `{%- for slug in ${JSON.stringify(DAIRY_SLUGS)} -%}`,
    '{%- if is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- endif -%}',
    '{%- if not hit.list -%}',
    `{%- for slug in ${JSON.stringify(PLANT_SLUGS)} -%}`,
    '{%- if not hit.plant and is_in_category(item.ingredient, slug) -%}{%- set hit.plant = slug -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- endif -%}',
    '{%- endif -%}',
    '{%- set slim.list = slim.list + [{"ingredient": item.ingredient, "allergens": item.allergens if item.allergens is defined else none, "warnings": warnings, "categories": hit.list, "plant": hit.plant}] -%}',
    '{%- endfor -%}',
    '{%- set missing = (plan.missing_recipes | map(attribute="name") | list) if is_plan else [] -%}',
    '{{ {"names": names.list, "refs": refs.list, "missing": missing, "items": slim.list, "failures": agg["failures"]} | tojson }}',
].join('\n');

export interface DietIngredient {
    /** Recipe name when alignment worked, otherwise the service's name. */
    name: string;
    /** `unknown`: a placeholder, a failure, or no fully well-formed verified EU allergen block. */
    status: 'verified' | 'unknown';
    /** The service's canonical name for the item (`item.ingredient`), when it returned one. */
    canonical?: string;
    /**
     * The plant-only group it belongs to, if any. With `categories` this says whether the item is
     * classified at all: the allergen audit says nothing about meat, so without it an audited
     * `pancetta` would pass every diet.
     */
    plant?: PlantSlug;
    /** EU allergen class slugs the service tagged (kept even when the block is unknown). */
    allergenClasses: string[];
    categories: CategorySlug[];
}

export interface DietOutput {
    names: string[];
    /** Linked recipes inside a recipe: never checked. */
    refs: string[];
    /** Menu references the engine couldn't resolve: never checked. */
    missing: string[];
    ingredients: DietIngredient[];
}

/** Stands in for results the service dropped when its reply can't be aligned to the recipe. */
export const MISALIGNED_NAME = "some ingredients (the nutrition service's reply didn't line up)";

const PLACEHOLDER_WARNING_CODE = 'nutrition_placeholder';

interface RawItem {
    ingredient: string;
    allergens: unknown;
    warnings: unknown;
    categories: CategorySlug[];
    plant: PlantSlug | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isCategorySlug(value: string): value is CategorySlug {
    return ANIMAL_RESULT_SLUGS.includes(value);
}

/** Strips every leading `?` (optional-ingredient marker) and surrounding whitespace. */
function cleanName(name: string): string {
    return name.replace(/^\?+/, '').trim();
}

/**
 * The service returns an unresolvable ingredient as a normal item tagged with a
 * `nutrition_placeholder` warning (usually `{ code }`, a bare string is accepted too).
 */
function isPlaceholder(warnings: unknown): boolean {
    return Array.isArray(warnings) && warnings.some(warning =>
        warning === PLACEHOLDER_WARNING_CODE || (isPlainObject(warning) && warning.code === PLACEHOLDER_WARNING_CODE));
}

/**
 * Only a verified block in the EU view counts as checked: in another view EU-only classes
 * would look absent. A malformed entry makes the block unverified, but well-formed entries
 * are kept so a hit (e.g. `milk`) still fails a diet.
 */
function allergenData(block: unknown): { verified: boolean; classes: string[] } {
    if (!isPlainObject(block) || block.status !== 'verified' || block.view !== 'eu' || !Array.isArray(block.contains)) {
        return { verified: false, classes: [] };
    }
    const classes = block.contains
        .map(entry => (isPlainObject(entry) && typeof entry.class === 'string' ? entry.class : undefined))
        .filter((cls): cls is string => cls !== undefined);
    return { verified: classes.length === block.contains.length, classes };
}

function toIngredient(name: string, item: RawItem): DietIngredient {
    const allergens = allergenData(item.allergens);
    const unknown = !allergens.verified || isPlaceholder(item.warnings);
    return {
        name,
        ...(item.ingredient !== '' ? { canonical: item.ingredient } : {}),
        status: unknown ? 'unknown' : 'verified',
        ...(item.plant !== undefined ? { plant: item.plant } : {}),
        allergenClasses: allergens.classes,
        categories: item.categories,
    };
}

function unknownIngredient(name: string): DietIngredient {
    return { name, status: 'unknown', allergenClasses: [], categories: [] };
}

function isValidIndex(index: unknown, length: number): index is number {
    return Number.isInteger(index) && (index as number) >= 0 && (index as number) < length;
}

function failureName(failure: Record<string, unknown>, length: number): string {
    if (typeof failure.ingredient === 'string') {
        return cleanName(failure.ingredient);
    }
    return isValidIndex(failure.index, length) ? `ingredient ${failure.index + 1}` : 'an unnamed ingredient';
}

/** Same alignment as Allergens: items fill the non-failed slots in order; otherwise fall back to service names. */
function align(names: string[], items: RawItem[], failures: Record<string, unknown>[]): DietIngredient[] {
    const failedIndices = new Set(failures.map(failure => failure.index).filter(index => isValidIndex(index, names.length)));
    if (items.length + failures.length === names.length && failedIndices.size === failures.length) {
        let next = 0;
        return names.map((name, index) => failedIndices.has(index) ? unknownIngredient(name) : toIngredient(name, items[next++]));
    }
    const fallback = [
        ...items.map(item => toIngredient(item.ingredient, item)),
        ...failures.map(failure => unknownIngredient(failureName(failure, names.length))),
    ];
    if (fallback.length < names.length) {
        fallback.push(unknownIngredient(MISALIGNED_NAME));
    }
    return fallback;
}

/** Undefined when the output is malformed. An item without a string `ingredient` or a string-array `categories` rejects the whole output. */
export function parseDietOutput(output: string): DietOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data) || !isStringArray(data.names) || !isStringArray(data.refs) || !isStringArray(data.missing)
        || !Array.isArray(data.items) || !Array.isArray(data.failures)) {
        return undefined;
    }
    const items: RawItem[] = [];
    for (const item of data.items) {
        if (!isPlainObject(item) || typeof item.ingredient !== 'string' || !isStringArray(item.categories)) {
            return undefined;
        }
        items.push({
            ingredient: cleanName(item.ingredient),
            allergens: item.allergens,
            warnings: item.warnings,
            categories: item.categories.filter(isCategorySlug),
            plant: PLANT_SLUGS.find(slug => slug === item.plant),
        });
    }
    const names = data.names.map(cleanName);
    return {
        names,
        refs: data.refs.map(cleanName),
        missing: data.missing.map(cleanName),
        ingredients: align(names, items, data.failures.filter(isPlainObject)),
    };
}

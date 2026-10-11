// The Jinja template this plugin asks the editor's Reports engine to render, and the strict
// validation of what comes back. Output is untrusted: every field is checked.

/**
 * Checked with `is_in_category` for every item the service returned. The check is tree-aware,
 * so `oily_fish` counts as `fish_and_shellfish`. An unknown slug fails the whole render, so these
 * must exist in the service's taxonomy (db migrations 0009_taxonomy and 0011_expand_categories).
 */
export const TOP_LEVEL_SLUGS = ['meat', 'poultry', 'animal_fat', 'fish_and_shellfish', 'dairy_and_egg'] as const;
/** Children of `dairy_and_egg`; only checked when the parent matched (a child implies its parent). */
export const DAIRY_SLUGS = ['milk', 'cheese', 'yogurt', 'butter'] as const;
export type CategorySlug = typeof TOP_LEVEL_SLUGS[number] | typeof DAIRY_SLUGS[number];
const ALL_SLUGS: readonly string[] = [...TOP_LEVEL_SLUGS, ...DAIRY_SLUGS];

/**
 * `ings`: for a `.menu`, the engine's expanded plan (`plan.all_ingredients`, nested references
 * resolved). A menu's own `ingredients` are its `@./Recipe{}` references, which
 * `aggregate_nutrition` skips. For a recipe it is `ingredients`.
 * `names`: ingredient names in the order `aggregate_nutrition` sends them, recipe references
 * skipped, so `names[i]` is the i-th item sent to the service. `refs`: linked recipes inside a
 * recipe (never expanded). `missing`: menu references the engine couldn't resolve.
 * Items are slimmed to what the rules need, plus the categories they matched.
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
    '{%- set hit = namespace(list=[]) -%}',
    `{%- for slug in ${JSON.stringify(TOP_LEVEL_SLUGS)} -%}`,
    '{%- if is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- if "dairy_and_egg" in hit.list -%}',
    `{%- for slug in ${JSON.stringify(DAIRY_SLUGS)} -%}`,
    '{%- if is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- endif -%}',
    '{%- set slim.list = slim.list + [{"ingredient": item.ingredient, "allergens": item.allergens if item.allergens is defined else none, "warnings": item.warnings if item.warnings is defined else [], "categories": hit.list}] -%}',
    '{%- endfor -%}',
    '{%- set missing = (plan.missing_recipes | map(attribute="name") | list) if is_plan else [] -%}',
    '{{ {"names": names.list, "refs": refs.list, "missing": missing, "items": slim.list, "failures": agg["failures"]} | tojson }}',
].join('\n');

export interface DietIngredient {
    /** Recipe name when alignment worked, otherwise the service's name. */
    name: string;
    /** `unknown`: a placeholder, a failure, or no fully well-formed verified EU allergen block. */
    status: 'verified' | 'unknown';
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
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isCategorySlug(value: string): value is CategorySlug {
    return ALL_SLUGS.includes(value);
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
    return { name, status: unknown ? 'unknown' : 'verified', allergenClasses: allergens.classes, categories: item.categories };
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

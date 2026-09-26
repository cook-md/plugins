// The Jinja template this plugin asks the editor's Reports engine to render.
// It uses the engine's nutrition functions (`aggregate_nutrition`,
// `is_in_category`) and hands the data back with the `tojson` filter. Types mirror the
// cook.md nutrition service's `/aggregate` response (snake_case, verbatim).

export interface NutritionMacros {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carb_g: number;
    fiber_g: number;
    sugar_g: number;
    sat_fat_g: number;
}

export interface NutritionItem {
    ingredient: string;
    preparation: string;
    amount: { value: number; unit: string; mass_g: number };
    macros: NutritionMacros;
    micros: Record<string, number>;
    source: string;
    confidence: string;
    warnings: unknown[];
}

export interface NutritionFailure {
    index: number;
    ingredient: string;
    error: { code: string; message: string; suggestions?: string[] };
}

export interface NutritionAggregate {
    items: NutritionItem[];
    failures: NutritionFailure[];
    totals: {
        mass_g: number;
        macros: NutritionMacros;
        micros: Record<string, number>;
        confidence: string;
        confidence_weighted: string;
        is_partial: boolean;
        included_count: number;
        failed_count: number;
    };
}

export interface NutritionData {
    aggregate: NutritionAggregate;
    /** Grams of matched ingredients in any requested category; undefined when none were requested. */
    categoryMassG?: number;
}

const SLUG = /^[a-z0-9-]{1,40}$/;

/** `categories` are embedded as a JSON list, so they must be plain slugs. */
export function nutritionTemplate(categories: readonly string[]): string {
    if (!categories.every(slug => SLUG.test(slug))) {
        throw new Error('Category slug must be lowercase letters, digits or dashes.');
    }
    return [
        `{%- set categories = ${JSON.stringify(categories)} -%}`,
        '{%- set agg = aggregate_nutrition(ingredients) -%}',
        '{%- set found = namespace(names=[]) -%}',
        // Bracket access, not `agg.items`: minijinja resolves `.items` on a
        // dict to its `items()` method, not the `items` key.
        '{%- for item in agg["items"] -%}',
        '{%- set hit = namespace(value=false) -%}',
        '{%- for slug in categories -%}',
        '{%- if not hit.value and is_in_category(item.ingredient, slug) -%}{%- set hit.value = true -%}{%- endif -%}',
        '{%- endfor -%}',
        '{%- if hit.value -%}{%- set found.names = found.names + [item.ingredient] -%}{%- endif -%}',
        '{%- endfor -%}',
        '{{ {"aggregate": agg, "categoryIngredients": found.names} | tojson }}',
    ].join('\n');
}

export function parseNutritionOutput(output: string, categoriesRequested: boolean): NutritionData | undefined {
    let data: { aggregate?: unknown; categoryIngredients?: unknown };
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    const aggregate = toNutritionAggregate(data.aggregate);
    if (!aggregate) {
        return undefined;
    }
    if (!categoriesRequested) {
        return { aggregate };
    }
    const members = new Set(Array.isArray(data.categoryIngredients) ? data.categoryIngredients : []);
    const categoryMassG = aggregate.items
        .filter(item => members.has(item.ingredient))
        .reduce((sum, item) => sum + item.amount.mass_g, 0);
    return { aggregate, categoryMassG };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MACRO_FIELDS: readonly (keyof NutritionMacros)[] = ['kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sat_fat_g'];

function isNutritionMacros(value: unknown): value is NutritionMacros {
    return isPlainObject(value) && MACRO_FIELDS.every(field => isFiniteNumber(value[field]));
}

function isNutritionItem(value: unknown): value is NutritionItem {
    return isPlainObject(value) && typeof value.ingredient === 'string'
        && isPlainObject(value.amount) && isFiniteNumber(value.amount.mass_g);
}

function isNutritionFailure(value: unknown): value is NutritionFailure {
    return isPlainObject(value) && typeof value.ingredient === 'string';
}

/**
 * Validates an untrusted `aggregate` payload from the template output:
 * rejects it outright when `totals` is structurally unsound, and drops
 * malformed `items`/`failures` entries instead of letting them crash callers
 * later (e.g. `toPer100g` reading `item.amount.mass_g`).
 */
function toNutritionAggregate(value: unknown): NutritionAggregate | undefined {
    if (!isPlainObject(value) || !Array.isArray(value.items) || !Array.isArray(value.failures)) {
        return undefined;
    }
    const totals = value.totals;
    if (!isPlainObject(totals) || !isFiniteNumber(totals.mass_g) || !isNutritionMacros(totals.macros) || !isPlainObject(totals.micros)) {
        return undefined;
    }
    return {
        items: value.items.filter(isNutritionItem),
        failures: value.failures.filter(isNutritionFailure),
        totals: totals as unknown as NutritionAggregate['totals'],
    };
}

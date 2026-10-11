// The Jinja template this plugin asks the editor's Reports engine to render, and
// validation of what comes back. Copied from nutriscore/src/nutrition-template.ts
// and trimmed: no category lookups, plus a `plan` branch for `.menu` files (the
// engine exposes `plan` there, as Core Vitals uses it). Types mirror the cook.md
// nutrition service's `/aggregate` response (snake_case, verbatim).

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
    amount: { mass_g: number };
    /** May be missing entirely on older service versions; treat as no warnings. */
    warnings?: unknown[];
}

export interface NutritionFailure {
    ingredient: string;
}

export interface NutritionAggregate {
    items: NutritionItem[];
    failures: NutritionFailure[];
    totals: {
        mass_g: number;
        macros: NutritionMacros;
    };
}

/** A recipe: the aggregate of its (already scaled) ingredients. */
export interface RecipeOutput {
    kind: 'recipe';
    aggregate: NutritionAggregate;
}

/** A `.menu` plan: the aggregate of every expanded recipe, and what to divide it by. */
export interface PlanOutput {
    kind: 'plan';
    aggregate: NutritionAggregate;
    /** Sections of the menu (`= Day … =`), at least 1. */
    days: number;
    /** The menu's numeric `servings:` frontmatter, at least 1. */
    people: number;
    /** Recipe references the engine could not expand; their ingredients are missing from the totals. */
    missingRecipes: string[];
}

export type MacrosOutput = RecipeOutput | PlanOutput;

const PLACEHOLDER_WARNING_CODE = 'nutrition_placeholder';

/**
 * True when the nutrition service could not resolve this ingredient: it returns it as a normal
 * `items[]` entry with `mass_g: 0` and zero macros, tagged with a `nutrition_placeholder` warning.
 * Warnings are normally `{ code: string, ... }` objects, but a bare string warning is accepted
 * defensively too. A missing `warnings` field means not a placeholder.
 */
export function isPlaceholder(item: NutritionItem): boolean {
    if (!Array.isArray(item.warnings)) {
        return false;
    }
    return item.warnings.some(warning => {
        if (typeof warning === 'string') {
            return warning === PLACEHOLDER_WARNING_CODE;
        }
        return isPlainObject(warning) && warning.code === PLACEHOLDER_WARNING_CODE;
    });
}

/**
 * One template for recipes and plans. `plan` is only defined for `.menu` files; plans default to
 * 1 day and 1 person exactly like Core Vitals' template. The output is passed through `tojson`.
 */
export const MACROS_TEMPLATE = [
    '{%- if plan is defined -%}',
    '{%- set agg = aggregate_nutrition(plan.all_ingredients) -%}',
    '{%- set days = (plan.days | length) if (plan.days | length) > 0 else 1 -%}',
    '{%- set people = plan.servings if (plan.servings is defined and plan.servings is not none and plan.servings is number and plan.servings >= 1) else 1 -%}',
    '{{ {"kind": "plan", "aggregate": agg, "days": days, "people": people, "missingRecipes": (plan.missing_recipes | map(attribute="name") | list)} | tojson }}',
    '{%- else -%}',
    '{%- set agg = aggregate_nutrition(ingredients) -%}',
    '{{ {"kind": "recipe", "aggregate": agg} | tojson }}',
    '{%- endif -%}',
].join('\n');

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

function isCountAtLeastOne(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

/**
 * Validates an untrusted `aggregate` payload: rejects it when `totals` is structurally unsound,
 * and drops malformed `items`/`failures` entries instead of letting them crash callers later.
 */
function toNutritionAggregate(value: unknown): NutritionAggregate | undefined {
    if (!isPlainObject(value) || !Array.isArray(value.items) || !Array.isArray(value.failures)) {
        return undefined;
    }
    const totals = value.totals;
    if (!isPlainObject(totals) || !isFiniteNumber(totals.mass_g) || !isNutritionMacros(totals.macros)) {
        return undefined;
    }
    return {
        items: value.items.filter(isNutritionItem),
        failures: value.failures.filter(isNutritionFailure),
        totals: { mass_g: totals.mass_g, macros: totals.macros },
    };
}

/** Validates the template output; undefined when it is not a Macros payload. */
export function parseMacrosOutput(output: string): MacrosOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data)) {
        return undefined;
    }
    const aggregate = toNutritionAggregate(data.aggregate);
    if (!aggregate) {
        return undefined;
    }
    if (data.kind === 'recipe') {
        return { kind: 'recipe', aggregate };
    }
    if (data.kind !== 'plan' || !isCountAtLeastOne(data.days) || !isCountAtLeastOne(data.people) || !Array.isArray(data.missingRecipes)) {
        return undefined;
    }
    const missingRecipes = data.missingRecipes.filter((name): name is string => typeof name === 'string');
    return { kind: 'plan', aggregate, days: data.days, people: data.people, missingRecipes };
}

// The Jinja templates this plugin asks the editor's Reports engine to render, and the
// validation of what comes back. Output is untrusted: every field is checked.

/**
 * `names`: recipe ingredient names in the order `aggregate_nutrition` sends them, recipe
 * references skipped, so `names[i]` is the i-th item sent to the service. `refs`: the
 * skipped recipe references (linked recipes), whose contents are never checked. The leading
 * `?` of optional ingredients is stripped in `parseAllergenOutput`.
 */
const NAMES_PRELUDE = [
    '{%- set names = namespace(list=[]) -%}',
    '{%- set refs = namespace(list=[]) -%}',
    '{%- for ing in ingredients -%}',
    '{%- if ing.reference -%}{%- set refs.list = refs.list + [ing.name | string] -%}',
    '{%- else -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
].join('\n');

/** Ingredient names only: no nutrition call, works signed out. */
export const NAMES_TEMPLATE = `${NAMES_PRELUDE}\n{{ {"names": names.list, "refs": refs.list} | tojson }}`;

/** Names plus the `/aggregate` response in the EU allergen view (all 14 classes). */
export const STANDARD_TEMPLATE = [
    NAMES_PRELUDE,
    '{%- set agg = aggregate_nutrition(ingredients, "eu") -%}',
    '{{ {"names": names.list, "refs": refs.list, "aggregate": agg} | tojson }}',
].join('\n');

export interface AllergenEntry {
    class: string;
    subtype?: string;
    label: string;
}

export interface IngredientAllergens {
    /** Recipe name when alignment worked, otherwise the service's name. */
    name: string;
    /** `unknown`: unverified by the service, no allergen data, or not matched at all. */
    status: 'verified' | 'unknown';
    contains: AllergenEntry[];
}

export interface AllergenOutput {
    names: string[];
    /** Linked recipes (`@./Other recipe{}`): never checked, so always reported as unknown. */
    refs: string[];
    /** Undefined for the names-only template. */
    ingredients: IngredientAllergens[] | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toEntry(value: unknown): AllergenEntry | undefined {
    if (!isPlainObject(value) || typeof value.class !== 'string' || typeof value.label !== 'string') {
        return undefined;
    }
    if (value.subtype !== undefined && typeof value.subtype !== 'string') {
        return { class: value.class, label: value.label };
    }
    return value.subtype === undefined
        ? { class: value.class, label: value.label }
        : { class: value.class, subtype: value.subtype, label: value.label };
}

function allergensOf(block: unknown): Pick<IngredientAllergens, 'status' | 'contains'> {
    if (!isPlainObject(block) || block.status !== 'verified' || !Array.isArray(block.contains)) {
        return { status: 'unknown', contains: [] };
    }
    const contains = block.contains.map(toEntry).filter((entry): entry is AllergenEntry => entry !== undefined);
    return { status: 'verified', contains };
}

function alignIngredients(names: string[], aggregate: unknown): IngredientAllergens[] | undefined {
    if (!isPlainObject(aggregate) || !Array.isArray(aggregate.items) || !Array.isArray(aggregate.failures)) {
        return undefined;
    }
    const items = aggregate.items.filter(isPlainObject).filter(item => typeof item.ingredient === 'string');
    const failures = aggregate.failures.filter(isPlainObject).filter(failure => typeof failure.ingredient === 'string');
    const failedIndices = new Set(failures
        .map(failure => failure.index)
        .filter((index): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < names.length));
    if (items.length + failures.length === names.length && failedIndices.size === failures.length) {
        let next = 0;
        return names.map((name, index) => failedIndices.has(index)
            ? { name, status: 'unknown', contains: [] }
            : { name, ...allergensOf(items[next++].allergens) });
    }
    return [
        ...items.map(item => ({ name: item.ingredient as string, ...allergensOf(item.allergens) })),
        ...failures.map(failure => ({ name: failure.ingredient as string, status: 'unknown' as const, contains: [] })),
    ];
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

/** Strips every leading `?` (optional-ingredient marker) and surrounding whitespace. */
function cleanName(name: string): string {
    return name.replace(/^\?+/, '').trim();
}

/** `standard`: the output came from `STANDARD_TEMPLATE`. Undefined when the output is malformed. */
export function parseAllergenOutput(output: string, standard: boolean): AllergenOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data) || !isStringArray(data.names) || !isStringArray(data.refs)) {
        return undefined;
    }
    const names = data.names.map(cleanName);
    const refs = data.refs.map(cleanName);
    if (!standard) {
        return { names, refs, ingredients: undefined };
    }
    const ingredients = alignIngredients(names, data.aggregate);
    return ingredients ? { names, refs, ingredients } : undefined;
}

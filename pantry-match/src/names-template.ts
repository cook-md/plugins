// The names-only template (the Allergens `NAMES_TEMPLATE`): no nutrition call, so it
// works signed out. The editor's Reports engine parses with no extensions, so an
// optional ingredient `@?parsley{}` arrives as the name `?parsley`; the engine has no
// `optional` field. `parseNamesOutput` turns that leading `?` into `optional: true`.
import { CooklangApi } from './cooklang-api';

export const NAMES_TEMPLATE = [
    '{%- set names = namespace(list=[]) -%}',
    '{%- set refs = namespace(list=[]) -%}',
    '{%- for ing in ingredients -%}',
    '{%- if ing.reference -%}{%- set refs.list = refs.list + [ing.name | string] -%}',
    '{%- else -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{{ {"names": names.list, "refs": refs.list} | tojson }}',
].join('\n');

export interface IngredientName {
    name: string;
    /** `@?x`: never counts as missing. */
    optional: boolean;
}

export interface RecipeNames {
    names: IngredientName[];
    /** Linked recipes as written (`./Sauces/Pesto`); only their presence matters. */
    refs: string[];
}

export type RenderedNames = { ok: true; names: RecipeNames } | { ok: false; message: string };

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function toIngredientName(raw: string): IngredientName | undefined {
    const optional = /^\s*\?/.test(raw);
    const name = raw.replace(/^\s*\?+/, '').trim();
    return name === '' ? undefined : { name, optional };
}

/** Untrusted template output → names; undefined when malformed. */
export function parseNamesOutput(output: string): RecipeNames | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return undefined;
    }
    const { names, refs } = data as { names?: unknown; refs?: unknown };
    if (!isStringArray(names) || !isStringArray(refs)) {
        return undefined;
    }
    return {
        names: names.map(toIngredientName).filter((entry): entry is IngredientName => entry !== undefined),
        refs: refs.map(ref => ref.trim()).filter(ref => ref !== ''),
    };
}

/** Renders the names template for a `.cook` URI; never throws. */
export async function renderNames(api: Pick<CooklangApi, 'renderReport'>, uri: string): Promise<RenderedNames> {
    try {
        const result = await api.renderReport({ uri, template: NAMES_TEMPLATE, scale: 1 });
        if (!result.ok) {
            return { ok: false, message: result.message || result.reason };
        }
        const names = parseNamesOutput(result.output);
        return names ? { ok: true, names } : { ok: false, message: 'unexpected template output' };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

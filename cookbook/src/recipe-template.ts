// The Jinja template rendered once per recipe by `cooklang.api.renderReport`, and
// validation of its JSON output. The Reports engine (cooklang-reports 0.5) exposes
// `metadata` (a map), `ingredients` / `cookware` (objects with `name`, `quantity`,
// `note`, and `reference` for ingredients) and `sections` (iterable, with `name`).
// A section's items render as text only: a step as `"N. text"` with ingredients,
// cookware and timers already flattened ("Chop 1 onion"), a text block as its text.
// Step numbers restart at 1 in each section and skip text blocks, so a counter
// tells them apart. The engine parses with no extensions, so the `?`, `-`, `&` and
// `+` ingredient modifiers stay in the name ("?salt"); `parseRecipeOutput` handles them.

import { isRecord } from './cooklang-api';

export const RECIPE_TEMPLATE = [
    '{%- set book = namespace(sections=[], ingredients=[], cookware=[]) -%}',
    '{%- for section in sections -%}',
    '{%- set part = namespace(blocks=[], next=1) -%}',
    '{%- for content in section -%}',
    '{%- set text = content | string -%}',
    '{%- set prefix = part.next ~ ". " -%}',
    '{%- if text is startingwith(prefix) -%}',
    '{%- set part.blocks = part.blocks + [{"kind": "step", "number": part.next, "text": text[prefix | length:]}] -%}',
    '{%- set part.next = part.next + 1 -%}',
    '{%- else -%}',
    '{%- set part.blocks = part.blocks + [{"kind": "text", "text": text}] -%}',
    '{%- endif -%}',
    '{%- endfor -%}',
    '{%- set book.sections = book.sections + [{"name": section.name, "blocks": part.blocks}] -%}',
    '{%- endfor -%}',
    '{%- for ingredient in ingredients -%}',
    '{%- set book.ingredients = book.ingredients + [{"name": ingredient.name, "quantity": (ingredient.quantity | string) if ingredient.quantity is defined else "", "note": ingredient.note if ingredient.note is defined else "", "reference": ingredient.reference}] -%}',
    '{%- endfor -%}',
    '{%- for item in cookware -%}',
    '{%- set book.cookware = book.cookware + [{"name": item.name, "quantity": item.quantity if item.quantity is defined else "", "note": item.note if item.note is defined else ""}] -%}',
    '{%- endfor -%}',
    '{{ {"metadata": metadata, "ingredients": book.ingredients, "cookware": book.cookware, "sections": book.sections} | tojson }}',
].join('\n');

export interface RecipeIngredient {
    name: string;
    quantity: string;
    note: string;
    /** `@?name`: may be left out. */
    optional: boolean;
    /** A reference to another recipe (`@./Sauces/Pesto{}`); `name` is the recipe's name. */
    reference: boolean;
}

export interface RecipeCookware {
    name: string;
    quantity: string;
    note: string;
}

export type RecipeBlock =
    | { kind: 'step'; number: number; text: string }
    | { kind: 'text'; text: string };

export interface RecipeSection {
    /** Empty for the unnamed first section. */
    name: string;
    blocks: RecipeBlock[];
}

export interface RecipeData {
    metadata: Record<string, unknown>;
    /** Without `@-hidden` and `@&reused` entries; those stay only in the step text. */
    ingredients: RecipeIngredient[];
    cookware: RecipeCookware[];
    sections: RecipeSection[];
}

const MODIFIERS = /^[?\-&+]+/;

function text(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Removes modifier prefixes from the flattened step text: "Add ?salt" → "Add salt". */
function cleanStepText(value: string, rawNames: readonly string[]): string {
    let cleaned = value;
    for (const raw of [...rawNames].sort((a, b) => b.length - a.length)) {
        cleaned = cleaned.split(raw).join(raw.replace(MODIFIERS, ''));
    }
    return cleaned;
}

/** Parses and validates the template output; malformed entries are dropped, a malformed document is undefined. */
export function parseRecipeOutput(output: string): RecipeData | undefined {
    let value: unknown;
    try {
        value = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isRecord(value) || !Array.isArray(value.ingredients) || !Array.isArray(value.cookware) || !Array.isArray(value.sections)) {
        return undefined;
    }
    const modified: string[] = [];
    const ingredients: RecipeIngredient[] = [];
    for (const entry of value.ingredients) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
            continue;
        }
        const modifiers = MODIFIERS.exec(entry.name)?.[0] ?? '';
        if (modifiers !== '') {
            modified.push(entry.name);
        }
        const name = entry.name.slice(modifiers.length).trim();
        if (name === '' || modifiers.includes('-') || modifiers.includes('&')) {
            continue;
        }
        ingredients.push({
            name,
            quantity: text(entry.quantity),
            note: text(entry.note),
            optional: modifiers.includes('?'),
            reference: entry.reference === true,
        });
    }
    const cookware: RecipeCookware[] = [];
    for (const entry of value.cookware) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
            continue;
        }
        const modifiers = MODIFIERS.exec(entry.name)?.[0] ?? '';
        if (modifiers !== '') {
            modified.push(entry.name);
        }
        const name = entry.name.slice(modifiers.length).trim();
        if (name === '' || modifiers.includes('-') || modifiers.includes('&')) {
            continue;
        }
        cookware.push({ name, quantity: text(entry.quantity), note: text(entry.note) });
    }
    const sections: RecipeSection[] = [];
    for (const entry of value.sections) {
        if (!isRecord(entry) || !Array.isArray(entry.blocks)) {
            continue;
        }
        const blocks: RecipeBlock[] = [];
        for (const block of entry.blocks) {
            if (!isRecord(block) || typeof block.text !== 'string') {
                continue;
            }
            if (block.kind === 'step' && typeof block.number === 'number' && Number.isInteger(block.number) && block.number > 0) {
                blocks.push({ kind: 'step', number: block.number, text: cleanStepText(block.text, modified) });
            } else if (block.kind === 'text') {
                blocks.push({ kind: 'text', text: block.text });
            }
        }
        sections.push({ name: text(entry.name), blocks });
    }
    return { metadata: isRecord(value.metadata) ? value.metadata : {}, ingredients, cookware, sections };
}

/** The recipe's `title` metadata, else the file-name title from the book tree. */
export function recipeTitle(data: RecipeData, fallback: string): string {
    const title = data.metadata.title;
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : fallback;
}

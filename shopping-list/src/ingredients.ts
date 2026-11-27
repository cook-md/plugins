// Typed and pasted ingredient lines, read by cooklang-ingredient-parser (the
// same rules as the Cook mobile apps) through `@cooklang/cooklang`. No
// `vscode` import, so the specs run it for real.

import * as fs from 'fs';
import * as path from 'path';
import * as glue from '@cooklang/cooklang/pkg/cooklang_wasm_bg.js';
import type { ParsedIngredient } from '@cooklang/cooklang/pkg/cooklang_wasm';

/** The package imports its `.wasm` as an ES module, which Node cannot load; the build copies it next to this file instead. */
const WASM_FILE = 'cooklang_wasm_bg.wasm';

let loaded = false;

function load(): void {
    if (loaded) {
        return;
    }
    const bytes = fs.readFileSync(path.join(__dirname, WASM_FILE));
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { './cooklang_wasm_bg.js': glue as unknown as WebAssembly.ModuleImports });
    glue.__wbg_set_wasm(instance.exports);
    const start = instance.exports.__wbindgen_start;
    if (typeof start === 'function') {
        start();
    }
    loaded = true;
}

/** A free-hand line as written to `.shopping-list`. */
export interface FreeHandLine {
    name: string;
    /** Stored quantity: `1.5%kg`, `3`, `a pinch`. */
    quantity?: string;
}

/** A parsed line, with the chip that shows its amount (`2 l`, `x3`). */
export interface RecognizedLine extends FreeHandLine {
    chip?: string;
}

function toLine(parsed: ParsedIngredient): RecognizedLine | undefined {
    if (parsed.name === '') {
        return undefined;
    }
    const amount = parsed.amount;
    const quantity = amount ? glue.ingredient_amount_quantity(amount.value, amount.unit) : undefined;
    if (!amount || quantity === undefined) {
        return { name: parsed.name };
    }
    return { name: parsed.name, quantity, chip: glue.ingredient_amount_chip(amount.value, amount.unit) };
}

/**
 * One typed line: `Sugar 1.5kg`, `2 l milk`, `3 lemons`. With `aisle`
 * (the aisle.conf text) a name takes the configuration's spelling.
 * Undefined for a blank line.
 */
export function recognizeLine(line: string, aisle?: string): RecognizedLine | undefined {
    load();
    return toLine(glue.parse_ingredient(line, aisle));
}

/** Pasted text, one entry per kept line (bullets, checkboxes and Markdown headings dropped). */
export function recognizeList(text: string, aisle?: string): RecognizedLine[] {
    load();
    return glue.parse_ingredient_list(text, aisle).flatMap(parsed => toLine(parsed) ?? []);
}

/** The sum of two stored quantities with the same unit; `'not-addable'` for anything else. */
export function addQuantities(a: string | undefined, b: string | undefined): string | undefined | 'not-addable' {
    load();
    try {
        return glue.add_ingredient_quantities(a, b) ?? undefined;
    } catch {
        return 'not-addable';
    }
}

/**
 * The text that reads back as this line: `Milk 2 l`. Just the name when the
 * stored quantity is something the rules would not read back the same
 * (`a pinch`, `1%glass`).
 */
export function editText(line: FreeHandLine): string {
    load();
    return glue.ingredient_edit_text(line.name, line.quantity);
}

/**
 * The line an edit box's `text` asks for, given the line it started from.
 * `'unchanged'` while the text is still the starting text, so lines other
 * tools wrote (`Heinz 57`) are never re-read. When the starting text left the
 * stored quantity out (`salt{a pinch}` edits as `salt`) and the new text has
 * no amount, that quantity is kept. Undefined when no name is left.
 */
export function editedLine(original: FreeHandLine, text: string, aisle?: string): FreeHandLine | 'unchanged' | undefined {
    const collapse = (value: string): string => value.trim().replace(/\s+/g, ' ');
    const startingText = editText(original);
    if (collapse(text) === collapse(startingText)) {
        return 'unchanged';
    }
    const line = recognizeLine(text, aisle);
    if (!line) {
        return undefined;
    }
    const quantityLeftOut = original.quantity !== undefined && collapse(startingText) === collapse(original.name);
    if (line.quantity === undefined && quantityLeftOut) {
        return { name: line.name, quantity: original.quantity };
    }
    return line.quantity === undefined ? { name: line.name } : { name: line.name, quantity: line.quantity };
}

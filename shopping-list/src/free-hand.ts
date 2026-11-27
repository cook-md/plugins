// Free-hand lines (`milk{2%l}`, `bread`): reading what people type or paste,
// and the Cooklang quantity text stored in `.shopping-list`. Pure, no `vscode`
// import, so the webview bundles it too. Behaviour follows the iOS app's
// manual items.

import type { ShoppingListEntry } from './cooklang-api';

/** A free-hand line as the store writes it. */
export interface FreeHandLine {
    name: string;
    /** Stored quantity text: `1.5%kg`, `3`, `a pinch`. */
    quantity?: string;
}

/** A stored quantity read as a number (with an optional unit), or as text. */
export type StoredAmount =
    | { kind: 'number'; value: number; unit?: string }
    | { kind: 'text'; text: string };

/** Unit words people type, mapped to the unit written to the file. Matched lower-cased, trailing `.` ignored. */
const UNIT_ALIASES: ReadonlyMap<string, string> = new Map(Object.entries({
    g: 'g', gr: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
    kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    mg: 'mg',
    l: 'l', lt: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
    ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
    cl: 'cl', dl: 'dl',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    cup: 'cup', cups: 'cup',
    tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
    pinch: 'pinch', pinches: 'pinch',
    clove: 'clove', cloves: 'clove',
    can: 'can', cans: 'can', tin: 'tin', tins: 'tin',
    jar: 'jar', jars: 'jar', bottle: 'bottle', bottles: 'bottle',
    pack: 'pack', packs: 'pack', packet: 'packet', packets: 'packet',
    bag: 'bag', bags: 'bag', box: 'box', boxes: 'box',
    bunch: 'bunch', bunches: 'bunch', head: 'head', heads: 'head',
    slice: 'slice', slices: 'slice', loaf: 'loaf', loaves: 'loaf',
    dozen: 'dozen',
}));

/** Words that mean "this many": the amount is written as a plain count. */
const PIECE_WORDS: ReadonlySet<string> = new Set(['pc', 'pcs', 'piece', 'pieces', 'x']);

/**
 * A name that reads back unchanged from `.shopping-list`: no braces, no
 * comment starts (`--`, `[-`), no leading `./`, `/` or `? `, no zero-width
 * characters, whitespace collapsed. May return an empty string.
 */
export function cleanName(raw: string): string {
    let name = raw
        .replace(/[​⁠﻿]/g, '')
        .replace(/[{}]/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
        .trim();
    while (/--|\[-/.test(name)) {
        name = name.replace(/--/g, '-').replace(/\[-/g, '[');
    }
    let previous: string;
    do {
        previous = name;
        name = name.replace(/^(\.\/|\/|\? )/, '').trim();
    } while (name !== previous);
    return name;
}

/** Quantity text that reads back unchanged, or undefined when nothing is left. */
export function cleanQuantity(raw: string | undefined): string | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const quantity = cleanName(raw);
    return quantity === '' ? undefined : quantity;
}

/** A positive number written as `2`, `1.5`, `1,5` or `1/2`, else undefined. */
function readNumber(text: string, allowComma: boolean): number | undefined {
    const fraction = /^(\d+)\/(\d+)$/.exec(text);
    if (fraction) {
        const value = Number(fraction[1]) / Number(fraction[2]);
        return Number.isFinite(value) && value > 0 ? value : undefined;
    }
    const pattern = allowComma ? /^\d+([.,]\d+)?$/ : /^\d+(\.\d+)?$/;
    if (!pattern.test(text)) {
        return undefined;
    }
    const value = Number(text.replace(',', '.'));
    return value > 0 ? value : undefined;
}

/** Reads `2%l`, `3`, `1/2%cup`; anything else (`a pinch`, `1,000`) is text. */
export function parseStoredQuantity(quantity: string): StoredAmount {
    const split = quantity.indexOf('%');
    const amount = (split < 0 ? quantity : quantity.slice(0, split)).trim();
    const unit = split < 0 ? undefined : quantity.slice(split + 1).trim() || undefined;
    // A comma in a file is a thousands separator, not a decimal point.
    const value = readNumber(amount, false);
    if (value === undefined) {
        return { kind: 'text', text: quantity };
    }
    return unit === undefined ? { kind: 'number', value } : { kind: 'number', value, unit };
}

/** `1.5%kg`, `3`: rounded to 6 decimals, `.` as the decimal point. */
export function formatStoredQuantity(value: number, unit?: string): string {
    const number = String(Number(value.toFixed(6)));
    return unit ? `${number}%${unit}` : number;
}

/** How a stored quantity reads in the list: `2%l` → `2 l`. */
export function displayQuantity(quantity: string | undefined): string {
    return quantity === undefined ? '' : quantity.replace(/%/g, ' ').replace(/\s+/g, ' ').trim();
}

function unitOf(word: string): string | undefined {
    return UNIT_ALIASES.get(word.toLowerCase().replace(/\.$/, ''));
}

function isPieceWord(word: string): boolean {
    return PIECE_WORDS.has(word.toLowerCase().replace(/\.$/, ''));
}

/** A typed amount: a decimal, or a fraction below 1 (so `24/7` stays a name). */
function typedNumber(text: string): number | undefined {
    const value = readNumber(text, true);
    if (value === undefined || (text.includes('/') && value >= 1)) {
        return undefined;
    }
    return value;
}

/** `1.5kg` → 1.5 kg, `3pcs` → 3; `7up` and `Milk2l` are not amounts. */
function gluedAmount(token: string): string | undefined {
    const match = /^([\d.,/]+)(\D+)$/.exec(token);
    if (!match) {
        return undefined;
    }
    const value = typedNumber(match[1]);
    if (value === undefined) {
        return undefined;
    }
    if (isPieceWord(match[2])) {
        return formatStoredQuantity(value);
    }
    const unit = unitOf(match[2]);
    return unit === undefined ? undefined : formatStoredQuantity(value, unit);
}

/** `2 l`, `3 pcs`: a typed number followed by a unit or piece word. */
function numberAndUnit(numberToken: string, unitToken: string): string | undefined {
    const value = typedNumber(numberToken);
    if (value === undefined) {
        return undefined;
    }
    if (isPieceWord(unitToken)) {
        return formatStoredQuantity(value);
    }
    const unit = unitOf(unitToken);
    return unit === undefined ? undefined : formatStoredQuantity(value, unit);
}

/** A bare typed number is a count. */
function count(token: string): string | undefined {
    const value = typedNumber(token);
    return value === undefined ? undefined : formatStoredQuantity(value);
}

/**
 * What a typed line asks for. The amount is looked for at the end first
 * (`Sugar 1.5kg`, `Milk 2 l`, `Lemons 3`), then at the start (`2 l milk`,
 * `3 lemons`). With no amount, or no name left beside it, the whole line is
 * the name.
 */
export function recognizeLine(text: string): FreeHandLine | undefined {
    const tokens = text.trim().split(/\s+/).filter(token => token !== '');
    const whole = cleanName(tokens.join(' '));
    if (whole === '') {
        return undefined;
    }
    const n = tokens.length;
    const attempts: Array<() => { quantity?: string; rest: string[] }> = [
        () => ({ quantity: gluedAmount(tokens[n - 1]), rest: tokens.slice(0, n - 1) }),
        () => ({ quantity: n >= 3 ? numberAndUnit(tokens[n - 2], tokens[n - 1]) : undefined, rest: tokens.slice(0, n - 2) }),
        () => ({ quantity: count(tokens[n - 1]), rest: tokens.slice(0, n - 1) }),
        () => ({ quantity: gluedAmount(tokens[0]), rest: tokens.slice(1) }),
        () => ({ quantity: n >= 3 ? numberAndUnit(tokens[0], tokens[1]) : undefined, rest: tokens.slice(2) }),
        () => ({ quantity: count(tokens[0]), rest: tokens.slice(1) }),
    ];
    if (n >= 2) {
        for (const attempt of attempts) {
            const { quantity, rest } = attempt();
            const name = cleanName(rest.join(' '));
            // `2 l` is not a thing called "l".
            if (quantity !== undefined && name !== '' && unitOf(name) === undefined && !isPieceWord(name)) {
                return { name, quantity };
            }
        }
    }
    return { name: whole };
}

/**
 * Pasted text as one entry per line: list markers (`-`, `*`, `•`, `[ ]`,
 * `[x]`) dropped, blank lines skipped. Commas never split.
 */
export function splitPastedText(text: string): string[] {
    return text
        .split(/\r\n|\r|\n/)
        .map(line => line.trim()
            .replace(/^([-*–]\s+|•\s*)/, '')
            .replace(/^\[[ xX]\]\s*/, '')
            .trim())
        .filter(line => line !== '');
}

/**
 * Where `line` goes among the top-level entries: folded into an existing
 * free-hand line with the same name (ignoring case) when both have no amount
 * or both are numbers in the same unit, else appended.
 */
export function placeFreeHand(items: readonly ShoppingListEntry[], line: FreeHandLine): { index: number; quantity?: string } | undefined {
    const key = line.name.toLowerCase();
    const added = line.quantity === undefined ? undefined : parseStoredQuantity(line.quantity);
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (item.type !== 'ingredient' || item.name.toLowerCase() !== key) {
            continue;
        }
        if (item.quantity === undefined && added === undefined) {
            return { index };
        }
        if (item.quantity === undefined || added === undefined || added.kind !== 'number') {
            continue;
        }
        const existing = parseStoredQuantity(item.quantity);
        if (existing.kind === 'number' && (existing.unit ?? '').toLowerCase() === (added.unit ?? '').toLowerCase()) {
            return { index, quantity: formatStoredQuantity(existing.value + added.value, existing.unit) };
        }
    }
    return undefined;
}

/** How a free-hand line reads back in an edit box: `Milk 2 l`. */
export function editText(item: FreeHandLine): string {
    const quantity = displayQuantity(item.quantity);
    return quantity === '' ? item.name : `${item.name} ${quantity}`;
}

/**
 * The line an edit box's `text` asks for, given the line it started from.
 * `'unchanged'` when the text was not touched, so lines other tools wrote
 * (`salt{a pinch}`, `Heinz 57`) are never re-read. While the text still ends
 * with the old amount, that amount is kept exactly as stored, units the
 * recognizer does not know included. Undefined when no name is left.
 */
export function editedLine(original: FreeHandLine, text: string): FreeHandLine | 'unchanged' | undefined {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed === editText(original).replace(/\s+/g, ' ')) {
        return 'unchanged';
    }
    const oldAmount = displayQuantity(original.quantity);
    if (original.quantity !== undefined && oldAmount !== '' && trimmed.endsWith(` ${oldAmount}`)) {
        const name = cleanName(trimmed.slice(0, -oldAmount.length));
        return name === '' ? undefined : { name, quantity: original.quantity };
    }
    return recognizeLine(trimmed);
}

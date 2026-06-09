/**
 * Pure journal logic: filenames, dates, templates, entry navigation.
 * This module must not import 'vscode' so it stays unit-testable in plain Node.
 */

import * as posixPath from 'node:path/posix';

export const JOURNAL_EXTENSION = '.journal';

export const DEFAULT_TEMPLATE = [
    '---',
    'title: ${title}',
    'date: ${date}',
    'type: journal',
    '---',
    '',
    '= Breakfast',
    '',
    '= Lunch',
    '',
    '= Dinner',
    ''
].join('\n');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** Local date as ISO `YYYY-MM-DD`. */
export function isoDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Journal file name for a date, e.g. `2026-06-09.journal`. */
export function fileNameForDate(date: Date): string {
    return `${isoDate(date)}${JOURNAL_EXTENSION}`;
}

/** True for date-named journal files like `2026-06-09.journal`. */
export function isJournalFileName(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}\.journal$/.test(name);
}

/** Human-readable date, e.g. `Tuesday, 9 June 2026`. Deliberately locale-independent. */
export function humanTitle(date: Date): string {
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Replaces `${date}` and `${title}` placeholders in a template. */
export function renderTemplate(template: string, date: Date): string {
    return template
        .replaceAll('${date}', isoDate(date))
        .replaceAll('${title}', humanTitle(date));
}

/**
 * Nearest existing entry before/after `current` by filename order
 * (ISO dates sort lexically). Non-journal files are ignored.
 */
export function adjacentEntry(entries: string[], current: string, direction: 'previous' | 'next'): string | undefined {
    const sorted = entries.filter(isJournalFileName).sort();
    if (direction === 'previous') {
        const earlier = sorted.filter(name => name < current);
        return earlier[earlier.length - 1];
    }
    return sorted.find(name => name > current);
}

/**
 * Cooklang recipe reference for a recipe, relative to the journal file's folder.
 * Both arguments are workspace-relative POSIX paths ('' = workspace root).
 * E.g. ('Journal', 'Christmas Dinner/Turkey.cook') -> '@../Christmas Dinner/Turkey{}'.
 */
export function recipeReference(journalDir: string, recipePath: string): string {
    const withoutExtension = recipePath.replace(/\.cook$/, '');
    let relative = posixPath.relative(journalDir || '.', withoutExtension);
    if (!relative.startsWith('.')) {
        relative = `./${relative}`;
    }
    return `@${relative}{}`;
}

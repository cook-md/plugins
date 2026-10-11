/** A README split into its YAML frontmatter fields this plugin reads and the Markdown body. */
export interface Frontmatter {
    title?: string;
    order?: number;
    body: string;
}

/**
 * Reads `title:` and `order:` from a leading `---` … `---` block. Only those two
 * top-level keys are read, line by line (no YAML library); quotes around the title
 * are removed. An unclosed block is not frontmatter: the whole text is the body.
 */
export function parseFrontmatter(text: string): Frontmatter {
    const source = text.replace(/^﻿/, '');
    const lines = source.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return { body: source };
    }
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) {
        return { body: source };
    }
    const result: Frontmatter = { body: lines.slice(end + 1).join('\n') };
    for (const line of lines.slice(1, end)) {
        const title = /^title\s*:\s*(.*)$/i.exec(line);
        if (title && result.title === undefined) {
            const value = title[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim();
            if (value !== '') {
                result.title = value;
            }
        }
        const order = /^order\s*:\s*["']?(-?\d+(?:\.\d+)?)["']?\s*$/i.exec(line);
        if (order && result.order === undefined) {
            result.order = Number.parseFloat(order[1]);
        }
    }
    return result;
}

/** The text of the first level-1 ATX heading (`# Title`) in a Markdown body. */
export function firstHeading(body: string): string | undefined {
    for (const line of body.split(/\r?\n/)) {
        const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

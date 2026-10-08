/** Servings above this are treated as unknown (almost certainly a typo). */
export const MAX_SERVINGS = 1000;

/**
 * The recipe's servings from its YAML frontmatter (the block between a `---`
 * first line and the next `---` line), as a positive integer. The keys
 * `servings`, `serves` and `yield` are accepted case-insensitively, and the
 * number may be quoted: `4`, `"4"` and `4 people` all give 4. Undefined when
 * absent, non-numeric, zero, above {@link MAX_SERVINGS}, or when the block is
 * never closed. Only the frontmatter is read; the plugin never parses the
 * recipe body.
 */
export function parseServings(text: string): number | undefined {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return undefined;
    }
    let servings: number | undefined;
    for (const line of lines.slice(1)) {
        if (line.trim() === '---') {
            return servings;
        }
        const match = /^(servings|serves|yield)\s*:\s*["']?(\d+)/i.exec(line);
        if (match && servings === undefined) {
            const value = Number.parseInt(match[2], 10);
            servings = value >= 1 && value <= MAX_SERVINGS ? value : undefined;
        }
    }
    return undefined;
}

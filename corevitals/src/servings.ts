/**
 * The recipe's `servings:` from its YAML frontmatter (the block between a
 * `---` first line and the next `---` line), as a positive integer: `4` and
 * `4 people` both give 4. Undefined when absent or non-numeric. Only the
 * frontmatter is read; the plugin never parses the recipe body.
 */
export function parseServings(text: string): number | undefined {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return undefined;
    }
    for (const line of lines.slice(1)) {
        if (line.trim() === '---') {
            return undefined;
        }
        const match = /^servings\s*:\s*(\d+)/i.exec(line);
        if (match) {
            const servings = Number.parseInt(match[1], 10);
            return servings >= 1 ? servings : undefined;
        }
    }
    return undefined;
}

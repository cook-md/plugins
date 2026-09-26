const MAX_LIST_ENTRIES = 8;
const MAX_NAME_LENGTH = 60;

/** Caps a display name at 60 characters, appending an ellipsis, before it is escaped. */
export function truncateName(name: string): string {
    return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH)}…` : name;
}

/**
 * Escapes markdown/HTML specials so untrusted names can't break out of the hover text. Collapses
 * whitespace runs containing a newline first, so a name can't start a new block; escapes `:` so
 * `https://…` substrings can't be autolinked.
 */
export function escapeMarkdown(text: string): string {
    const collapsed = text.replace(/\s*[\r\n]+\s*/g, ' ');
    return collapsed.replace(/[\\`*_{}[\]()#+\-.!|<>~:]/g, character => `\\${character}`);
}

/** Truncates and escapes each name, then joins them, capping the list at 8 with an "and N more" tail. */
export function formatNames(names: readonly string[]): string {
    const escaped = names.map(name => escapeMarkdown(truncateName(name)));
    if (escaped.length <= MAX_LIST_ENTRIES) {
        return escaped.join(', ');
    }
    return `${escaped.slice(0, MAX_LIST_ENTRIES).join(', ')}, and ${escaped.length - MAX_LIST_ENTRIES} more`;
}

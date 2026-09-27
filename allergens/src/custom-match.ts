export interface CustomWordMatch {
    /** The word as the user typed it. */
    word: string;
    /** Recipe ingredient names it matched, first-seen order, no duplicates. */
    ingredients: string[];
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive, on word boundaries (letters/digits of any script), allowing a plural
 * `s`/`es` on either side: the word minus a trailing `es` or `s` is tried too, and any
 * alternative may be followed by `s`/`es`. `nut` matches "nuts" but not "walnuts";
 * `pea` does not match "peanut". Whitespace inside a word matches any whitespace run. Word and
 * name are NFC-normalised, so a decomposed "crème" matches a composed one.
 */
function wordPattern(word: string): RegExp {
    const lower = word.normalize('NFC').trim().toLowerCase();
    const bases = new Set([lower]);
    if (lower.endsWith('es') && lower.length > 3) {
        bases.add(lower.slice(0, -2));
    }
    if (lower.endsWith('s') && lower.length > 2) {
        bases.add(lower.slice(0, -1));
    }
    const alternatives = [...bases].map(base => escapeRegExp(base).replace(/\s+/g, '\\s+'));
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
}

export function matchesWord(word: string, ingredientName: string): boolean {
    return wordPattern(word).test(ingredientName.normalize('NFC'));
}

/** Words with at least one match, in the order given. */
export function matchCustomWords(words: readonly string[], ingredientNames: readonly string[]): CustomWordMatch[] {
    const matches: CustomWordMatch[] = [];
    for (const word of words) {
        const pattern = wordPattern(word);
        const ingredients = [...new Set(ingredientNames.filter(name => pattern.test(name.normalize('NFC'))))];
        if (ingredients.length > 0) {
            matches.push({ word, ingredients });
        }
    }
    return matches;
}

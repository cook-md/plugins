import { ALLERGEN_CLASSES, AllergenClass } from './allergen-classes';

export const MAX_CUSTOM_WORD_LENGTH = 40;

export interface AllergenSettings {
    /** Ticked EU-14 classes, in table order. */
    classes: readonly AllergenClass[];
    /** Custom words as the user typed them (whitespace/control runs → one space, trimmed), deduplicated case-insensitively. */
    customWords: readonly string[];
    showWhenLocked: boolean;
}

/** Reads one setting under `allergens.`; extension.ts passes `getConfiguration('allergens').get`. */
export type ReadSetting = (key: string) => unknown;

export function readSettings(read: ReadSetting): AllergenSettings {
    const classes = ALLERGEN_CLASSES.filter(allergenClass => read(allergenClass.key) === true);
    const raw = read('custom');
    const seen = new Set<string>();
    const customWords: string[] = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (typeof entry !== 'string') {
            continue;
        }
        // Control characters (tabs, NULs, C1 controls) would break the pill; fold them into spaces.
        const word = entry.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();
        const folded = word.toLowerCase();
        if (word === '' || word.length > MAX_CUSTOM_WORD_LENGTH || seen.has(folded)) {
            continue;
        }
        seen.add(folded);
        customWords.push(word);
    }
    return { classes, customWords, showWhenLocked: read('showWhenLocked') !== false };
}

/** Nothing to look for: the provider returns no badge without rendering anything. */
export function isInactive(settings: AllergenSettings): boolean {
    return settings.classes.length === 0 && settings.customWords.length === 0;
}

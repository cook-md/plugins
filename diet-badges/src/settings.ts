/** The diets this plugin checks; the setting name under `dietBadges.` is the same. */
export type DietId = 'vegan' | 'vegetarian' | 'pescatarian' | 'dairyFree';

/** Strictest first; Dairy-free is not on the Vegan → Vegetarian → Pescatarian ladder. */
export const DIET_IDS: readonly DietId[] = ['vegan', 'vegetarian', 'pescatarian', 'dairyFree'];

export const MAX_WORD_LENGTH = 40;

export interface DietSettings {
    diets: Readonly<Record<DietId, boolean>>;
    /** User words that make a recipe not vegan (whitespace/control runs → one space, trimmed), deduplicated case-insensitively. */
    extraNonVegan: readonly string[];
    showWhenLocked: boolean;
}

/** Reads one setting under `dietBadges.`; extension.ts passes `getConfiguration('dietBadges').get`. */
export type ReadSetting = (key: string) => unknown;

function readWords(raw: unknown): string[] {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (typeof entry !== 'string') {
            continue;
        }
        // Control characters (tabs, NULs, C1 controls) would break the hover; fold them into spaces.
        const word = entry.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();
        const folded = word.toLowerCase();
        if (word === '' || word.length > MAX_WORD_LENGTH || seen.has(folded)) {
            continue;
        }
        seen.add(folded);
        words.push(word);
    }
    return words;
}

/** Every diet defaults to on: only an explicit `false` turns one off. */
export function readSettings(read: ReadSetting): DietSettings {
    return {
        diets: {
            vegan: read('vegan') !== false,
            vegetarian: read('vegetarian') !== false,
            pescatarian: read('pescatarian') !== false,
            dairyFree: read('dairyFree') !== false,
        },
        extraNonVegan: readWords(read('extraNonVegan')),
        showWhenLocked: read('showWhenLocked') !== false,
    };
}

/** No diet to check: the provider returns no badge without asking about the plan or rendering. */
export function isInactive(settings: DietSettings): boolean {
    return DIET_IDS.every(id => !settings.diets[id]);
}

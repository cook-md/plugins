export const DEFAULT_ALWAYS_HAVE: readonly string[] = ['salt', 'pepper', 'black pepper', 'water'];
export const DEFAULT_EXPIRING_WITHIN_DAYS = 5;
export const MAX_EXPIRING_WITHIN_DAYS = 365;

export interface PantryMatchSettings {
    /** As typed (trimmed); normalised later by `pantryLookup`. */
    alwaysHave: readonly string[];
    expiringWithinDays: number;
    showBadge: boolean;
}

/** Reads one setting under `pantryMatch.`; extension code passes `getConfiguration('pantryMatch').get`. */
export type ReadSetting = (key: string) => unknown;

export function readSettings(read: ReadSetting): PantryMatchSettings {
    const rawAlwaysHave = read('alwaysHave');
    const alwaysHave = Array.isArray(rawAlwaysHave)
        ? rawAlwaysHave
            .filter((entry): entry is string => typeof entry === 'string')
            .map(entry => entry.trim())
            .filter(entry => entry !== '')
        : [...DEFAULT_ALWAYS_HAVE];
    const rawDays = read('expiringWithinDays');
    const expiringWithinDays = typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays >= 0
        ? Math.min(Math.floor(rawDays), MAX_EXPIRING_WITHIN_DAYS)
        : DEFAULT_EXPIRING_WITHIN_DAYS;
    return { alwaysHave, expiringWithinDays, showBadge: read('showBadge') !== false };
}

/** What the recipe figures are per: one serving, or 100 g of the dish. Plans are always per person per day. */
export type Basis = 'serving' | '100g';

export interface MacrosSettings {
    /** Append the energy (kcal) to the pill. */
    showEnergy: boolean;
    basis: Basis;
    /** Show a greyed `🔒 Macros` pill when the plan lacks nutrition data. */
    showWhenLocked: boolean;
}

/** Reads one setting under `macros.`; extension.ts passes `getConfiguration('macros').get`. */
export type ReadSetting = (key: string) => unknown;

/** Normalises the raw `macros.*` values; anything malformed falls back to its default. */
export function readSettings(read: ReadSetting): MacrosSettings {
    return {
        showEnergy: read('showEnergy') !== false,
        basis: read('basis') === '100g' ? '100g' : 'serving',
        showWhenLocked: read('showWhenLocked') !== false,
    };
}

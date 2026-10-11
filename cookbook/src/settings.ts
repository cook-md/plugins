import { PageSize } from './cooklang-api';

export interface CookbookSettings {
    /** Folder names or folder paths left out of the book. */
    exclude: string[];
    /** Print a nutrition line per recipe when the plan includes `nutrition_api`. */
    nutrition: boolean;
    pageSize: PageSize;
}

export const DEFAULT_EXCLUDE: readonly string[] = ['Drafts', 'config'];

/** Normalises the `cookbook.*` settings; `get` is `workspace.getConfiguration('cookbook').get`. */
export function readSettings(get: (key: string) => unknown): CookbookSettings {
    const exclude = get('exclude');
    return {
        exclude: Array.isArray(exclude)
            ? exclude.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(entry => entry !== '')
            : [...DEFAULT_EXCLUDE],
        nutrition: get('nutrition') !== false,
        pageSize: get('pageSize') === 'Letter' ? 'Letter' : 'A4',
    };
}

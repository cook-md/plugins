// Paths of the read-only `cooklang-hub:` file system:
// `cooklang-hub:/recipes/<id>/<Title>.cook`. Only the id matters for reading;
// the file name gives the preview tab its title and the `.cook` extension
// makes the editor treat it as a recipe. No `vscode` import.

export const HUB_SCHEME = 'cooklang-hub';

const RECIPE_PATH = /^\/recipes\/(\d+)\/([^/]+\.[Cc][Oo][Oo][Kk])$/;
const DIRECTORY_PATH = /^\/(recipes(\/\d+)?)?\/?$/;
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|#%\u0000-\u001f]/g;
const MAX_TITLE_LENGTH = 100;

export interface HubRecipeRef {
    id: number;
    fileName: string;
}

/** `<Title>.cook` without characters that are unsafe in file names or URIs; `Recipe <id>.cook` when nothing is left. */
export function fileNameForTitle(title: string, id: number): string {
    const cleaned = title
        .replace(UNSAFE_FILE_NAME_CHARACTERS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+|\.+$/g, '')
        .trim()
        .slice(0, MAX_TITLE_LENGTH)
        .trim();
    return `${cleaned === '' ? `Recipe ${id}` : cleaned}.cook`;
}

export function recipePath(id: number, title: string): string {
    return `/recipes/${id}/${fileNameForTitle(title, id)}`;
}

export function parseRecipePath(path: string): HubRecipeRef | undefined {
    const match = RECIPE_PATH.exec(path);
    if (!match) {
        return undefined;
    }
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? { id, fileName: match[2] } : undefined;
}

export function isDirectoryPath(path: string): boolean {
    return DIRECTORY_PATH.test(path);
}

export function titleFromFileName(fileName: string): string {
    return fileName.replace(/\.cook$/i, '');
}

/** The `uri` of a Cooklang outlet context (`{ version, uri, path, scale }`); undefined for anything else. */
export function outletContextUri(arg: unknown): string | undefined {
    if (typeof arg !== 'object' || arg === null) {
        return undefined;
    }
    const uri = (arg as { uri?: unknown }).uri;
    return typeof uri === 'string' ? uri : undefined;
}

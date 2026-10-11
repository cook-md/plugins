import { PantryContents, PantryItem } from './cooklang-api';

/** Same location the Shopping List and Pantry plugins use, under the first workspace folder. */
export const PANTRY_FILE = 'config/pantry.conf';

export type PantryState =
    | { kind: 'missing' }
    | { kind: 'error'; message: string }
    | { kind: 'ok'; items: PantryItem[] };

export interface PantrySource {
    /** File text, or undefined when the file does not exist. */
    read(): Promise<string | undefined>;
    /** `cooklang.api.parsePantry`. */
    parse(text: string): Promise<PantryContents>;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function loadPantry(source: PantrySource): Promise<PantryState> {
    let text: string | undefined;
    try {
        text = await source.read();
    } catch (error) {
        return { kind: 'error', message: `Could not read ${PANTRY_FILE}: ${messageOf(error)}` };
    }
    if (text === undefined) {
        return { kind: 'missing' };
    }
    let contents: PantryContents;
    try {
        contents = await source.parse(text);
    } catch (error) {
        return { kind: 'error', message: `${PANTRY_FILE} has an error: ${messageOf(error)}` };
    }
    if (typeof contents !== 'object' || contents === null || !Array.isArray(contents.sections)) {
        return { kind: 'error', message: `${PANTRY_FILE}: unexpected result from the editor` };
    }
    return { kind: 'ok', items: contents.sections.flatMap(section => Array.isArray(section.items) ? section.items : []) };
}

import type { PantryAttributes, PantrySection } from './cooklang-api';

export type ViewStatus = 'unsupported' | 'noWorkspace' | 'loading' | 'noFile' | 'parseError' | 'loaded';

/** Everything the webview renders. */
export interface ViewState {
    status: ViewStatus;
    sections: PantrySection[];
    parseError?: string;
    editError?: string;
}

export type ToWebview =
    | { type: 'state'; state: ViewState }
    /** From the `pantry.addItem` command. */
    | { type: 'showAdd' };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'create' }
    | { type: 'openFile' }
    | { type: 'dismissError' }
    | { type: 'add'; section: string; name: string; attributes: PantryAttributes }
    | { type: 'update'; section: string; name: string; fields: PantryAttributes }
    | { type: 'remove'; section: string; name: string };

function isName(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== '';
}

const ATTRIBUTE_KEYS = new Set(['quantity', 'bought', 'expire', 'low']);

function isAttributes(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.entries(value).every(([key, v]) => ATTRIBUTE_KEYS.has(key) && typeof v === 'string');
}

/** The webview is untrusted input: check shapes before touching the store. */
export function isValidMessage(message: unknown): message is FromWebview {
    if (typeof message !== 'object' || message === null) {
        return false;
    }
    const m = message as Record<string, unknown>;
    switch (m.type) {
        case 'ready':
        case 'create':
        case 'openFile':
        case 'dismissError': return true;
        case 'add': return isName(m.section) && isName(m.name) && isAttributes(m.attributes);
        case 'update': return isName(m.section) && isName(m.name) && isAttributes(m.fields);
        case 'remove': return isName(m.section) && isName(m.name);
        default: return false;
    }
}

// Pure view logic for the pantry webview; no DOM, no vscode.
import type { PantryAttributes, PantryItem, PantrySection } from './cooklang-api';

export type PantryFilter = 'all' | 'low' | 'out' | 'expiring';
export type ItemStatus = 'expired' | 'out' | 'low' | 'expiring' | 'ok';

/** Items expiring within this many days count as "expiring". */
export const EXPIRING_DAYS = 7;
export const DEFAULT_SECTIONS = ['fridge', 'pantry', 'freezer'];

/** The four editable attributes as the form shows them. */
export interface EditDraft {
    quantity: string;
    low: string;
    bought: string;
    expire: string;
}

export interface SectionView {
    name: string;
    /** Items in the section before search/filter. */
    total: number;
    items: PantryItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date as `YYYY-MM-DD`. */
export function todayIso(now: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `today` to `isoDate` (both `YYYY-MM-DD`); negative in the past. */
export function daysUntil(isoDate: string, today: string): number {
    const utc = (iso: string): number => {
        const [year, month, day] = iso.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    return Math.round((utc(isoDate) - utc(today)) / DAY_MS);
}

export function itemStatus(item: PantryItem, today: string): ItemStatus {
    const days = item.expireDate ? daysUntil(item.expireDate, today) : undefined;
    if (days !== undefined && days < 0) {
        return 'expired';
    }
    if (item.isOutOfStock) {
        return 'out';
    }
    if (item.isLow) {
        return 'low';
    }
    if (days !== undefined && days <= EXPIRING_DAYS) {
        return 'expiring';
    }
    return 'ok';
}

export function matchesFilter(item: PantryItem, filter: PantryFilter, today: string): boolean {
    switch (filter) {
        case 'all': return true;
        case 'low': return item.isLow;
        case 'out': return item.isOutOfStock;
        case 'expiring': return item.expireDate !== undefined && daysUntil(item.expireDate, today) <= EXPIRING_DAYS;
    }
}

/** Sections with their matching items; empty sections are hidden while a search or filter is active. */
export function visibleSections(sections: readonly PantrySection[], search: string, filter: PantryFilter, today: string): SectionView[] {
    const needle = search.trim().toLowerCase();
    const narrowing = needle !== '' || filter !== 'all';
    return sections
        .map(section => ({
            name: section.name,
            total: section.items.length,
            items: section.items.filter(item => item.name.toLowerCase().includes(needle) && matchesFilter(item, filter, today)),
        }))
        .filter(section => !narrowing || section.items.length > 0);
}

/** `500%g` → `500 g`. */
export function displayQuantity(quantity: string): string {
    return quantity.replace('%', ' ');
}

/** `500 g` → `500%g`; values already using `%`, bare numbers and free text are kept. */
export function storedQuantity(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('%')) {
        return trimmed;
    }
    const match = /^([\d.,/]+)\s+(\S.*)$/.exec(trimmed);
    return match ? `${match[1]}%${match[2]}` : trimmed;
}

export function expiryLabel(days: number): string {
    const unit = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
    if (days === 0) {
        return 'today';
    }
    return days > 0 ? `in ${unit(days)}` : `expired ${unit(-days)} ago`;
}

export function sectionChoices(sections: readonly PantrySection[]): string[] {
    return sections.length > 0 ? sections.map(section => section.name) : [...DEFAULT_SECTIONS];
}

export function initialDraft(item: PantryItem): EditDraft {
    return {
        quantity: item.quantity ? displayQuantity(item.quantity) : '',
        low: item.low ? displayQuantity(item.low) : '',
        bought: item.boughtDate ?? item.bought ?? '',
        expire: item.expireDate ?? item.expire ?? '',
    };
}

/** Fields that differ from the item; a field emptied by the user is sent as `''` (clears it). */
export function changedFields(item: PantryItem, draft: EditDraft): PantryAttributes {
    const initial = initialDraft(item);
    const fields: PantryAttributes = {};
    if (draft.quantity.trim() !== initial.quantity) {
        fields.quantity = storedQuantity(draft.quantity);
    }
    if (draft.low.trim() !== initial.low) {
        fields.low = storedQuantity(draft.low);
    }
    if (draft.bought.trim() !== initial.bought) {
        fields.bought = draft.bought.trim();
    }
    if (draft.expire.trim() !== initial.expire) {
        fields.expire = draft.expire.trim();
    }
    return fields;
}

/** Attributes for a new item: only non-empty fields. */
export function addAttributes(draft: EditDraft): PantryAttributes {
    const attributes: PantryAttributes = {};
    const quantity = storedQuantity(draft.quantity);
    const low = storedQuantity(draft.low);
    if (quantity) { attributes.quantity = quantity; }
    if (low) { attributes.low = low; }
    if (draft.bought.trim()) { attributes.bought = draft.bought.trim(); }
    if (draft.expire.trim()) { attributes.expire = draft.expire.trim(); }
    return attributes;
}

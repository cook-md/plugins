import { PantryItem } from './cooklang-api';
import { normaliseName } from './match';

export interface ExpiringItem {
    /** As written in pantry.conf. */
    name: string;
    /** `normaliseName(name)`, matched against `RecipeMatch.uses`. */
    key: string;
    expireDate: string;
    /** Negative when already expired. */
    daysLeft: number;
}

const DAY_MS = 86_400_000;

function utcDay(date: string): number | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

/** The local calendar date as `YYYY-MM-DD` (pantry dates have no time zone). */
export function todayString(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `today` to `date` (both `YYYY-MM-DD`). */
export function daysUntil(today: string, date: string): number | undefined {
    const from = utcDay(today);
    const to = utcDay(date);
    return from === undefined || to === undefined ? undefined : Math.round((to - from) / DAY_MS);
}

/** In-stock items with an expiry date at most `withinDays` away (or past), one per normalised name, soonest first. */
export function expiringItems(items: readonly PantryItem[], today: string, withinDays: number): ExpiringItem[] {
    const byKey = new Map<string, ExpiringItem>();
    for (const item of items) {
        if (item.isOutOfStock || !item.expireDate) {
            continue;
        }
        const daysLeft = daysUntil(today, item.expireDate);
        const key = normaliseName(item.name);
        if (daysLeft === undefined || daysLeft > withinDays || key === '') {
            continue;
        }
        const existing = byKey.get(key);
        if (!existing || daysLeft < existing.daysLeft) {
            byKey.set(key, { name: item.name, key, expireDate: item.expireDate, daysLeft });
        }
    }
    return [...byKey.values()].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

export function describeExpiry(daysLeft: number): string {
    if (daysLeft < -1) {
        return `expired ${-daysLeft} days ago`;
    }
    if (daysLeft === -1) {
        return 'expired yesterday';
    }
    if (daysLeft === 0) {
        return 'expires today';
    }
    if (daysLeft === 1) {
        return 'expires tomorrow';
    }
    return `expires in ${daysLeft} days`;
}

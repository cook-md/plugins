import * as assert from 'assert';
import type { PantryItem, PantrySection } from './cooklang-api';
import {
    addAttributes, changedFields, daysUntil, displayQuantity, expiryLabel, initialDraft, itemStatus,
    matchesFilter, sectionChoices, storedQuantity, todayIso, visibleSections,
} from './view-model';

const TODAY = '2026-09-26';

function item(overrides: Partial<PantryItem> & { name: string }): PantryItem {
    return { isLow: false, isOutOfStock: false, ...overrides };
}

describe('view-model', () => {
    it('formats today as a local YYYY-MM-DD date', () => {
        assert.strictEqual(todayIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    });

    it('counts whole days between ISO dates, negative in the past', () => {
        assert.strictEqual(daysUntil('2026-09-26', TODAY), 0);
        assert.strictEqual(daysUntil('2026-10-03', TODAY), 7);
        assert.strictEqual(daysUntil('2026-09-24', TODAY), -2);
        assert.strictEqual(daysUntil('2027-03-29', '2027-03-27'), 2, 'DST change does not shift the count');
    });

    it('ranks status worst-first: expired, out, low, expiring, ok', () => {
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-09-25', isOutOfStock: true }), TODAY), 'expired');
        assert.strictEqual(itemStatus(item({ name: 'a', isOutOfStock: true, isLow: true }), TODAY), 'out');
        assert.strictEqual(itemStatus(item({ name: 'a', isLow: true, expireDate: '2026-09-27' }), TODAY), 'low');
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-10-03' }), TODAY), 'expiring');
        assert.strictEqual(itemStatus(item({ name: 'a', expireDate: '2026-10-04' }), TODAY), 'ok');
        assert.strictEqual(itemStatus(item({ name: 'a', expire: 'soon' }), TODAY), 'ok', 'unparseable expiry is ignored');
    });

    it('filters by low, out of stock and expiring (which includes expired)', () => {
        const low = item({ name: 'low', isLow: true });
        const out = item({ name: 'out', isOutOfStock: true });
        const expired = item({ name: 'expired', expireDate: '2026-09-01' });
        const fine = item({ name: 'fine' });
        const all = [low, out, expired, fine];
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'all', TODAY)), all);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'low', TODAY)), [low]);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'out', TODAY)), [out]);
        assert.deepStrictEqual(all.filter(i => matchesFilter(i, 'expiring', TODAY)), [expired]);
    });

    it('searches case-insensitively and hides empty sections only while narrowing', () => {
        const sections: PantrySection[] = [
            { name: 'fridge', items: [item({ name: 'Milk' }), item({ name: 'eggs' })] },
            { name: 'freezer', items: [item({ name: 'peas' })] },
            { name: 'empty', items: [] },
        ];
        assert.deepStrictEqual(visibleSections(sections, '', 'all', TODAY).map(s => [s.name, s.items.length, s.total]),
            [['fridge', 2, 2], ['freezer', 1, 1], ['empty', 0, 0]]);
        assert.deepStrictEqual(visibleSections(sections, ' MIL ', 'all', TODAY).map(s => [s.name, s.items.map(i => i.name), s.total]),
            [['fridge', ['Milk'], 2]]);
        assert.deepStrictEqual(visibleSections(sections, '', 'low', TODAY), []);
    });

    it('shows quantities with a space and stores them with %', () => {
        assert.strictEqual(displayQuantity('500%g'), '500 g');
        assert.strictEqual(displayQuantity('6'), '6');
        assert.strictEqual(storedQuantity(' 500 g '), '500%g');
        assert.strictEqual(storedQuantity('1.5 kg'), '1.5%kg');
        assert.strictEqual(storedQuantity('1/2 cup'), '1/2%cup');
        assert.strictEqual(storedQuantity('500%g'), '500%g');
        assert.strictEqual(storedQuantity('6'), '6');
        assert.strictEqual(storedQuantity('a pinch'), 'a pinch');
        assert.strictEqual(storedQuantity(''), '');
        assert.strictEqual(storedQuantity('2 large eggs'), '2 large eggs');
        assert.strictEqual(storedQuantity('1 1/2 cup'), '1 1/2 cup');
    });

    it('labels expiry relative to today', () => {
        assert.strictEqual(expiryLabel(0), 'today');
        assert.strictEqual(expiryLabel(1), 'in 1 day');
        assert.strictEqual(expiryLabel(3), 'in 3 days');
        assert.strictEqual(expiryLabel(-1), 'expired 1 day ago');
        assert.strictEqual(expiryLabel(-4), 'expired 4 days ago');
    });

    it('offers existing sections, or defaults when there are none', () => {
        assert.deepStrictEqual(sectionChoices([{ name: 'cellar', items: [] }]), ['cellar']);
        assert.deepStrictEqual(sectionChoices([]), ['fridge', 'pantry', 'freezer']);
    });

    it('prefills the edit draft from display quantities and normalised dates', () => {
        assert.deepStrictEqual(initialDraft(item({ name: 'milk', quantity: '1%L', low: '200%ml', expire: '01.10.2026', expireDate: '2026-10-01', bought: 'last week' })),
            { quantity: '1 L', low: '200 ml', bought: 'last week', expire: '2026-10-01' });
    });

    it('sends only fields changed from the form baseline, with an empty string for a cleared one', () => {
        const base = initialDraft(item({ name: 'milk', quantity: '1%L', expire: '01.10.2026', expireDate: '2026-10-01' }));
        assert.deepStrictEqual(changedFields(base, { quantity: '1 L', low: '', bought: '', expire: '2026-10-01' }), {});
        assert.deepStrictEqual(changedFields(base, { quantity: '2 L', low: '500 ml', bought: '', expire: '' }),
            { quantity: '2%L', low: '500%ml', expire: '' });
    });

    it('does not send an untouched field that changed outside the form', () => {
        const opened = item({ name: 'milk', quantity: '1%L', low: '200%ml' });
        const base = initialDraft(opened);
        const draft = { ...base, quantity: '2 L' };
        // Meanwhile someone else set low to 300 ml in pantry.conf; the draft still holds the old 200 ml.
        assert.deepStrictEqual(changedFields(base, draft), { quantity: '2%L' });
    });

    it('builds add attributes from non-empty fields only', () => {
        assert.deepStrictEqual(addAttributes({ quantity: '500 g', low: '', bought: '', expire: '2026-10-01' }),
            { quantity: '500%g', expire: '2026-10-01' });
    });
});

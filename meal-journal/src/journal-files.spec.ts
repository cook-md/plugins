import * as assert from 'node:assert';
import {
    DEFAULT_TEMPLATE,
    fileNameForDate,
    humanTitle,
    isJournalFileName,
    renderTemplate
} from './journal-files';

describe('journal-files', () => {
    // Note: JS Date months are 0-based; this is 9 June 2026, a Tuesday.
    const june9 = new Date(2026, 5, 9);

    describe('fileNameForDate', () => {
        it('formats the local date as YYYY-MM-DD.journal', () => {
            assert.strictEqual(fileNameForDate(june9), '2026-06-09.journal');
        });

        it('zero-pads month and day', () => {
            assert.strictEqual(fileNameForDate(new Date(2026, 0, 1)), '2026-01-01.journal');
        });
    });

    describe('isJournalFileName', () => {
        it('accepts date-named journal files', () => {
            assert.strictEqual(isJournalFileName('2026-06-09.journal'), true);
        });

        it('rejects non-date journal files', () => {
            assert.strictEqual(isJournalFileName('notes.journal'), false);
        });

        it('rejects other extensions', () => {
            assert.strictEqual(isJournalFileName('2026-06-09.cook'), false);
        });
    });

    describe('humanTitle', () => {
        it('formats a human-readable date', () => {
            assert.strictEqual(humanTitle(june9), 'Tuesday, 9 June 2026');
        });
    });

    describe('renderTemplate', () => {
        it('replaces ${date} and ${title} placeholders', () => {
            const rendered = renderTemplate('date: ${date}\ntitle: ${title}\n${date}', june9);
            assert.strictEqual(rendered, 'date: 2026-06-09\ntitle: Tuesday, 9 June 2026\n2026-06-09');
        });

        it('renders the default template with YAML frontmatter and meal sections', () => {
            const rendered = renderTemplate(DEFAULT_TEMPLATE, june9);
            assert.ok(rendered.startsWith('---\n'), 'starts with YAML frontmatter');
            assert.ok(rendered.includes('title: Tuesday, 9 June 2026'));
            assert.ok(rendered.includes('date: 2026-06-09'));
            assert.ok(rendered.includes('= Breakfast'));
            assert.ok(rendered.includes('= Lunch'));
            assert.ok(rendered.includes('= Dinner'));
        });
    });
});

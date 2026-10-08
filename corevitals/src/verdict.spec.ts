import * as assert from 'assert';
import { evaluate } from './verdict';
import { VitalsOutput, VitalsRow } from './vitals-template';

function row(overrides: Partial<VitalsRow>): VitalsRow {
    return { key: 'iron_mg', label: 'Iron', kind: 'min', unit: 'mg', actual: 9, target: 18, lo: 0, hi: 0, percent: 50, ok: false, skipped: false, ...overrides };
}

function output(overrides: Partial<VitalsOutput>): VitalsOutput {
    return { kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20, rows: [], matched: 18, total: 20, unmatched: ['saffron'], missingRecipes: [], confidence: 'partial', ...overrides };
}

describe('evaluate', () => {
    it('counts met checks and sorts shortfalls into below and over', () => {
        const verdict = evaluate(output({
            rows: [
                row({ key: 'kcal', label: 'Energy', kind: 'energy', percent: 95, ok: true }),
                row({ key: 'protein_g', label: 'Protein', kind: 'macroPercent', actual: 8, lo: 10, hi: 35, percent: 8, ok: false }),
                row({ key: 'fat_g', label: 'Fat', kind: 'macroPercent', actual: 40, lo: 20, hi: 35, percent: 40, ok: false }),
                row({ key: 'sodium_mg', label: 'Sodium', kind: 'max', percent: 132, ok: false }),
                row({ percent: 54, ok: false }),
                row({ key: 'kcal2', label: 'Energy high', kind: 'energy', percent: 130, ok: false }),
                row({ key: 'boron_ug', label: 'Boron', skipped: true }),
            ],
        }));
        assert.strictEqual(verdict.withheld, undefined);
        assert.strictEqual(verdict.met, 1);
        assert.strictEqual(verdict.counted, 6);
        assert.deepStrictEqual(verdict.below.map(entry => entry.label), ['Protein', 'Iron']);
        assert.deepStrictEqual(verdict.over.map(entry => entry.label), ['Fat', 'Sodium', 'Energy high']);
        assert.deepStrictEqual(verdict.skipped, ['Boron']);
        assert.strictEqual(verdict.confidence, 'Medium');
    });

    it('withholds the verdict when fewer than 70 % of ingredients matched, at the edge', () => {
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 7, total: 10 })).withheld, undefined);
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 6, total: 10 })).withheld, 'unmatched');
    });

    it('withholds for missing recipes, no data and no counted checks', () => {
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], missingRecipes: ['Pesto'] })).withheld, 'missingRecipes');
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 0, total: 0 })).withheld, 'noData');
        assert.strictEqual(evaluate(output({ rows: [row({ skipped: true })] })).withheld, 'noChecks');
    });

    it('maps the service confidence to High / Medium / Low', () => {
        assert.strictEqual(evaluate(output({ confidence: 'confirmed' })).confidence, 'High');
        assert.strictEqual(evaluate(output({ confidence: 'partial' })).confidence, 'Medium');
        assert.strictEqual(evaluate(output({ confidence: 'estimated' })).confidence, 'Low');
        assert.strictEqual(evaluate(output({ confidence: '' })).confidence, 'Low');
    });

    it('carries the period through', () => {
        const verdict = evaluate(output({ kind: 'recipe', days: 1, people: 4, standard: 'eu' }));
        assert.deepStrictEqual({ kind: verdict.kind, days: verdict.days, people: verdict.people, standard: verdict.standard }, { kind: 'recipe', days: 1, people: 4, standard: 'eu' });
    });
});

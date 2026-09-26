import * as assert from 'assert';
import { gradeFor, nutriScore, Per100g } from './nutriscore';

const base: Per100g = { energyKj: 0, sugarsG: 0, satFatG: 0, saltG: 0, proteinG: 0, fibreG: 0, fvlPercent: 0 };

describe('nutriScore (2023, general foods)', () => {
    it('scores a fruit-heavy, low-energy dish as A', () => {
        // N = 0; P = protein 2 (>4.8) + fibre 1 (>3.0) + fvl 5 (>80) = 8; score -8.
        const result = nutriScore({ ...base, energyKj: 250, sugarsG: 2, satFatG: 0.5, saltG: 0.1, proteinG: 5, fibreG: 4, fvlPercent: 90 });
        assert.deepStrictEqual(result, { grade: 'A', score: -8, negative: 0, positive: 8, proteinCounted: true });
    });

    it('scores an energy-dense, sugary, salty dish as E and ignores protein', () => {
        // energy 6 (>2010), sugars 8 (>27), sat fat 10 (>10), salt 7 (>1.4) => N = 31; protein ignored (N >= 11).
        const result = nutriScore({ ...base, energyKj: 2100, sugarsG: 30, satFatG: 12, saltG: 1.5, proteinG: 10 });
        assert.deepStrictEqual(result, { grade: 'E', score: 31, negative: 31, positive: 0, proteinCounted: false });
    });

    it('does not count protein once negative points reach 11', () => {
        // energy 2 (>670), sat fat 5 (>5), salt 5 (>1.0) => N = 12; protein 20 g would be 7 points.
        const result = nutriScore({ ...base, energyKj: 700, sugarsG: 1, satFatG: 5.5, saltG: 1.1, proteinG: 20 });
        assert.strictEqual(result.proteinCounted, false);
        assert.strictEqual(result.score, 12);
        assert.strictEqual(result.grade, 'D');
    });

    it('counts protein below 11 negative points', () => {
        // energy 2, sat fat 5, salt 3 (>0.6) => N = 10; protein 7 (>17).
        const result = nutriScore({ ...base, energyKj: 700, satFatG: 5.5, saltG: 0.7, proteinG: 20 });
        assert.strictEqual(result.proteinCounted, true);
        assert.strictEqual(result.score, 3);
        assert.strictEqual(result.grade, 'C');
    });

    it('uses strictly-greater thresholds', () => {
        assert.strictEqual(nutriScore({ ...base, energyKj: 335 }).negative, 0);
        assert.strictEqual(nutriScore({ ...base, energyKj: 335.1 }).negative, 1);
        assert.strictEqual(nutriScore({ ...base, saltG: 0.6 }).negative, 2);
        assert.strictEqual(nutriScore({ ...base, fvlPercent: 80 }).positive, 2);
    });

    it('maps scores to grades at the 2023 boundaries', () => {
        assert.deepStrictEqual([-15, 0, 1, 2, 3, 10, 11, 18, 19].map(gradeFor), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E']);
    });
});

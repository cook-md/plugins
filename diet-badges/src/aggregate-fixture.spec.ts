import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { dietBadge } from './badge';
import { parseDietOutput } from './diet-template';
import { evaluateDiets } from './rules';
import { DIET_IDS } from './settings';

describe('a captured /aggregate response (EU view)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'diet-output-eu.json'), 'utf8');
    const output = parseDietOutput(raw);

    it('parses and aligns the service items back to recipe names', () => {
        assert.ok(output);
        assert.deepStrictEqual(output.ingredients.map(i => [i.name, i.status]), [
            ['plain flour', 'unknown'],
            ['butter', 'verified'],
            ['almonds', 'verified'],
            ['saffron', 'unknown'],
            ['unobtainium', 'unknown'],
            ['soy sauce', 'verified'],
        ]);
    });

    it('fails Vegan and Dairy-free on butter and leaves the rest unknown (soy sauce is audited but unclassified)', () => {
        const verdicts = evaluateDiets(output!, []);
        assert.deepStrictEqual(DIET_IDS.map(id => verdicts[id].status), ['fail', 'unknown', 'unknown', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'butter', reason: 'dairy' }]);
        assert.deepStrictEqual(verdicts.vegetarian.unknown, ['plain flour', 'saffron', 'unobtainium', 'soy sauce']);
    });

    it('shows an amber Vegetarian? pill explaining both failures', () => {
        const badge = dietBadge(evaluateDiets(output!, []), { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true });
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegetarian?', 'warning']);
        assert.ok(badge?.tooltipMarkdown.includes("- **Vegetarian?** 4 ingredients couldn't be checked: plain flour, saffron, unobtainium, soy sauce"), badge?.tooltipMarkdown);
        assert.ok(badge?.tooltipMarkdown.includes('- Not vegan: butter \\(dairy\\)'));
        assert.ok(badge?.tooltipMarkdown.includes('- Not dairy-free: butter \\(dairy\\)'));
    });
});

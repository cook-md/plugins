import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ALLERGEN_CLASSES } from './allergen-classes';
import { parseAllergenOutput } from './allergen-template';
import { findAllergens } from './evaluate';

describe('a captured /aggregate response (EU view)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'aggregate-eu.json'), 'utf8');
    const classes = ALLERGEN_CLASSES.filter(c => ['milk', 'gluten', 'tree_nuts'].includes(c.slug));

    it('parses, aligns to recipe names and finds the ticked allergens', () => {
        const output = parseAllergenOutput(raw, true);
        assert.ok(output);
        const findings = findAllergens(classes, ['saffron'], output);
        assert.deepStrictEqual(findings.pillLabels, ['Gluten', 'Milk', 'Tree nuts', 'saffron']);
        for (const line of [
            { label: 'Wheat', ingredients: ['soy sauce'] },
            { label: 'Milk', ingredients: ['butter'] },
            { label: 'Almonds', ingredients: ['almonds'] },
        ]) {
            assert.ok(findings.lines.some(found => JSON.stringify(found) === JSON.stringify(line)), JSON.stringify(line));
        }
        // Recipe names, not the service's ("flour", "almond"): alignment worked. The live
        // service returns flour as unverified.
        assert.deepStrictEqual(findings.unknown, ['plain flour', 'saffron', 'unobtainium']);
    });
});

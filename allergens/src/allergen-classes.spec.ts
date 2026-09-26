import * as assert from 'assert';
import { ALLERGEN_CLASSES } from './allergen-classes';

describe('ALLERGEN_CLASSES', () => {
    it('lists the 14 EU classes with unique slugs, keys and labels', () => {
        assert.strictEqual(ALLERGEN_CLASSES.length, 14);
        for (const field of ['slug', 'key', 'label'] as const) {
            assert.strictEqual(new Set(ALLERGEN_CLASSES.map(c => c[field])).size, 14, field);
        }
    });

    it('maps the camelCase setting to the service slug', () => {
        const treeNuts = ALLERGEN_CLASSES.find(c => c.key === 'treeNuts');
        assert.deepStrictEqual(treeNuts, { slug: 'tree_nuts', key: 'treeNuts', label: 'Tree nuts' });
    });

    it('matches the contributed settings', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../package.json');
        const keys = Object.keys(pkg.contributes.configuration.properties)
            .filter(key => pkg.contributes.configuration.properties[key].type === 'boolean' && key !== 'allergens.showWhenLocked');
        assert.deepStrictEqual(keys, ALLERGEN_CLASSES.map(c => `allergens.${c.key}`));
    });
});

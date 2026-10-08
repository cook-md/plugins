import * as assert from 'assert';
import { buildCheckSpec } from './check-spec';
import { CoreVitalsSettings } from './settings';
import { MAX_TEMPLATE_LENGTH, VitalsOutput, buildTemplate, parseVitalsOutput } from './vitals-template';

const SETTINGS: CoreVitalsSettings = {
    standard: 'eu', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

const ROW = { key: 'iron_mg', label: 'Iron', kind: 'min', unit: 'mg', actual: 9.7, target: 18, lo: 0, hi: 0, percent: 54, ok: false, skipped: false };
const OUTPUT: VitalsOutput = {
    kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20, rows: [ROW as VitalsOutput['rows'][number]],
    matched: 18, total: 20, unmatched: ['saffron', 'ghee'], missingRecipes: [], confidence: 'partial',
};

describe('buildTemplate', () => {
    it('starts with the mode line and embeds the spec as a dict literal', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 4), 'json');
        assert.ok(template.startsWith('{%- set mode = "json" -%}\n{%- set spec = {\n'), template.slice(0, 80));
        assert.ok(template.includes('"standard": "eu"'));
        assert.ok(template.includes('"servings": 4'));
        assert.ok(template.includes('aggregate_nutrition(ings)'));
        assert.ok(template.includes('| tojson'));
    });

    it('tells the report whether servings were known', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1, false), 'html');
        assert.ok(template.includes('"servingsKnown": false'));
        assert.ok(template.includes('Whole recipe (no servings in frontmatter)'));
        assert.ok(template.includes('{%- if spec.servingsKnown -%}'));
    });

    it('never puts two closing braces next to each other inside the spec block', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        const specBlock = template.slice(template.indexOf('{%- set spec ='), template.indexOf('-%}', template.indexOf('{%- set spec =')));
        assert.ok(!specBlock.includes('}}'), specBlock);
    });

    it('builds the html mode with the mode line and the report markup', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        assert.ok(template.startsWith('{%- set mode = "html" -%}'));
        assert.ok(template.includes('class="corevitals"'));
        assert.ok(template.length < MAX_TEMPLATE_LENGTH, `${template.length}`);
    });

    it('escapes every untrusted print in the html mode', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        assert.ok(template.includes('row.label | escape'));
        assert.ok(template.includes('name | escape'));
        assert.ok(template.includes('d.label | string)[:10] | escape'));
        assert.ok(template.includes('<td>{{ d.label | escape }}</td>'));
        assert.ok(!template.includes('{{ row.label }}'));
        assert.ok(!template.includes('{{ name }}'));
    });

    it('hides the count tile when withheld', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        const guard = template.indexOf('{%- if not withheld %}');
        assert.ok(guard >= 0);
        assert.ok(guard < template.indexOf('Targets met'));
    });

    it('accepts the longest label a 40-character key can produce', () => {
        const spec = buildCheckSpec({ ...SETTINGS, micronutrients: ['vit_abcdefghi_abcdefghi_abcdefghi_abcdef'] }, 1);
        assert.strictEqual(spec.checks[7].label.length, 44);
        assert.ok(buildTemplate(spec, 'json').includes('"Vitamin ABCDEFGHI ABCDEFGHI ABCDEFGHI ABCDEF"'));
    });

    it('refuses labels or keys that could break out of the template', () => {
        const spec = buildCheckSpec(SETTINGS, 1);
        spec.checks[0].label = 'Energy" %}{{ 1 }}';
        assert.throws(() => buildTemplate(spec, 'json'), /label/);
        const spec2 = buildCheckSpec(SETTINGS, 1);
        spec2.checks[0].key = 'kcal %}';
        assert.throws(() => buildTemplate(spec2, 'json'), /key/);
    });
});

describe('parseVitalsOutput', () => {
    it('accepts a well-formed payload and ignores extra fields', () => {
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, extra: true }));
        assert.deepStrictEqual(parsed, OUTPUT);
    });

    it('rejects non-JSON, wrong kinds and bad rows', () => {
        assert.strictEqual(parseVitalsOutput('not json'), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, standard: 'who' })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, kind: 'week' })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, percent: 'NaN' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, ok: 'yes' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, kind: 'avg' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, matched: -1 })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, matched: 25 })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, unmatched: 'saffron' })), undefined);
    });

    it('tolerates a skipped row with zeroed numbers and a non-string confidence', () => {
        const skipped = { ...ROW, key: 'boron_ug', target: 0, percent: 0, skipped: true };
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [skipped], confidence: 7 }));
        assert.ok(parsed);
        assert.strictEqual(parsed.rows[0].skipped, true);
        assert.strictEqual(parsed.confidence, '');
    });

    it('drops non-string names from unmatched and missingRecipes', () => {
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, unmatched: ['a', 1], missingRecipes: [{ name: 'x' }, 'Pesto'] }));
        assert.ok(parsed);
        assert.deepStrictEqual(parsed.unmatched, ['a']);
        assert.deepStrictEqual(parsed.missingRecipes, ['Pesto']);
    });
});

import * as assert from 'assert';
import { buildSaveDraftArgs, legacyMetadataToFrontmatter, yamlScalar } from './recipe-draft';

const LEGACY = '>> servings: 4\n>> source: https://blog.example/pasta\n>> servings: 6\n\nBoil @pasta{400%g}.\n';

describe('buildSaveDraftArgs', () => {
    it('uses the recipe title and its original source', () => {
        assert.deepStrictEqual(buildSaveDraftArgs({
            id: 7,
            fileTitle: 'Pasta Bake',
            content: 'Boil @pasta{400%g}.\n',
            detail: { title: 'Pasta Bake (Mum\'s)', sourceUrl: 'https://blog.example/pasta' },
            serverUrl: 'https://hub.example',
        }), {
            version: 1,
            content: 'Boil @pasta{400%g}.\n',
            title: 'Pasta Bake (Mum\'s)',
            frontmatter: { source: 'https://blog.example/pasta' },
        });
    });

    it('falls back to the file title and the Recipe Hub page', () => {
        assert.deepStrictEqual(buildSaveDraftArgs({ id: 7, fileTitle: 'Pasta Bake', content: 'x', serverUrl: 'https://hub.example/' }), {
            version: 1, content: 'x', title: 'Pasta Bake', frontmatter: { source: 'https://hub.example/recipes/7' },
        });
    });

    it('ignores a blank title and a non-http source_url', () => {
        const args = buildSaveDraftArgs({
            id: 7, fileTitle: 'Pasta Bake', content: 'x', detail: { title: '  ', sourceUrl: 'javascript:alert(1)' }, serverUrl: 'https://hub.example',
        });
        assert.deepStrictEqual([args.title, args.frontmatter], ['Pasta Bake', { source: 'https://hub.example/recipes/7' }]);
    });

    it('never emits the deprecated >> metadata syntax', () => {
        const args = buildSaveDraftArgs({ id: 7, fileTitle: 'Pasta', content: LEGACY, serverUrl: 'https://hub.example' });
        assert.strictEqual(/^>>/m.test(args.content), false, args.content);
        assert.ok(args.content.startsWith('---\n'), args.content);
    });
});

describe('legacyMetadataToFrontmatter', () => {
    it('turns >> metadata into YAML frontmatter, keeping the last value of a repeated key at its first position', () => {
        assert.strictEqual(legacyMetadataToFrontmatter(LEGACY),
            '---\nservings: 6\nsource: "https://blog.example/pasta"\n---\nBoil @pasta{400%g}.\n');
    });

    it('leaves YAML frontmatter and metadata-free recipes unchanged', () => {
        const yaml = '---\ntitle: Soup\n---\n>> not: converted\nBoil @water.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(yaml), yaml);
        assert.strictEqual(legacyMetadataToFrontmatter('Boil @water.\n'), 'Boil @water.\n');
    });

    it('does not convert >> lines when frontmatter fences exist anywhere, even after a leading blank line', () => {
        const withLeadingBlank = '\n---\ntitle: Soup\n---\n>> not: converted\nBoil @water.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(withLeadingBlank), withLeadingBlank);
    });

    it('converts >> lines when the body has only one lone --- divider (no closing fence)', () => {
        const loneDivider = '>> servings: 4\n\nSome step.\n---\nMore text.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(loneDivider),
            '---\nservings: 4\n---\nSome step.\n---\nMore text.\n');
    });

    it('leaves >> [key] config directives (parser modes, e.g. cooklang-rs MODES) out of frontmatter, unchanged in the body', () => {
        const withConfig = '>> servings: 4\n>> [mode]: ingredients\n\nBoil @pasta{400%g}.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(withConfig),
            '---\nservings: 4\n---\n>> [mode]: ingredients\n\nBoil @pasta{400%g}.\n');
    });

    it('leaves content unchanged when only >> [key] config directives are present (nothing to convert)', () => {
        const onlyConfig = '>> [mode]: ingredients\n\nBoil @pasta{400%g}.\n';
        assert.strictEqual(legacyMetadataToFrontmatter(onlyConfig), onlyConfig);
    });
});

describe('yamlScalar', () => {
    it('quotes only when needed', () => {
        assert.strictEqual(yamlScalar('4'), '4');
        assert.strictEqual(yamlScalar('Pasta Bake'), 'Pasta Bake');
        assert.strictEqual(yamlScalar('Crème brûlée'), 'Crème brûlée');
        assert.strictEqual(yamlScalar('yes'), '"yes"');
        assert.strictEqual(yamlScalar('a: b'), '"a: b"');
        assert.strictEqual(yamlScalar('#tag'), '"#tag"');
        assert.strictEqual(yamlScalar(''), '""');
    });
});

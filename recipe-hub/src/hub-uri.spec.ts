import * as assert from 'assert';
import { fileNameForTitle, isDirectoryPath, outletContextUri, parseRecipePath, recipePath, titleFromFileName } from './hub-uri';

describe('hub URIs', () => {
    it('fileNameForTitle makes a safe .cook file name', () => {
        assert.strictEqual(fileNameForTitle('Pasta: Bake / Mom\'s?', 7), 'Pasta Bake Mom\'s.cook');
        assert.strictEqual(fileNameForTitle('  ...  ', 7), 'Recipe 7.cook');
        assert.strictEqual(fileNameForTitle('a'.repeat(150), 7), `${'a'.repeat(100)}.cook`);
    });

    it('recipePath and parseRecipePath round-trip', () => {
        assert.strictEqual(recipePath(7, 'Pasta Bake'), '/recipes/7/Pasta Bake.cook');
        assert.deepStrictEqual(parseRecipePath('/recipes/7/Pasta Bake.cook'), { id: 7, fileName: 'Pasta Bake.cook' });
    });

    it('parseRecipePath rejects anything that is not a recipe file', () => {
        for (const path of ['/recipes/7', '/recipes/x/a.cook', '/recipes/0/a.cook', '/other/7/a.cook', '/recipes/7/a/b.cook',
            '/recipes/7/notes.txt', '/recipes/7/..', '/recipes/7/.']) {
            assert.strictEqual(parseRecipePath(path), undefined, path);
        }
    });

    it('parseRecipePath accepts a case-insensitive .cook extension', () => {
        assert.deepStrictEqual(parseRecipePath('/recipes/7/Soup.COOK'), { id: 7, fileName: 'Soup.COOK' });
    });

    it('isDirectoryPath covers the root, /recipes and /recipes/<id>', () => {
        for (const path of ['/', '/recipes', '/recipes/', '/recipes/7']) {
            assert.strictEqual(isDirectoryPath(path), true, path);
        }
        for (const path of ['/recipes/7/a.cook', '/x']) {
            assert.strictEqual(isDirectoryPath(path), false, path);
        }
    });

    it('titleFromFileName drops the extension', () => {
        assert.strictEqual(titleFromFileName('Pasta Bake.cook'), 'Pasta Bake');
        assert.strictEqual(titleFromFileName('Soup.COOK'), 'Soup');
    });

    it('outletContextUri reads the uri of a Cooklang outlet context', () => {
        assert.strictEqual(outletContextUri({ version: 1, uri: 'cooklang-hub:/recipes/7/A.cook', path: '', scale: 1 }), 'cooklang-hub:/recipes/7/A.cook');
        for (const bad of [undefined, null, {}, 'cooklang-hub:/recipes/7/A.cook', { uri: 5 }]) {
            assert.strictEqual(outletContextUri(bad), undefined, JSON.stringify(bad));
        }
    });
});

import * as assert from 'assert';
import { effectiveServerUrl, httpUrl, imageSources, isDisplayableImageUrl, originalRecipeUrl, serverOrigin, trimServerUrl } from './hub-urls';

describe('hub URLs', () => {
    it('trimServerUrl drops whitespace and trailing slashes', () => {
        assert.strictEqual(trimServerUrl(' https://hub.example// '), 'https://hub.example');
    });

    it('httpUrl accepts only http(s) URLs', () => {
        assert.strictEqual(httpUrl('https://blog.example/pasta'), 'https://blog.example/pasta');
        assert.strictEqual(httpUrl(' http://localhost:8080/x '), 'http://localhost:8080/x');
        assert.strictEqual(httpUrl('javascript:alert(1)'), undefined);
        assert.strictEqual(httpUrl('not a url'), undefined);
        assert.strictEqual(httpUrl(undefined), undefined);
    });

    it('serverOrigin is the origin of an http(s) server URL', () => {
        assert.strictEqual(serverOrigin('http://localhost:8080/'), 'http://localhost:8080');
        assert.strictEqual(serverOrigin('https://recipes.cooklang.org'), 'https://recipes.cooklang.org');
        assert.strictEqual(serverOrigin('ftp://hub.example'), undefined);
    });

    it('effectiveServerUrl keeps a trimmed http(s) URL and falls back otherwise', () => {
        const fallback = 'https://recipes.cooklang.org';
        assert.strictEqual(effectiveServerUrl(' http://localhost:8080/ ', fallback), 'http://localhost:8080');
        assert.strictEqual(effectiveServerUrl('https://hub.example/base/', fallback), 'https://hub.example/base');
        assert.strictEqual(effectiveServerUrl('file:///etc', fallback), fallback);
        assert.strictEqual(effectiveServerUrl('javascript:alert(1)', fallback), fallback);
        assert.strictEqual(effectiveServerUrl('not a url', fallback), fallback);
        assert.strictEqual(effectiveServerUrl('   ', fallback), fallback);
        assert.strictEqual(effectiveServerUrl(undefined, fallback), fallback);
    });

    it('imageSources adds the server origin only for plain http', () => {
        assert.strictEqual(imageSources('https://recipes.cooklang.org'), 'https:');
        assert.strictEqual(imageSources('http://localhost:8080/'), 'https: http://localhost:8080');
        assert.strictEqual(imageSources('file:///etc'), 'https:');
    });

    it('originalRecipeUrl prefers the source and falls back to the Recipe Hub page', () => {
        assert.strictEqual(originalRecipeUrl('https://blog.example/pasta', 'https://hub.example/', 7), 'https://blog.example/pasta');
        assert.strictEqual(originalRecipeUrl(undefined, 'https://hub.example/', 7), 'https://hub.example/recipes/7');
        assert.strictEqual(originalRecipeUrl('javascript:x', 'https://hub.example', 7), 'https://hub.example/recipes/7');
    });

    it('isDisplayableImageUrl allows https images and images from the server', () => {
        assert.strictEqual(isDisplayableImageUrl('https://img.example/a.jpg', ''), true);
        assert.strictEqual(isDisplayableImageUrl('http://localhost:8765/a.jpg', 'http://localhost:8765'), true);
        assert.strictEqual(isDisplayableImageUrl('http://img.example/a.jpg', 'http://localhost:8765'), false);
        assert.strictEqual(isDisplayableImageUrl('data:image/png;base64,AAAA', ''), false);
    });
});

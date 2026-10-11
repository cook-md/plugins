import * as assert from 'assert';
import { ImageFiles, ImageInliner, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_CHARS, lookupStepImage, mimeType, toDataUri } from './images';

function files(contents: Record<string, Uint8Array>): ImageFiles & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        size: async uri => contents[uri]?.length,
        read: async uri => {
            reads.push(uri);
            const bytes = contents[uri];
            if (!bytes) {
                throw new Error('missing');
            }
            return bytes;
        },
    };
}

describe('mimeType', () => {
    it('maps the preview extensions, case-insensitively', () => {
        assert.strictEqual(mimeType('file:///b/Pancakes.JPG'), 'image/jpeg');
        assert.strictEqual(mimeType('file:///b/a.webp?x=1'), 'image/webp');
        assert.strictEqual(mimeType('file:///b/a.gif'), undefined);
        assert.strictEqual(mimeType('file:///b.d/noext'), undefined);
    });
});

describe('toDataUri', () => {
    it('base64-encodes the bytes', () => {
        assert.strictEqual(toDataUri(new Uint8Array([1, 2, 3]), 'image/png'), 'data:image/png;base64,AQID');
    });
});

describe('lookupStepImage', () => {
    it('prefers the section image and falls back to the linear one', () => {
        const images = { steps: { 0: { 0: 'a', 3: 'linear' }, 1: { 0: 'section' } } };
        assert.strictEqual(lookupStepImage(images, 1, 0, 3), 'section');
        assert.strictEqual(lookupStepImage(images, 1, 1, 3), 'linear');
        assert.strictEqual(lookupStepImage(images, 0, 0, 0), 'a');
        assert.strictEqual(lookupStepImage(images, 2, 0, 9), undefined);
    });
});

describe('ImageInliner', () => {
    it('inlines files, keeps http(s) URLs and reads each file once', async () => {
        const fs = files({ 'file:///b/a.png': new Uint8Array([1, 2, 3]) });
        const inliner = new ImageInliner(fs);
        assert.strictEqual(await inliner.inline('file:///b/a.png'), 'data:image/png;base64,AQID');
        assert.strictEqual(await inliner.inline('file:///b/a.png'), 'data:image/png;base64,AQID');
        assert.strictEqual(await inliner.inline('https://x.org/a.jpg'), 'https://x.org/a.jpg');
        assert.deepStrictEqual(fs.reads, ['file:///b/a.png']);
    });

    it('skips unknown types, unreadable files, oversized files and files past the budget', async () => {
        const fs = files({ 'file:///b/big.jpg': new Uint8Array(11), 'file:///b/a.jpg': new Uint8Array(3), 'file:///b/c.jpg': new Uint8Array(3), 'file:///b/x.gif': new Uint8Array(1) });
        const inliner = new ImageInliner(fs, 10, 30);
        assert.strictEqual(await inliner.inline('file:///b/x.gif'), undefined);
        assert.strictEqual(await inliner.inline('file:///b/missing.jpg'), undefined);
        assert.strictEqual(await inliner.inline('javascript:alert(1).png'), undefined);
        assert.strictEqual(await inliner.inline('relative/a.jpg'), undefined);
        assert.strictEqual(await inliner.inline('file:///b/big.jpg'), undefined);
        assert.ok((await inliner.inline('file:///b/a.jpg'))?.startsWith('data:image/jpeg;base64,'));
        assert.strictEqual(await inliner.inline('file:///b/c.jpg'), undefined);
        assert.strictEqual(inliner.skipped, 2);
    });

    it('never exceeds the budget with concurrent loads and releases a reservation when the read fails', async () => {
        const bytes = new Uint8Array(30);
        const contents: Record<string, Uint8Array> = {};
        for (let n = 0; n < 6; n++) {
            contents[`file:///b/${n}.jpg`] = bytes;
        }
        const slow: ImageFiles = {
            size: async uri => contents[uri]?.length,
            read: async uri => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return contents[uri];
            },
        };
        // One 30-byte image is 40 base64 characters plus the 23-character data: prefix.
        const one = toDataUri(bytes, 'image/jpeg').length;
        const inliner = new ImageInliner(slow, 1000, one * 2 + 5);
        const results = await Promise.all(Object.keys(contents).map(uri => inliner.inline(uri)));
        assert.strictEqual(results.filter(result => result !== undefined).length, 2);
        assert.strictEqual(inliner.skipped, 4);

        const failing: ImageFiles = {
            size: async () => 30,
            read: async uri => {
                if (uri.endsWith('bad.jpg')) {
                    throw new Error('boom');
                }
                return bytes;
            },
        };
        const retry = new ImageInliner(failing, 1000, one + 5);
        assert.strictEqual(await retry.inline('file:///b/bad.jpg'), undefined);
        assert.ok(await retry.inline('file:///b/good.jpg'));
    });

    it('charges the budget for every use of a shared photo but reads it once', async () => {
        const fs = files({ 'file:///b/shared.jpg': new Uint8Array(30) });
        const one = toDataUri(new Uint8Array(30), 'image/jpeg').length;
        const inliner = new ImageInliner(fs, 1000, one * 3 + 1);
        const results = await Promise.all([1, 2, 3, 4, 5].map(() => inliner.inline('file:///b/shared.jpg')));
        assert.strictEqual(results.filter(result => result !== undefined).length, 3);
        assert.strictEqual(inliner.skipped, 2);
        assert.deepStrictEqual(fs.reads, ['file:///b/shared.jpg']);
        assert.strictEqual(await inliner.inline('file:///b/shared.jpg'), undefined);
        assert.strictEqual(inliner.skipped, 3);
    });

    it('drops a file that turns out bigger than the cap after the read, and clears its cache', async () => {
        const grown: ImageFiles = { size: async () => 3, read: async () => new Uint8Array(20) };
        const inliner = new ImageInliner(grown, 10, 1000);
        assert.strictEqual(await inliner.inline('file:///b/a.jpg'), undefined);
        assert.strictEqual(inliner.skipped, 1);
        const fs = files({ 'file:///b/a.png': new Uint8Array([1]) });
        const again = new ImageInliner(fs);
        await again.inline('file:///b/a.png');
        again.clear();
        await again.inline('file:///b/a.png');
        assert.strictEqual(fs.reads.length, 2);
    });

    it('keeps the whole book under 50 MiB of images', () => {
        assert.strictEqual(MAX_TOTAL_IMAGE_CHARS, 50 * 1024 * 1024);
        assert.strictEqual(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
    });

    it('inlines a whole RecipeImages result and drops what it cannot inline', async () => {
        const fs = files({ 'file:///b/t.jpg': new Uint8Array([0]), 'file:///b/t.0.jpg': new Uint8Array([1]) });
        const inliner = new ImageInliner(fs);
        assert.deepStrictEqual(await inliner.inlineAll({ title: 'file:///b/t.jpg', steps: { 0: { 0: 'file:///b/t.0.jpg', 1: 'file:///b/gone.jpg' } } }), {
            title: 'data:image/jpeg;base64,AA==',
            steps: { 0: { 0: 'data:image/jpeg;base64,AQ==' } },
        });
    });
});

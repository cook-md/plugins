import * as assert from 'assert';
import { parseServings } from './servings';

describe('parseServings', () => {
    it('reads the leading integer of servings: in the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: Pancakes\nservings: 4\n---\nMix @eggs{2}.'), 4);
        assert.strictEqual(parseServings('---\nservings: 6 people\n---\n'), 6);
        assert.strictEqual(parseServings('---\r\nServings:   2\r\n---\r\n'), 2);
    });

    it('returns undefined without a frontmatter block or a numeric servings', () => {
        assert.strictEqual(parseServings('Mix @eggs{2}.'), undefined);
        assert.strictEqual(parseServings('---\nservings: a few\n---\n'), undefined);
        assert.strictEqual(parseServings('---\nservings: 0\n---\n'), undefined);
        assert.strictEqual(parseServings(''), undefined);
    });

    it('skips a leading BOM and stops at the first servings key', () => {
        assert.strictEqual(parseServings('\uFEFF---\nservings: 3\n---\n'), 3);
        assert.strictEqual(parseServings('---\nservings: 0\nserves: 4\n---\n'), undefined);
    });

    it('ignores a servings line outside the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: x\n---\nservings: 4\n'), undefined);
        assert.strictEqual(parseServings('intro\n---\nservings: 4\n---\n'), undefined);
    });

    it('accepts the serves and yield aliases and a quoted number', () => {
        assert.strictEqual(parseServings('---\nserves: 4\n---\n'), 4);
        assert.strictEqual(parseServings('---\nyield: 6 portions\n---\n'), 6);
        assert.strictEqual(parseServings('---\nservings: "4"\n---\n'), 4);
        assert.strictEqual(parseServings('---\nservings: \'2\'\n---\n'), 2);
    });

    it('needs a closed frontmatter block', () => {
        assert.strictEqual(parseServings('---\ntitle: x\nservings: 4\n'), undefined);
    });

    it('treats values above the bound as unknown', () => {
        assert.strictEqual(parseServings('---\nservings: 99999\n---\n'), undefined);
        assert.strictEqual(parseServings('---\nservings: 1000\n---\n'), 1000);
    });
});

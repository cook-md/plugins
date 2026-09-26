import * as assert from 'assert';
import { matchCustomWords, matchesWord } from './custom-match';

describe('matchesWord', () => {
    const cases: Array<[string, string, boolean]> = [
        ['nut', 'nuts', true],
        ['nut', 'walnuts', false],
        ['nuts', 'nut', true],
        ['pea', 'peanut butter', false],
        ['pea', 'frozen peas', true],
        ['tomato', 'tomatoes', true],
        ['tomatoes', 'cherry tomato', true],
        ['cheeses', 'cheese', true],
        ['Coriander', 'fresh coriander leaves', true],
        ['soy sauce', 'dark soy  sauce', true],
        ['c++', 'c++ flour', true],
        ['a.b', 'axb', false],
        ['crème', 'crème fraîche', true],
        ['egg', 'eggplant', false],
    ];
    for (const [word, name, expected] of cases) {
        it(`${JSON.stringify(word)} ${expected ? 'matches' : 'does not match'} ${JSON.stringify(name)}`, () => {
            assert.strictEqual(matchesWord(word, name), expected);
        });
    }
});

describe('matchCustomWords', () => {
    it('groups matching ingredient names per word, in word order, deduplicated', () => {
        const matches = matchCustomWords(['kiwi', 'coriander', 'mango'], ['coriander', 'Kiwis', 'coriander', 'lime']);
        assert.deepStrictEqual(matches, [
            { word: 'kiwi', ingredients: ['Kiwis'] },
            { word: 'coriander', ingredients: ['coriander'] },
        ]);
    });
});

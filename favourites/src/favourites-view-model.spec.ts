import * as assert from 'assert';
import { describeFavourite, favouriteEntries } from './favourites-view-model';

describe('favourites view model', () => {
    it('describes a favourite by recipe name and folder', () => {
        assert.deepStrictEqual(describeFavourite('Breakfast/Pancakes.cook'), { path: 'Breakfast/Pancakes.cook', name: 'Pancakes', folder: 'Breakfast' });
        assert.deepStrictEqual(describeFavourite('Soup.COOK'), { path: 'Soup.COOK', name: 'Soup', folder: '' });
    });

    it('sorts by name ignoring case, then by path', () => {
        const entries = favouriteEntries(['b/Soup.cook', 'a/soup.cook', 'Apple Pie.cook', 'zucchini.cook', 'Bread.cook']);
        assert.deepStrictEqual(entries.map(entry => entry.path), ['Apple Pie.cook', 'Bread.cook', 'a/soup.cook', 'b/Soup.cook', 'zucchini.cook']);
    });
});

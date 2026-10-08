# Favourites

Mark recipes as favourites in Cook Editor. Ships with Cook Editor.

## What you see

- A heart as the first button in a recipe preview's header: outline when the
  recipe is not a favourite, filled orange when it is. Click to toggle. A
  notification confirms it, with **Undo**.
- **Add to Favourites** / **Remove from Favourites** when you right-click a
  `.cook` file in the Explorer, and **Favourites: Toggle Favourite** in the
  command palette for the recipe you are editing.
- A **Favourites** section in the Explorer sidebar listing your favourites.
  Click one to open its preview; the inline heart removes it. A warning icon
  marks a favourite whose file is missing.

## The `.bookmarks` file

Favourites live in `.bookmarks` at the root of your recipe folder, so other
Cooklang apps and sync can share them:

```
# one recipe per line, relative to this folder
Breakfast/Pancakes.cook
Dinner/Tomato Soup.cook
```

- Paths use `/` and keep the `.cook` extension; blank lines and `#` comments
  are fine, and the plugin preserves them when it edits the file.
- You can edit the file by hand; open previews and the Favourites view update.
- Renaming or deleting a recipe or folder inside Cook Editor updates the file.
  Moves made outside the editor leave an entry with a warning icon; remove it
  from the Favourites view.
- Only the first folder of a multi-folder workspace is used.

## For plugin authors

Shows how a plugin drives per-recipe toolbar state without editor code: it
publishes the favourite list with `setContext` (`cooklang.favourites.paths`,
`cooklang.favourites.uris`), contributes two commands to
`cooklang/recipePreview/toolbar` whose `when` clauses use
`cooklangPreviewPath in …` / `not in …`, and calls
`cooklang.api.refreshBadges` so open previews re-render. Also a tree view in
the `explorer` container and `cooklang.api.openPreview`.

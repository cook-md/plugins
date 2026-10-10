# Pantry Match plugin ("What can I cook?") — design

**Date:** 2026-10-10
**Status:** Approved
**Scope:** New optional, free plugin `cooklang.pantry-match` that ranks the user's recipes by how much of each is already in the pantry, and suggests recipes for pantry items that expire soon. No changes outside this repo.

## Goals

- Answer "what can I cook tonight without shopping?" and "what uses up the spinach before Friday?".
- Make keeping `pantry.conf` current pay off, and lead into the Shopping List plugin for what's missing.
- Free: no nutrition service, works signed out.

## Non-goals

- Quantity matching (having 100 g of a 500 g requirement counts as "have"). v1 is presence only.
- Substitutions ("use yogurt instead of sour cream").
- Writing to the pantry (the Pantry plugin does that).
- Suggesting recipes from outside the workspace (Recipe Hub does that).

## Preferences

| Key | Type | Default |
|---|---|---|
| `pantryMatch.alwaysHave` | string[] | `["salt", "pepper", "black pepper", "water"]` |
| `pantryMatch.expiringWithinDays` | number | `5` |
| `pantryMatch.showBadge` | boolean | `true` |

## Data

- **Pantry:** `config/pantry.conf` (same discovery as Shopping List) read with `workspace.fs` and parsed by `cooklang.api.parsePantry`. An item is **in stock** unless `isOutOfStock`. `expireDate` drives "use it up".
- **Recipes:** every `.cook` file in the workspace (`workspace.findFiles('**/*.cook')` with `node_modules` and `.git` excluded; `Drafts/` is included).
- **Ingredient names per recipe:** `renderReport` with a names-only template (the Allergens `NAMES_TEMPLATE` prelude, plus optional flag): `{ names: [{ name, optional }], refs: [path] }`. Optional ingredients (`@?x`) never count as missing. Recipe references are expanded once with `cooklang.api.resolveRecipeReferences` and their ingredient names merged (cycle-safe, depth 3).
- **Cache:** per file URI keyed by mtime; invalidated by a `FileSystemWatcher` on `**/*.cook` and `config/pantry.conf`. Initial index runs in the background with a progress indicator in the view, batches of 10 concurrent renders.

## Matching

Pure module `match.ts`:

- Normalise both sides: lowercase, trim, collapse whitespace, strip a trailing `s`/`es` (simple plural), drop text after a comma.
- An ingredient is **covered** when its normalised name equals a normalised in-stock pantry item name, or is in `alwaysHave`.
- Coverage = covered required ingredients / required ingredients (alwaysHave ones excluded from both sides so salt doesn't inflate scores).

## UI

**Explorer view "What can I cook"** (tree view, like Favourites):

- Group **Cook now** — recipes with 100 % coverage.
- Group **Missing 1–2** — sorted by missing count, then coverage.
- Group **Use it up** — one child per pantry item expiring within `expiringWithinDays` (or already expired), each listing recipes that use it, best coverage first.
- A recipe row: title, description `9/11`; expand to see missing ingredients as children. Click opens the preview (`cooklang.api.openPreview`).
- Row context action **Add missing to shopping list**: opens the recipe in the Shopping List plugin's flow by running the Shopping List plugin's `shoppingList.addRecipe` with the recipe URI (the whole recipe is added; the list already subtracts the pantry, so only the missing items appear). Hidden when that command isn't registered.
- View title actions: Refresh.
- Empty states: no `pantry.conf` → "Add a pantry to see what you can cook" with a button that runs the Pantry plugin's `pantry.openFile` if installed, else opens the pantry docs.

**Badge** (optional, `cooklang/recipePreview/badge`): pill `Have 9/11`, tone `good` at 100 %, `neutral` otherwise; hover lists missing ingredients.

## Architecture

`cooklang-api.ts`, `pantry-file.ts` (locate + parse), `names-template.ts`, `recipe-index.ts` (cache + watcher, pure core), `match.ts`, `tree.ts` (TreeDataProvider), `badge.ts`, `extension.ts`.

## Error handling

Malformed pantry → view shows the parse error message and a "Open pantry.conf" action. A recipe whose render fails is skipped and listed under a collapsed "Couldn't read" group.

## Testing

Normalisation and plural cases; alwaysHave exclusion; optional ingredients; out-of-stock vs low; expiry grouping (expired, within N days, beyond); reference expansion with a cycle; ranking order.

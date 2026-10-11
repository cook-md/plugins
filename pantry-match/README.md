# Pantry Match

What can I cook tonight without shopping? Pantry Match ranks the recipes in
your folder by how much of each is already in your pantry, and suggests
recipes for the things that expire soon. Free, and works signed out.
Install it from the Extensions view.

## What you see

A **What can I cook** view in the Explorer:

| Group | What's in it |
|---|---|
| **Cook now** | Recipes you have everything for. |
| **Missing 1–2** | Recipes missing one or two ingredients, fewest missing first. Expand a recipe to see what's missing. |
| **Use it up** | Each pantry item that expires within 5 days (or already has), with the recipes that use it, best match first. |
| **Couldn't read** | Recipes that couldn't be read (open them to fix the error). |

Each recipe shows how many ingredients you have, e.g. `9/11`. Click it to
open the preview. Right-click a recipe with missing ingredients and choose
**Add missing to shopping list** (needs the Shopping List plugin). The
whole recipe goes on the list, and the list leaves out what's in your
pantry, so only the missing items show.

Recipe previews also get a `Have 9/11` badge (green when you have
everything). Hover it to see what's missing.

## How matching works

- Your pantry is `config/pantry.conf`, the file the Pantry and Shopping List
  plugins use. No pantry yet? The view offers to set one up.
- An item counts as in stock unless its quantity is zero. Low stock still
  counts.
- Names match ignoring case, extra spaces, simple plurals (`tomatoes` =
  `tomato`) and anything after a comma (`garlic, minced` = `garlic`).
- Optional ingredients (`@?parsley{}`) never count as missing.
- Ingredients of linked recipes (`@./Sauces/Pesto{}`) count too, up to three
  levels deep.
- Quantities aren't compared: 100 g of a 500 g requirement counts as "have".

## Settings

| Setting | Default | |
|---|---|---|
| `pantryMatch.alwaysHave` | `salt`, `pepper`, `black pepper`, `water` | Never listed as missing and left out of the score. |
| `pantryMatch.expiringWithinDays` | `5` | How soon an item must expire to appear under **Use it up**. |
| `pantryMatch.showBadge` | `true` | The `Have 9/11` badge on recipe previews. |

## For plugin authors

This plugin shows:

- an Explorer tree view over the whole workspace (`src/tree.ts`,
  `src/view-model.ts`) with welcome views driven by a context key;
- a names-only report template rendered with `cooklang.api.renderReport`
  (no nutrition call, so it works signed out) and linked recipes expanded
  with `cooklang.api.resolveRecipeReferences` (`src/names-template.ts`,
  `src/references.ts`);
- reading `config/pantry.conf` with `cooklang.api.parsePantry`
  (`src/pantry-file.ts`);
- a `pill` badge on `cooklang/recipePreview/badge` (`src/badge.ts`);
- calling another plugin's command (`shoppingList.addRecipe`), hidden with
  a `when` clause when that plugin isn't installed.

Reference: https://cook.md/help/plugins/api

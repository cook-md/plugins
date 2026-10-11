# Macros

Protein, carbs and fat at a glance in Cook Editor: per serving on recipe previews, per person per day on meal plans.

## What you see

A pill in the preview header: `38P 52C 14F · 520 kcal` means 38 g protein, 52 g carbohydrate and 14 g fat per serving, 520 kcal. Grams are rounded to whole numbers, energy to the nearest 10 kcal. Pills are short, so the energy is dropped from the pill when it does not fit; the hover always shows it.

Hover the pill for protein, carbs, fat, fiber, sugar and saturated fat in grams, protein / carbs / fat as a share of energy, the basis used, how many ingredients matched the nutrition database, and which did not.

- **Recipes** use their `servings:` (or `serves:` / `yield:`) frontmatter. Scaling the preview does not change per-serving figures. Without servings the pill shows the whole recipe and ends with `· whole`.
- **Meal plans** (`.menu`) are divided by the people in the menu's `servings:` frontmatter (default 1) and the days, one per `= Day … =` section (default 1). The pill ends with `/day`. These are the same conventions as Core Vitals.
- `Macros ?` (amber) means the figures would mislead: fewer than 70 % of the ingredients matched the nutrition database, a recipe referenced by the plan was not found, or the nutrition service did not answer. The hover says which.

Macros are not good or bad, so the pill is never coloured by them. For targets and verdicts, use Core Vitals.

Note: in the current Cook Editor a `.menu` file opens with the XML language, so edits to a menu do not refresh the pill until the editor fixes the association. Workaround: add `"files.associations": { "*.menu": "cooklang" }` to your settings.

## Settings

**Settings → Extensions → Macros**:

- **Show Energy**: add kcal to the pill when it fits (default on).
- **Basis**: `serving` (default) or `100g` for recipes. Plans are always per person per day.
- **Show When Locked**: show a greyed `🔒 Macros` pill when your plan doesn't include nutrition data (default on).

## Plans

Needs a Cook Basic or Pro plan (nutrition data comes from the cook.md nutrition service). Figures are estimates from recipe ingredients, not a certified label.

## For plugin authors

Shows one badge command on both badge outlets (`cooklang/recipePreview/badge`, `cooklang/menuPreview/badge`), one Jinja template rendered through `cooklang.api.renderReport` that branches on the engine's `plan` context for menus, and `cooklang.api.refreshBadges` after a settings change.

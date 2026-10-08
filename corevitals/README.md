# Core Vitals

Checks a meal plan or a recipe against daily nutrient targets in Cook Editor.

## What you see

A `Vitals 14/17` pill in the preview header: how many targets the plan meets for the days and people it covers (a recipe is judged per serving against one meal). Green from 90 % of targets met, amber from 60 %, red below. Hover it for what is below target or over a limit.

The heartbeat icon next to the shopping-list cart opens the full report: targets met, energy, the macro split against the recommended ranges, every nutrient as a % of its daily value, energy per day for multi-day plans, and what could not be checked.

`Vitals ?` means the data does not support a verdict: fewer than 70 % of the ingredients matched the nutrition database, a referenced recipe was not found, or nothing could be evaluated. The hover says which.

## Targets

Daily values come from the cook.md nutrition service (**Settings → Extensions → Core Vitals**):

- **Standard**: FDA (default), EU or UK tables.
- **Energy**: override the daily kcal target.
- **Protein / Carbohydrate / Fat %**: fixed shares of energy; leave at 0 for the 10–35 / 45–65 / 20–35 % ranges. If the set percentages add up to more than 100, all three fall back to the ranges.
- **Micronutrients**: nutrient keys checked as minimums (`iron_mg`, `vit_c_mg`, `selenium_ug`…). Energy, the macros, fiber, saturated fat (limit) and sodium (limit) are always checked.
- **Tolerance**: minimums pass at 100 − tolerance %, limits at 100 + tolerance %, energy within ± tolerance %.
- **Meals per day**: a recipe serving is judged against a day divided by this.

Plans use the menu's `servings:` frontmatter as the number of people and count a day per `= Day … =` section. Recipes use their `servings:` (or `serves:` / `yield:`) frontmatter; without one, the whole recipe counts as one serving and the hover says so.

## Plans

Needs a Cook Basic or Pro plan (nutrition data comes from the cook.md nutrition service). Without it a greyed `🔒 Vitals` pill is shown; turn it off with **Show When Locked**.

Daily values are generic adult figures, not personal medical advice.

## For plugin authors

Shows both badge outlets (`cooklang/recipePreview/badge`, `cooklang/menuPreview/badge`), a toolbar command on both preview toolbars, one Jinja template rendered in two modes through `cooklang.api.renderReport` (`tojson` for the badge) and `cooklang.api.openReport` (HTML with inline SVG for the report), and `cooklang.api.refreshBadges` after a settings change.

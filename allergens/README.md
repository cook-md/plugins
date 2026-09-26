# Allergens

Flags the allergens you care about on Cook Editor's recipe preview.

## Setup

Open **Settings → Extensions → Allergens** and:

- tick any of the 14 regulated allergens (gluten, crustaceans, eggs, fish, peanuts, soy, milk, tree nuts, celery, mustard, sesame, sulphites, lupin, molluscs), and/or
- add your own words under **Custom** (for example `coriander`). They match ingredient names on whole words; plurals match both ways.

## What you see

| Badge | Meaning |
|---|---|
| red `⚠ Milk, Tree nuts +1` | at least one of your allergens was found |
| amber `⚠ Check allergens` | nothing found, but something couldn't be checked: ingredients the nutrition service doesn't know yet, linked recipes, or the service couldn't be reached |
| no badge | none of your allergens were found in the ingredients that were checked, and nothing was left unchecked |
| grey `🔒 Allergens` | you ticked standard allergens but your plan doesn't include nutrition data |

Hover the badge to see which ingredients triggered each allergen and which ones couldn't be checked.

Linked recipes (`@./Other recipe{}`) aren't looked into: they always show under "Couldn't check", so open the linked recipe to check it. Custom words still match the linked recipe's name.

If the cook.md nutrition service can't be reached, the standard allergens aren't checked: the badge turns amber (or red, if a custom word matched) and the hover says so.

**This is informational only.** It never says a recipe is allergen-free: ingredient data can be incomplete, and it knows nothing about cross-contamination. Always check product labels.

## Plans

Custom words work for everyone, offline included. The 14 standard allergens come from the cook.md nutrition service and need a Cook Basic or Pro plan. Turn off **Show When Locked** to hide the grey hint.

## For plugin authors

Shows the preview badge outlet (`cooklang/recipePreview/badge`) with a `pill` badge, rendering a report template with `cooklang.api.renderReport` (`aggregate_nutrition(ingredients, "eu")` for per-ingredient allergen data), and `cooklang.api.refreshBadges` after a settings change.

# Diet Badges plugin — design

**Date:** 2026-10-10
**Status:** Approved
**Scope:** New optional plugin `cooklang.diet-badges` that shows which diets a recipe or meal plan fits (Vegan, Vegetarian, Pescatarian, Dairy-free) as pills on the recipe and menu previews. No changes outside this repo.

## Goals

- At a glance, tell whether a recipe or a week's menu is vegan, vegetarian, pescatarian or dairy-free.
- Back up the cook.md `/for/vegan` and `/for/gluten-free` landings without users writing templates.
- **Never claim a diet when something could not be checked.** A green pill means every ingredient was verified; otherwise the pill is amber with a `?`.
- Uses the cook.md nutrition service, so Cook Basic or Pro (plan feature `nutrition_api`), like Nutri-Score and Core Vitals.

## Non-goals

- Gluten-free (that is the Allergens plugin's job; the gluten-free landing links both).
- Keto, paleo, halal, kosher or any diet that needs amounts or provenance rather than ingredient classes.
- Certification or medical claims.
- A free tier: there is no local ingredient dictionary.

## Preferences

Contributed under `dietBadges.*`:

| Key | Type | Default |
|---|---|---|
| `dietBadges.vegan`, `dietBadges.vegetarian`, `dietBadges.pescatarian`, `dietBadges.dairyFree` | boolean | `true` |
| `dietBadges.extraNonVegan` | string[] | `[]` |
| `dietBadges.showWhenLocked` | boolean | `true` |

On any `dietBadges.*` change the plugin calls `cooklang.api.refreshBadges` (missing on old editors: badge updates on next edit).

## Rules

Evaluated per ingredient from one `renderReport` call whose template runs `aggregate_nutrition(ingredients, "eu")` and, for each item, `is_in_category` against the slugs below (tree-aware, so `oily_fish` counts as `fish_and_shellfish`). Same names prelude as Allergens, so recipe references are reported separately and never silently passed.

| Diet | Fails when any ingredient is in |
|---|---|
| Pescatarian | categories `meat`, `poultry`, `animal_fat` |
| Vegetarian | Pescatarian, plus category `fish_and_shellfish`, allergen classes `fish`, `crustaceans`, `molluscs` |
| Vegan | Vegetarian, plus category `dairy_and_egg`, allergen classes `milk`, `eggs`, plus a built-in word list (`honey`, `gelatin`/`gelatine`, `fish sauce`, `anchovy`, `worcestershire`, `ghee`, `whey`, `casein`, `lard`, `suet`) and `dietBadges.extraNonVegan` |
| Dairy-free | categories `milk`, `cheese`, `yogurt`, `butter`, allergen class `milk` |

Word-list matching reuses the Allergens whole-word, plural-tolerant matcher (copied module, not a dependency).

An ingredient is **unknown** when the service returned a placeholder (`nutrition_placeholder` warning), a failure, or no verified allergen block. Linked recipes (`@./Other{}`) are unknown (not expanded), same as Allergens.

## Badge

One pill per outlet call (`kind: 'pill'`), on both `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`:

- Only the **strictest passing** of Vegan → Vegetarian → Pescatarian is shown (enabled ones only), plus `Dairy-free` appended when it passes and Vegan does not (vegan implies it): e.g. `Vegetarian · Dairy-free`.
- Tone `good` when the shown diets pass with zero unknown ingredients.
- Tone `warning` and each label suffixed `?` (`Vegan?`) when no violation was found but at least one ingredient was unknown.
- No pill when every enabled diet fails: a "not vegan" badge on every steak recipe is noise.
- Locked: grey `🔒 Diet` pill (tone `neutral`) when `hasFeature('nutrition_api')` is false, unless `showWhenLocked` is off.

## Hover (markdown)

- Per shown diet: "Vegan: every ingredient checked" or "Vegan? 2 ingredients couldn't be checked: miso paste, ./Sauces/Pesto".
- For the next-stricter diet that failed: "Not vegan: butter (dairy), eggs".
- Footer: "Based on the cook.md nutrition service. Informational only — check labels of packaged products."

## Menus

Same template against the `.menu` URI: `ingredients` there is every ingredient across the plan. A menu is vegan only if every referenced recipe is. Referenced recipes in a menu are resolved by the report engine (unlike `@./` references inside a recipe), so they are checked.

## Architecture

- `cooklang-api.ts` — typed wrapper (`version`, `hasFeature`, `renderReport`, `refreshBadges`).
- `diet-template.ts` — the Jinja template and strict validation of its JSON output.
- `rules.ts` — pure: per-ingredient classification → per-diet verdict (`pass` / `unknown` / `fail` + offending and unknown names).
- `badge.ts` — verdicts + settings → pill text, tone, hover markdown.
- `provider.ts` — outlet command: support check, plan check, render, cache by `uri + document version`.
- `extension.ts` — registration and config-change refresh.

## Error handling

- Service unreachable / `network` / `server` → amber pill `Diet ?` with "Couldn't reach the nutrition service".
- `template` error or malformed output → no pill, `console.warn`.
- Editor without `renderReport` → plugin stays inert.

## Testing

Mocha over fixture `/aggregate` JSON: each diet passing, failing, and unknown; tree-aware category hit; word-list hit; linked recipe → unknown; menu fixture; badge text/tone matrix; locked state.

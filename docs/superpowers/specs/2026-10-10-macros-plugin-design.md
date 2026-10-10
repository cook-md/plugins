# Macros plugin — design

**Date:** 2026-10-10
**Status:** Approved
**Scope:** New optional plugin `cooklang.macros` that shows protein / carbs / fat (and energy) per serving as a pill on the recipe preview and per person per day on the menu preview. No changes outside this repo.

## Goals

- Answer "what's in this plate" in one glance: `38P · 52C · 14F · 520 kcal`.
- Complements Core Vitals (which answers "does this week meet targets") and backs up the `/for/muscle-building` landing.
- Cook Basic or Pro (plan feature `nutrition_api`).

## Non-goals

- Targets, verdicts or colours by goodness (Core Vitals does that).
- Micronutrients.
- Per-ingredient breakdown tables (hover only shows totals).

## Preferences

| Key | Type | Default |
|---|---|---|
| `macros.showEnergy` | boolean | `true` |
| `macros.basis` | `"serving"` \| `"100g"` | `"serving"` |
| `macros.showWhenLocked` | boolean | `true` |

Config change → `cooklang.api.refreshBadges`.

## Numbers

One `renderReport` call: `aggregate_nutrition(ingredients) | tojson`, validated like Nutri-Score's `nutrition-template.ts` (copied, trimmed to totals + item placeholders).

- **Recipe, basis `serving`:** totals ÷ servings. Servings from frontmatter `servings` / `serves` / `yield` via the Core Vitals `parseServings` (copied). The preview `scale` is passed to `renderReport`, and servings are multiplied by the same scale, so per-serving numbers do not change when the user scales.
- **Recipe without servings:** whole-recipe totals; the pill ends with ` · whole recipe` and the hover says "No `servings:` in the frontmatter, so this is the whole recipe".
- **Basis `100g`:** totals × 100 ÷ `totals.mass_g`.
- **Menu:** totals ÷ (people × days). People from the menu's `servings:` frontmatter (default 1), days = count of `= Day … =` sections (default 1). Same conventions as Core Vitals; the pill reads `… /day`.
- Rounding: grams to integers, kcal to nearest 10.

## Badge

`kind: 'pill'`, tone `neutral` (macros aren't good or bad), text `38P · 52C · 14F · 520 kcal` (energy part dropped when `showEnergy` is off).

- **Low confidence:** when fewer than 70 % of ingredients (by count, placeholders and failures counted as unmatched) matched, text `Macros ?`, tone `warning`; hover lists the unmatched ingredients.
- **Locked:** grey `🔒 Macros`.

## Hover

Table of protein / carbs / fat / fiber / sugar / saturated fat in grams and protein-carb-fat as % of energy, the basis used, ingredients matched `n / m`, and the unmatched names. Footer: "Estimated from the cook.md nutrition service."

## Architecture

`cooklang-api.ts`, `nutrition-template.ts`, `servings.ts`, `macros.ts` (pure: aggregate + basis + servings → numbers), `badge.ts` (numbers → pill + hover), `provider.ts` (outlets for recipe and menu, cache), `extension.ts`.

## Error handling

Service errors → `Macros ?` warning pill with the reason in the hover. Template / malformed output → no pill, `console.warn`.

## Testing

Fixture aggregates: per serving, scaled preview, no servings, per-100 g, menu with 2 people × 7 days, confidence below threshold, rounding, locked.

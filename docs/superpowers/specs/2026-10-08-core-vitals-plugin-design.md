# Core Vitals plugin — design

**Date:** 2026-10-08
**Status:** Approved
**Scope:** New optional plugin `cooklang.corevitals` that judges a meal plan (`.menu`) or a single recipe (`.cook`) against daily micro/macro targets. A badge in the preview header gives the verdict, a toolbar icon next to the shopping-list cart opens a full report with charts. Two additive changes in the editor: a badge outlet on the menu preview and a `cooklang.api.openReport` command.

## Goals

- On a meal plan preview, show at a glance how many nutrient targets the plan meets for the people and days it covers, e.g. `Vitals 14/17`.
- On a recipe preview, show the same per serving, judged against one meal's share of a day.
- One click opens a report tab with the full breakdown: targets met, energy, macro split, every nutrient as a % of its daily value, per-day energy for multi-day plans, and what could not be checked.
- Targets are the nutrition service's daily values (FDA, EU or UK), optionally overridden for calories and macro split. No invented composite score: every verdict is a count of named checks the user can read.
- Never pretend precision the data does not have: when too few ingredients matched, or a referenced recipe is missing, the badge says `Vitals ?` and explains.

## Non-goals

- Personalised requirements (age, sex, weight, activity). The standard tables are generic adult values; the overrides exist for people who know their numbers.
- Per-meal timing checks, variety checks (`category_servings`), allergens (separate plugin).
- A free tier: everything needs the `nutrition_api` plan feature (Cook Basic / Pro), like Nutri-Score.
- Editing targets from the report. Settings is the only place.

## Preferences

Contributed under `coreVitals.*` (Settings → Extensions → Core Vitals):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `coreVitals.standard` | enum `fda` / `eu` / `uk` | `fda` | Daily-value table passed to `reference_intake` |
| `coreVitals.energyKcal` | number | `0` | Daily energy target; `0` uses the standard's `kcal` |
| `coreVitals.proteinPercent` | number | `0` | Protein as % of energy; `0` uses the AMDR band 10–35 |
| `coreVitals.carbPercent` | number | `0` | Carbohydrate as % of energy; `0` uses the AMDR band 45–65 |
| `coreVitals.fatPercent` | number | `0` | Fat as % of energy; `0` uses the AMDR band 20–35 |
| `coreVitals.micronutrients` | string[] | `calcium_mg, iron_mg, potassium_mg, magnesium_mg, zinc_mg, vit_a_rae_ug, vit_c_mg, vit_d_ug, vit_b12_ug, folate_ug` | Nutrient keys checked as minimums |
| `coreVitals.tolerancePercent` | number | `20` | Band width around a target (see Checks) |
| `coreVitals.mealsPerDay` | number | `3` | A recipe serving is judged against a day ÷ this |
| `coreVitals.showWhenLocked` | boolean | `true` | Show the greyed locked badge without a plan |

Normalisation (one module, unit-tested): numbers that are not finite or are negative fall back to the default; percent overrides outside 1–100 fall back to `0`; `tolerancePercent` is clamped to 0–100; `mealsPerDay` to 1–10; micronutrient keys are trimmed and lower-cased, must match `^[a-z0-9_]{1,40}$`, duplicates and the always-checked keys (`kcal`, `protein_g`, `carb_g`, `fat_g`, `fiber_g`, `sat_fat_g`, `sodium_mg`) are dropped; at most 30 keys. A key with no daily value in the chosen standard is kept in the list but skipped from the count and listed in the report under "No daily value".

On any `coreVitals.*` change the plugin calls `cooklang.api.refreshBadges`. Settings are embedded in the template (see below), so the editor's render cache misses on its own.

## Checks

The plugin builds a **check spec** from the settings, a plain JSON list the template consumes. Each entry: `key`, `label`, `kind` (`energy` / `macroPercent` / `min` / `max`), and for `macroPercent` either a fixed `target` or a `band` `[lo, hi]`. The fixed list, in display order:

| Key | Label | Kind | Target |
|---|---|---|---|
| `kcal` | Energy | energy | override or `reference_intake("kcal")` |
| `protein_g` | Protein | macroPercent | override or AMDR 10–35 % of energy |
| `carb_g` | Carbohydrate | macroPercent | override or AMDR 45–65 % |
| `fat_g` | Fat | macroPercent | override or AMDR 20–35 % |
| `fiber_g` | Fiber | min | `reference_intake("fiber_g")` |
| `sat_fat_g` | Saturated fat | max | `reference_intake("sat_fat_g")` |
| `sodium_mg` | Sodium | max | `reference_intake("sodium_mg")` |
| each micronutrient | key prettified (`vit_b12_ug` → "Vitamin B12", `calcium_mg` → "Calcium") | min | `reference_intake(key)` |

Labels for the macros, fiber, saturated fat, sodium and the default micros are a fixed table in the plugin; any other key is prettified mechanically (strip the unit suffix, `vit_` → "Vitamin ", underscores to spaces, capitalise).

**Period.** The template renders at scale 1 always (per-person results do not depend on the preview scale):

- `.menu`: `days = max(1, plan.days | length)`, `people = plan.servings` when numeric and ≥ 1, else 1. Target for a `min`/`max`/`energy` check = daily value × days; actual = `aggregate_nutrition(plan.all_ingredients)` totals ÷ people. When `plan` is undefined (editor built without the nutrition feature) the template emits `{"error": "no plan"}` and the badge is `Vitals ?`.
- `.cook`: `people = servings` (see Servings below). Target = daily value ÷ `mealsPerDay` (one meal); actual = recipe totals ÷ servings.

**Met.** With `tol = tolerancePercent`:

- `energy`: `percent` within `[100 − tol, 100 + tol]`.
- `macroPercent`: share of energy = `protein_g × 4`, `carb_g × 4`, `fat_g × 9` over the sum of those three (not the service's `kcal`, so the three shares add to 100). Met when inside the AMDR band, or within `[target − tol/2, target + tol/2]` percentage points of a fixed override (so the default 20 gives ± 10 points).
- `min`: `percent ≥ 100 − tol`.
- `max`: `percent ≤ 100 + tol`.

`percent` is `actual / target × 100`, rounded to the nearest integer for display. A check whose daily value is undefined (`reference_intake` returns undefined, or `kcal` is undefined for the standard and no override is set) is reported with `skipped: true` and excluded from the counts.

**Reliability.** From the aggregate totals: `matched = included_count − placeholders`, `total = included_count + failed_count`, where placeholders are items carrying a `nutrition_placeholder` warning (same rule as Nutri-Score). The verdict is withheld — `Vitals ?` — when `total` is 0, when `matched / total < 0.7`, or when `plan.missing_recipes` is non-empty. Confidence label (High / Medium / Low) reuses Nutri-Score's mass-weighted rule.

**Servings for recipes.** The plugin reads the document text (`workspace.openTextDocument(uri)`), takes the YAML frontmatter block between the opening `---` lines, and parses the leading integer of `servings:` (`servings: 4`, `servings: 4 people`). Missing or non-numeric → 1 and the hover says "whole recipe (no servings in frontmatter)". The number is passed into the template as part of the spec.

## Template

One Jinja template string, built in TypeScript from the check spec, rendered through `cooklang.api.renderReport` in `json` mode for the badge and handed to `cooklang.api.openReport` in `html` mode for the report. The first line sets `mode`; the rest is identical, so the two views can never disagree.

```jinja
{%- set mode = "json" -%}
{%- set spec = {"standard": "fda", "tol": 20, "mealsPerDay": 3, "servings": 4, "checks": [...]} -%}
{%- set is_plan = plan is defined -%}
{%- set ings = plan.all_ingredients if is_plan else ingredients -%}
{%- set agg = aggregate_nutrition(ings) -%}
… compute period, actuals, one `row` per check with key, label, kind, actual, target, unit, percent, ok, skipped …
{%- if mode == "json" -%}
{{ {"kind": "plan" | "recipe", "period": {...}, "standard": ..., "rows": rows, "matched": ..., "total": ..., "unmatched": [...], "missingRecipes": [...], "confidence": agg.totals.confidence_weighted, "days": [...]} | tojson }}
{%- else -%}
<style>…</style><section class="vitals">… HTML report …</section>
{%- endif -%}
```

`spec` is embedded as JSON (`JSON.stringify`), so a settings change changes the template text and misses the editor's render cache. The template must stay well under the 64 K limit; the HTML branch is the bulk and is budgeted at ≤ 20 K.

Per-day rows (plans only) come from `macros(day.ingredients)` for each `plan.days` entry: `date`, `name`, `kcal`, `protein_g`, `carb_g`, `fat_g`, each ÷ people.

`agg["items"]` is accessed with brackets (minijinja resolves `.items` to the dict method).

### JSON output validation (plugin side)

Rejects (→ `Vitals ?`, logged once as `output`) unless: `rows` is an array whose entries have string `key`/`label`, finite `percent` (or `skipped: true`), boolean `ok`; `matched`/`total` finite non-negative integers; `unmatched` an array of strings; `missingRecipes` an array of `{ name }`. Extra fields are ignored. Names are capped at 60 chars and markdown-escaped before display (Nutri-Score's helpers, copied).

## Badge

A `pill` badge, text ≤ 24 UTF-16 units:

| Situation | Badge |
|---|---|
| Verdict available, `met / counted ≥ 0.9` | `good` pill `Vitals 14/17` |
| `≥ 0.6` | `warning` pill |
| below | `bad` pill |
| Withheld (reliability, no plan, zero counted checks, bad output) | `neutral` pill `Vitals ?` |
| Not subscribed (`hasFeature('nutrition_api')` false, or render `unauthenticated` / `forbidden`) | `neutral` pill `🔒 Vitals`, unless `showWhenLocked` is false → no badge |
| Render failed with `network` / `server` / `template` | no badge, logged once per reason |

`counted` = rows not skipped. The provider runs on both outlets (`cooklang/recipePreview/badge` and the new `cooklang/menuPreview/badge`); the context tells it nothing about which, so it decides by `CooklangUri`-style extension check on `context.uri` (`.menu` case-insensitive → plan mode, else recipe mode). The result is cached by the editor; the plugin keeps no cache of its own.

## Hover

Markdown, escaped like Nutri-Score's trust card, kept ≤ 3900 characters (lists capped at 8 entries with "and N more"):

```
**Core Vitals** · 14 of 17 targets met

2 days · 2 people · FDA daily values

Below target: Iron 54 %, Fiber 71 %
Over limit: Sodium 132 %

18 of 20 ingredients matched (High confidence). Open the Core Vitals report for the full breakdown.
```

Recipe variant, second line: `Per serving (4 servings) · one meal = ⅓ of a day · FDA daily values`, or `Whole recipe (no servings in frontmatter) · …`.

Withheld variants replace the first line with `**Core Vitals** · not enough data` and say why: `Only 9 of 20 ingredients matched` / `Missing recipes: Pesto, Rice bowl` / `This plan has no recipes` / `No daily values for the chosen checks`. Over-limit and below-target lines are omitted.

Locked variant: `**Core Vitals** · with Cook Basic and Pro` + the Nutri-Score upgrade sentence and `[See plans](https://cook.md/pricing)`.

Block order: title, period line, below-target, over-limit, (no-daily-value line: `No daily value for: boron_ug`), data line.

## Report

Opened by `cooklang.corevitals.openReport` (title "Core Vitals Report", `media/vitals-light.svg` / `vitals-dark.svg`), contributed to `cooklang/recipePreview/toolbar` and `cooklang/menuPreview/toolbar` at `navigation@20` (right after the shopping-list cart at `@10`), to `editor/title` for `.cook`/`.menu` editors, and to the command palette. Without `cooklang.api.openReport` (older editor) the command shows "needs a newer Cook Editor" as a warning message. Without the plan feature it opens the report anyway: the report tab shows the render error the editor reports for nutrition templates when signed out or unsubscribed.

The command calls `cooklang.api.openReport({ uri, template: <html mode>, label: 'Core Vitals', outputFormat: 'html', scale: 1 })`. Re-running focuses the same tab; the tab re-renders on edits like any report tab, and exports/prints through the existing report toolbar.

HTML content, top to bottom, styled by a `<style>` block scoped under `.corevitals` using `--theia-*` colours (`--theia-charts-green/yellow/red` for status, `--theia-foreground`, `--theia-descriptionForeground`, `--theia-editorWidget-border`). Scripts are never used; DOMPurify strips them anyway. Inline SVG draws every chart:

1. **Header**: plan title (`metadata.title` or the file name), period line (days, people or servings, standard, tolerance).
2. **Summary tiles**: targets met `14 / 17`; energy `3 800 / 4 000 kcal (95 %)`; confidence `High · 18 of 20 matched`. Withheld verdicts show the reason tile instead of the count.
3. **Macro split**: one stacked horizontal bar (protein / carbohydrate / fat share of energy) with the AMDR bands or override targets drawn as bracket markers under it, and the three percentages with ✓ / ✗.
4. **Nutrient table**: one row per check: label, actual with unit, target, a horizontal bar whose width is `min(percent, 150) / 150` of the column, tinted by status, a dashed line at 100 %, and the percent. Limits (`max`) say "limit" instead of "target". Skipped rows show "no daily value" greyed.
5. **Per-day energy** (plans with ≥ 2 days only): grouped column chart, one column per day for kcal per person, with a dashed target line; below it a small table with per-day protein / carb / fat grams.
6. **Could not check**: unmatched ingredients, missing recipes, skipped keys. Always present, even when empty ("Everything was matched").
7. Footer: "Estimates from the cook.md nutrition service; generic adult daily values, not personal medical advice."

## Errors

- `unauthenticated` / `forbidden`: locked badge; the report command still opens the tab (the editor shows the sign-in error there).
- `network` / `server` / `template`: no badge; logged once per reason to the "Core Vitals" output channel. The memory of logged reasons is cleared after any successful badge, as in Nutri-Score.
- Output that fails validation: `Vitals ?`, logged once as `output`.
- Older editor without `cooklang.api.renderReport`: no badge, "needs a newer Cook Editor" logged once, 30 s backoff on the support check (copied `support-check.ts`).
- Older editor without `cooklang.api.openReport`: badge works; the report command warns.

## Changes outside the plugin (editor)

Both additive; `CooklangPluginApi.VERSION` stays 1 and `CooklangOutlets.VERSION` stays 1.

1. **`cooklang/menuPreview/badge` outlet.** `CooklangOutlets.MENU_PREVIEW_BADGE`, same contract as the recipe one (context `PreviewOutletContext`, returns `PreviewBadge`, 10 s timeout, only visible previews). The badge machinery now inside `RecipePreviewWidget` (sequence, 500 ms debounce, stale-while-hidden, hover show/hide bookkeeping) moves to a `PreviewBadgeController` class in `preview-badge-controller.ts` that takes the outlet path, a context supplier, the host node and an `onChange` callback; both preview widgets own one. `MenuView` gains `badges`, `onShowBadgeDetails`, `onHideBadgeDetails` props and renders `PreviewBadgeView`s between the scale input and the action bar, as the recipe header does. Menu badges re-query on menu text change, scale change, subscription change, outlet change and when shown again after being hidden. Existing recipe behaviour and specs stay green.
2. **`cooklang.api.openReport`.** Argument `{ uri, template, label, outputFormat?, scale? }`: `uri` and `template` validated exactly like `renderReport` (absolute URI of a `.cook` or `.menu`, non-empty template ≤ 64 K); `label` a non-empty string ≤ 60 chars without control characters; `outputFormat` one of `markdown` / `html` / `text` (default `markdown`); `scale` a positive number (default 1). Opens a report tab through `ReportPresenter.show` with `templateId: 'inline:plugin:' + label`, `templateLabel: label`, `inlineTemplateContent: template`, `outputFormat`, and `configJson` from `ReportConfigService.buildConfigJson(scale, uri)`. Resolves to `undefined`. Documented in the `Commands` block next to `renderReport`.

## Plugin layout (`corevitals/`)

Mirrors `nutriscore/`: `package.json`, `LICENSE`, `README.md`, `scripts/deploy.js`, `media/vitals-light.svg`, `media/vitals-dark.svg`, and under `src/`:

- `cooklang-api.ts` — typed wrapper (copied; adds `openReport`, `refreshBadges`).
- `support-check.ts` — copied.
- `settings.ts` — read + normalise `coreVitals.*`.
- `nutrient-labels.ts` — label table and key prettifier.
- `check-spec.ts` — settings → check spec.
- `vitals-template.ts` — spec → template text (json / html mode), JSON output validation.
- `servings.ts` — frontmatter servings parser.
- `verdict.ts` — validated output → `{ state, met, counted, below, over, skipped, reliability }`.
- `badge.ts` — verdict → pill text and tone.
- `hover.ts` — verdict → markdown.
- `provider.ts` — the badge command.
- `report-command.ts` — the toolbar command.
- `extension.ts` — wiring; output channel "Core Vitals"; refreshBadges on config change.

Root README gets a table row. Marketplace publishing as for the others.

## Testing

- Unit (mocha, no `vscode`): settings normalisation for every clamp and the key filter; label table and prettifier; check spec for defaults, overrides and standard; template text (mode line, embedded spec, no unescaped user text inside the Jinja source — keys are validated by regex before embedding); JSON output validation incl. malformed rows; verdict thresholds at the 0.9 / 0.6 edges, the 70 % reliability edge, missing recipes, zero counted; pill text for 1–3 digit counts; hover escaping, caps, every variant; servings parser (`4`, `4 people`, missing, frontmatter absent, `servings` outside the frontmatter ignored).
- Fixture: a captured `json`-mode output for the two-day fixture plan run through validation → verdict → badge + hover.
- Editor specs: `PreviewBadgeController` (debounce, stale-while-hidden, sequence guard, hover flag), menu preview renders badges from the new outlet, `openReport` argument validation and that it calls the presenter with the expected options.
- E2E in the Electron app (CDP): open `week.menu` from the cooklang-reports-nutrition fixtures with the recipes beside it; the menu preview shows a `Vitals n/m` pill; the toolbar icon opens a "Core Vitals" tab whose HTML contains the nutrient table and the per-day chart; changing `coreVitals.standard` updates the pill without editing the menu; a recipe preview shows the per-serving pill.

## Known limitations

- Daily values are generic adult figures. The report footer says so.
- Ingredient matching coverage is the nutrition service's (cook-md/db#54); plans with many niche ingredients will often get `Vitals ?` until coverage grows.
- Macro-share checks ignore alcohol (no `alcohol_g` from the service today).

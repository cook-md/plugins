# Allergens plugin — design

**Date:** 2026-09-26
**Status:** Approved
**Scope:** New optional plugin `cooklang.allergens` that flags the allergens a user cares about on the recipe preview. Recipes only. Two small additive changes outside this repo: an optional `standard` argument on `aggregate_nutrition` (cooklang-reports-nutrition 0.1.2) and a `cooklang.api.refreshBadges` command in the editor.

## Goals

- Users pick the allergens they care about in Settings: tick any of the EU-14 regulated classes, and/or list custom words.
- The recipe preview header shows a flag when a tracked allergen is found, and a softer warning when some ingredients could not be checked.
- **Never claim a recipe is allergen-free.** No "safe" badge; the hover always says what could not be checked and that the flag is informational.
- Custom words work for everyone. EU-14 detection uses the cook.md nutrition service and is available on Cook Basic / Pro (plan feature `nutrition_api`), like Nutri-Score.

## Non-goals

- Menus (same as Nutri-Score v1).
- "May contain traces" / cross-contamination.
- Free-from certification.
- Allergen detection for free users beyond custom words (no local EU-14 dictionary).

## Preferences

Contributed under `allergens.*` (Settings → Extensions → Allergens):

| Key | Type | Default |
|---|---|---|
| `allergens.gluten`, `allergens.crustaceans`, `allergens.eggs`, `allergens.fish`, `allergens.peanuts`, `allergens.soybeans`, `allergens.milk`, `allergens.treeNuts`, `allergens.celery`, `allergens.mustard`, `allergens.sesame`, `allergens.sulphites`, `allergens.lupin`, `allergens.molluscs` | boolean | `false` |
| `allergens.custom` | string[] | `[]` |
| `allergens.showWhenLocked` | boolean | `true` |

Booleans, not an enum array: Theia's settings UI renders booleans as checkboxes and string arrays with its add/remove list editor, but falls back to a raw JSON box for an array of enums.

Each boolean maps to a service class slug (`treeNuts` → `tree_nuts`, the rest verbatim) and a display label (Gluten, Crustaceans, Eggs, Fish, Peanuts, Soy, Milk, Tree nuts, Celery, Mustard, Sesame, Sulphites, Lupin, Molluscs). The table lives in one module; order follows the EU-14 list above and is the order labels appear in the pill.

Custom words are kept as typed, with runs of whitespace and control characters folded into one space and the ends trimmed; they are de-duplicated case-insensitively (first spelling wins); blanks and entries longer than 40 characters are dropped.

When nothing is ticked and the custom list is empty, the provider returns `undefined` immediately (no render, no badge).

On any `allergens.*` configuration change the plugin calls `cooklang.api.refreshBadges` so the open preview updates without an edit. If the command is missing (older editor) the badge updates on the next edit.

## Detection

The plugin renders one template through `cooklang.api.renderReport` and parses the `tojson` output.

**Recipe names.** The template emits `names`: the recipe's ingredient names in order, skipping recipe references — the same filter `aggregate_nutrition` applies before sending items — so `names[i]` is the i-th item sent to the service. Leading `?`s (optional ingredients) are stripped when parsing.

**Linked recipes.** The template also emits `refs`: the names of the skipped recipe references (`@./Other recipe{}`). Their contents are never checked — not by the service, not by custom words — so whenever anything is being looked for, every linked recipe is listed as unknown as "`<name>` (linked recipe)". Custom words do match the linked recipe's name.

**Standard classes (EU-14).** Used only when at least one class is ticked **and** `hasFeature('nutrition_api')` is true. The template calls `aggregate_nutrition(ingredients, "eu")` and emits the response. The plugin aligns results back to recipe names: indices listed in `failures[].index` are failures; the remaining indices take `items[]` in order. If `items.length + failures.length !== names.length` (or a failure index is missing/out of range), alignment is abandoned and the service's canonical `items[].ingredient` names are used instead; failures without an `ingredient` name are kept as "ingredient N" (from a valid index) or "an unnamed ingredient". If the fallback has fewer results than recipe names, one extra unknown — "some ingredients (the nutrition service's reply didn't line up)" — stands in for the missing ones.

For each aligned ingredient:
- `allergens.status == "verified"` and `allergens.view == "eu"` → every `contains[]` entry whose `class` is ticked is a **hit** for that class. Hover label is the entry's `label` (so gluten/wheat reads "Wheat", tree_nuts/almond reads "Almonds").
- `allergens.status == "unverified"`, `allergens` missing, or any view other than `eu` (the FDA view would make EU-only classes such as celery look absent) → **unknown**.
- A `contains[]` entry without a string `class` or `label` makes the ingredient **unknown** (its well-formed entries still count as hits). A missing, `null` or non-string `subtype` is simply omitted.
- In `failures[]` (service could not match it) → **unknown**.

`allergen_summary` is not used; per-item data carries everything and keeps recipe names.

**Custom words (everyone).** Word and name are NFC-normalised; a word matches an ingredient name (or a linked recipe's name) when it appears case-insensitively on word boundaries, allowing a trailing `s` or `es` on either side (`nut` matches "nuts", not "walnuts"; `pea` does not match "peanut"; `tomatoes` matches "tomato"). Implemented with an escaped regex, not substring search. Custom matches are hits labelled with the word as the user typed it. Custom words never produce unknowns of their own (linked recipes are unknown regardless).

**Templates.**
- Standard + custom (subscribed): emits `{"names": [...], "refs": [...], "aggregate": aggregate_nutrition(...)}`.
- Custom only, or not subscribed: emits `{"names": [...], "refs": [...]}` only — no nutrition call, works signed-out.

## Badge states

Uses the existing `pill` badge (`text` ≤ 24 UTF-16 units, `tone`, `tooltipMarkdown`). Never hiding an unknown takes precedence over everything else: a failure that leaves something unchecked shows amber, not nothing. Truncation cuts on code points, never splitting a surrogate pair.

| Situation | Badge |
|---|---|
| ≥ 1 hit | `bad` pill: `⚠ ` + hit labels in class order then custom words, joined `, `, truncated to fit 24 chars with ` +N` for the rest (e.g. `⚠ Milk, Tree nuts +1`) |
| No hits, ≥ 1 unknown (incl. linked recipes), or the standard classes went unchecked because the service failed | `warning` pill: `⚠ Check allergens` |
| No hits, no unknowns, nothing unchecked | none |
| Standard classes ticked, not subscribed, no custom hit | `neutral` pill `🔒 Allergens` with the locked tooltip — unless `showWhenLocked` is false, then none |
| Standard classes ticked, not subscribed, custom hit | `bad` pill as above; hover adds the locked line |

"Not subscribed" means `hasFeature('nutrition_api')` is false, or the render failed with reason `unauthenticated` / `forbidden`; in the latter case the plugin re-renders with the custom-only template so custom hits still show.

## Hover

Markdown, same escaping rules as Nutri-Score's trust card (escape markdown specials including `:`, collapse newlines, names capped at 60 chars, lists capped at 8 with "and N more"):

```
**Allergens**

Couldn't check: saffron, flour, Pesto (linked recipe)

- **Milk** — butter, parmesan
- **Wheat** — soy sauce
- **coriander** — coriander leaves

Informational only — always check product labels.
```

Locked variant (standard ticked, not subscribed): a line "Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)".

Service unreachable: a line "The standard allergens couldn't be checked: the cook.md nutrition service was unreachable or returned an error." This also applies when the names-only fallback render fails: the badge keeps the unchecked (amber) or locked state instead of disappearing.

Block order: title, service-unreachable line, `Couldn't check: …`, hit list, locked line, disclaimer. The editor cuts `tooltipMarkdown` at 4000 characters, so the hover is kept ≤ 3900: hit lines are dropped from the end (replaced by `- and N more`) until it fits — what wasn't checked and the disclaimer always survive.

## Errors

- `network` / `server` / `template` failure of the standard render, or standard output that fails validation: logged once per reason to the "Allergens" output channel; the standard classes are treated as **unchecked**. With custom words, the names-only template is rendered and custom matching runs as usual; without, no second render. Badge: red on a custom hit, otherwise amber `⚠ Check allergens`, and the hover says the service couldn't be reached. (This overrides "no badge on errors": an unchecked class must never look like "nothing found".)
- `unauthenticated` / `forbidden`: the locked behaviour above.
- Names-only render failure or output that fails validation (not JSON, `names`/`refs` not string arrays): no badge, logged once. There is nothing to show.
- The "logged once" memory is cleared only after a render path with no failure at all, so a steady fallback (e.g. forbidden → custom words) logs once, not on every preview update.
- Older editor without `cooklang.api.renderReport`: no badge, "needs a newer Cook Editor" logged once; 30 s backoff before retrying the support check, as in Nutri-Score.
- Older editor without `cooklang.api.renderReport`: no badge, "needs a newer Cook Editor" logged once.

## Changes outside the plugin

1. **cooklang-reports-nutrition 0.1.2:** `aggregate_nutrition(ingredients, standard=none)` — optional standard slug forwarded to `Client::aggregate`; empty/none keeps today's behaviour. Test via the existing mock-server tests. Release also ships the already-merged `subscription required:` prefix fix.
2. **Editor:** bump `cooklang-reports-nutrition` to 0.1.2 in `packages/cooklang-native`; add `cooklang.api.refreshBadges` (no args, fires the outlet change event so previews re-query badges; debounced by the existing 500 ms badge schedule). Documented next to the other `cooklang.api.*` commands; additive, so `VERSION` stays 1.

## Plugin layout (`allergens/`)

Mirrors `nutriscore/`: `package.json`, `src/cooklang-api.ts` (copied, plus `refreshBadges`), `allergen-classes.ts` (slug/key/label table), `settings.ts` (read + normalise config), `custom-match.ts`, `allergen-template.ts` (templates + output validation + alignment), `evaluate.ts` (hits/unknowns → badge state), `hover.ts`, `provider.ts`, `support-check.ts` (copied), `extension.ts`, `README.md`, `scripts/deploy.js`. Root README gets a table row.

## Testing

- Unit: class table (14 entries, unique slugs/keys); settings normalisation; custom matcher (boundaries, plurals both ways, casing, regex metacharacters in words, NFC/NFD); alignment incl. references reported as linked recipes, non-EU view, malformed entries, count mismatch fallback and its sentinel; evaluation for every badge-state row; pill truncation at 24 chars; hover escaping and caps; locked paths incl. forbidden → custom-only re-render.
- Fixture: a captured `/aggregate` response (`reference: eu`) run through parse + evaluate.
- E2E in the Electron app (CDP): tick Milk + Tree nuts, add custom `coriander`; a recipe with butter shows the red pill; a recipe with only unverified ingredients shows amber; unticking everything removes the badge without editing the recipe.

## Known limitation

The service has audited roughly the top 500 ingredients; everything else is `unverified` (even plain "flour" today). Expect the amber "Check allergens" pill on many recipes until coverage grows. Noted on cook-md/db#54.

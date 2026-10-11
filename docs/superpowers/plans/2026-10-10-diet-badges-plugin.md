# Diet Badges Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cooklang.diet-badges` plugin that shows which diets a recipe or meal plan fits (Vegan, Vegetarian, Pescatarian, Dairy-free) as one `pill` badge on the recipe and menu previews. Green only when every ingredient was verified, amber with `?` when something couldn't be checked, a grey `🔒 Diet` pill without the `nutrition_api` plan feature.

**Architecture:** One command, `cooklang.dietBadges.provideBadge`, is contributed to both `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`. It renders one Jinja template through `cooklang.api.renderReport`. The template reads `plan.all_ingredients` for menus and `ingredients` for recipes, calls `aggregate_nutrition(ings, "eu")`, and runs `is_in_category` for each item against a fixed slug list. It emits a slim JSON with names, linked recipes, missing menu recipes, per-item allergen blocks, warnings and category hits. Pure modules turn that into per-diet verdicts (`rules.ts`) and then into a pill (`badge.ts`). `provider.ts` handles the support check, plan check, error states and a small badge cache. `extension.ts` wires up VS Code and calls `cooklang.api.refreshBadges` when a `dietBadges.*` setting changes. Nothing changes outside the plugins repo.

**Tech Stack:** TypeScript ~7.0 + mocha 12 (VS Code API ^1.100, same devDependencies as `allergens`), Jinja templates (minijinja) run by the editor's report engine (cooklang-reports-nutrition), `@vscode/vsce` for packaging.

---

**Spec:** `docs/superpowers/specs/2026-10-10-diet-badges-plugin-design.md` (branch `docs/four-plugin-specs`).

**Repo and branch:** `~/Cooklang/plugins`. Execute on a fresh branch `feat/diet-badges` cut from `main`, in its own worktree (superpowers:using-git-worktrees). Do not work on `docs/four-plugin-specs`, because other agents use that checkout. Every command below runs from the repo root of that worktree unless it starts with `cd`.

**Environment notes:**
- Use Node 22 for `npm install` / `npm test` / `npm run package`: prefix commands with `PATH=~/.local/bin:$PATH` (`~/.local/bin/node` is v22.23.2; the system node is v20). Do not install Node.
- Never print the nutrition token (`editor/.env`, `NUTRITION_TOKEN`).
- Never use the deprecated `>>` metadata syntax in any `.cook` / `.menu` test file. Use YAML frontmatter.

## Deviations from spec

These come from reading the real code. Where the spec and the APIs disagree, this plan follows the code.

1. **Menus read `plan.all_ingredients`, not `ingredients`.** In a `.menu` render, `ingredients` holds the menu's own `@./Recipe{}` references (see `editor/packages/cooklang-native/src/lib.rs` ~l.1493: "The menu source still renders as a recipe"). `aggregate_nutrition` skips every `reference` ingredient (`cooklang-reports-nutrition/src/lib.rs` `ingredients_to_items`), so following the spec as written would turn every menu green with zero checked ingredients. The template uses `plan.all_ingredients if plan is defined else ingredients`, the same as Core Vitals. The engine expands nested references there (`plan.rs` `load_recipe_ingredients`). `plan.missing_recipes` (unresolvable refs) is reported as unknown, labelled `"<name> (recipe not found)"`.
2. **Cache key.** `PreviewOutletContext` carries `version, uri, path, scale` and no document version. The provider takes a `documentVersion(uri)` callback; `extension.ts` reads it from `vscode.workspace.textDocuments`. It caches a recipe's badge by `uri + version + settings` only when that document is open. Menus are never cached, because editing a referenced recipe does not bump the menu's version. Two caches already sit underneath. The editor's `PluginReportService` caches successful renders by content (`[uri, text, template, scale]`, cleared on auth/`cooklang.*` changes). The native nutrition client is built `.cached()` process-wide, so `is_in_category` results are memoised per (ingredient, slug).
3. **Pill text limit.** `PreviewBadge.parse` (editor `cooklang-outlet-context.ts`) drops any pill whose text is over 24 UTF-16 units. `Pescatarian? · Dairy-free?` is 26 units and would vanish silently. `pillText` therefore joins labels with ` · ` and, if that is too long, falls back to `·` with no spaces (`Pescatarian?·Dairy-free?` = 24). If even that is too long, it shows only the first label.
4. **`?` is per diet.** Only a label whose own verdict is `unknown` gets `?` (e.g. `Vegetarian · Dairy-free?`). The tone is `warning` if any shown diet is unknown.
5. **Linked-recipe naming.** Unknown linked recipes read `Pesto (linked recipe)`, which is the Allergens wording and what the template's `ing.name` gives. They do not read `./Sauces/Pesto`.
6. **Dairy sub-categories are only queried when `dairy_and_egg` matched.** `is_in_category` is tree-aware: `milk`/`cheese`/`yogurt`/`butter` are children of `dairy_and_egg` (`db` migration 0011), so a child hit implies the parent. Gating on the parent saves four HTTP calls per non-dairy ingredient.
7. **Word list adds `anchovies`.** The copied matcher handles `s`/`es` plurals but not `y → ies`, so `anchovy` alone misses "anchovies".
8. **Hover additions.** There is a `Not dairy-free: …` line when Dairy-free is enabled and fails. When no Vegan/Vegetarian/Pescatarian diet passes, the "Not …" line names the least strict enabled one that failed. The reason in parentheses is left out when the ingredient name already contains it (`eggs`, not `eggs (eggs)`), which matches the spec example `Not vegan: butter (dairy), eggs`.
9. **No pill for an empty recipe/menu** (no ingredients, links or missing recipes). An empty file would otherwise pass every diet.
10. **Renders at scale 1.** Diet verdicts don't depend on scale, so the editor's render cache stays warm across scale changes.
11. **"console.warn" → logged once per reason** to a `Diet Badges` output channel *and* `console.warn`, the same way as Allergens.

---

## File Structure

Created under `diet-badges/`:

| File | Responsibility |
|---|---|
| `package.json` | Manifest: `dietBadges.*` settings, the badge command on both outlets, hidden from the palette; scripts/devDeps as `allergens` |
| `package-lock.json` | Generated by `npm install`; CI runs `npm ci` |
| `tsconfig.json` | Copied from `allergens` |
| `.vscodeignore` | Copied from `allergens` (excludes `src/`, specs, maps, `test-fixtures/`) |
| `LICENSE` | Copied MIT licence |
| `README.md` | User docs: setup, what the badge means, plans, menus, for plugin authors |
| `scripts/deploy.js` | Copies the built plugin to `../../editor/plugins/cooklang.diet-badges` |
| `test-fixtures/diet-output-eu.json` | Template-shaped output built from the captured Allergens `/aggregate` (EU view) response |
| `src/cooklang-api.ts` (+ `.spec.ts`) | Typed `cooklang.api.*` wrapper (copied verbatim from `allergens`) |
| `src/support-check.ts` (+ `.spec.ts`) | Cached "does this editor have `renderReport`" check (copied verbatim) |
| `src/markdown.ts` | Escaping/truncating untrusted names for hover markdown (copied verbatim) |
| `src/custom-match.ts` (+ `.spec.ts`) | Whole-word, plural-tolerant matcher (copied verbatim) |
| `src/settings.ts` (+ `.spec.ts`) | `DietId`, `DIET_IDS`, reading/cleaning `dietBadges.*`, `isInactive` |
| `src/diet-template.ts` (+ `.spec.ts`) | The Jinja template and strict validation/alignment of its JSON output |
| `src/aggregate-fixture.spec.ts` | End-to-end parse → rules → badge over the captured fixture |
| `src/rules.ts` (+ `.spec.ts`) | Pure per-ingredient classification into per-diet verdicts |
| `src/badge.ts` (+ `.spec.ts`) | Verdicts + enabled diets → pill text, tone and hover; locked and unreachable pills |
| `src/provider.ts` (+ `.spec.ts`) | Outlet command logic: context check, plan check, render, errors, cache |
| `src/extension.ts` | Activation, command registration, config-change refresh |

Modified:

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | Add `diet-badges` to the build matrix |
| `README.md` (repo root) | Add a `diet-badges` row to the plugin table |

---

## Task 1: Scaffold the package and copy the shared modules

**Files:**
- Create: `diet-badges/package.json`, `diet-badges/scripts/deploy.js`, `diet-badges/README.md`
- Copy: `diet-badges/tsconfig.json`, `diet-badges/.vscodeignore`, `diet-badges/LICENSE` from `allergens/`
- Copy: `diet-badges/src/{cooklang-api,support-check,custom-match}.ts` + their `.spec.ts`, `diet-badges/src/markdown.ts` from `allergens/src/`
- Generate: `diet-badges/package-lock.json`

- [ ] **Step 1: Create the manifest**

`diet-badges/package.json`:

```json
{
  "name": "diet-badges",
  "displayName": "Diet Badges",
  "description": "Shows which diets a recipe or meal plan fits (vegan, vegetarian, pescatarian, dairy-free) as a badge on previews. Uses the cook.md nutrition service (Cook Basic or Pro).",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "diet-badges" },
  "keywords": ["cooklang", "diet", "vegan", "vegetarian", "nutrition", "recipes", "meal plan"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "cooklang.dietBadges.provideBadge", "title": "Diet Badges", "category": "Diet Badges" }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.dietBadges.provideBadge", "when": "false" }
      ],
      "cooklang/recipePreview/badge": [
        { "command": "cooklang.dietBadges.provideBadge" }
      ],
      "cooklang/menuPreview/badge": [
        { "command": "cooklang.dietBadges.provideBadge" }
      ]
    },
    "configuration": {
      "title": "Diet Badges",
      "properties": {
        "dietBadges.vegan": {
          "type": "boolean", "default": true, "order": 1,
          "description": "Show Vegan when no ingredient is meat, fish, dairy, egg, honey, gelatine or another animal product."
        },
        "dietBadges.vegetarian": {
          "type": "boolean", "default": true, "order": 2,
          "description": "Show Vegetarian when no ingredient is meat, poultry, animal fat, fish or shellfish."
        },
        "dietBadges.pescatarian": {
          "type": "boolean", "default": true, "order": 3,
          "description": "Show Pescatarian when no ingredient is meat, poultry or animal fat."
        },
        "dietBadges.dairyFree": {
          "type": "boolean", "default": true, "order": 4,
          "description": "Show Dairy-free when no ingredient is milk, cheese, yogurt or butter (shown next to Vegetarian or Pescatarian; Vegan already implies it)."
        },
        "dietBadges.extraNonVegan": {
          "type": "array", "items": { "type": "string" }, "default": [], "order": 5,
          "description": "Other words that make a recipe not vegan (e.g. bone broth), matched against ingredient names on whole words. Plurals match both ways."
        },
        "dietBadges.showWhenLocked": {
          "type": "boolean", "default": true, "order": 6,
          "description": "Show a grey 🔒 Diet badge when your plan doesn't include nutrition data."
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -w -p .",
    "test": "tsc -p . && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js",
    "vscode:prepublish": "npm run compile",
    "package": "vsce package --no-dependencies",
    "publish:marketplace": "ovsx publish --packagePath diet-badges-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^22.20.4",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^4.0.0",
    "mocha": "^12.0.2",
    "ovsx": "^1.0.0",
    "typescript": "~7.0.2"
  }
}
```

- [ ] **Step 2: Copy config files and write the deploy script**

```bash
mkdir -p diet-badges/src diet-badges/scripts diet-badges/test-fixtures
cp allergens/tsconfig.json allergens/.vscodeignore allergens/LICENSE diet-badges/
```

`diet-badges/scripts/deploy.js`:

```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.diet-badges');

// Skips test specs and source maps, which the packaged plugin doesn't need.
const skipTestArtifacts = src => !/\.spec\.js$|\.map$/.test(src);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'README.md', 'LICENSE']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: skipTestArtifacts });
}
console.log(`Deployed to ${target}`);
```

`diet-badges/README.md` (Task 10 replaces it with the full user docs):

```markdown
# Diet Badges

Shows which diets a recipe or meal plan fits (Vegan, Vegetarian, Pescatarian, Dairy-free) as a badge on Cook Editor's recipe and menu previews. Uses the cook.md nutrition service, so it needs a Cook Basic or Pro plan.
```

- [ ] **Step 3: Install dev dependencies (creates the lockfile)**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm install`
Expected: `added N packages`, and `diet-badges/package-lock.json` exists.

- [ ] **Step 4: Copy the shared specs first and watch them fail**

```bash
cp allergens/src/cooklang-api.spec.ts allergens/src/support-check.spec.ts allergens/src/custom-match.spec.ts diet-badges/src/
```

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc` with `error TS2307: Cannot find module './cooklang-api'` (also `./support-check`, `./custom-match`).

- [ ] **Step 5: Copy the shared implementations verbatim**

These are plugin-agnostic. The spec says to copy them, not depend on `allergens`.

```bash
cp allergens/src/cooklang-api.ts allergens/src/support-check.ts allergens/src/custom-match.ts allergens/src/markdown.ts diet-badges/src/
grep -n -i "allergen" diet-badges/src/*.ts
```

Expected: the `grep` prints nothing, so none of the copied modules mentions allergens.

- [ ] **Step 6: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS: `CooklangApi.refreshBadges`, `SupportCheck`, `matchesWord`, `matchCustomWords` suites green, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add diet-badges/package.json diet-badges/package-lock.json diet-badges/tsconfig.json diet-badges/.vscodeignore diet-badges/LICENSE diet-badges/README.md diet-badges/scripts/deploy.js diet-badges/src/cooklang-api.ts diet-badges/src/cooklang-api.spec.ts diet-badges/src/support-check.ts diet-badges/src/support-check.spec.ts diet-badges/src/custom-match.ts diet-badges/src/custom-match.spec.ts diet-badges/src/markdown.ts
git commit -m "feat(diet-badges): scaffold the plugin and copy the shared API, support-check, matcher and markdown modules"
```

---

## Task 2: Settings

**Files:**
- Create: `diet-badges/src/settings.ts`, `diet-badges/src/settings.spec.ts`

- [ ] **Step 1: Write the failing test**

`diet-badges/src/settings.spec.ts`:

```ts
import * as assert from 'assert';
import { DIET_IDS, isInactive, readSettings } from './settings';

const reader = (values: Record<string, unknown>) => (key: string): unknown => values[key];

describe('readSettings', () => {
    it('enables every diet and the locked hint by default', () => {
        assert.deepStrictEqual(readSettings(reader({})), {
            diets: { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true },
            extraNonVegan: [],
            showWhenLocked: true,
        });
    });

    it('only an explicit false switches a diet or the locked hint off', () => {
        const settings = readSettings(reader({ vegan: false, dairyFree: false, vegetarian: 'no', showWhenLocked: false }));
        assert.deepStrictEqual(settings.diets, { vegan: false, vegetarian: true, pescatarian: true, dairyFree: false });
        assert.strictEqual(settings.showWhenLocked, false);
    });

    it('cleans extra non-vegan words: control characters and whitespace runs become one space, blanks, over-long, non-string and duplicate entries are dropped', () => {
        const settings = readSettings(reader({ extraNonVegan: ['  Bone\tbroth ', 'bone broth', '', '   ', 42, 'x'.repeat(41), 'carmine', 'a\u0000b'] }));
        assert.deepStrictEqual(settings.extraNonVegan, ['Bone broth', 'carmine', 'a b']);
    });

    it('treats a non-array word list as empty', () => {
        assert.deepStrictEqual(readSettings(reader({ extraNonVegan: 'honey' })).extraNonVegan, []);
    });

    it('lists the diets strictest first, Dairy-free last', () => {
        assert.deepStrictEqual(DIET_IDS, ['vegan', 'vegetarian', 'pescatarian', 'dairyFree']);
    });
});

describe('isInactive', () => {
    it('is true only when every diet is switched off', () => {
        assert.strictEqual(isInactive(readSettings(reader({}))), false);
        assert.strictEqual(isInactive(readSettings(reader({ vegan: false, vegetarian: false, pescatarian: false, dairyFree: false }))), true);
        assert.strictEqual(isInactive(readSettings(reader({ vegan: false, vegetarian: false, pescatarian: false }))), false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc`: `error TS2307: Cannot find module './settings'`.

- [ ] **Step 3: Implement**

`diet-badges/src/settings.ts`:

```ts
/** The diets this plugin checks; the setting name under `dietBadges.` is the same. */
export type DietId = 'vegan' | 'vegetarian' | 'pescatarian' | 'dairyFree';

/** Strictest first; Dairy-free is not on the Vegan → Vegetarian → Pescatarian ladder. */
export const DIET_IDS: readonly DietId[] = ['vegan', 'vegetarian', 'pescatarian', 'dairyFree'];

export const MAX_WORD_LENGTH = 40;

export interface DietSettings {
    diets: Readonly<Record<DietId, boolean>>;
    /** User words that make a recipe not vegan (whitespace/control runs → one space, trimmed), deduplicated case-insensitively. */
    extraNonVegan: readonly string[];
    showWhenLocked: boolean;
}

/** Reads one setting under `dietBadges.`; extension.ts passes `getConfiguration('dietBadges').get`. */
export type ReadSetting = (key: string) => unknown;

function readWords(raw: unknown): string[] {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (typeof entry !== 'string') {
            continue;
        }
        // Control characters (tabs, NULs, C1 controls) would break the hover; fold them into spaces.
        const word = entry.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();
        const folded = word.toLowerCase();
        if (word === '' || word.length > MAX_WORD_LENGTH || seen.has(folded)) {
            continue;
        }
        seen.add(folded);
        words.push(word);
    }
    return words;
}

/** Every diet defaults to on: only an explicit `false` turns one off. */
export function readSettings(read: ReadSetting): DietSettings {
    return {
        diets: {
            vegan: read('vegan') !== false,
            vegetarian: read('vegetarian') !== false,
            pescatarian: read('pescatarian') !== false,
            dairyFree: read('dairyFree') !== false,
        },
        extraNonVegan: readWords(read('extraNonVegan')),
        showWhenLocked: read('showWhenLocked') !== false,
    };
}

/** No diet to check: the provider returns no badge without asking about the plan or rendering. */
export function isInactive(settings: DietSettings): boolean {
    return DIET_IDS.every(id => !settings.diets[id]);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, including `readSettings` (5) and `isInactive` (1).

- [ ] **Step 5: Commit**

```bash
git add diet-badges/src/settings.ts diet-badges/src/settings.spec.ts
git commit -m "feat(diet-badges): read and clean the dietBadges settings"
```

---

## Task 3: Template and output validation

**Files:**
- Create: `diet-badges/src/diet-template.ts`, `diet-badges/src/diet-template.spec.ts`

- [ ] **Step 1: Write the failing test**

`diet-badges/src/diet-template.spec.ts`:

```ts
import * as assert from 'assert';
import { DAIRY_SLUGS, DIET_TEMPLATE, MISALIGNED_NAME, TOP_LEVEL_SLUGS, parseDietOutput } from './diet-template';

const verified = (...classes: string[]) => ({ status: 'verified', view: 'eu', contains: classes.map(c => ({ class: c, label: c })) });
const item = (ingredient: string, extra: Record<string, unknown> = {}) =>
    ({ ingredient, allergens: verified(), warnings: [], categories: [], ...extra });
const raw = (fields: Record<string, unknown>) =>
    JSON.stringify({ names: [], refs: [], missing: [], items: [], failures: [], ...fields });

describe('DIET_TEMPLATE', () => {
    it('reads the expanded plan for menus and the recipe ingredients otherwise, in the EU allergen view', () => {
        assert.ok(DIET_TEMPLATE.includes('{%- set ings = plan.all_ingredients if is_plan else ingredients -%}'));
        assert.ok(DIET_TEMPLATE.includes('aggregate_nutrition(ings, "eu")'));
    });

    it('checks every top-level slug, and the dairy children only under dairy_and_egg', () => {
        assert.ok(DIET_TEMPLATE.includes(JSON.stringify(TOP_LEVEL_SLUGS)));
        assert.ok(DIET_TEMPLATE.includes(JSON.stringify(DAIRY_SLUGS)));
        assert.ok(DIET_TEMPLATE.includes('{%- if "dairy_and_egg" in hit.list -%}'));
        assert.ok(DIET_TEMPLATE.includes('is_in_category(item.ingredient, slug)'));
    });

    it('uses bracket access for the aggregate items (minijinja resolves `.items` to the dict method)', () => {
        assert.ok(DIET_TEMPLATE.includes('agg["items"]'));
        assert.ok(!DIET_TEMPLATE.includes('agg.items'));
    });

    it('emits linked recipes and missing menu recipes', () => {
        assert.ok(DIET_TEMPLATE.includes('"refs": refs.list'));
        assert.ok(DIET_TEMPLATE.includes('plan.missing_recipes'));
        assert.ok(DIET_TEMPLATE.includes('| tojson'));
    });

    it('stays well under the editor\'s 64 KiB template limit', () => {
        assert.ok(DIET_TEMPLATE.length < 4096, String(DIET_TEMPLATE.length));
    });
});

describe('parseDietOutput', () => {
    it('aligns items and failures back to recipe names, stripping `?`', () => {
        const parsed = parseDietOutput(raw({
            names: ['?butter', 'unobtainium', 'tofu '],
            items: [
                item('butter', { allergens: verified('milk'), categories: ['dairy_and_egg', 'butter'] }),
                item('tofu', { allergens: verified('soybeans') }),
            ],
            failures: [{ index: 1, ingredient: 'unobtainium', error: { code: 'ingredient_not_found', message: 'x' } }],
        }));
        assert.deepStrictEqual(parsed, {
            names: ['butter', 'unobtainium', 'tofu'],
            refs: [],
            missing: [],
            ingredients: [
                { name: 'butter', status: 'verified', allergenClasses: ['milk'], categories: ['dairy_and_egg', 'butter'] },
                { name: 'unobtainium', status: 'unknown', allergenClasses: [], categories: [] },
                { name: 'tofu', status: 'verified', allergenClasses: ['soybeans'], categories: [] },
            ],
        });
    });

    it('marks placeholders, unverified, non-EU and missing allergen blocks unknown', () => {
        const parsed = parseDietOutput(raw({
            names: ['a', 'b', 'c', 'd', 'e'],
            items: [
                item('a', { warnings: [{ code: 'nutrition_placeholder', message: 'x' }] }),
                item('b', { warnings: ['nutrition_placeholder'] }),
                item('c', { allergens: { status: 'unverified', view: 'eu', contains: [] } }),
                item('d', { allergens: { status: 'verified', view: 'fda', contains: [] } }),
                item('e', { allergens: null }),
            ],
        }));
        assert.ok(parsed);
        assert.deepStrictEqual(parsed.ingredients.map(i => i.status), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    });

    it('keeps the well-formed classes of a block with a malformed entry, but marks it unknown', () => {
        const parsed = parseDietOutput(raw({
            names: ['butter'],
            items: [item('butter', { allergens: { status: 'verified', view: 'eu', contains: [{ class: 'milk', label: 'Milk' }, { label: 'no class' }] } })],
        }));
        assert.deepStrictEqual(parsed?.ingredients, [{ name: 'butter', status: 'unknown', allergenClasses: ['milk'], categories: [] }]);
    });

    it('drops category slugs it never asked for', () => {
        const parsed = parseDietOutput(raw({ names: ['milk'], items: [item('milk', { categories: ['dairy_and_egg', 'vegetables', 'milk'] })] }));
        assert.deepStrictEqual(parsed?.ingredients[0].categories, ['dairy_and_egg', 'milk']);
    });

    it('reads linked recipes and missing menu recipes', () => {
        const parsed = parseDietOutput(raw({ refs: ['?Pesto '], missing: [' Lasagne'] }));
        assert.deepStrictEqual([parsed?.refs, parsed?.missing], [['Pesto'], ['Lasagne']]);
    });

    it('falls back to service names, plus a stand-in, when items and failures do not line up', () => {
        const parsed = parseDietOutput(raw({ names: ['a', 'b', 'c'], items: [item('A')] }));
        assert.deepStrictEqual(parsed?.ingredients, [
            { name: 'A', status: 'verified', allergenClasses: [], categories: [] },
            { name: MISALIGNED_NAME, status: 'unknown', allergenClasses: [], categories: [] },
        ]);
    });

    it('rejects malformed output', () => {
        for (const output of [
            'not json',
            '[]',
            JSON.stringify({ names: [], refs: [], items: [], failures: [] }),
            raw({ names: [1] }),
            raw({ refs: 'Pesto' }),
            raw({ items: 'x' }),
            raw({ failures: {} }),
            raw({ names: ['x'], items: [{ ingredient: 'x', allergens: verified(), warnings: [] }] }),
            raw({ names: ['x'], items: [{ allergens: verified(), warnings: [], categories: [] }] }),
            raw({ names: ['x'], items: [item('x', { categories: [7] })] }),
        ]) {
            assert.strictEqual(parseDietOutput(output), undefined, output);
        }
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc`: `error TS2307: Cannot find module './diet-template'`.

- [ ] **Step 3: Implement**

`diet-badges/src/diet-template.ts`:

```ts
// The Jinja template this plugin asks the editor's Reports engine to render, and the strict
// validation of what comes back. Output is untrusted: every field is checked.

/**
 * Checked with `is_in_category` for every item the service returned. The check is tree-aware,
 * so `oily_fish` counts as `fish_and_shellfish`. An unknown slug fails the whole render, so these
 * must exist in the service's taxonomy (db migrations 0009_taxonomy and 0011_expand_categories).
 */
export const TOP_LEVEL_SLUGS = ['meat', 'poultry', 'animal_fat', 'fish_and_shellfish', 'dairy_and_egg'] as const;
/** Children of `dairy_and_egg`; only checked when the parent matched (a child implies its parent). */
export const DAIRY_SLUGS = ['milk', 'cheese', 'yogurt', 'butter'] as const;
export type CategorySlug = typeof TOP_LEVEL_SLUGS[number] | typeof DAIRY_SLUGS[number];
const ALL_SLUGS: readonly string[] = [...TOP_LEVEL_SLUGS, ...DAIRY_SLUGS];

/**
 * `ings`: for a `.menu`, the engine's expanded plan (`plan.all_ingredients`, nested references
 * resolved). A menu's own `ingredients` are its `@./Recipe{}` references, which
 * `aggregate_nutrition` skips. For a recipe it is `ingredients`.
 * `names`: ingredient names in the order `aggregate_nutrition` sends them, recipe references
 * skipped, so `names[i]` is the i-th item sent to the service. `refs`: linked recipes inside a
 * recipe (never expanded). `missing`: menu references the engine couldn't resolve.
 * Items are slimmed to what the rules need, plus the categories they matched.
 */
export const DIET_TEMPLATE = [
    '{%- set is_plan = plan is defined -%}',
    '{%- set ings = plan.all_ingredients if is_plan else ingredients -%}',
    '{%- set names = namespace(list=[]) -%}',
    '{%- set refs = namespace(list=[]) -%}',
    '{%- for ing in ings -%}',
    '{%- if ing.reference -%}{%- set refs.list = refs.list + [ing.name | string] -%}',
    '{%- else -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- set agg = aggregate_nutrition(ings, "eu") -%}',
    '{%- set slim = namespace(list=[]) -%}',
    // Bracket access, not `agg.items`: minijinja resolves `.items` on a dict to its `items()` method.
    '{%- for item in agg["items"] -%}',
    '{%- set hit = namespace(list=[]) -%}',
    `{%- for slug in ${JSON.stringify(TOP_LEVEL_SLUGS)} -%}`,
    '{%- if is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- if "dairy_and_egg" in hit.list -%}',
    `{%- for slug in ${JSON.stringify(DAIRY_SLUGS)} -%}`,
    '{%- if is_in_category(item.ingredient, slug) -%}{%- set hit.list = hit.list + [slug] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{%- endif -%}',
    '{%- set slim.list = slim.list + [{"ingredient": item.ingredient, "allergens": item.allergens if item.allergens is defined else none, "warnings": item.warnings if item.warnings is defined else [], "categories": hit.list}] -%}',
    '{%- endfor -%}',
    '{%- set missing = (plan.missing_recipes | map(attribute="name") | list) if is_plan else [] -%}',
    '{{ {"names": names.list, "refs": refs.list, "missing": missing, "items": slim.list, "failures": agg["failures"]} | tojson }}',
].join('\n');

export interface DietIngredient {
    /** Recipe name when alignment worked, otherwise the service's name. */
    name: string;
    /** `unknown`: a placeholder, a failure, or no fully well-formed verified EU allergen block. */
    status: 'verified' | 'unknown';
    /** EU allergen class slugs the service tagged (kept even when the block is unknown). */
    allergenClasses: string[];
    categories: CategorySlug[];
}

export interface DietOutput {
    names: string[];
    /** Linked recipes inside a recipe: never checked. */
    refs: string[];
    /** Menu references the engine couldn't resolve: never checked. */
    missing: string[];
    ingredients: DietIngredient[];
}

/** Stands in for results the service dropped when its reply can't be aligned to the recipe. */
export const MISALIGNED_NAME = "some ingredients (the nutrition service's reply didn't line up)";

const PLACEHOLDER_WARNING_CODE = 'nutrition_placeholder';

interface RawItem {
    ingredient: string;
    allergens: unknown;
    warnings: unknown;
    categories: CategorySlug[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isCategorySlug(value: string): value is CategorySlug {
    return ALL_SLUGS.includes(value);
}

/** Strips every leading `?` (optional-ingredient marker) and surrounding whitespace. */
function cleanName(name: string): string {
    return name.replace(/^\?+/, '').trim();
}

/**
 * The service returns an unresolvable ingredient as a normal item tagged with a
 * `nutrition_placeholder` warning (usually `{ code }`, a bare string is accepted too).
 */
function isPlaceholder(warnings: unknown): boolean {
    return Array.isArray(warnings) && warnings.some(warning =>
        warning === PLACEHOLDER_WARNING_CODE || (isPlainObject(warning) && warning.code === PLACEHOLDER_WARNING_CODE));
}

/**
 * Only a verified block in the EU view counts as checked: in another view EU-only classes
 * would look absent. A malformed entry makes the block unverified, but well-formed entries
 * are kept so a hit (e.g. `milk`) still fails a diet.
 */
function allergenData(block: unknown): { verified: boolean; classes: string[] } {
    if (!isPlainObject(block) || block.status !== 'verified' || block.view !== 'eu' || !Array.isArray(block.contains)) {
        return { verified: false, classes: [] };
    }
    const classes = block.contains
        .map(entry => (isPlainObject(entry) && typeof entry.class === 'string' ? entry.class : undefined))
        .filter((cls): cls is string => cls !== undefined);
    return { verified: classes.length === block.contains.length, classes };
}

function toIngredient(name: string, item: RawItem): DietIngredient {
    const allergens = allergenData(item.allergens);
    const unknown = !allergens.verified || isPlaceholder(item.warnings);
    return { name, status: unknown ? 'unknown' : 'verified', allergenClasses: allergens.classes, categories: item.categories };
}

function unknownIngredient(name: string): DietIngredient {
    return { name, status: 'unknown', allergenClasses: [], categories: [] };
}

function isValidIndex(index: unknown, length: number): index is number {
    return Number.isInteger(index) && (index as number) >= 0 && (index as number) < length;
}

function failureName(failure: Record<string, unknown>, length: number): string {
    if (typeof failure.ingredient === 'string') {
        return cleanName(failure.ingredient);
    }
    return isValidIndex(failure.index, length) ? `ingredient ${failure.index + 1}` : 'an unnamed ingredient';
}

/** Same alignment as Allergens: items fill the non-failed slots in order; otherwise fall back to service names. */
function align(names: string[], items: RawItem[], failures: Record<string, unknown>[]): DietIngredient[] {
    const failedIndices = new Set(failures.map(failure => failure.index).filter(index => isValidIndex(index, names.length)));
    if (items.length + failures.length === names.length && failedIndices.size === failures.length) {
        let next = 0;
        return names.map((name, index) => failedIndices.has(index) ? unknownIngredient(name) : toIngredient(name, items[next++]));
    }
    const fallback = [
        ...items.map(item => toIngredient(item.ingredient, item)),
        ...failures.map(failure => unknownIngredient(failureName(failure, names.length))),
    ];
    if (fallback.length < names.length) {
        fallback.push(unknownIngredient(MISALIGNED_NAME));
    }
    return fallback;
}

/** Undefined when the output is malformed. An item without a string `ingredient` or a string-array `categories` rejects the whole output. */
export function parseDietOutput(output: string): DietOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data) || !isStringArray(data.names) || !isStringArray(data.refs) || !isStringArray(data.missing)
        || !Array.isArray(data.items) || !Array.isArray(data.failures)) {
        return undefined;
    }
    const items: RawItem[] = [];
    for (const item of data.items) {
        if (!isPlainObject(item) || typeof item.ingredient !== 'string' || !isStringArray(item.categories)) {
            return undefined;
        }
        items.push({
            ingredient: cleanName(item.ingredient),
            allergens: item.allergens,
            warnings: item.warnings,
            categories: item.categories.filter(isCategorySlug),
        });
    }
    const names = data.names.map(cleanName);
    return {
        names,
        refs: data.refs.map(cleanName),
        missing: data.missing.map(cleanName),
        ingredients: align(names, items, data.failures.filter(isPlainObject)),
    };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, including `DIET_TEMPLATE` (5) and `parseDietOutput` (7).

- [ ] **Step 5: Commit**

```bash
git add diet-badges/src/diet-template.ts diet-badges/src/diet-template.spec.ts
git commit -m "feat(diet-badges): report template with is_in_category checks and strict output validation"
```

---

## Task 4: Rules (per-ingredient classification → per-diet verdicts)

**Files:**
- Create: `diet-badges/src/rules.ts`, `diet-badges/src/rules.spec.ts`

- [ ] **Step 1: Write the failing test**

`diet-badges/src/rules.spec.ts`:

```ts
import * as assert from 'assert';
import { CategorySlug, DietIngredient, DietOutput } from './diet-template';
import { DietVerdicts, NON_VEGAN_WORDS, evaluateDiets } from './rules';
import { DIET_IDS } from './settings';

const ing = (name: string, options: { categories?: CategorySlug[]; allergens?: string[]; unknown?: boolean } = {}): DietIngredient =>
    ({ name, status: options.unknown ? 'unknown' : 'verified', allergenClasses: options.allergens ?? [], categories: options.categories ?? [] });
const output = (ingredients: DietIngredient[], extra: { refs?: string[]; missing?: string[] } = {}): DietOutput =>
    ({ names: ingredients.map(i => i.name), refs: extra.refs ?? [], missing: extra.missing ?? [], ingredients });
/** Vegan, Vegetarian, Pescatarian, Dairy-free. */
const statuses = (verdicts: DietVerdicts) => DIET_IDS.map(id => verdicts[id].status);

describe('evaluateDiets', () => {
    it('passes every diet when every ingredient is verified and plant-based', () => {
        const verdicts = evaluateDiets(output([ing('tofu', { allergens: ['soybeans'] }), ing('rice')]), []);
        assert.deepStrictEqual(statuses(verdicts), ['pass', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual([verdicts.vegan.violations, verdicts.vegan.unknown], [[], []]);
    });

    it('fails meat, poultry and animal fat for Pescatarian and stricter', () => {
        for (const [ingredient, reason] of [
            [ing('chicken thighs', { categories: ['poultry'] }), 'poultry'],
            [ing('bacon', { categories: ['meat'] }), 'meat'],
            [ing('lard', { categories: ['animal_fat'] }), 'animal fat'],
        ] as const) {
            const verdicts = evaluateDiets(output([ingredient]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'pass'], ingredient.name);
            assert.deepStrictEqual(verdicts.pescatarian.violations, [{ ingredient: ingredient.name, reason }]);
        }
    });

    it('fails fish via the tree-aware category for Vegetarian, not Pescatarian, preferring the allergen reason', () => {
        const verdicts = evaluateDiets(output([ing('salmon', { categories: ['fish_and_shellfish'], allergens: ['fish'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegetarian.violations, [{ ingredient: 'salmon', reason: 'fish' }]);
        const categoryOnly = evaluateDiets(output([ing('cod', { categories: ['fish_and_shellfish'] })]), []);
        assert.deepStrictEqual(categoryOnly.vegetarian.violations, [{ ingredient: 'cod', reason: 'fish or shellfish' }]);
    });

    it('fails crustaceans and molluscs allergen classes for Vegetarian', () => {
        const verdicts = evaluateDiets(output([ing('prawns', { allergens: ['crustaceans'] }), ing('mussels', { allergens: ['molluscs'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'pass', 'pass']);
        assert.deepStrictEqual(verdicts.vegetarian.violations, [
            { ingredient: 'prawns', reason: 'crustaceans' },
            { ingredient: 'mussels', reason: 'molluscs' },
        ]);
    });

    it('fails dairy for Vegan and Dairy-free, eggs for Vegan only', () => {
        const butter = evaluateDiets(output([ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] })]), []);
        assert.deepStrictEqual(statuses(butter), ['fail', 'pass', 'pass', 'fail']);
        assert.deepStrictEqual([butter.vegan.violations, butter.dairyFree.violations], [
            [{ ingredient: 'butter', reason: 'dairy' }],
            [{ ingredient: 'butter', reason: 'dairy' }],
        ]);
        const eggs = evaluateDiets(output([ing('eggs', { allergens: ['eggs'], categories: ['dairy_and_egg'] })]), []);
        assert.deepStrictEqual(statuses(eggs), ['fail', 'pass', 'pass', 'pass']);
        assert.deepStrictEqual(eggs.vegan.violations, [{ ingredient: 'eggs', reason: 'eggs' }]);
    });

    it('fails Dairy-free on a dairy sub-category without the milk allergen class', () => {
        const verdicts = evaluateDiets(output([ing('parmesan', { categories: ['dairy_and_egg', 'cheese'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'parmesan', reason: 'dairy or egg' }]);
        assert.deepStrictEqual(verdicts.dairyFree.violations, [{ ingredient: 'parmesan', reason: 'dairy' }]);
    });

    it('fails Vegan on the built-in word list, plurals included', () => {
        for (const [name, reason] of [['honey', 'honey'], ['gelatine sheets', 'gelatine'], ['anchovies', 'anchovies'], ['Worcestershire sauce', 'worcestershire'], ['whey protein', 'whey']]) {
            const verdicts = evaluateDiets(output([ing(name)]), []);
            assert.deepStrictEqual(statuses(verdicts), ['fail', 'pass', 'pass', 'pass'], name);
            assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: name, reason }], name);
        }
        assert.ok(NON_VEGAN_WORDS.includes('suet'));
    });

    it('fails Vegan on the user\'s extra words', () => {
        const verdicts = evaluateDiets(output([ing('bone broth')]), ['bone broth']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'bone broth', reason: 'bone broth' }]);
    });

    it('is unknown, never pass, when an ingredient couldn\'t be checked', () => {
        const verdicts = evaluateDiets(output([ing('tofu'), ing('miso paste', { unknown: true })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso paste']);
    });

    it('lets a violation win over unknown ingredients, but still lists them', () => {
        const verdicts = evaluateDiets(output([
            ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] }),
            ing('miso paste', { unknown: true }),
        ]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'unknown', 'unknown', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso paste']);
    });

    it('fails an unknown ingredient that still matched a category', () => {
        const verdicts = evaluateDiets(output([ing('mystery chicken', { unknown: true, categories: ['poultry'] })]), []);
        assert.deepStrictEqual(statuses(verdicts), ['fail', 'fail', 'fail', 'unknown']);
        assert.deepStrictEqual(verdicts.dairyFree.unknown, ['mystery chicken']);
    });

    it('reports linked recipes as unknown, unless a non-vegan word matches their name', () => {
        const linked = evaluateDiets(output([ing('rice')], { refs: ['Pesto'] }), []);
        assert.deepStrictEqual(statuses(linked), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(linked.vegan.unknown, ['Pesto (linked recipe)']);
        const honey = evaluateDiets(output([ing('rice')], { refs: ['Honey glaze'] }), []);
        assert.deepStrictEqual(statuses(honey), ['fail', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(honey.vegan.violations, [{ ingredient: 'Honey glaze (linked recipe)', reason: 'honey' }]);
    });

    it('reports missing menu recipes as unknown', () => {
        const verdicts = evaluateDiets(output([ing('rice')], { missing: ['Lasagne'] }), []);
        assert.deepStrictEqual(statuses(verdicts), ['unknown', 'unknown', 'unknown', 'unknown']);
        assert.deepStrictEqual(verdicts.pescatarian.unknown, ['Lasagne (recipe not found)']);
    });

    it('lists an ingredient once even when a menu repeats it', () => {
        const butter = ing('butter', { allergens: ['milk'], categories: ['dairy_and_egg', 'butter'] });
        const miso = ing('miso', { unknown: true });
        const verdicts = evaluateDiets(output([butter, butter, miso, miso]), []);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'butter', reason: 'dairy' }]);
        assert.deepStrictEqual(verdicts.vegan.unknown, ['miso']);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc`: `error TS2307: Cannot find module './rules'`.

- [ ] **Step 3: Implement**

`diet-badges/src/rules.ts`:

```ts
import { matchesWord } from './custom-match';
import { DietIngredient, DietOutput } from './diet-template';
import { DIET_IDS, DietId } from './settings';

export type DietStatus = 'pass' | 'unknown' | 'fail';

export interface Violation {
    /** Recipe ingredient name, or `<name> (linked recipe)`. */
    ingredient: string;
    /** Why it breaks the diet, e.g. `dairy`, `poultry`, `honey`. */
    reason: string;
}

export interface DietVerdict {
    diet: DietId;
    /** `fail`: any violation. `unknown`: none, but something couldn't be checked. `pass`: everything checked, nothing found. */
    status: DietStatus;
    violations: Violation[];
    /** Names that couldn't be checked (unknown ingredients, linked and missing recipes), deduplicated. */
    unknown: string[];
}

export type DietVerdicts = Record<DietId, DietVerdict>;

/** Matched on whole words, plurals tolerated (`custom-match.ts`); `anchovies` is listed because `y → ies` isn't. */
export const NON_VEGAN_WORDS: readonly string[] = [
    'honey', 'gelatin', 'gelatine', 'fish sauce', 'anchovy', 'anchovies', 'worcestershire', 'ghee', 'whey', 'casein', 'lard', 'suet',
];

export interface DietRule {
    /** Allergen class slug → reason. Checked first. */
    allergens: Readonly<Record<string, string>>;
    /** Category slug → reason. */
    categories: Readonly<Record<string, string>>;
    /** Also fail on `NON_VEGAN_WORDS` and `dietBadges.extraNonVegan`. */
    words: boolean;
}

const PESCATARIAN: DietRule = {
    allergens: {},
    categories: { meat: 'meat', poultry: 'poultry', animal_fat: 'animal fat' },
    words: false,
};
const VEGETARIAN: DietRule = {
    allergens: { fish: 'fish', crustaceans: 'crustaceans', molluscs: 'molluscs' },
    categories: { ...PESCATARIAN.categories, fish_and_shellfish: 'fish or shellfish' },
    words: false,
};
const VEGAN: DietRule = {
    allergens: { ...VEGETARIAN.allergens, milk: 'dairy', eggs: 'eggs' },
    categories: { ...VEGETARIAN.categories, dairy_and_egg: 'dairy or egg' },
    words: true,
};
const DAIRY_FREE: DietRule = {
    allergens: { milk: 'dairy' },
    categories: { milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy' },
    words: false,
};

export const DIET_RULES: Readonly<Record<DietId, DietRule>> = {
    vegan: VEGAN, vegetarian: VEGETARIAN, pescatarian: PESCATARIAN, dairyFree: DAIRY_FREE,
};

function matchingWord(rule: DietRule, name: string, words: readonly string[]): string | undefined {
    return rule.words ? words.find(word => matchesWord(word, name)) : undefined;
}

/** The first reason this ingredient breaks the rule: allergen classes, then categories, then words. */
function reasonFor(rule: DietRule, ingredient: DietIngredient, words: readonly string[]): string | undefined {
    for (const [cls, reason] of Object.entries(rule.allergens)) {
        if (ingredient.allergenClasses.includes(cls)) {
            return reason;
        }
    }
    const categories: readonly string[] = ingredient.categories;
    for (const [slug, reason] of Object.entries(rule.categories)) {
        if (categories.includes(slug)) {
            return reason;
        }
    }
    return matchingWord(rule, ingredient.name, words);
}

function evaluateDiet(diet: DietId, output: DietOutput, words: readonly string[]): DietVerdict {
    const rule = DIET_RULES[diet];
    const violations: Violation[] = [];
    const violating = new Set<string>();
    const unknown: string[] = [];
    const addViolation = (ingredient: string, reason: string): void => {
        if (!violating.has(ingredient)) {
            violating.add(ingredient);
            violations.push({ ingredient, reason });
        }
    };
    for (const ingredient of output.ingredients) {
        const reason = reasonFor(rule, ingredient, words);
        if (reason !== undefined) {
            addViolation(ingredient.name, reason);
        } else if (ingredient.status === 'unknown') {
            unknown.push(ingredient.name);
        }
    }
    // Linked recipes are never expanded: only their name can be judged.
    for (const ref of output.refs) {
        const name = `${ref} (linked recipe)`;
        const word = matchingWord(rule, ref, words);
        if (word !== undefined) {
            addViolation(name, word);
        } else {
            unknown.push(name);
        }
    }
    for (const missing of output.missing) {
        unknown.push(`${missing} (recipe not found)`);
    }
    const unchecked = [...new Set(unknown)].filter(name => !violating.has(name));
    const status: DietStatus = violations.length > 0 ? 'fail' : unchecked.length > 0 ? 'unknown' : 'pass';
    return { diet, status, violations, unknown: unchecked };
}

/** One verdict per diet, enabled or not; `badge.ts` decides what to show. */
export function evaluateDiets(output: DietOutput, extraNonVegan: readonly string[]): DietVerdicts {
    const words = [...NON_VEGAN_WORDS, ...extraNonVegan];
    const verdicts = {} as DietVerdicts;
    for (const diet of DIET_IDS) {
        verdicts[diet] = evaluateDiet(diet, output, words);
    }
    return verdicts;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, including `evaluateDiets` (14).

- [ ] **Step 5: Commit**

```bash
git add diet-badges/src/rules.ts diet-badges/src/rules.spec.ts
git commit -m "feat(diet-badges): per-diet verdicts from categories, allergen classes and the non-vegan word list"
```

---

## Task 5: Badge text, tone and hover

**Files:**
- Create: `diet-badges/src/badge.ts`, `diet-badges/src/badge.spec.ts`

- [ ] **Step 1: Write the failing test**

`diet-badges/src/badge.spec.ts`:

```ts
import * as assert from 'assert';
import {
    FOOTER, LOCKED_TEXT, LOCKED_TOOLTIP, MAX_PILL_TEXT, UNREACHABLE_LINE, UNREACHABLE_TEXT,
    dietBadge, lockedBadge, pillText, unreachableBadge,
} from './badge';
import { DietStatus, DietVerdict, DietVerdicts, Violation } from './rules';
import { DietId } from './settings';

const v = (diet: DietId, status: DietStatus, extra: { violations?: Violation[]; unknown?: string[] } = {}): DietVerdict =>
    ({ diet, status, violations: extra.violations ?? [], unknown: extra.unknown ?? [] });
const verdicts = (partial: Partial<DietVerdicts>): DietVerdicts => ({
    vegan: v('vegan', 'pass'), vegetarian: v('vegetarian', 'pass'), pescatarian: v('pescatarian', 'pass'), dairyFree: v('dairyFree', 'pass'),
    ...partial,
});
const ALL_ON = { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true };
const hover = (...lines: string[]) => ['**Diet**', lines.join('\n'), FOOTER].join('\n\n');

describe('dietBadge', () => {
    it('shows only the strictest passing diet: Vegan implies the rest', () => {
        assert.deepStrictEqual(dietBadge(verdicts({}), ALL_ON), {
            kind: 'pill', text: 'Vegan', tone: 'good', tooltipMarkdown: hover('- **Vegan**: every ingredient checked'),
        });
    });

    it('appends Dairy-free when Vegan is not shown, and says why Vegan failed', () => {
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', { violations: [{ ingredient: 'eggs', reason: 'eggs' }] }) }), ALL_ON);
        assert.deepStrictEqual(badge, {
            kind: 'pill', text: 'Vegetarian · Dairy-free', tone: 'good',
            tooltipMarkdown: hover(
                '- **Vegetarian**: every ingredient checked',
                '- **Dairy-free**: every ingredient checked',
                '- Not vegan: eggs',
            ),
        });
    });

    it('names the reason unless the ingredient name already says it, and lists a failed Dairy-free', () => {
        const butter = { violations: [{ ingredient: 'butter', reason: 'dairy' }, { ingredient: 'eggs', reason: 'eggs' }] };
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', butter), dairyFree: v('dairyFree', 'fail', { violations: [{ ingredient: 'butter', reason: 'dairy' }] }) }), ALL_ON);
        assert.strictEqual(badge?.text, 'Vegetarian');
        assert.strictEqual(badge?.tooltipMarkdown, hover(
            '- **Vegetarian**: every ingredient checked',
            '- Not vegan: butter \\(dairy\\), eggs',
            '- Not dairy-free: butter \\(dairy\\)',
        ));
    });

    it('turns amber with `?` when nothing broke the diet but something couldn\'t be checked', () => {
        const unknown = ['miso paste', 'Pesto (linked recipe)'];
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'unknown', { unknown }), vegetarian: v('vegetarian', 'unknown', { unknown }),
            pescatarian: v('pescatarian', 'unknown', { unknown }), dairyFree: v('dairyFree', 'unknown', { unknown }),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan?', 'warning']);
        assert.strictEqual(badge?.tooltipMarkdown, hover("- **Vegan?** 2 ingredients couldn't be checked: miso paste, Pesto \\(linked recipe\\)"));
    });

    it('uses the singular for one unchecked ingredient', () => {
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'unknown', { unknown: ['miso'] }) }), ALL_ON);
        assert.ok(badge?.tooltipMarkdown.includes("- **Vegan?** 1 ingredient couldn't be checked: miso"), badge?.tooltipMarkdown);
    });

    it('puts `?` only on the diet that is unknown, and is amber if any shown diet is', () => {
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', { violations: [{ ingredient: 'eggs', reason: 'eggs' }] }),
            dairyFree: v('dairyFree', 'unknown', { unknown: ['cream substitute'] }),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegetarian · Dairy-free?', 'warning']);
    });

    it('keeps two `?` labels within the editor\'s 24-character limit', () => {
        const unknown = ['miso'];
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', { violations: [{ ingredient: 'prawns', reason: 'crustaceans' }] }),
            vegetarian: v('vegetarian', 'fail', { violations: [{ ingredient: 'prawns', reason: 'crustaceans' }] }),
            pescatarian: v('pescatarian', 'unknown', { unknown }), dairyFree: v('dairyFree', 'unknown', { unknown }),
        }), ALL_ON);
        assert.strictEqual(badge?.text, 'Pescatarian?·Dairy-free?');
        assert.ok(badge.text.length <= MAX_PILL_TEXT);
        assert.ok(badge.tooltipMarkdown.includes('- Not vegetarian: prawns \\(crustaceans\\)'), badge.tooltipMarkdown);
    });

    it('shows Dairy-free alone when every ladder diet failed, naming the least strict failure', () => {
        const chicken = { violations: [{ ingredient: 'chicken', reason: 'poultry' }] };
        const badge = dietBadge(verdicts({
            vegan: v('vegan', 'fail', chicken), vegetarian: v('vegetarian', 'fail', chicken), pescatarian: v('pescatarian', 'fail', chicken),
        }), ALL_ON);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Dairy-free', 'good']);
        assert.strictEqual(badge?.tooltipMarkdown, hover('- **Dairy-free**: every ingredient checked', '- Not pescatarian: chicken \\(poultry\\)'));
    });

    it('shows no pill when every enabled diet fails', () => {
        const steak = { violations: [{ ingredient: 'steak', reason: 'meat' }] };
        const butter = { violations: [{ ingredient: 'butter', reason: 'dairy' }] };
        assert.strictEqual(dietBadge(verdicts({
            vegan: v('vegan', 'fail', steak), vegetarian: v('vegetarian', 'fail', steak), pescatarian: v('pescatarian', 'fail', steak),
            dairyFree: v('dairyFree', 'fail', butter),
        }), ALL_ON), undefined);
        assert.strictEqual(dietBadge(verdicts({ dairyFree: v('dairyFree', 'fail', butter) }), { vegan: false, vegetarian: false, pescatarian: false, dairyFree: true }), undefined);
    });

    it('never shows or mentions a disabled diet', () => {
        const noVegan = { ...ALL_ON, vegan: false };
        assert.strictEqual(dietBadge(verdicts({}), noVegan)?.text, 'Vegetarian · Dairy-free');
        const fish = { violations: [{ ingredient: 'cod', reason: 'fish or shellfish' }] };
        const badge = dietBadge(verdicts({ vegan: v('vegan', 'fail', fish), vegetarian: v('vegetarian', 'fail', fish) }), noVegan);
        assert.strictEqual(badge?.text, 'Pescatarian · Dairy-free');
        assert.ok(badge?.tooltipMarkdown.includes('- Not vegetarian: cod \\(fish or shellfish\\)'));
        assert.ok(!badge?.tooltipMarkdown.includes('vegan'));
        assert.strictEqual(dietBadge(verdicts({}), { vegan: true, vegetarian: true, pescatarian: true, dairyFree: false })?.text, 'Vegan');
    });
});

describe('pillText', () => {
    it('joins with a spaced dot, then a tight dot, then keeps the first label', () => {
        assert.strictEqual(pillText(['Vegan']), 'Vegan');
        assert.strictEqual(pillText(['Pescatarian', 'Dairy-free']), 'Pescatarian · Dairy-free');
        assert.strictEqual(pillText(['Pescatarian?', 'Dairy-free?']), 'Pescatarian?·Dairy-free?');
        assert.strictEqual(pillText(['x'.repeat(20), 'y'.repeat(20)]), 'x'.repeat(20));
    });
});

describe('fixed pills', () => {
    it('locked: grey 🔒 Diet with an upgrade hint', () => {
        assert.deepStrictEqual(lockedBadge(), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(LOCKED_TEXT, '🔒 Diet');
        assert.ok(LOCKED_TOOLTIP.includes('[See plans](https://cook.md/pricing)'));
    });

    it('unreachable: amber Diet ? saying the service couldn\'t be reached', () => {
        assert.deepStrictEqual(unreachableBadge(), {
            kind: 'pill', text: UNREACHABLE_TEXT, tone: 'warning', tooltipMarkdown: ['**Diet**', UNREACHABLE_LINE, FOOTER].join('\n\n'),
        });
        assert.strictEqual(UNREACHABLE_TEXT, 'Diet ?');
        assert.ok(UNREACHABLE_LINE.startsWith("Couldn't reach the nutrition service"));
    });
});
```

Note: diet names in "Not …" lines are fixed strings and are not escaped; only ingredient names go through `formatNames`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc`: `error TS2307: Cannot find module './badge'`.

- [ ] **Step 3: Implement**

`diet-badges/src/badge.ts`:

```ts
import { PillBadge } from './cooklang-api';
import { matchesWord } from './custom-match';
import { formatNames } from './markdown';
import { DietVerdict, DietVerdicts, Violation } from './rules';
import { DietId } from './settings';

/** The editor's `PreviewBadge.MAX_TEXT_LENGTH`, in UTF-16 units: longer pills are dropped, not cut. */
export const MAX_PILL_TEXT = 24;

/** Strictest first. Dairy-free sits beside the ladder: Vegan implies it. */
const LADDER: readonly DietId[] = ['vegan', 'vegetarian', 'pescatarian'];

export const DIET_LABELS: Readonly<Record<DietId, string>> = {
    vegan: 'Vegan', vegetarian: 'Vegetarian', pescatarian: 'Pescatarian', dairyFree: 'Dairy-free',
};

export const FOOTER = '_Based on the cook.md nutrition service. Informational only — check labels of packaged products._';

export const LOCKED_TEXT = '🔒 Diet';
export const LOCKED_TOOLTIP = `**Diet badges** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to see which diets your recipes and meal plans fit: vegan, vegetarian, pescatarian and dairy-free.

[See plans](https://cook.md/pricing)`;

export const UNREACHABLE_TEXT = 'Diet ?';
export const UNREACHABLE_LINE = "Couldn't reach the nutrition service, so no diet could be checked.";

type EnabledDiets = Readonly<Record<DietId, boolean>>;

/** The strictest enabled ladder diet that didn't fail, plus Dairy-free when it didn't fail and Vegan isn't shown. */
function shownDiets(verdicts: DietVerdicts, enabled: EnabledDiets): DietId[] {
    const ladder = LADDER.find(id => enabled[id] && verdicts[id].status !== 'fail');
    const shown: DietId[] = ladder ? [ladder] : [];
    if (enabled.dairyFree && verdicts.dairyFree.status !== 'fail' && ladder !== 'vegan') {
        shown.push('dairyFree');
    }
    return shown;
}

/**
 * The next-stricter enabled ladder diet (it necessarily failed), or, when no ladder diet is
 * shown, the least strict enabled one; plus Dairy-free when it is enabled and failed.
 */
function failedDiets(verdicts: DietVerdicts, enabled: EnabledDiets, shown: readonly DietId[]): DietId[] {
    const enabledLadder = LADDER.filter(id => enabled[id]);
    const shownLadder = shown.find(id => id !== 'dairyFree');
    const candidates = shownLadder ? enabledLadder.slice(0, enabledLadder.indexOf(shownLadder)) : enabledLadder;
    const failed: DietId[] = candidates.length > 0 ? [candidates[candidates.length - 1]] : [];
    if (enabled.dairyFree && verdicts.dairyFree.status === 'fail') {
        failed.push('dairyFree');
    }
    return failed;
}

function label(verdict: DietVerdict): string {
    return `${DIET_LABELS[verdict.diet]}${verdict.status === 'unknown' ? '?' : ''}`;
}

/** Labels joined with ` · `; if over 24 units, with `·`; if still over, the first label alone. */
export function pillText(labels: readonly string[]): string {
    const spaced = labels.join(' · ');
    if (spaced.length <= MAX_PILL_TEXT) {
        return spaced;
    }
    const tight = labels.join('·');
    return tight.length <= MAX_PILL_TEXT ? tight : labels[0];
}

function violationText(violation: Violation): string {
    return matchesWord(violation.reason, violation.ingredient) ? violation.ingredient : `${violation.ingredient} (${violation.reason})`;
}

function shownLine(verdict: DietVerdict): string {
    const title = `**${label(verdict)}**`;
    if (verdict.status === 'pass') {
        return `- ${title}: every ingredient checked`;
    }
    const count = verdict.unknown.length;
    return `- ${title} ${count} ingredient${count === 1 ? '' : 's'} couldn't be checked: ${formatNames(verdict.unknown)}`;
}

function failedLine(verdict: DietVerdict): string {
    return `- Not ${DIET_LABELS[verdict.diet].toLowerCase()}: ${formatNames(verdict.violations.map(violationText))}`;
}

/** Green when every shown diet passed, amber when one is unknown, no pill when every enabled diet failed. */
export function dietBadge(verdicts: DietVerdicts, enabled: EnabledDiets): PillBadge | undefined {
    const shown = shownDiets(verdicts, enabled);
    if (shown.length === 0) {
        return undefined;
    }
    const tone = shown.every(id => verdicts[id].status === 'pass') ? 'good' : 'warning';
    const lines = [
        ...shown.map(id => shownLine(verdicts[id])),
        ...failedDiets(verdicts, enabled, shown).map(id => failedLine(verdicts[id])),
    ];
    return {
        kind: 'pill',
        text: pillText(shown.map(id => label(verdicts[id]))),
        tone,
        tooltipMarkdown: ['**Diet**', lines.join('\n'), FOOTER].join('\n\n'),
    };
}

export function lockedBadge(): PillBadge {
    return { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP };
}

export function unreachableBadge(): PillBadge {
    return { kind: 'pill', text: UNREACHABLE_TEXT, tone: 'warning', tooltipMarkdown: ['**Diet**', UNREACHABLE_LINE, FOOTER].join('\n\n') };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, including `dietBadge` (10), `pillText` (1) and `fixed pills` (2). If a "Not dairy-free" expectation fails on escaping, check that `failedLine` does not pass the diet label through `escapeMarkdown`.

- [ ] **Step 5: Commit**

```bash
git add diet-badges/src/badge.ts diet-badges/src/badge.spec.ts
git commit -m "feat(diet-badges): pill text, tone and hover from diet verdicts, plus locked and unreachable pills"
```

---

## Task 6: End-to-end test over a captured `/aggregate` response

**Files:**
- Create: `diet-badges/test-fixtures/diet-output-eu.json`, `diet-badges/src/aggregate-fixture.spec.ts`

- [ ] **Step 1: Build the fixture from the captured Allergens response**

`allergens/test-fixtures/aggregate-eu.json` is a real `/aggregate` reply in the EU view. Recipe names: plain flour, butter, almonds, saffron, unobtainium, soy sauce. Items: flour (unverified), butter (milk), almond (tree nuts), saffron (unverified), soy sauce (gluten, soybeans). Failure: index 4 unobtainium. Reshape it into this plugin's template output. `is_in_category` calls aren't captured, so butter's categories are set to what the taxonomy gives it:

```bash
jq '{names, refs, missing: [], items: [.aggregate.items[] | {ingredient, allergens, warnings, categories: (if .ingredient == "butter" then ["dairy_and_egg", "butter"] else [] end)}], failures: .aggregate.failures}' allergens/test-fixtures/aggregate-eu.json > diet-badges/test-fixtures/diet-output-eu.json
jq -c '[.names, (.items | map(.ingredient)), (.failures | map(.index))]' diet-badges/test-fixtures/diet-output-eu.json
```

Expected second command output: `[["plain flour","butter","almonds","saffron","unobtainium","soy sauce"],["flour","butter","almond","saffron","soy sauce"],[4]]`

- [ ] **Step 2: Write the test**

`diet-badges/src/aggregate-fixture.spec.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { dietBadge } from './badge';
import { parseDietOutput } from './diet-template';
import { evaluateDiets } from './rules';
import { DIET_IDS } from './settings';

describe('a captured /aggregate response (EU view)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'test-fixtures', 'diet-output-eu.json'), 'utf8');
    const output = parseDietOutput(raw);

    it('parses and aligns the service items back to recipe names', () => {
        assert.ok(output);
        assert.deepStrictEqual(output.ingredients.map(i => [i.name, i.status]), [
            ['plain flour', 'unknown'],
            ['butter', 'verified'],
            ['almonds', 'verified'],
            ['saffron', 'unknown'],
            ['unobtainium', 'unknown'],
            ['soy sauce', 'verified'],
        ]);
    });

    it('fails Vegan and Dairy-free on butter and leaves the rest unknown', () => {
        const verdicts = evaluateDiets(output!, []);
        assert.deepStrictEqual(DIET_IDS.map(id => verdicts[id].status), ['fail', 'unknown', 'unknown', 'fail']);
        assert.deepStrictEqual(verdicts.vegan.violations, [{ ingredient: 'butter', reason: 'dairy' }]);
        assert.deepStrictEqual(verdicts.vegetarian.unknown, ['plain flour', 'saffron', 'unobtainium']);
    });

    it('shows an amber Vegetarian? pill explaining both failures', () => {
        const badge = dietBadge(evaluateDiets(output!, []), { vegan: true, vegetarian: true, pescatarian: true, dairyFree: true });
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegetarian?', 'warning']);
        assert.ok(badge?.tooltipMarkdown.includes("- **Vegetarian?** 3 ingredients couldn't be checked: plain flour, saffron, unobtainium"), badge?.tooltipMarkdown);
        assert.ok(badge?.tooltipMarkdown.includes('- Not vegan: butter \\(dairy\\)'));
        assert.ok(badge?.tooltipMarkdown.includes('- Not dairy-free: butter \\(dairy\\)'));
    });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, with `a captured /aggregate response (EU view)` (3) green. This test exercises Tasks 3–5 together. If it fails, the bug is in one of those modules: fix it there and re-run that module's spec too.

- [ ] **Step 4: Commit**

```bash
git add diet-badges/test-fixtures/diet-output-eu.json diet-badges/src/aggregate-fixture.spec.ts
git commit -m "test(diet-badges): parse, rules and badge over a captured EU /aggregate response"
```

---

## Task 7: Provider with plan check, error states and caching

**Files:**
- Create: `diet-badges/src/provider.ts`, `diet-badges/src/provider.spec.ts`

- [ ] **Step 1: Write the failing test**

`diet-badges/src/provider.spec.ts`:

```ts
import * as assert from 'assert';
import { LOCKED_TEXT, UNREACHABLE_TEXT } from './badge';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { DIET_TEMPLATE } from './diet-template';
import { DietBadgeProvider, isMenuUri } from './provider';
import { readSettings } from './settings';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 2 };
const MENU = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 1 };

const verified = (...classes: string[]) => ({ status: 'verified', view: 'eu', contains: classes.map(c => ({ class: c, label: c })) });
const item = (ingredient: string, categories: string[] = [], allergens: unknown = verified()) => ({ ingredient, allergens, warnings: [], categories });
const out = (fields: { names?: string[]; refs?: string[]; missing?: string[]; items?: unknown[]; failures?: unknown[] }): PluginReportResult => ({
    ok: true,
    output: JSON.stringify({ names: fields.names ?? [], refs: fields.refs ?? [], missing: fields.missing ?? [], items: fields.items ?? [], failures: fields.failures ?? [] }),
});
const TOFU = out({ names: ['tofu', 'rice'], items: [item('tofu', [], verified('soybeans')), item('rice')] });
const fail = (reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template', message = 'boom'): PluginReportResult => ({ ok: false, reason, message });

interface Setup {
    provider: DietBadgeProvider;
    renders: Array<{ uri: string; template: string; scale: number }>;
    logs: string[];
    featureChecks: () => number;
}

function setup(options: { values?: Record<string, unknown>; feature?: boolean; results?: PluginReportResult[]; version?: (uri: string) => number | undefined } = {}): Setup {
    const renders: Setup['renders'] = [];
    const logs: string[] = [];
    let featureChecks = 0;
    const results = options.results ?? [];
    const values = options.values ?? {};
    const api = new CooklangApi(async (command, ...args) => {
        if (command === 'cooklang.api.hasFeature') {
            featureChecks += 1;
            return options.feature ?? true;
        }
        renders.push(args[0] as { uri: string; template: string; scale: number });
        return results.shift();
    }, async () => []);
    const provider = new DietBadgeProvider(api, message => logs.push(message), () => readSettings(key => values[key]), options.version);
    return { provider, renders, logs, featureChecks: () => featureChecks };
}

describe('isMenuUri', () => {
    it('recognises .menu files, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/Week.MENU?x=1#y'), true);
        assert.strictEqual(isMenuUri('file:///ws/a.cook'), false);
    });
});

describe('DietBadgeProvider', () => {
    it('ignores a malformed context', async () => {
        const s = setup();
        assert.strictEqual(await s.provider.provide({ uri: 1 }), undefined);
        assert.strictEqual(s.featureChecks(), 0);
    });

    it('does nothing when every diet is switched off', async () => {
        const s = setup({ values: { vegan: false, vegetarian: false, pescatarian: false, dairyFree: false } });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual([s.featureChecks(), s.renders.length], [0, 0]);
    });

    it('shows the locked pill without rendering when the plan lacks nutrition data', async () => {
        const s = setup({ feature: false });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.text, badge?.tone], [LOCKED_TEXT, 'neutral']);
        assert.strictEqual(s.renders.length, 0);
    });

    it('hides the locked pill when showWhenLocked is off', async () => {
        const s = setup({ feature: false, values: { showWhenLocked: false } });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
    });

    it('renders the diet template at scale 1 and returns the badge', async () => {
        const s = setup({ results: [TOFU] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan', 'good']);
        assert.deepStrictEqual(s.renders, [{ uri: CONTEXT.uri, template: DIET_TEMPLATE, scale: 1 }]);
    });

    it('treats an unauthenticated or forbidden render as locked', async () => {
        for (const reason of ['unauthenticated', 'forbidden'] as const) {
            const s = setup({ results: [fail(reason)] });
            assert.strictEqual((await s.provider.provide(CONTEXT))?.text, LOCKED_TEXT, reason);
        }
    });

    it('shows an amber Diet ? when the service is unreachable or erroring', async () => {
        for (const reason of ['network', 'server'] as const) {
            const s = setup({ results: [fail(reason)] });
            const badge = await s.provider.provide(CONTEXT);
            assert.deepStrictEqual([badge?.text, badge?.tone], [UNREACHABLE_TEXT, 'warning'], reason);
        }
    });

    it('shows nothing on a template error or malformed output, logging each reason once', async () => {
        const s = setup({ results: [fail('template', 'bad'), fail('template', 'bad'), { ok: true, output: 'nope' }, TOFU, fail('template', 'bad')] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Diet badges unavailable (template): bad', 'Diet badges unavailable (output): unexpected template output']);
        await s.provider.provide(CONTEXT);
        await s.provider.provide(CONTEXT);
        assert.strictEqual(s.logs.length, 3, 'a good render clears the log-once memory');
    });

    it('shows nothing for an empty recipe', async () => {
        const s = setup({ results: [out({})] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
    });

    it('warns about missing recipes in a menu', async () => {
        const s = setup({ results: [out({ names: ['rice'], items: [item('rice')], missing: ['Lasagne'] })] });
        const badge = await s.provider.provide(MENU);
        assert.deepStrictEqual([badge?.text, badge?.tone], ['Vegan?', 'warning']);
        assert.ok(badge?.tooltipMarkdown.includes('Lasagne \\(recipe not found\\)'), badge?.tooltipMarkdown);
    });

    it('caches an open recipe\'s badge by uri, document version and settings', async () => {
        let version = 1;
        const values: Record<string, unknown> = {};
        const s = setup({ results: [TOFU, TOFU, TOFU], version: () => version, values });
        await s.provider.provide(CONTEXT);
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, 'Vegan');
        assert.strictEqual(s.renders.length, 1);
        version = 2;
        await s.provider.provide(CONTEXT);
        assert.strictEqual(s.renders.length, 2);
        values.vegan = false;
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, 'Vegetarian · Dairy-free');
        assert.strictEqual(s.renders.length, 3);
    });

    it('still checks the plan before using the cache', async () => {
        let feature = true;
        const renders: unknown[] = [];
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return feature;
            }
            renders.push(args[0]);
            return TOFU;
        }, async () => []);
        const provider = new DietBadgeProvider(api, () => undefined, () => readSettings(() => undefined), () => 1);
        assert.strictEqual((await provider.provide(CONTEXT))?.text, 'Vegan');
        feature = false;
        assert.strictEqual((await provider.provide(CONTEXT))?.text, LOCKED_TEXT);
        assert.strictEqual(renders.length, 1);
    });

    it('does not cache without a document version, for menus, or on errors', async () => {
        const noVersion = setup({ results: [TOFU, TOFU] });
        await noVersion.provider.provide(CONTEXT);
        await noVersion.provider.provide(CONTEXT);
        assert.strictEqual(noVersion.renders.length, 2);

        const menu = setup({ results: [TOFU, TOFU], version: () => 1 });
        await menu.provider.provide(MENU);
        await menu.provider.provide(MENU);
        assert.strictEqual(menu.renders.length, 2);

        const flaky = setup({ results: [fail('network'), TOFU], version: () => 1 });
        assert.strictEqual((await flaky.provider.provide(CONTEXT))?.text, UNREACHABLE_TEXT);
        assert.strictEqual((await flaky.provider.provide(CONTEXT))?.text, 'Vegan');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: FAIL at `tsc`: `error TS2307: Cannot find module './provider'`.

- [ ] **Step 3: Implement**

`diet-badges/src/provider.ts`:

```ts
import { dietBadge, lockedBadge, unreachableBadge } from './badge';
import { CooklangApi, PillBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { DIET_TEMPLATE, DietOutput, parseDietOutput } from './diet-template';
import { evaluateDiets } from './rules';
import { DietSettings, isInactive } from './settings';

/** Badges remembered per open recipe version; oldest dropped first. */
export const CACHE_SIZE = 50;

/** Version of the open text document at `uri`, or undefined when it isn't open. */
export type DocumentVersion = (uri: string) => number | undefined;

type FailedResult = Extract<PluginReportResult, { ok: false }>;

/** Whether a URI string names a `.menu` plan (the badge outlets pass no other hint). */
export function isMenuUri(uri: string): boolean {
    return /\.menu$/i.test(uri.replace(/[?#].*$/, ''));
}

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

function isEmpty(output: DietOutput): boolean {
    return output.names.length === 0 && output.refs.length === 0 && output.missing.length === 0;
}

/** Backs `cooklang.dietBadges.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class DietBadgeProvider {

    protected readonly logged = new Set<string>();
    protected readonly cache = new Map<string, { badge: PillBadge | undefined }>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => DietSettings,
        protected readonly documentVersion: DocumentVersion = () => undefined,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        if (isInactive(settings)) {
            return undefined;
        }
        // Asked every time, before the cache: signing out or a lapsed plan must lock a cached badge.
        if (!(await this.api.hasFeature('nutrition_api'))) {
            return this.locked(settings);
        }
        const key = this.cacheKey(context.uri, settings);
        const hit = key === undefined ? undefined : this.cache.get(key);
        if (hit) {
            return hit.badge;
        }
        // Diets don't depend on scale; a fixed scale keeps the editor's render cache warm.
        const result = await this.api.renderReport({ uri: context.uri, template: DIET_TEMPLATE, scale: 1 });
        if (!result.ok) {
            return this.failed(result, settings);
        }
        const output = parseDietOutput(result.output);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        this.logged.clear();
        const badge = isEmpty(output) ? undefined : dietBadge(evaluateDiets(output, settings.extraNonVegan), settings.diets);
        if (key !== undefined) {
            this.remember(key, badge);
        }
        return badge;
    }

    protected failed(result: FailedResult, settings: DietSettings): PillBadge | undefined {
        this.logOnce(result.reason, result.message);
        switch (result.reason) {
            case 'unauthenticated':
            case 'forbidden':
                // The cached plan said yes but the service disagreed (expired sign-in, lapsed plan).
                return this.locked(settings);
            case 'network':
            case 'server':
                return unreachableBadge();
            default:
                return undefined;
        }
    }

    protected locked(settings: DietSettings): PillBadge | undefined {
        return settings.showWhenLocked ? lockedBadge() : undefined;
    }

    /**
     * Only open recipes are cached: a menu's verdict depends on the recipes it references,
     * whose edits don't change the menu's version.
     */
    protected cacheKey(uri: string, settings: DietSettings): string | undefined {
        if (isMenuUri(uri)) {
            return undefined;
        }
        const version = this.documentVersion(uri);
        return version === undefined ? undefined : JSON.stringify([uri, version, settings]);
    }

    protected remember(key: string, badge: PillBadge | undefined): void {
        this.cache.delete(key);
        this.cache.set(key, { badge });
        if (this.cache.size > CACHE_SIZE) {
            this.cache.delete(this.cache.keys().next().value as string);
        }
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Diet badges unavailable (${reason}): ${message}`);
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test`
Expected: PASS, including `isMenuUri` (1) and `DietBadgeProvider` (13).

- [ ] **Step 5: Commit**

```bash
git add diet-badges/src/provider.ts diet-badges/src/provider.spec.ts
git commit -m "feat(diet-badges): badge provider with plan check, error pills and a per-version cache"
```

---

## Task 8: Extension wiring and config-change refresh

**Files:**
- Create: `diet-badges/src/extension.ts`

`extension.ts` only wires VS Code to modules that are already unit-tested, the same way as Allergens. It has no spec of its own: compiling proves the types, and Task 12 verifies it by hand.

- [ ] **Step 1: Confirm nothing registers the command yet**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm run compile && ls out/extension.js`
Expected: FAIL: `ls: out/extension.js: No such file or directory` (the manifest's `main` points at a file that doesn't exist).

- [ ] **Step 2: Implement**

`diet-badges/src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { DietBadgeProvider } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Diet Badges');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const supportCheck = new SupportCheck(api);
    const provider = new DietBadgeProvider(
        api,
        message => {
            output.appendLine(message);
            console.warn(message);
        },
        () => {
            const configuration = vscode.workspace.getConfiguration('dietBadges');
            return readSettings(key => configuration.get(key));
        },
        uri => vscode.workspace.textDocuments.find(document => document.uri.toString() === uri)?.version,
    );
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.dietBadges.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Diet Badges needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    // Switching a diet off (or adding a word) should update the open preview without an edit.
    // Editors without cooklang.api.refreshBadges update on the next edit instead.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('dietBadges')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 3: Compile and run all tests**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test && ls out/extension.js`
Expected: PASS (all suites green) and `out/extension.js` listed.

- [ ] **Step 4: Commit**

```bash
git add diet-badges/src/extension.ts
git commit -m "feat(diet-badges): register the badge command on both outlets and refresh badges on settings change"
```

---

## Task 9: Packaging check

**Files:** none changed (`*.vsix` is gitignored at the repo root).

- [ ] **Step 1: Package**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm run package`
Expected: `DONE  Packaged: .../diet-badges/diet-badges-0.1.0.vsix`, with no error about a missing README/LICENSE/repository.

- [ ] **Step 2: Check the package contents**

Run: `cd diet-badges && unzip -l diet-badges-0.1.0.vsix | grep -E "extension/(package.json|README.md|LICENSE|out/)"`
Expected: `package.json`, `README.md`, `LICENSE` (vsce may rename it `LICENSE.txt`), and `out/*.js` for `extension, provider, badge, rules, diet-template, settings, cooklang-api, support-check, custom-match, markdown`. Check that there are no `.spec.js`, no `.map`, no `src/`, no `test-fixtures/`.

Run: `cd diet-badges && unzip -l diet-badges-0.1.0.vsix | grep -cE "spec\.js|\.map|test-fixtures|/src/"`
Expected: `0`.

Nothing to commit.

---

## Task 10: README

**Files:**
- Modify: `diet-badges/README.md`

- [ ] **Step 1: Replace the scaffold README with the user docs**

`diet-badges/README.md`:

```markdown
# Diet Badges

Shows which diets a recipe or meal plan fits on Cook Editor's recipe and menu previews: **Vegan**, **Vegetarian**, **Pescatarian** and **Dairy-free**.

## What you see

| Badge | Meaning |
|---|---|
| green `Vegan` | every ingredient was checked and none of them is an animal product |
| green `Vegetarian · Dairy-free` | the strictest diet that fits, plus Dairy-free when Vegan doesn't fit (Vegan already implies it) |
| amber `Vegan?` | nothing breaks the diet, but some ingredients couldn't be checked: ingredients the nutrition service doesn't know yet, linked recipes, or recipes a meal plan points to that can't be found |
| amber `Diet ?` | the cook.md nutrition service couldn't be reached |
| no badge | every diet you've switched on is broken (a steak won't get a "not vegan" badge) |
| grey `🔒 Diet` | your plan doesn't include nutrition data |

A badge is only green when every ingredient was checked. If anything couldn't be checked, the diet gets a `?`.

Hover the badge to see what was checked, which ingredients couldn't be, and why the next stricter diet doesn't fit (for example *Not vegan: butter (dairy), eggs*).

## How diets are decided

| Diet | Doesn't fit when an ingredient is |
|---|---|
| Pescatarian | meat, poultry or animal fat |
| Vegetarian | anything above, or fish, shellfish, crustaceans or molluscs |
| Vegan | anything above, or dairy or eggs, or honey, gelatine, fish sauce, anchovies, Worcestershire, ghee, whey, casein, lard or suet, or one of your **Extra Non Vegan** words |
| Dairy-free | milk, cheese, yogurt or butter |

Ingredient categories and allergen data come from the cook.md nutrition service. Word matching is on whole words, and plurals match both ways.

## Recipes and meal plans

On a recipe, linked recipes (`@./Sauces/Pesto{}`) aren't looked into. They always count as "couldn't be checked", so open the linked recipe to see its own badge.

On a meal plan (`.menu`), every recipe the plan references is expanded and checked, so a week is vegan only if every recipe in it is. A recipe the plan points to that can't be found counts as "couldn't be checked".

## Settings

Open **Settings → Extensions → Diet Badges**:

- switch any of **Vegan**, **Vegetarian**, **Pescatarian**, **Dairy Free** off to stop checking it (all are on by default),
- add words under **Extra Non Vegan** (for example `bone broth`) to catch ingredients the built-in list misses,
- turn off **Show When Locked** to hide the grey `🔒 Diet` badge.

Changes apply to the open preview straight away.

## Plans

Diet Badges uses the cook.md nutrition service, so it needs a Cook Basic or Pro plan. There is no offline mode.

**This is informational only.** It is not a certification or medical advice: ingredient data can be incomplete, and it knows nothing about how packaged products are made. Always check product labels.

## For plugin authors

Shows one command serving two badge outlets (`cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`) with a `pill` badge. The report template uses `plan.all_ingredients` on menus, `aggregate_nutrition(ings, "eu")` for per-ingredient allergen data, and the tree-aware `is_in_category` for taxonomy checks. Settings changes call `cooklang.api.refreshBadges`.
```

- [ ] **Step 2: Check the README is packaged and the tests still pass**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm test && PATH=~/.local/bin:$PATH npm run package`
Expected: tests PASS; `Packaged: .../diet-badges-0.1.0.vsix`.

- [ ] **Step 3: Commit**

```bash
git add diet-badges/README.md
git commit -m "docs(diet-badges): README with badge meanings, rules, menus, settings and plans"
```

---

## Task 11: CI matrix entry and root README row

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` (repo root)

Other plugin branches touch these same two lines. Edit them in place with the Edit tool and don't rewrite the files.

- [ ] **Step 1: Add the package to the CI matrix**

In `.github/workflows/ci.yml`, add `diet-badges` to the `matrix.package` list in alphabetical order. Today the line is:

```yaml
        package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

and becomes:

```yaml
        package: [allergens, corevitals, diet-badges, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

If the line already holds other new entries when you get there, keep them and only insert `diet-badges` in its alphabetical slot.

- [ ] **Step 2: Add the root README row**

In the root `README.md` plugin table, insert this row directly after the `corevitals` row:

```markdown
| [`diet-badges`](./diet-badges) | `Vegan`, `Vegetarian`, `Pescatarian` or `Dairy-free` badge on recipe and meal-plan previews: green when every ingredient was checked, amber with `?` when something couldn't be. Needs a Cook Basic or Pro plan. Install it from the Extensions view. Shows one command serving both badge outlets and `is_in_category` in a report template. |
```

- [ ] **Step 3: Run what CI runs**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm ci && PATH=~/.local/bin:$PATH npm run compile && PATH=~/.local/bin:$PATH npm test && PATH=~/.local/bin:$PATH npm run package`
Expected: `npm ci` succeeds from the committed lockfile, tests PASS, and the package builds.

Run: `grep -n "diet-badges" .github/workflows/ci.yml README.md`
Expected: one hit in `ci.yml` and one in `README.md`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: run the diet-badges plugin in the matrix; list it in the README"
```

---

## Task 12: Manual verification in Cook Editor

**Files:** none (scratch `.cook`/`.menu` files live in a throwaway workspace folder, not in this repo).

- [ ] **Step 1: Deploy and restart the editor**

Run: `cd diet-badges && PATH=~/.local/bin:$PATH npm run deploy`
Expected: `Deployed to …/editor/plugins/cooklang.diet-badges` (set `COOK_EDITOR_DIR` to use an editor worktree).

Then quit Cook Editor fully and start it again: `cd ../../editor && npm run start:electron`. Plugins are copied only at startup.

- [ ] **Step 2: Make a scratch workspace**

Open an empty folder in the editor and create these files. Use YAML frontmatter, never `>>`.

`Lentil soup.cook`:
```
---
servings: 4
---
Simmer @red lentils{200%g} with @onion{1} and @olive oil{2%tbsp} in @water{1%l}. Season with @salt{1%tsp}.
```

`Pancakes.cook`:
```
---
servings: 2
---
Whisk @flour{100%g}, @eggs{2}, @milk{250%ml} and @butter{20%g}.
```

`Roast chicken.cook`:
```
---
servings: 4
---
Roast @chicken{1.5%kg} with @olive oil{2%tbsp} and @lemon{1}.
```

`Salmon.cook`:
```
---
servings: 2
---
Bake @salmon fillets{2} with @olive oil{1%tbsp} and @dill{1%tbsp}.
```

`Mystery.cook`:
```
---
servings: 1
---
Mix @rice{100%g} with @unobtainium{1%tsp}.
```

`Pasta with pesto.cook`:
```
---
servings: 2
---
Toss @spaghetti{200%g} with @./Pesto{}.
```

`Week.menu`:
```
---
servings: 2
---
Monday:
- @./Lentil soup{4%servings}

Tuesday:
- @./Missing recipe{1}
```

- [ ] **Step 3: Signed in with Cook Basic (or Pro)**

Sign in to cook.md in the editor with an account whose plan includes `nutrition_api`. Open each preview and check:

| File | Expected pill | Hover check |
|---|---|---|
| `Lentil soup.cook` | green `Vegan`, or amber `Vegan?` if the service has an unverified allergen block for one of them | "Vegan: every ingredient checked" or lists the unchecked ones |
| `Pancakes.cook` | `Vegetarian` (amber `Vegetarian?` if flour is unverified, as in the captured fixture) | "Not vegan: eggs, milk (dairy), butter (dairy)" and "Not dairy-free: …" |
| `Roast chicken.cook` | `Dairy-free` (or `Dairy-free?`) | "Not pescatarian: chicken (poultry)" |
| `Salmon.cook` | `Pescatarian · Dairy-free` (with `?` where unknown) | "Not vegetarian: salmon fillets (fish)" |
| `Mystery.cook` | amber `Vegan?` | "unobtainium" listed as couldn't be checked |
| `Pasta with pesto.cook` | amber `Vegan?` | "Pesto (linked recipe)" listed |
| `Week.menu` | amber `Vegan?` | "Missing recipe (recipe not found)"; delete the Tuesday block and save → it follows `Lentil soup.cook` |

Then:
- [ ] Settings → Diet Badges → switch **Vegan** off with `Lentil soup.cook` open: the pill changes to `Vegetarian · Dairy-free` without editing the recipe. Switch it back on.
- [ ] Add `lentils` to **Extra Non Vegan**: the lentil soup loses `Vegan` and shows `Vegetarian · Dairy-free`, and the hover says "Not vegan: red lentils" (the reason is left out because the name already contains the word). Remove the word.
- [ ] Switch all four diets off: no pill anywhere. Switch them back on.
- [ ] Edit `Lentil soup.cook` to add `@honey{1%tsp}`: the pill drops `Vegan` on the next refresh. Undo.
- [ ] Turn off Wi-Fi and edit a recipe so it re-renders: amber `Diet ?` with "Couldn't reach the nutrition service". Turn Wi-Fi back on and edit again: the normal pill returns.
- [ ] **View → Output → Diet Badges** shows at most one line per failure reason and no token.
- [ ] The Nutri-Score, Allergens and Core Vitals badges (if installed) still render next to this pill.

- [ ] **Step 4: Signed out, and on a plan without nutrition**

- [ ] Sign out of cook.md: every preview shows the grey `🔒 Diet` pill. Its hover has "Sign in to cook.md with a Cook Basic or Pro plan…" and a "See plans" link.
- [ ] Turn off **Show When Locked**: the grey pill disappears. Turn it back on.
- [ ] If an account with no paid plan is available (e.g. a free test account), sign in with it: it shows the same grey pill.
- [ ] Sign back in with Basic/Pro: real pills return without restarting.

- [ ] **Step 5: Older editor (optional)**

On an editor build without `cooklang.api.renderReport`, the plugin stays inert. There is no pill and one Output line: "Diet Badges needs a newer Cook Editor (cooklang.api.renderReport is missing)."

Record anything unexpected (e.g. staples that come back unverified and make most recipes amber) in the PR description. Don't change the rules to hide it: the spec says never claim a diet that wasn't checked.

---

## Self-review: spec coverage

| Spec section | Covered by |
|---|---|
| Goals: at-a-glance diets for recipes and menus | Task 1 (both outlets in `package.json`), Tasks 3–7 |
| Goals: never claim a diet when something couldn't be checked | Task 3 (placeholder / failure / non-verified → unknown), Task 4 (unknown beats pass), Task 5 (`?` + warning), Task 6 |
| Goals: `nutrition_api` plan, like Nutri-Score / Core Vitals | Task 7 (`hasFeature('nutrition_api')`, locked pill), Task 12 Step 4 |
| Non-goals (no gluten, keto, certification, free tier) | Nothing implemented for them; README "informational only" (Task 10) |
| Preferences: four diet booleans default true | Task 1 (manifest), Task 2 (`readSettings`) |
| Preferences: `extraNonVegan` | Task 1, Task 2 (cleaning), Task 4 (Vegan words) |
| Preferences: `showWhenLocked` | Task 1, Task 2, Task 7 |
| Preferences: refreshBadges on change, missing on old editors | Task 1 (copied `refreshBadges` + spec), Task 8 |
| Rules: one `renderReport`, `aggregate_nutrition(…, "eu")`, `is_in_category` per item, tree-aware | Task 3 (template + spec), Task 4 (`fish_and_shellfish` from `oily_fish`) |
| Rules: same names prelude; references reported separately | Task 3 (prelude, `refs`), Task 4 (linked recipe → unknown) |
| Rules: Pescatarian / Vegetarian / Vegan / Dairy-free table | Task 4 (`DIET_RULES` + one test per row) |
| Rules: word list with the copied whole-word plural matcher | Task 1 (copied `custom-match.ts`), Task 4 (`NON_VEGAN_WORDS`) |
| Rules: unknown = placeholder, failure, no verified allergen block; linked recipes unknown | Task 3, Task 4 |
| Badge: one pill on both outlets | Task 1, Task 5, Task 7 |
| Badge: strictest passing ladder diet + Dairy-free when Vegan not shown | Task 5 |
| Badge: tone good / warning with `?` / no pill when all fail | Task 5 (deviation 4: `?` per diet) |
| Badge: locked grey `🔒 Diet`, `showWhenLocked` | Task 5 (`lockedBadge`), Task 7 |
| Hover: per shown diet, next-stricter failed diet, footer | Task 5 (deviation 8 additions) |
| Menus: every ingredient across the plan; referenced recipes checked | Task 3 (`plan.all_ingredients`, `missing_recipes`, deviation 1), Task 4, Task 7, Task 12 |
| Architecture: `cooklang-api.ts`, `diet-template.ts`, `rules.ts`, `badge.ts`, `provider.ts`, `extension.ts` | Tasks 1, 3, 4, 5, 7, 8 (plus `settings.ts`, `markdown.ts`, `custom-match.ts`, `support-check.ts`) |
| Architecture: cache by `uri + document version` | Task 7 (deviation 2), Task 8 (`textDocuments` version) |
| Error handling: network/server → `Diet ?` | Task 5 (`unreachableBadge`), Task 7 |
| Error handling: template error / malformed → no pill + warn | Task 7 (log once), Task 8 (`console.warn` + output channel) |
| Error handling: no `renderReport` → inert | Task 1 (copied `SupportCheck`), Task 8, Task 12 Step 5 |
| Testing: fixture `/aggregate` JSON | Task 6 |
| Testing: each diet passing, failing, unknown | Task 4 |
| Testing: tree-aware category hit; word-list hit; linked recipe → unknown | Task 4 |
| Testing: menu fixture | Task 7 (missing recipe in a menu), Task 3 (template reads the plan) |
| Testing: badge text/tone matrix; locked state | Task 5, Task 7 |
| Repo integration: CI matrix, root README row, packaging | Tasks 9, 11 |

**Open risks to watch during execution**

- **Request volume.** `is_in_category` is one HTTP GET per (ingredient, slug): five per ingredient, nine for dairy, each with a 5 s client timeout. The native client memoises results process-wide, so only the first render of a new ingredient is slow. A large first-time menu could take several seconds.
- **Taxonomy slugs must exist.** An unknown slug fails the whole render (`category_not_found` → `template` reason → no pill). All nine slugs are in migrations 0009/0011. If prod is ever behind, Task 12 will show no pill plus an Output line.
- **Sparse data.** Migration 0011 notes that sub-categories (`milk`, `cheese`, `butter`, …) are "populated by curation over time". Dairy-free mostly leans on the `milk` allergen class, and `animal_fat` may be sparse. Many staples (flour in the captured fixture) come back with an unverified allergen block, so expect many amber `?` pills at first. This is by design.
- **URI matching.** The cache only hits when the outlet's `uri` string equals `TextDocument.uri.toString()`. If the encodings differ (spaces, drive letters), the cache misses. That is harmless: the editor's own content cache still applies.

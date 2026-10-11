# Macros Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cooklang.macros` plugin that shows protein / carbs / fat (and energy) as a neutral pill on recipe previews (per serving, or per 100 g) and on meal-plan previews (per person per day), with a hover table, a `Macros ?` warning when the data is too thin, and a greyed `🔒 Macros` pill without a Cook Basic/Pro plan.

**Architecture:** One fixed Jinja template (`aggregate_nutrition(...) | tojson`, with a `plan` branch for `.menu` files) is rendered by the editor's Reports engine through `cooklang.api.renderReport`. Everything else is pure TypeScript with mocha specs: output validation (`nutrition-template.ts`), servings from frontmatter (`servings.ts`), the 70 % match rule (`match.ts`), the maths (`macros.ts`), hover and pill (`hover.ts`, `badge.ts`), and the badge command with a small render cache (`provider.ts`). `extension.ts` only wires them. The plugin mirrors `nutriscore/` (template + validation + locked state) and `corevitals/` (servings, menu badge outlet, plan context, pill badge, `refreshBadges` on config change).

**Tech Stack:** TypeScript (`typescript ~7.0.2`, as the other plugins), VS Code extension API 1.100 (via Theia), minijinja templates rendered by the editor, mocha 12 + node `assert`, `@vscode/vsce` for packaging.

**Spec:** `docs/superpowers/specs/2026-10-10-macros-plugin-design.md`

---

## Deviations from spec

Verified against the code on 2026-10-10 (editor `main` c49bb9416, `corevitals/`, `nutriscore/`, `cooklang-reports` and `cooklang-reports-nutrition`):

1. **Pill text is compacted.** The editor's `PreviewBadge.parse` (`editor/packages/cooklang/src/common/cooklang-outlet-context.ts`) drops any pill whose text is longer than `MAX_TEXT_LENGTH = 24`. The spec's `38P · 52C · 14F · 520 kcal` is 26 characters, so the badge would silently never appear. The plan uses `38P 52C 14F · 520 kcal` (22). When that does not fit, the energy is tightened (`520kcal`) and then dropped; the hover always shows it. The spec's ` · whole recipe` suffix becomes ` · whole`, and the basis markers are `/day` and `/100g`. A basis marker is never dropped: if even the bare figures don't fit, the pill reads `Macros ?`. In practice, whole-recipe and per-day pills usually show only the macros.
2. **Menu people and days come from the engine, not from the text.** As in Core Vitals, the template reads `plan.servings` (the menu's numeric `servings:`, default 1) and `plan.days | length` (default 1) from the `plan` context that `editor/packages/cooklang-native/src/lib.rs` (`render_report_body`, `is_menu`) adds for `.menu` files. Every menu section counts as a day. This is what "`= Day … =` sections" means in Core Vitals too.
3. **Scale.** `cooklang_reports::render_template_with_config` calls `recipe.scale(config.scale)` before it builds the context, so `aggregate_nutrition(ingredients)` sees scaled quantities. For recipes the plan follows the spec: it passes the preview scale and multiplies the frontmatter servings (read from the unscaled text) by it. Menus are rendered at scale 1, because `build_plan_from_source` always expands a plan at `1.0` and per-person-per-day figures do not depend on the menu scale. A recipe without servings shows the whole recipe **at the current scale**.
4. **`macros.basis` applies to recipes only.** Plans are always per person per day, as the spec's "Menu" bullet implies.
5. **Extra `Macros ?` cases**, each with its own hover line: a plan that references a recipe the engine could not find (Core Vitals withholds for the same reason, since the totals undercount); basis `100g` when the service could not weigh the recipe (`mass_g` 0); no ingredients at all.
6. **Error handling detail.** `unauthenticated` / `forbidden` render failures show the locked pill, as in Nutri-Score and Core Vitals, because the cached subscription disagreed with the service. `network` / `server` failures show the `Macros ?` warning pill with the reason, as the spec says. A `template` failure or malformed output shows no pill. Each is logged once per reason to the "Macros" output channel and to `console.warn`.
7. **Cache scope.** The provider caches validated recipe outputs keyed by `[uri, scale, text]` (LRU, 20 entries), so a settings change re-uses the last render. Plans are not cached by the plugin, because their totals depend on referenced recipes that the menu text does not capture. The editor's own `PluginReportService` cache still applies.

## Conventions for every task

- **Work in a separate worktree.** Other agents are writing in `/Users/alexeydubovskoy/Cooklang/plugins`, so never switch branches there. Task 1 creates the worktree `/Users/alexeydubovskoy/Cooklang/plugins-macros` on branch `feature/macros` from `main`. All paths below are relative to that worktree. The plugin folder is `macros/`. `scripts/deploy.js` resolves `../../editor` from `macros/`, which is the same editor checkout from this worktree.
- **Node 22 is required.** mocha 12 fails under the machine's default Node 20.11 with `ERR_REQUIRE_ESM`. Before any `npm` command, run `export PATH="$HOME/.local/bin:$PATH"` and check that `node --version` prints `v22.x`.
- **Tests:** `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`, which runs `tsc -p .` and then `mocha "out/**/*.spec.js"`. A spec that imports a module that doesn't exist yet fails at the `tsc` step with `error TS2307: Cannot find module …`. That is the expected red.
- **Specs** use `import * as assert from 'assert'` with `describe`/`it`, like `corevitals/src/*.spec.ts`.
- **Code style:** 4 spaces, single quotes, `undefined` not `null`, explicit return types, and no `vscode` import outside `extension.ts`.
- **Commits:** conventional commits scoped `macros`, e.g. `feat(macros): …`, run from the worktree root.
- **Cooklang fixtures** use YAML frontmatter. Never use the deprecated `>>` metadata syntax.

## File Structure

All new files are under `macros/` unless noted.

| File | Responsibility |
|---|---|
| `macros/package.json` | Manifest: `cooklang.macros.provideBadge` on `cooklang/recipePreview/badge` + `cooklang/menuPreview/badge`; settings `macros.showEnergy`, `macros.basis` (`serving`/`100g`), `macros.showWhenLocked`; npm scripts |
| `macros/package-lock.json` | Lockfile for `npm ci` in CI (generated) |
| `macros/tsconfig.json` | Copied from `corevitals/` |
| `macros/LICENSE` | MIT, copied from `corevitals/` |
| `macros/.vscodeignore` | Copied from `corevitals/` (keeps specs, maps and sources out of the `.vsix`) |
| `macros/scripts/deploy.js` | Copies the build into `editor/plugins/cooklang.macros` |
| `macros/README.md` | User docs (stub in Task 1, full text in Task 11) |
| `macros/src/cooklang-api.ts` | Typed wrapper over `cooklang.api.*`: `version`, `supportsReports`, `hasFeature`, `renderReport`, `refreshBadges`; `PillBadge`, `PreviewOutletContext` types |
| `macros/src/cooklang-api.spec.ts` | Specs for the wrapper |
| `macros/src/support-check.ts` | Copied from `corevitals/`: caches whether the editor has the report commands |
| `macros/src/markdown.ts` | Copied from `corevitals/`: escape / truncate / list untrusted names |
| `macros/src/settings.ts` (+ spec) | `MacrosSettings`, `Basis`, `readSettings` normalisation |
| `macros/src/nutrition-template.ts` (+ spec) | `MACROS_TEMPLATE`, aggregate types, `isPlaceholder`, `parseMacrosOutput` validation |
| `macros/src/servings.ts` (+ spec) | Copied from `corevitals/`: `parseServings` from YAML frontmatter |
| `macros/src/match.ts` (+ spec) | `summarizeMatch` (placeholders + failures = unmatched), `isConfident` (≥ 70 %) |
| `macros/src/macros.ts` (+ spec) | Pure maths: portion (serving × scale / whole / 100 g / person-day), divisor, rounding, energy shares, withheld reason |
| `macros/src/hover.ts` (+ spec) | Hover markdown: table, energy, basis, matched n / m, unmatched, footer; locked and service-error tooltips |
| `macros/src/badge.ts` (+ spec) | Pill text within 24 chars, neutral / warning / locked pills |
| `macros/src/provider.ts` (+ spec) | The badge command: feature check, servings, render, cache, error mapping |
| `macros/src/extension.ts` | Wiring: output channel, API, support check, command, config-change refresh |
| `.github/workflows/ci.yml` (modify) | Add `macros` to the matrix |
| `README.md` (root, modify) | Add a `macros` row to the plugin table |

---

### Task 1: Scaffold the plugin and the API wrapper

**Files:**
- Create: `macros/package.json`, `macros/tsconfig.json`, `macros/LICENSE`, `macros/.vscodeignore`, `macros/scripts/deploy.js`, `macros/README.md`, `macros/src/cooklang-api.ts`, `macros/src/cooklang-api.spec.ts`, `macros/src/support-check.ts`, `macros/src/markdown.ts`, `macros/package-lock.json`

- [ ] **Step 1: Create the worktree and folder, and copy the files that need no changes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins && git fetch origin && git worktree add ../plugins-macros -b feature/macros origin/main
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
mkdir -p macros/src macros/scripts
cp corevitals/tsconfig.json corevitals/LICENSE corevitals/.vscodeignore macros/
cp corevitals/src/support-check.ts corevitals/src/markdown.ts macros/src/
sed 's#plugins/cooklang.nutriscore#plugins/cooklang.macros#' nutriscore/scripts/deploy.js > macros/scripts/deploy.js
grep -n "cooklang.macros" macros/scripts/deploy.js
```

Expected: the last command prints `const target = path.join(editor, 'plugins/cooklang.macros');`.

- [ ] **Step 2: Write `macros/package.json`**

```json
{
  "name": "macros",
  "displayName": "Macros",
  "description": "Protein, carbs and fat per serving on recipe previews and per person per day on meal plans, from the cook.md nutrition service. Needs a Basic or Pro plan.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "macros" },
  "keywords": ["cooklang", "nutrition", "macros", "protein", "meal plan", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "cooklang.macros.provideBadge", "title": "Macros", "category": "Macros" }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.macros.provideBadge", "when": "false" }
      ],
      "cooklang/recipePreview/badge": [
        { "command": "cooklang.macros.provideBadge" }
      ],
      "cooklang/menuPreview/badge": [
        { "command": "cooklang.macros.provideBadge" }
      ]
    },
    "configuration": {
      "title": "Macros",
      "properties": {
        "macros.showEnergy": {
          "type": "boolean",
          "default": true,
          "order": 1,
          "description": "Add the energy (kcal) to the pill when it fits. The hover always shows it."
        },
        "macros.basis": {
          "type": "string",
          "enum": ["serving", "100g"],
          "enumDescriptions": ["Per serving, from the recipe's servings: frontmatter (the whole recipe without one)", "Per 100 g of the finished dish"],
          "default": "serving",
          "order": 2,
          "description": "What recipe figures are per. Meal plans are always per person per day."
        },
        "macros.showWhenLocked": {
          "type": "boolean",
          "default": true,
          "order": 3,
          "description": "Show a greyed Macros pill with an upgrade hint when your plan doesn't include nutrition data."
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
    "publish:marketplace": "ovsx publish --packagePath macros-$npm_package_version.vsix -r https://plugins.cook.md"
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

- [ ] **Step 3: Write the README stub `macros/README.md`** (`vsce` needs one; Task 11 replaces it)

```markdown
# Macros

Protein, carbs and fat per serving on recipe previews, and per person per day on meal plans, in Cook Editor. Needs a Cook Basic or Pro plan.
```

- [ ] **Step 4: Install dependencies (creates `package-lock.json`)**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --version
cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm install
```

Expected: `v22.x`, then `added N packages`, and `macros/package-lock.json` exists.

- [ ] **Step 5: Write the failing test `macros/src/cooklang-api.spec.ts`**

```ts
import * as assert from 'assert';
import { CooklangApi } from './cooklang-api';

function recorder(result: unknown, commands: string[] = []): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('calls hasFeature and renderReport with one JSON argument', async () => {
        const { api, calls } = recorder(true);
        await api.hasFeature('nutrition_api');
        await api.renderReport({ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 });
        assert.deepStrictEqual(calls, [
            { command: 'cooklang.api.hasFeature', args: [{ name: 'nutrition_api' }] },
            { command: 'cooklang.api.renderReport', args: [{ uri: 'file:///a.cook', template: '{{ 1 }}', scale: 2 }] },
        ]);
    });

    it('reports support only when both report commands exist', async () => {
        assert.strictEqual(await recorder(undefined, ['cooklang.api.hasFeature', 'cooklang.api.renderReport']).api.supportsReports(), true);
        assert.strictEqual(await recorder(undefined, ['cooklang.api.renderReport']).api.supportsReports(), false);
    });

    it('refreshes badges only when the editor has the command', async () => {
        const old = recorder(undefined, []);
        assert.strictEqual(await old.api.refreshBadges(), false);
        assert.deepStrictEqual(old.calls, []);
        const current = recorder(undefined, ['cooklang.api.refreshBadges']);
        assert.strictEqual(await current.api.refreshBadges(), true);
        assert.deepStrictEqual(current.calls, [{ command: 'cooklang.api.refreshBadges', args: [] }]);
    });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL at `tsc` with `error TS2307: Cannot find module './cooklang-api'`.

- [ ] **Step 7: Write `macros/src/cooklang-api.ts`** (corevitals' wrapper without `openReport`)

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/plugin-report-types.ts`
// and `cooklang-outlet-context.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand`.

export const SUPPORTED_API_VERSION = 1;
export const REPORT_COMMANDS = ['cooklang.api.hasFeature', 'cooklang.api.renderReport'] as const;
/** Added after `renderReport`; older editors refresh badges on the next edit instead. */
export const REFRESH_BADGES_COMMAND = 'cooklang.api.refreshBadges';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };

export interface PreviewOutletContext {
    version: 1;
    uri: string;
    path: string;
    /** The recipe scale, or the menu scale on the menu preview. */
    scale: number;
}

/** The subset of the editor's `PreviewBadge` this plugin returns. `text` is at most 24 UTF-16 units. */
export interface PillBadge {
    kind: 'pill';
    text: string;
    tone: 'neutral' | 'good' | 'warning' | 'bad';
    tooltipMarkdown: string;
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    version(): Promise<number> {
        return this.call('cooklang.api.version');
    }

    async supportsReports(): Promise<boolean> {
        const commands = new Set(await this.listCommands());
        return REPORT_COMMANDS.every(command => commands.has(command));
    }

    hasFeature(name: string): Promise<boolean> {
        return this.call('cooklang.api.hasFeature', { name });
    }

    renderReport(args: { uri: string; template: string; scale: number }): Promise<PluginReportResult> {
        return this.call('cooklang.api.renderReport', args);
    }

    /** Asks open previews to re-query badges. False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.listCommands()).includes(REFRESH_BADGES_COMMAND)) {
            return false;
        }
        await this.call(REFRESH_BADGES_COMMAND);
        return true;
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

- [ ] **Step 8: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `3 passing`. `support-check.ts` and `markdown.ts` compile against this wrapper unchanged.

- [ ] **Step 9: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/package.json macros/package-lock.json macros/tsconfig.json macros/LICENSE macros/.vscodeignore macros/scripts/deploy.js macros/README.md macros/src/cooklang-api.ts macros/src/cooklang-api.spec.ts macros/src/support-check.ts macros/src/markdown.ts
git commit -m "feat(macros): scaffold the Macros plugin and the Cooklang API wrapper"
```

(`out/` and `node_modules/` are ignored by the repo's `.gitignore`.)

---

### Task 2: Settings

**Files:**
- Create: `macros/src/settings.ts`, `macros/src/settings.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/settings.spec.ts`**

```ts
import * as assert from 'assert';
import { readSettings } from './settings';

function reader(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

describe('readSettings', () => {
    it('defaults to energy on, per serving, locked pill shown', () => {
        assert.deepStrictEqual(readSettings(reader({})), { showEnergy: true, basis: 'serving', showWhenLocked: true });
    });

    it('reads explicit values', () => {
        assert.deepStrictEqual(
            readSettings(reader({ showEnergy: false, basis: '100g', showWhenLocked: false })),
            { showEnergy: false, basis: '100g', showWhenLocked: false },
        );
    });

    it('falls back to defaults for malformed values', () => {
        assert.deepStrictEqual(
            readSettings(reader({ showEnergy: 'no', basis: 'portion', showWhenLocked: 0 })),
            { showEnergy: true, basis: 'serving', showWhenLocked: true },
        );
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './settings'`.

- [ ] **Step 3: Write `macros/src/settings.ts`**

```ts
/** What the recipe figures are per: one serving, or 100 g of the dish. Plans are always per person per day. */
export type Basis = 'serving' | '100g';

export interface MacrosSettings {
    /** Append the energy (kcal) to the pill. */
    showEnergy: boolean;
    basis: Basis;
    /** Show a greyed `🔒 Macros` pill when the plan lacks nutrition data. */
    showWhenLocked: boolean;
}

/** Reads one setting under `macros.`; extension.ts passes `getConfiguration('macros').get`. */
export type ReadSetting = (key: string) => unknown;

/** Normalises the raw `macros.*` values; anything malformed falls back to its default. */
export function readSettings(read: ReadSetting): MacrosSettings {
    return {
        showEnergy: read('showEnergy') !== false,
        basis: read('basis') === '100g' ? '100g' : 'serving',
        showWhenLocked: read('showWhenLocked') !== false,
    };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `6 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/settings.ts macros/src/settings.spec.ts
git commit -m "feat(macros): read and normalise the macros.* settings"
```

---

### Task 3: Template and output validation

The template is copied in spirit from `nutriscore/src/nutrition-template.ts`, without the category lookups. It adds the `plan` branch that `corevitals/src/vitals-template.ts` uses (`plan.all_ingredients`, `plan.days`, `plan.servings`, `plan.missing_recipes`). The validator copies Nutri-Score's checks: totals must be sound, and malformed items or failures are dropped. Plan counts must be integers ≥ 1.

**Files:**
- Create: `macros/src/nutrition-template.ts`, `macros/src/nutrition-template.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/nutrition-template.spec.ts`**

```ts
import * as assert from 'assert';
import { MACROS_TEMPLATE, NutritionItem, isPlaceholder, parseMacrosOutput } from './nutrition-template';

const macros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

const aggregate = {
    items: [
        { ingredient: 'chicken', preparation: '', amount: { value: 600, unit: 'g', mass_g: 600 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
        { ingredient: 'rice', preparation: '', amount: { value: 300, unit: 'g', mass_g: 300 }, macros: {}, micros: {}, source: 'usda', confidence: 'confirmed', warnings: [] },
    ],
    failures: [],
    totals: { mass_g: 900, macros, micros: {}, confidence: 'confirmed', confidence_weighted: 'confirmed', is_partial: false, included_count: 2, failed_count: 0 },
};

describe('MACROS_TEMPLATE', () => {
    it('aggregates plan ingredients for menus and recipe ingredients otherwise, returning JSON', () => {
        assert.ok(MACROS_TEMPLATE.startsWith('{%- if plan is defined -%}'));
        assert.ok(MACROS_TEMPLATE.includes('aggregate_nutrition(plan.all_ingredients)'));
        assert.ok(MACROS_TEMPLATE.includes('aggregate_nutrition(ingredients)'));
        assert.ok(MACROS_TEMPLATE.includes('plan.missing_recipes | map(attribute="name") | list'));
        assert.strictEqual(MACROS_TEMPLATE.split('| tojson }}').length, 3);
        assert.ok(MACROS_TEMPLATE.trimEnd().endsWith('{%- endif -%}'));
    });
});

describe('parseMacrosOutput', () => {
    it('reads a recipe payload and keeps only the fields it needs', () => {
        const data = parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate }));
        assert.strictEqual(data?.kind, 'recipe');
        assert.deepStrictEqual(data?.aggregate.totals, { mass_g: 900, macros });
        assert.strictEqual(data?.aggregate.items.length, 2);
    });

    it('reads a plan payload with days, people and missing recipes', () => {
        const data = parseMacrosOutput(JSON.stringify({ kind: 'plan', aggregate, days: 7, people: 2, missingRecipes: ['Curry', 3] }));
        assert.deepStrictEqual(data && data.kind === 'plan' ? [data.days, data.people, data.missingRecipes] : undefined, [7, 2, ['Curry']]);
    });

    it('rejects a plan with a non-positive or fractional day or people count', () => {
        for (const bad of [{ days: 0, people: 2 }, { days: 7, people: 0 }, { days: 1.5, people: 2 }, { days: 7, people: '2' }]) {
            assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'plan', aggregate, missingRecipes: [], ...bad })), undefined);
        }
    });

    it('rejects output that is not the template result', () => {
        assert.strictEqual(parseMacrosOutput('not json'), undefined);
        assert.strictEqual(parseMacrosOutput('[]'), undefined);
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: {} })), undefined);
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'other', aggregate })), undefined);
    });

    it('rejects totals with a missing or non-numeric macro field', () => {
        const { kcal, ...withoutKcal } = macros;
        void kcal;
        const missing = { ...aggregate, totals: { mass_g: 900, macros: withoutKcal } };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: missing })), undefined);
        const stringField = { ...aggregate, totals: { mass_g: 900, macros: { ...macros, protein_g: '12' } } };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: stringField })), undefined);
        const nullTotals = { ...aggregate, totals: null };
        assert.strictEqual(parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: nullTotals })), undefined);
    });

    it('drops malformed items and failures but keeps valid ones', () => {
        const withJunk = {
            ...aggregate,
            items: [...aggregate.items, { ingredient: 'x' }, { amount: { mass_g: 9 } }, 'nope', null],
            failures: [{ ingredient: 'salt' }, { error: {} }, 42],
        };
        const data = parseMacrosOutput(JSON.stringify({ kind: 'recipe', aggregate: withJunk }));
        assert.strictEqual(data?.aggregate.items.length, 2);
        assert.deepStrictEqual(data?.aggregate.failures.map(failure => failure.ingredient), ['salt']);
    });
});

describe('isPlaceholder', () => {
    const base = { ingredient: 'x', amount: { mass_g: 0 } };

    it('detects a nutrition_placeholder warning object or bare string', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: [{ code: 'nutrition_placeholder', message: 'unresolved' }] }), true);
        assert.strictEqual(isPlaceholder({ ...base, warnings: ['nutrition_placeholder'] }), true);
    });

    it('is false for other warnings, no warnings, or a non-array warnings field', () => {
        assert.strictEqual(isPlaceholder({ ...base, warnings: [{ code: 'something_else' }] }), false);
        assert.strictEqual(isPlaceholder({ ...base, warnings: [] }), false);
        assert.strictEqual(isPlaceholder({ ...base }), false);
        assert.strictEqual(isPlaceholder({ ...base, warnings: 'nutrition_placeholder' } as unknown as NutritionItem), false);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './nutrition-template'`.

- [ ] **Step 3: Write `macros/src/nutrition-template.ts`**

```ts
// The Jinja template this plugin asks the editor's Reports engine to render, and
// validation of what comes back. Copied from nutriscore/src/nutrition-template.ts
// and trimmed: no category lookups, plus a `plan` branch for `.menu` files (the
// engine exposes `plan` there, as Core Vitals uses it). Types mirror the cook.md
// nutrition service's `/aggregate` response (snake_case, verbatim).

export interface NutritionMacros {
    kcal: number;
    protein_g: number;
    fat_g: number;
    carb_g: number;
    fiber_g: number;
    sugar_g: number;
    sat_fat_g: number;
}

export interface NutritionItem {
    ingredient: string;
    amount: { mass_g: number };
    /** May be missing entirely on older service versions; treat as no warnings. */
    warnings?: unknown[];
}

export interface NutritionFailure {
    ingredient: string;
}

export interface NutritionAggregate {
    items: NutritionItem[];
    failures: NutritionFailure[];
    totals: {
        mass_g: number;
        macros: NutritionMacros;
    };
}

/** A recipe: the aggregate of its (already scaled) ingredients. */
export interface RecipeOutput {
    kind: 'recipe';
    aggregate: NutritionAggregate;
}

/** A `.menu` plan: the aggregate of every expanded recipe, and what to divide it by. */
export interface PlanOutput {
    kind: 'plan';
    aggregate: NutritionAggregate;
    /** Sections of the menu (`= Day … =`), at least 1. */
    days: number;
    /** The menu's numeric `servings:` frontmatter, at least 1. */
    people: number;
    /** Recipe references the engine could not expand; their ingredients are missing from the totals. */
    missingRecipes: string[];
}

export type MacrosOutput = RecipeOutput | PlanOutput;

const PLACEHOLDER_WARNING_CODE = 'nutrition_placeholder';

/**
 * True when the nutrition service could not resolve this ingredient: it returns it as a normal
 * `items[]` entry with `mass_g: 0` and zero macros, tagged with a `nutrition_placeholder` warning.
 * Warnings are normally `{ code: string, ... }` objects, but a bare string warning is accepted
 * defensively too. A missing `warnings` field means not a placeholder.
 */
export function isPlaceholder(item: NutritionItem): boolean {
    if (!Array.isArray(item.warnings)) {
        return false;
    }
    return item.warnings.some(warning => {
        if (typeof warning === 'string') {
            return warning === PLACEHOLDER_WARNING_CODE;
        }
        return isPlainObject(warning) && warning.code === PLACEHOLDER_WARNING_CODE;
    });
}

/**
 * One template for recipes and plans. `plan` is only defined for `.menu` files; plans default to
 * 1 day and 1 person exactly like Core Vitals' template. The output is passed through `tojson`.
 */
export const MACROS_TEMPLATE = [
    '{%- if plan is defined -%}',
    '{%- set agg = aggregate_nutrition(plan.all_ingredients) -%}',
    '{%- set days = (plan.days | length) if (plan.days | length) > 0 else 1 -%}',
    '{%- set people = plan.servings if (plan.servings is defined and plan.servings is not none and plan.servings is number and plan.servings >= 1) else 1 -%}',
    '{{ {"kind": "plan", "aggregate": agg, "days": days, "people": people, "missingRecipes": (plan.missing_recipes | map(attribute="name") | list)} | tojson }}',
    '{%- else -%}',
    '{%- set agg = aggregate_nutrition(ingredients) -%}',
    '{{ {"kind": "recipe", "aggregate": agg} | tojson }}',
    '{%- endif -%}',
].join('\n');

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MACRO_FIELDS: readonly (keyof NutritionMacros)[] = ['kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sat_fat_g'];

function isNutritionMacros(value: unknown): value is NutritionMacros {
    return isPlainObject(value) && MACRO_FIELDS.every(field => isFiniteNumber(value[field]));
}

function isNutritionItem(value: unknown): value is NutritionItem {
    return isPlainObject(value) && typeof value.ingredient === 'string'
        && isPlainObject(value.amount) && isFiniteNumber(value.amount.mass_g);
}

function isNutritionFailure(value: unknown): value is NutritionFailure {
    return isPlainObject(value) && typeof value.ingredient === 'string';
}

function isCountAtLeastOne(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

/**
 * Validates an untrusted `aggregate` payload: rejects it when `totals` is structurally unsound,
 * and drops malformed `items`/`failures` entries instead of letting them crash callers later.
 */
function toNutritionAggregate(value: unknown): NutritionAggregate | undefined {
    if (!isPlainObject(value) || !Array.isArray(value.items) || !Array.isArray(value.failures)) {
        return undefined;
    }
    const totals = value.totals;
    if (!isPlainObject(totals) || !isFiniteNumber(totals.mass_g) || !isNutritionMacros(totals.macros)) {
        return undefined;
    }
    return {
        items: value.items.filter(isNutritionItem),
        failures: value.failures.filter(isNutritionFailure),
        totals: { mass_g: totals.mass_g, macros: totals.macros },
    };
}

/** Validates the template output; undefined when it is not a Macros payload. */
export function parseMacrosOutput(output: string): MacrosOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data)) {
        return undefined;
    }
    const aggregate = toNutritionAggregate(data.aggregate);
    if (!aggregate) {
        return undefined;
    }
    if (data.kind === 'recipe') {
        return { kind: 'recipe', aggregate };
    }
    if (data.kind !== 'plan' || !isCountAtLeastOne(data.days) || !isCountAtLeastOne(data.people) || !Array.isArray(data.missingRecipes)) {
        return undefined;
    }
    const missingRecipes = data.missingRecipes.filter((name): name is string => typeof name === 'string');
    return { kind: 'plan', aggregate, days: data.days, people: data.people, missingRecipes };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `15 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/nutrition-template.ts macros/src/nutrition-template.spec.ts
git commit -m "feat(macros): nutrition template for recipes and plans, with output validation"
```

---

### Task 4: Servings (copied from Core Vitals)

**Files:**
- Create: `macros/src/servings.spec.ts`, `macros/src/servings.ts` (both copied verbatim from `corevitals/src/`)

- [ ] **Step 1: Copy the spec first**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros && cp corevitals/src/servings.spec.ts macros/src/servings.spec.ts
```

The spec, for reference:

```ts
import * as assert from 'assert';
import { parseServings } from './servings';

describe('parseServings', () => {
    it('reads the leading integer of servings: in the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: Pancakes\nservings: 4\n---\nMix @eggs{2}.'), 4);
        assert.strictEqual(parseServings('---\nservings: 6 people\n---\n'), 6);
        assert.strictEqual(parseServings('---\r\nServings:   2\r\n---\r\n'), 2);
    });

    it('returns undefined without a frontmatter block or a numeric servings', () => {
        assert.strictEqual(parseServings('Mix @eggs{2}.'), undefined);
        assert.strictEqual(parseServings('---\nservings: a few\n---\n'), undefined);
        assert.strictEqual(parseServings('---\nservings: 0\n---\n'), undefined);
        assert.strictEqual(parseServings(''), undefined);
    });

    it('skips a leading BOM and stops at the first servings key', () => {
        assert.strictEqual(parseServings('\uFEFF---\nservings: 3\n---\n'), 3);
        assert.strictEqual(parseServings('---\nservings: 0\nserves: 4\n---\n'), undefined);
    });

    it('ignores a servings line outside the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: x\n---\nservings: 4\n'), undefined);
        assert.strictEqual(parseServings('intro\n---\nservings: 4\n---\n'), undefined);
    });

    it('accepts the serves and yield aliases and a quoted number', () => {
        assert.strictEqual(parseServings('---\nserves: 4\n---\n'), 4);
        assert.strictEqual(parseServings('---\nyield: 6 portions\n---\n'), 6);
        assert.strictEqual(parseServings('---\nservings: "4"\n---\n'), 4);
        assert.strictEqual(parseServings('---\nservings: \'2\'\n---\n'), 2);
    });

    it('needs a closed frontmatter block', () => {
        assert.strictEqual(parseServings('---\ntitle: x\nservings: 4\n'), undefined);
    });

    it('treats values above the bound as unknown', () => {
        assert.strictEqual(parseServings('---\nservings: 99999\n---\n'), undefined);
        assert.strictEqual(parseServings('---\nservings: 1000\n---\n'), 1000);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './servings'`.

- [ ] **Step 3: Copy the implementation**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros && cp corevitals/src/servings.ts macros/src/servings.ts
```

For reference:

```ts
/** Servings above this are treated as unknown (almost certainly a typo). */
export const MAX_SERVINGS = 1000;

/**
 * The recipe's servings from its YAML frontmatter (the block between a `---`
 * first line and the next `---` line), as a positive integer. The keys
 * `servings`, `serves` and `yield` are accepted case-insensitively, and the
 * number may be quoted: `4`, `"4"` and `4 people` all give 4. Undefined when
 * absent, non-numeric, zero, above {@link MAX_SERVINGS}, or when the block is
 * never closed. Only the frontmatter is read; the plugin never parses the
 * recipe body.
 */
export function parseServings(text: string): number | undefined {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return undefined;
    }
    let servings: number | undefined;
    let matched = false;
    for (const line of lines.slice(1)) {
        if (line.trim() === '---') {
            return servings;
        }
        const match = /^(servings|serves|yield)\s*:\s*["']?(\d+)/i.exec(line);
        if (match && !matched) {
            matched = true;
            const value = Number.parseInt(match[2], 10);
            servings = value >= 1 && value <= MAX_SERVINGS ? value : undefined;
        }
    }
    return undefined;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `22 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/servings.ts macros/src/servings.spec.ts
git commit -m "feat(macros): parse servings from recipe frontmatter (copied from Core Vitals)"
```

---

### Task 5: Confidence threshold

The 70 % rule from Nutri-Score's `trust.ts` and Core Vitals' `verdict.ts` counts ingredients, not mass. Placeholders and failures both count as unmatched.

**Files:**
- Create: `macros/src/match.ts`, `macros/src/match.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/match.spec.ts`**

```ts
import * as assert from 'assert';
import { isConfident, summarizeMatch } from './match';
import { NutritionAggregate } from './nutrition-template';

const zero = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 };

function aggregate(matched: number, placeholders: string[], failures: string[]): NutritionAggregate {
    return {
        items: [
            ...Array.from({ length: matched }, (_, index) => ({ ingredient: `item ${index}`, amount: { mass_g: 100 }, warnings: [] })),
            ...placeholders.map(ingredient => ({ ingredient, amount: { mass_g: 0 }, warnings: [{ code: 'nutrition_placeholder' }] })),
        ],
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: matched * 100, macros: zero },
    };
}

describe('summarizeMatch', () => {
    it('counts placeholders and failures as unmatched, failures listed first', () => {
        assert.deepStrictEqual(summarizeMatch(aggregate(3, ['chana dal'], ['ghee'])), { matched: 3, total: 5, unmatched: ['ghee', 'chana dal'] });
    });

    it('is empty for a recipe without ingredients', () => {
        assert.deepStrictEqual(summarizeMatch(aggregate(0, [], [])), { matched: 0, total: 0, unmatched: [] });
    });
});

describe('isConfident', () => {
    it('needs at least 70 % matched', () => {
        assert.strictEqual(isConfident(summarizeMatch(aggregate(7, [], ['a', 'b', 'c']))), true);
        assert.strictEqual(isConfident(summarizeMatch(aggregate(6, ['a'], ['b', 'c', 'd']))), false);
        assert.strictEqual(isConfident(summarizeMatch(aggregate(2, [], ['a']))), false);
    });

    it('is false when nothing could be evaluated', () => {
        assert.strictEqual(isConfident(summarizeMatch(aggregate(0, [], []))), false);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './match'`.

- [ ] **Step 3: Write `macros/src/match.ts`**

```ts
import { NutritionAggregate, isPlaceholder } from './nutrition-template';

/** At least 70 % of the ingredients (by count) must have matched the nutrition database. */
export const MIN_MATCHED_SHARE = 0.7;

export interface MatchSummary {
    matched: number;
    /** Matched + placeholders + failures. */
    total: number;
    /** Failures first, then placeholders, in service order. */
    unmatched: string[];
}

/**
 * Counts how many ingredients the service resolved. `nutrition_placeholder` items (mass 0, zero
 * macros) and `failures[]` both count as unmatched, as in Nutri-Score and Core Vitals. Only the
 * validated arrays are trusted for counts, never the service's `included_count`/`failed_count`.
 */
export function summarizeMatch(aggregate: NutritionAggregate): MatchSummary {
    const placeholders = aggregate.items.filter(isPlaceholder);
    const matched = aggregate.items.length - placeholders.length;
    const unmatched = [...aggregate.failures.map(failure => failure.ingredient), ...placeholders.map(item => item.ingredient)];
    return { matched, total: matched + unmatched.length, unmatched };
}

/** True when there is something to show and at least {@link MIN_MATCHED_SHARE} of it matched. */
export function isConfident(summary: MatchSummary): boolean {
    return summary.total > 0 && summary.matched / summary.total >= MIN_MATCHED_SHARE;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `26 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/match.ts macros/src/match.spec.ts
git commit -m "feat(macros): ingredient match summary and the 70 % confidence threshold"
```

---

### Task 6: Macros maths

Per serving, scaled preview, no servings, per 100 g, menu people × days, rounding, and withheld reasons. The fixture is chicken and rice for 4: 152 g protein, 208 g carbs, 56 g fat, 2080 kcal, 900 g. That gives `38P 52C 14F · 520 kcal` per serving.

**Files:**
- Create: `macros/src/macros.ts`, `macros/src/macros.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/macros.spec.ts`**

```ts
import * as assert from 'assert';
import { computeMacros, normaliseScale, roundGrams, roundKcal } from './macros';
import { MacrosOutput, NutritionAggregate, NutritionMacros } from './nutrition-template';

// Chicken & rice for 4: 152 g protein, 208 g carbs, 56 g fat, 2080 kcal, 900 g.
const MACROS: NutritionMacros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

function aggregate(macros: NutritionMacros = MACROS, massG = 900, failures: string[] = []): NutritionAggregate {
    return {
        items: Array.from({ length: 4 }, (_, index) => ({ ingredient: `item ${index}`, amount: { mass_g: massG / 4 }, warnings: [] })),
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: massG, macros },
    };
}

function times(macros: NutritionMacros, factor: number): NutritionMacros {
    return {
        kcal: macros.kcal * factor, protein_g: macros.protein_g * factor, fat_g: macros.fat_g * factor, carb_g: macros.carb_g * factor,
        fiber_g: macros.fiber_g * factor, sugar_g: macros.sugar_g * factor, sat_fat_g: macros.sat_fat_g * factor,
    };
}

const recipe = (agg: NutritionAggregate = aggregate()): MacrosOutput => ({ kind: 'recipe', aggregate: agg });

describe('rounding', () => {
    it('rounds grams to integers and kcal to the nearest 10', () => {
        assert.strictEqual(roundGrams(37.5), 38);
        assert.strictEqual(roundGrams(0.4), 0);
        assert.strictEqual(roundKcal(524), 520);
        assert.strictEqual(roundKcal(525), 530);
        assert.strictEqual(roundKcal(4), 0);
        assert.ok(Object.is(roundGrams(-0.2), 0));
    });

    it('normalises a missing or broken scale to 1', () => {
        assert.strictEqual(normaliseScale(2), 2);
        assert.strictEqual(normaliseScale(0), 1);
        assert.strictEqual(normaliseScale(Number.NaN), 1);
        assert.strictEqual(normaliseScale(-1), 1);
    });
});

describe('computeMacros', () => {
    it('divides by the servings per serving', () => {
        const result = computeMacros(recipe(), { basis: 'serving', servings: 4, scale: 1 });
        assert.deepStrictEqual(result.portion, { kind: 'serving', servings: 4 });
        assert.deepStrictEqual(result.figures, { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 });
        // 608 + 832 + 504 = 1944 kcal from macros.
        assert.deepStrictEqual(result.shares, { protein: 31, carb: 43, fat: 26 });
        assert.strictEqual(result.withheld, undefined);
    });

    it('keeps per-serving figures when the preview is scaled (the engine scaled the totals)', () => {
        const scaled = computeMacros(recipe(aggregate(times(MACROS, 2), 1800)), { basis: 'serving', servings: 4, scale: 2 });
        const plain = computeMacros(recipe(), { basis: 'serving', servings: 4, scale: 1 });
        assert.deepStrictEqual(scaled.portion, { kind: 'serving', servings: 8 });
        assert.deepStrictEqual(scaled.figures, plain.figures);
    });

    it('shows the whole recipe without servings', () => {
        const result = computeMacros(recipe(), { basis: 'serving', servings: undefined, scale: 1 });
        assert.deepStrictEqual(result.portion, { kind: 'whole' });
        assert.deepStrictEqual(result.figures, { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 });
    });

    it('scales per 100 g by the total mass, ignoring servings and scale', () => {
        const result = computeMacros(recipe(aggregate(times(MACROS, 3), 2700)), { basis: '100g', servings: 4, scale: 3 });
        assert.deepStrictEqual(result.portion, { kind: '100g' });
        // 2080 / 9 = 231.1 kcal, 152 / 9 = 16.9 g protein per 100 g.
        assert.deepStrictEqual(result.figures, { kcal: 230, protein_g: 17, fat_g: 6, carb_g: 23, fiber_g: 3, sugar_g: 4, sat_fat_g: 2 });
    });

    it('withholds per-100 g figures when the service could not weigh the recipe', () => {
        const result = computeMacros(recipe(aggregate(MACROS, 0)), { basis: '100g', servings: undefined, scale: 1 });
        assert.strictEqual(result.withheld, 'notWeighed');
        assert.strictEqual(result.figures, undefined);
    });

    it('divides a plan by people × days, whatever the basis', () => {
        // A week for two: 14 × the daily intake.
        const week = aggregate(times({ kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 }, 14), 30000);
        const plan: MacrosOutput = { kind: 'plan', aggregate: week, days: 7, people: 2, missingRecipes: [] };
        const result = computeMacros(plan, { basis: '100g', servings: 4, scale: 3 });
        assert.deepStrictEqual(result.portion, { kind: 'day', people: 2, days: 7 });
        assert.deepStrictEqual(result.figures, { kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 });
    });

    it('withholds figures when fewer than 70 % of ingredients matched, listing the unmatched', () => {
        const result = computeMacros(recipe(aggregate(MACROS, 900, ['ghee', 'garam masala'])), { basis: 'serving', servings: 4, scale: 1 });
        assert.strictEqual(result.withheld, 'unmatched');
        assert.deepStrictEqual(result.match, { matched: 4, total: 6, unmatched: ['ghee', 'garam masala'] });
        assert.strictEqual(result.figures, undefined);
    });

    it('withholds figures for a plan with a missing recipe', () => {
        const plan: MacrosOutput = { kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: ['Curry'] };
        const result = computeMacros(plan, { basis: 'serving', servings: undefined, scale: 1 });
        assert.strictEqual(result.withheld, 'missingRecipes');
        assert.deepStrictEqual(result.missingRecipes, ['Curry']);
    });

    it('withholds figures when there is nothing to evaluate', () => {
        const empty: NutritionAggregate = { items: [], failures: [], totals: { mass_g: 0, macros: times(MACROS, 0) } };
        assert.strictEqual(computeMacros(recipe(empty), { basis: 'serving', servings: 4, scale: 1 }).withheld, 'noData');
    });

    it('leaves the energy shares out when the macros supply no energy', () => {
        const water = aggregate({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sat_fat_g: 0 });
        assert.strictEqual(computeMacros(recipe(water), { basis: 'serving', servings: 1, scale: 1 }).shares, undefined);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './macros'`.

- [ ] **Step 3: Write `macros/src/macros.ts`**

```ts
import { MatchSummary, isConfident, summarizeMatch } from './match';
import { MacrosOutput, NutritionMacros } from './nutrition-template';
import { Basis } from './settings';

/** What the figures are per. `servings` is the frontmatter value times the preview scale. */
export type Portion =
    | { kind: 'serving'; servings: number }
    | { kind: 'whole' }
    | { kind: '100g' }
    | { kind: 'day'; people: number; days: number };

/** Why no figures are shown: nothing to evaluate, too few matches, a plan recipe missing, or no weight for per-100 g. */
export type WithheldReason = 'noData' | 'unmatched' | 'missingRecipes' | 'notWeighed';

/** Rounded figures: grams to whole numbers, kcal to the nearest 10. */
export type MacroFigures = NutritionMacros;

/** Protein, carbohydrate and fat as whole % of the energy they supply (4 / 4 / 9 kcal per g). */
export interface EnergyShares {
    protein: number;
    carb: number;
    fat: number;
}

export interface MacrosResult {
    portion: Portion;
    /** Set when the figures are not shown; `figures` and `shares` are then undefined. */
    withheld?: WithheldReason;
    figures?: MacroFigures;
    /** Undefined when the macros supply no energy. */
    shares?: EnergyShares;
    match: MatchSummary;
    missingRecipes: string[];
}

export interface MacrosOptions {
    basis: Basis;
    /** Recipe `servings:` from the frontmatter; undefined when absent. Ignored for plans. */
    servings: number | undefined;
    /** The scale the recipe was rendered at (the engine scales the ingredients by it). */
    scale: number;
}

/** A usable preview scale; anything else renders at 1. */
export function normaliseScale(scale: number): number {
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function roundGrams(grams: number): number {
    return Math.round(grams) + 0;
}

export function roundKcal(kcal: number): number {
    return Math.round(kcal / 10) * 10 + 0;
}

function portionFor(output: MacrosOutput, options: MacrosOptions): Portion {
    if (output.kind === 'plan') {
        return { kind: 'day', people: output.people, days: output.days };
    }
    if (options.basis === '100g') {
        return { kind: '100g' };
    }
    if (options.servings !== undefined) {
        // The engine scaled the ingredients, so scale the servings too: per-serving figures stay put.
        return { kind: 'serving', servings: options.servings * normaliseScale(options.scale) };
    }
    return { kind: 'whole' };
}

function divisorFor(portion: Portion, massG: number): number {
    switch (portion.kind) {
        case 'serving': return portion.servings;
        case 'whole': return 1;
        case '100g': return massG / 100;
        case 'day': return portion.people * portion.days;
        default: {
            const never: never = portion;
            return never;
        }
    }
}

function energyShares(macros: NutritionMacros): EnergyShares | undefined {
    const protein = macros.protein_g * 4;
    const carb = macros.carb_g * 4;
    const fat = macros.fat_g * 9;
    const energy = protein + carb + fat;
    if (!(energy > 0)) {
        return undefined;
    }
    return {
        protein: Math.round(protein / energy * 100),
        carb: Math.round(carb / energy * 100),
        fat: Math.round(fat / energy * 100),
    };
}

/** Turns a validated template output into the figures the badge and hover show. */
export function computeMacros(output: MacrosOutput, options: MacrosOptions): MacrosResult {
    const portion = portionFor(output, options);
    const match = summarizeMatch(output.aggregate);
    const missingRecipes = output.kind === 'plan' ? output.missingRecipes : [];
    const totals = output.aggregate.totals;
    let withheld: WithheldReason | undefined;
    if (match.total === 0) {
        withheld = 'noData';
    } else if (missingRecipes.length > 0) {
        withheld = 'missingRecipes';
    } else if (!isConfident(match)) {
        withheld = 'unmatched';
    } else if (portion.kind === '100g' && !(totals.mass_g > 0)) {
        withheld = 'notWeighed';
    }
    if (withheld) {
        return { portion, withheld, match, missingRecipes };
    }
    const divisor = divisorFor(portion, totals.mass_g);
    const m = totals.macros;
    const figures: MacroFigures = {
        kcal: roundKcal(m.kcal / divisor),
        protein_g: roundGrams(m.protein_g / divisor),
        fat_g: roundGrams(m.fat_g / divisor),
        carb_g: roundGrams(m.carb_g / divisor),
        fiber_g: roundGrams(m.fiber_g / divisor),
        sugar_g: roundGrams(m.sugar_g / divisor),
        sat_fat_g: roundGrams(m.sat_fat_g / divisor),
    };
    return { portion, figures, shares: energyShares(m), match, missingRecipes };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `38 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/macros.ts macros/src/macros.spec.ts
git commit -m "feat(macros): per-serving, per-100 g and per-person-per-day figures with rounding"
```

---

### Task 7: Hover

**Files:**
- Create: `macros/src/hover.ts`, `macros/src/hover.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/hover.spec.ts`**

```ts
import * as assert from 'assert';
import { FOOTER, MAX_HOVER_LENGTH, WHOLE_RECIPE_NOTE, basisLine, hoverMarkdown, serviceErrorTooltip } from './hover';
import { MacrosResult } from './macros';

const OK: MacrosResult = {
    portion: { kind: 'serving', servings: 4 },
    figures: { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 },
    shares: { protein: 31, carb: 43, fat: 26 },
    match: { matched: 9, total: 10, unmatched: ['salt'] },
    missingRecipes: [],
};

describe('basisLine', () => {
    it('names each basis', () => {
        assert.strictEqual(basisLine({ kind: 'serving', servings: 4 }), 'Per serving (4 servings)');
        assert.strictEqual(basisLine({ kind: 'serving', servings: 1 }), 'Per serving (1 serving)');
        assert.strictEqual(basisLine({ kind: 'serving', servings: 4 / 3 }), 'Per serving (1.33 servings)');
        assert.strictEqual(basisLine({ kind: 'whole' }), `Whole recipe · ${WHOLE_RECIPE_NOTE}`);
        assert.strictEqual(basisLine({ kind: '100g' }), 'Per 100 g');
        assert.strictEqual(basisLine({ kind: 'day', people: 2, days: 7 }), 'Per person per day (2 people × 7 days)');
        assert.strictEqual(basisLine({ kind: 'day', people: 1, days: 1 }), 'Per person per day (1 person × 1 day)');
    });
});

describe('hoverMarkdown', () => {
    it('shows the table, energy, match count, unmatched names and footer', () => {
        assert.strictEqual(hoverMarkdown(OK), [
            '**Macros**',
            'Per serving (4 servings)',
            [
                '| | g | % energy |',
                '|---|---:|---:|',
                '| Protein | 38 | 31 % |',
                '| Carbs | 52 | 43 % |',
                '| Fat | 14 | 26 % |',
                '| Fiber | 6 | |',
                '| Sugar | 9 | |',
                '| Saturated fat | 4 | |',
            ].join('\n'),
            'Energy: **520 kcal**',
            'Ingredients matched: 9 / 10',
            'Not matched: salt',
            FOOTER,
        ].join('\n\n'));
    });

    it('says why figures are withheld and escapes unmatched names', () => {
        const text = hoverMarkdown({
            portion: { kind: 'serving', servings: 4 }, withheld: 'unmatched',
            match: { matched: 2, total: 5, unmatched: ['# heading', '[x](https://evil)', 'ghee'] }, missingRecipes: [],
        });
        assert.ok(text.startsWith('**Macros** · not enough data\n\nPer serving (4 servings)\n\nOnly 2 of 5 ingredients matched'));
        assert.ok(text.includes('Not matched: \\# heading, \\[x\\]\\(https\\://evil\\), ghee'));
        assert.ok(!text.includes('| Protein'));
        assert.ok(text.endsWith(FOOTER));
    });

    it('lists missing plan recipes', () => {
        const text = hoverMarkdown({
            portion: { kind: 'day', people: 2, days: 7 }, withheld: 'missingRecipes',
            match: { matched: 10, total: 10, unmatched: [] }, missingRecipes: ['Curry'],
        });
        assert.ok(text.includes('Missing recipes, so the totals would undercount: Curry'));
    });

    it('stays under the editor limit with a huge unmatched list', () => {
        const names = Array.from({ length: 500 }, (_, index) => `ingredient number ${index} with a long name`.repeat(3));
        const text = hoverMarkdown({ ...OK, match: { matched: 500, total: 1000, unmatched: names } });
        assert.ok(text.length <= MAX_HOVER_LENGTH);
    });
});

describe('serviceErrorTooltip', () => {
    it('escapes the reason and message', () => {
        assert.strictEqual(
            serviceErrorTooltip('network', 'transport error: <b>'),
            '**Macros** · unavailable\n\nThe cook.md nutrition service did not answer (network): transport error\\: \\<b\\>\n\nTry again later; the pill refreshes on the next edit.',
        );
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './hover'`.

- [ ] **Step 3: Write `macros/src/hover.ts`**

```ts
import { MacrosResult, Portion, WithheldReason } from './macros';
import { escapeMarkdown, formatNames } from './markdown';

/** The editor truncates `tooltipMarkdown` at 4000 characters; stay clear of it. */
export const MAX_HOVER_LENGTH = 3900;

export const FOOTER = '_Estimated from the cook.md nutrition service._';

/** Tooltip of the greyed `🔒 Macros` pill. */
export const LOCKED_TOOLTIP = `**Macros** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to see protein, carbs and fat per serving and per day.

[See plans](https://cook.md/pricing)`;

export const WHOLE_RECIPE_NOTE = 'No `servings:` in the frontmatter, so this is the whole recipe.';

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** `4` → `4`, `2.5` → `2.5`, `1.3333` → `1.33`: scaled servings can be fractional. */
function formatCount(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/** The basis line under the title. */
export function basisLine(portion: Portion): string {
    switch (portion.kind) {
        case 'serving': return `Per serving (${formatCount(portion.servings)} serving${portion.servings === 1 ? '' : 's'})`;
        case 'whole': return `Whole recipe · ${WHOLE_RECIPE_NOTE}`;
        case '100g': return 'Per 100 g';
        case 'day': return `Per person per day (${plural(portion.people, 'person', 'people')} × ${plural(portion.days, 'day', 'days')})`;
        default: {
            const never: never = portion;
            return never;
        }
    }
}

function withheldLine(result: MacrosResult, reason: WithheldReason): string {
    switch (reason) {
        case 'unmatched': return `Only ${result.match.matched} of ${result.match.total} ingredients matched the nutrition database, so the figures would be misleading.`;
        case 'missingRecipes': return `Missing recipes, so the totals would undercount: ${formatNames(result.missingRecipes)}`;
        case 'noData': return result.portion.kind === 'day' ? 'This plan has no recipes that could be evaluated.' : 'This recipe has no ingredients that could be evaluated.';
        case 'notWeighed': return "Ingredient weights are missing, so the figures can't be shown per 100 g.";
        default: {
            const never: never = reason;
            return never;
        }
    }
}

function share(value: number | undefined): string {
    return value === undefined ? '' : `${value} %`;
}

/** Title, basis, table (or why there is none), energy, match count, unmatched names, footer. */
export function hoverMarkdown(result: MacrosResult): string {
    const blocks: string[] = [];
    const { figures, shares } = result;
    if (result.withheld || !figures) {
        blocks.push('**Macros** · not enough data', basisLine(result.portion), withheldLine(result, result.withheld ?? 'noData'));
    } else {
        blocks.push('**Macros**', basisLine(result.portion));
        blocks.push([
            '| | g | % energy |',
            '|---|---:|---:|',
            `| Protein | ${figures.protein_g} | ${share(shares?.protein)} |`,
            `| Carbs | ${figures.carb_g} | ${share(shares?.carb)} |`,
            `| Fat | ${figures.fat_g} | ${share(shares?.fat)} |`,
            `| Fiber | ${figures.fiber_g} | |`,
            `| Sugar | ${figures.sugar_g} | |`,
            `| Saturated fat | ${figures.sat_fat_g} | |`,
        ].join('\n'));
        blocks.push(`Energy: **${figures.kcal} kcal**`);
    }
    blocks.push(`Ingredients matched: ${result.match.matched} / ${result.match.total}`);
    if (result.match.unmatched.length > 0) {
        blocks.push(`Not matched: ${formatNames(result.match.unmatched)}`);
    }
    blocks.push(FOOTER);
    const text = blocks.join('\n\n');
    return text.length > MAX_HOVER_LENGTH ? `${text.slice(0, MAX_HOVER_LENGTH - 1)}…` : text;
}

/** Tooltip for a nutrition service failure (network or server); the message is escaped. */
export function serviceErrorTooltip(reason: string, message: string): string {
    return [
        '**Macros** · unavailable',
        `The cook.md nutrition service did not answer (${escapeMarkdown(reason)}): ${escapeMarkdown(message.slice(0, 300))}`,
        'Try again later; the pill refreshes on the next edit.',
    ].join('\n\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `44 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/hover.ts macros/src/hover.spec.ts
git commit -m "feat(macros): hover table with energy shares, basis and matched ingredients"
```

---

### Task 8: Pill badge

**Files:**
- Create: `macros/src/badge.ts`, `macros/src/badge.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/badge.spec.ts`**

```ts
import * as assert from 'assert';
import { LOCKED_TEXT, MAX_TEXT_LENGTH, UNKNOWN_TEXT, badgeFor, lockedBadge, pillText, serviceErrorBadge } from './badge';
import { LOCKED_TOOLTIP, hoverMarkdown } from './hover';
import { MacroFigures, MacrosResult } from './macros';

const SERVING: MacroFigures = { kcal: 520, protein_g: 38, fat_g: 14, carb_g: 52, fiber_g: 6, sugar_g: 9, sat_fat_g: 4 };
const WHOLE: MacroFigures = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };
const PER_100G: MacroFigures = { kcal: 120, protein_g: 8, fat_g: 3, carb_g: 12, fiber_g: 1, sugar_g: 2, sat_fat_g: 1 };
const DAY: MacroFigures = { kcal: 2400, protein_g: 150, fat_g: 80, carb_g: 250, fiber_g: 30, sugar_g: 50, sat_fat_g: 25 };

describe('pillText', () => {
    it('shows macros and energy per serving', () => {
        assert.strictEqual(pillText(SERVING, { kind: 'serving', servings: 4 }, true), '38P 52C 14F · 520 kcal');
    });

    it('drops the energy when showEnergy is off', () => {
        assert.strictEqual(pillText(SERVING, { kind: 'serving', servings: 4 }, false), '38P 52C 14F');
    });

    it('marks the whole recipe, dropping energy that does not fit', () => {
        assert.strictEqual(pillText(WHOLE, { kind: 'whole' }, true), '152P 208C 56F · whole');
    });

    it('marks per 100 g, tightening the energy to fit', () => {
        assert.strictEqual(pillText(PER_100G, { kind: '100g' }, true), '8P 12C 3F · 120kcal/100g');
        assert.strictEqual(pillText(PER_100G, { kind: '100g' }, false), '8P 12C 3F /100g');
    });

    it('marks a plan per day', () => {
        assert.strictEqual(pillText(DAY, { kind: 'day', people: 2, days: 7 }, true), '150P 250C 80F /day');
        assert.strictEqual(pillText({ ...DAY, protein_g: 9, carb_g: 20, fat_g: 5, kcal: 160 }, { kind: 'day', people: 1, days: 1 }, true), '9P 20C 5F · 160 kcal/day');
    });

    it('never exceeds the editor limit', () => {
        const huge: MacroFigures = { ...WHOLE, protein_g: 123456, carb_g: 123456, fat_g: 123456, kcal: 9999990 };
        for (const portion of [{ kind: 'serving', servings: 1 }, { kind: 'whole' }, { kind: '100g' }, { kind: 'day', people: 1, days: 1 }] as const) {
            assert.ok(pillText(huge, portion, true).length <= MAX_TEXT_LENGTH);
            assert.ok(pillText(SERVING, portion, true).length <= MAX_TEXT_LENGTH);
        }
        assert.strictEqual(pillText(huge, { kind: 'whole' }, true), UNKNOWN_TEXT);
    });
});

describe('badgeFor', () => {
    const ok: MacrosResult = {
        portion: { kind: 'serving', servings: 4 }, figures: SERVING, shares: { protein: 31, carb: 43, fat: 26 },
        match: { matched: 4, total: 4, unmatched: [] }, missingRecipes: [],
    };

    it('is a neutral pill with the hover', () => {
        assert.deepStrictEqual(badgeFor(ok, true), { kind: 'pill', text: '38P 52C 14F · 520 kcal', tone: 'neutral', tooltipMarkdown: hoverMarkdown(ok) });
    });

    it('is a warning Macros ? when withheld', () => {
        const withheld: MacrosResult = { portion: ok.portion, withheld: 'unmatched', match: { matched: 1, total: 4, unmatched: ['a', 'b', 'c'] }, missingRecipes: [] };
        const badge = badgeFor(withheld, true);
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge.tooltipMarkdown.includes('Not matched: a, b, c'));
    });
});

describe('lockedBadge and serviceErrorBadge', () => {
    it('shows the grey lock unless turned off', () => {
        assert.deepStrictEqual(lockedBadge(true), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(lockedBadge(false), undefined);
        assert.ok(LOCKED_TEXT.length <= MAX_TEXT_LENGTH);
    });

    it('turns a service failure into a warning pill', () => {
        const badge = serviceErrorBadge('network', 'offline');
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge.tooltipMarkdown.includes('(network): offline'));
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './badge'`.

- [ ] **Step 3: Write `macros/src/badge.ts`**

```ts
import { PillBadge } from './cooklang-api';
import { LOCKED_TOOLTIP, hoverMarkdown, serviceErrorTooltip } from './hover';
import { MacroFigures, MacrosResult, Portion } from './macros';

/** The editor drops pills whose text is longer than this (UTF-16 units). */
export const MAX_TEXT_LENGTH = 24;
export const LOCKED_TEXT = '🔒 Macros';
export const UNKNOWN_TEXT = 'Macros ?';

const SUFFIX: Readonly<Record<Portion['kind'], string>> = { serving: '', whole: ' · whole', '100g': '/100g', day: '/day' };

/**
 * `38P 52C 14F · 520 kcal`, with `/100g`, `/day` or ` · whole` for the other bases. The editor caps
 * pill text at 24 characters, so the energy is tightened (`520kcal`) and then dropped when it does
 * not fit; the hover always has it. The basis marker is never dropped: if even the bare figures do
 * not fit, the pill reads `Macros ?`.
 */
export function pillText(figures: MacroFigures, portion: Portion, showEnergy: boolean): string {
    const core = `${figures.protein_g}P ${figures.carb_g}C ${figures.fat_g}F`;
    const suffix = SUFFIX[portion.kind];
    const candidates: string[] = [];
    if (showEnergy) {
        candidates.push(`${core} · ${figures.kcal} kcal${suffix}`, `${core} · ${figures.kcal}kcal${suffix}`);
    }
    candidates.push(suffix.startsWith('/') ? `${core} ${suffix}` : `${core}${suffix}`);
    return candidates.find(text => text.length <= MAX_TEXT_LENGTH) ?? UNKNOWN_TEXT;
}

/** Neutral pill with the figures, or a warning `Macros ?` when they are withheld. */
export function badgeFor(result: MacrosResult, showEnergy: boolean): PillBadge {
    const tooltipMarkdown = hoverMarkdown(result);
    if (result.withheld || !result.figures) {
        return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'warning', tooltipMarkdown };
    }
    return { kind: 'pill', text: pillText(result.figures, result.portion, showEnergy), tone: 'neutral', tooltipMarkdown };
}

/** Greyed pill with an upgrade hint, or undefined when `macros.showWhenLocked` is off. */
export function lockedBadge(showWhenLocked: boolean): PillBadge | undefined {
    return showWhenLocked ? { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP } : undefined;
}

/** The nutrition service failed (network or server): `Macros ?` with the reason in the hover. */
export function serviceErrorBadge(reason: string, message: string): PillBadge {
    return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'warning', tooltipMarkdown: serviceErrorTooltip(reason, message) };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `54 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/badge.ts macros/src/badge.spec.ts
git commit -m "feat(macros): pill text within the editor's 24-character limit, warning and locked pills"
```

---

### Task 9: Badge provider (cache and locked state)

**Files:**
- Create: `macros/src/provider.ts`, `macros/src/provider.spec.ts`

- [ ] **Step 1: Write the failing test `macros/src/provider.spec.ts`**

```ts
import * as assert from 'assert';
import { LOCKED_TEXT } from './badge';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { LOCKED_TOOLTIP } from './hover';
import { MacrosBadgeProvider, isMenuUri } from './provider';
import { MACROS_TEMPLATE, NutritionAggregate, NutritionMacros } from './nutrition-template';
import { MacrosSettings } from './settings';

const MACROS: NutritionMacros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 24, sugar_g: 36, sat_fat_g: 16 };

function aggregate(factor = 1, failures: string[] = []): NutritionAggregate {
    const scaled = Object.fromEntries(Object.entries(MACROS).map(([key, value]) => [key, value * factor])) as unknown as NutritionMacros;
    return {
        items: ['chicken', 'rice', 'onion', 'oil'].map(ingredient => ({ ingredient, amount: { mass_g: 225 * factor }, warnings: [] })),
        failures: failures.map(ingredient => ({ ingredient })),
        totals: { mass_g: 900 * factor, macros: scaled },
    };
}

const recipeResult = (agg: NutritionAggregate = aggregate()): PluginReportResult => ({ ok: true, output: JSON.stringify({ kind: 'recipe', aggregate: agg }) });

const RECIPE = { version: 1, uri: 'file:///ws/Chicken.cook', path: 'Chicken.cook', scale: 1 };
const MENU = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 3 };
const FOUR_SERVINGS = '---\ntitle: Chicken and rice\nservings: 4\n---\nCook @chicken{600%g} with @rice{300%g}.';

class Fixture {
    features = new Set<string>(['nutrition_api']);
    results: PluginReportResult[] = [];
    renders: Array<{ uri: string; template: string; scale: number }> = [];
    logs: string[] = [];
    texts = new Map<string, string>([[RECIPE.uri, FOUR_SERVINGS]]);
    settings: MacrosSettings = { showEnergy: true, basis: 'serving', showWhenLocked: true };

    provider(): MacrosBadgeProvider {
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return this.features.has((args[0] as { name: string }).name);
            }
            if (command === 'cooklang.api.renderReport') {
                this.renders.push(args[0] as { uri: string; template: string; scale: number });
                return this.results.shift() ?? recipeResult();
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => ['cooklang.api.hasFeature', 'cooklang.api.renderReport']);
        return new MacrosBadgeProvider(api, message => this.logs.push(message), () => this.settings, async uri => this.texts.get(uri));
    }
}

describe('isMenuUri', () => {
    it('matches .menu case-insensitively, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/WEEK.MENU?x=1#top'), true);
        assert.strictEqual(isMenuUri('file:///ws/Chicken.cook'), false);
    });
});

describe('MacrosBadgeProvider', () => {
    it('ignores arguments that are not a preview context', async () => {
        assert.strictEqual(await new Fixture().provider().provide({ nope: true }), undefined);
    });

    it('renders the template at the preview scale and shows per-serving macros', async () => {
        const fixture = new Fixture();
        const badge = await fixture.provider().provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: '38P 52C 14F · 520 kcal', tone: 'neutral' });
        assert.ok(badge?.tooltipMarkdown.includes('Per serving (4 servings)'));
        assert.deepStrictEqual(fixture.renders, [{ uri: RECIPE.uri, template: MACROS_TEMPLATE, scale: 1 }]);
    });

    it('keeps per-serving numbers when the preview is scaled', async () => {
        const fixture = new Fixture();
        fixture.results = [recipeResult(aggregate(2))];
        const badge = await fixture.provider().provide({ ...RECIPE, scale: 2 });
        assert.strictEqual(badge?.text, '38P 52C 14F · 520 kcal');
        assert.ok(badge?.tooltipMarkdown.includes('Per serving (8 servings)'));
        assert.strictEqual(fixture.renders[0].scale, 2);
    });

    it('shows the whole recipe without servings, or when the text cannot be read', async () => {
        const fixture = new Fixture();
        fixture.texts.set(RECIPE.uri, 'Cook @chicken{600%g}.');
        const badge = await fixture.provider().provide(RECIPE);
        assert.strictEqual(badge?.text, '152P 208C 56F · whole');
        assert.ok(badge?.tooltipMarkdown.includes('No `servings:` in the frontmatter'));

        const unreadable = new Fixture();
        unreadable.texts.clear();
        assert.strictEqual((await unreadable.provider().provide(RECIPE))?.text, '152P 208C 56F · whole');
        assert.deepStrictEqual(unreadable.logs, ['Macros unavailable (read): could not read the recipe text; showing the whole recipe']);
    });

    it('renders a menu at scale 1 and divides by people × days', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(14), days: 7, people: 2, missingRecipes: [] }) }];
        const badge = await fixture.provider().provide(MENU);
        assert.strictEqual(badge?.text, '152P 208C 56F /day');
        assert.ok(badge?.tooltipMarkdown.includes('Per person per day (2 people × 7 days)'));
        assert.deepStrictEqual(fixture.renders, [{ uri: MENU.uri, template: MACROS_TEMPLATE, scale: 1 }]);
    });

    it('uses the per-100 g basis from the settings', async () => {
        const fixture = new Fixture();
        fixture.settings = { ...fixture.settings, basis: '100g' };
        const badge = await fixture.provider().provide(RECIPE);
        // 900 g: 231 kcal, 16.9 g protein, 23.1 g carbs, 6.2 g fat per 100 g; the energy does not fit in 24 characters.
        assert.strictEqual(badge?.text, '17P 23C 6F /100g');
        assert.ok(badge?.tooltipMarkdown.includes('Energy: **230 kcal**'));
    });

    it('shows Macros ? as a warning when too few ingredients matched', async () => {
        const fixture = new Fixture();
        fixture.results = [recipeResult(aggregate(1, ['ghee', 'garam masala']))];
        const badge = await fixture.provider().provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge?.tooltipMarkdown.includes('Not matched: ghee, garam masala'));
    });

    it('shows the locked pill without the nutrition feature, and does not render', async () => {
        const fixture = new Fixture();
        fixture.features.clear();
        assert.deepStrictEqual(await fixture.provider().provide(RECIPE), { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(fixture.renders.length, 0);
        fixture.settings = { ...fixture.settings, showWhenLocked: false };
        assert.strictEqual(await fixture.provider().provide(RECIPE), undefined);
    });

    it('shows the locked pill when the service rejects the sign-in or plan', async () => {
        for (const reason of ['unauthenticated', 'forbidden'] as const) {
            const fixture = new Fixture();
            fixture.results = [{ ok: false, reason, message: 'nope' }];
            assert.strictEqual((await fixture.provider().provide(RECIPE))?.text, LOCKED_TEXT);
            assert.deepStrictEqual(fixture.logs, [`Macros unavailable (${reason}): nope`]);
        }
    });

    it('shows a warning pill with the reason on network and server errors, logging each reason once', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: false, reason: 'network', message: 'offline' }, { ok: false, reason: 'network', message: 'offline' }];
        const provider = fixture.provider();
        const badge = await provider.provide(RECIPE);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Macros ?', tone: 'warning' });
        assert.ok(badge?.tooltipMarkdown.includes('(network): offline'));
        await provider.provide(RECIPE);
        assert.deepStrictEqual(fixture.logs, ['Macros unavailable (network): offline']);
    });

    it('shows no pill on a template error or malformed output, and logs it', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: false, reason: 'template', message: 'undefined function' }, { ok: true, output: 'nope' }];
        const provider = fixture.provider();
        assert.strictEqual(await provider.provide(RECIPE), undefined);
        assert.strictEqual(await provider.provide(RECIPE), undefined);
        assert.deepStrictEqual(fixture.logs, ['Macros unavailable (template): undefined function', 'Macros unavailable (output): unexpected template output']);
    });

    it('rejects a plan payload for a recipe', async () => {
        const fixture = new Fixture();
        fixture.results = [{ ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: [] }) }];
        assert.strictEqual(await fixture.provider().provide(RECIPE), undefined);
    });

    it('re-uses a cached render for the same recipe text and scale, e.g. after a settings change', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        await provider.provide(RECIPE);
        fixture.settings = { ...fixture.settings, showEnergy: false };
        assert.strictEqual((await provider.provide(RECIPE))?.text, '38P 52C 14F');
        assert.strictEqual(fixture.renders.length, 1);

        await provider.provide({ ...RECIPE, scale: 2 });
        fixture.texts.set(RECIPE.uri, `${FOUR_SERVINGS}\nServe.`);
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 3);

        provider.clearCache();
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 4);
    });

    it('does not cache menus or failures', async () => {
        const fixture = new Fixture();
        const plan: PluginReportResult = { ok: true, output: JSON.stringify({ kind: 'plan', aggregate: aggregate(), days: 1, people: 1, missingRecipes: [] }) };
        fixture.results = [plan, plan, { ok: false, reason: 'network', message: 'offline' }];
        const provider = fixture.provider();
        await provider.provide(MENU);
        await provider.provide(MENU);
        await provider.provide(RECIPE);
        await provider.provide(RECIPE);
        assert.strictEqual(fixture.renders.length, 4);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: FAIL with `error TS2307: Cannot find module './provider'`.

- [ ] **Step 3: Write `macros/src/provider.ts`**

```ts
import { badgeFor, lockedBadge, serviceErrorBadge } from './badge';
import { CooklangApi, PillBadge, PreviewOutletContext } from './cooklang-api';
import { computeMacros, normaliseScale } from './macros';
import { MACROS_TEMPLATE, MacrosOutput, parseMacrosOutput } from './nutrition-template';
import { parseServings } from './servings';
import { MacrosSettings } from './settings';

/** Reads a document's current text (unsaved edits included); undefined when it cannot be read. */
export type ReadText = (uri: string) => Promise<string | undefined>;

/** Whether a value is the version 1 context the editor passes to badge outlet commands. */
export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Whether a URI string names a `.menu` plan (the badge outlets pass no other hint). */
export function isMenuUri(uri: string): boolean {
    return /\.menu$/i.test(uri.replace(/[?#].*$/, ''));
}

/** Backs `cooklang.macros.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class MacrosBadgeProvider {

    static readonly CACHE_SIZE = 20;

    protected readonly logged = new Set<string>();
    /**
     * Validated recipe outputs keyed by `[uri, scale, text]`, least recently used first, so a
     * settings change (energy on/off, basis) or a repeated refresh re-uses the last render instead
     * of another round trip. Plans are not cached here: their totals also depend on the recipes they
     * reference, which the menu text does not capture.
     */
    protected readonly cache = new Map<string, MacrosOutput>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => MacrosSettings,
        protected readonly readText: ReadText,
    ) { }

    /** The badge for a preview context, or undefined for no badge. */
    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same one the
        // nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return lockedBadge(settings.showWhenLocked);
        }
        const isMenu = isMenuUri(context.uri);
        // The engine expands a menu's recipes at 1× whatever the menu scale, and per-person-per-day
        // figures do not depend on it; a recipe is rendered at the preview scale.
        const scale = isMenu ? 1 : normaliseScale(context.scale);
        let servings: number | undefined;
        let cacheKey: string | undefined;
        if (!isMenu) {
            const text = await this.readText(context.uri);
            if (text === undefined) {
                this.logOnce('read', 'could not read the recipe text; showing the whole recipe');
            } else {
                servings = parseServings(text);
                cacheKey = JSON.stringify([context.uri, scale, text]);
            }
        }
        let output = cacheKey === undefined ? undefined : this.recall(cacheKey);
        if (!output) {
            const result = await this.api.renderReport({ uri: context.uri, template: MACROS_TEMPLATE, scale });
            if (!result.ok) {
                this.logOnce(result.reason, result.message);
                // The cached subscription said yes but the service disagreed (expired sign-in, lapsed plan).
                if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                    return lockedBadge(settings.showWhenLocked);
                }
                // A template error is this plugin's bug, not something the user can act on: no pill.
                return result.reason === 'template' ? undefined : serviceErrorBadge(result.reason, result.message);
            }
            output = parseMacrosOutput(result.output);
            if (!output || output.kind !== (isMenu ? 'plan' : 'recipe')) {
                this.logOnce('output', 'unexpected template output');
                return undefined;
            }
            if (cacheKey !== undefined) {
                this.remember(cacheKey, output);
            }
        }
        // A badge is about to be shown: earlier failures are superseded. An unreadable document is
        // a standing condition, not a failure the success supersedes.
        const readFailed = this.logged.has('read');
        this.logged.clear();
        if (readFailed) {
            this.logged.add('read');
        }
        return badgeFor(computeMacros(output, { basis: settings.basis, servings, scale }), settings.showEnergy);
    }

    /** Forgets every cached render, e.g. after the nutrition service URL changed. */
    clearCache(): void {
        this.cache.clear();
    }

    protected recall(key: string): MacrosOutput | undefined {
        const output = this.cache.get(key);
        if (output) {
            this.cache.delete(key);
            this.cache.set(key, output);
        }
        return output;
    }

    protected remember(key: string, output: MacrosOutput): void {
        this.cache.set(key, output);
        if (this.cache.size > MacrosBadgeProvider.CACHE_SIZE) {
            this.cache.delete(this.cache.keys().next().value as string);
        }
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Macros unavailable (${reason}): ${message}`);
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test`
Expected: PASS, `69 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/provider.ts macros/src/provider.spec.ts
git commit -m "feat(macros): badge provider for recipe and menu previews with a render cache"
```

---

### Task 10: Extension wiring

`extension.ts` imports `vscode`, so it has no unit spec (same as every plugin in this repo). It is checked by `tsc` here and in the editor in Task 14.

**Files:**
- Create: `macros/src/extension.ts`

- [ ] **Step 1: Write `macros/src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { MacrosBadgeProvider, ReadText } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Macros');
    context.subscriptions.push(output);
    const log = (message: string): void => {
        output.appendLine(message);
        console.warn(`[macros] ${message}`);
    };
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('macros');
        return readSettings(key => configuration.get(key));
    };
    // The open document when there is one (unsaved edits included), else the file.
    // Failures are reported by the provider, once, not on every badge refresh.
    const readText: ReadText = async uri => {
        try {
            return (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
        } catch {
            return undefined;
        }
    };
    const supportCheck = new SupportCheck(api);
    const provider = new MacrosBadgeProvider(api, log, settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.macros.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            log('Macros needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        // A different nutrition service answers differently: forget cached renders.
        if (event.affectsConfiguration('cooklang.nutrition')) {
            provider.clearCache();
        }
        // Energy on/off or a new basis should update open previews without an edit.
        if (event.affectsConfiguration('macros') || event.affectsConfiguration('cooklang.nutrition')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 2: Compile and run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm test && ls out/extension.js`
Expected: PASS, `69 passing`, and `out/extension.js` is listed.

- [ ] **Step 3: Check the manifest and the code agree**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros
grep -c "cooklang.macros.provideBadge" package.json src/extension.ts
grep -o '"macros\.[a-zA-Z]*"' package.json
```

Expected: `package.json:4` and `src/extension.ts:1`, then `"macros.showEnergy"`, `"macros.basis"` and `"macros.showWhenLocked"`, which are the keys `readSettings` reads from `getConfiguration('macros')`.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/src/extension.ts
git commit -m "feat(macros): register the badge command and refresh badges on settings changes"
```

---

### Task 11: READMEs

**Files:**
- Modify: `macros/README.md` (replace the stub)
- Modify: `README.md` (root plugin table)

- [ ] **Step 1: Replace `macros/README.md` with**

````markdown
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
````

- [ ] **Step 2: Add the root table row**

In `/Users/alexeydubovskoy/Cooklang/plugins-macros/README.md`, insert this row directly after the `corevitals` row of the plugin table:

```markdown
| [`macros`](./macros) | `38P 52C 14F · 520 kcal` pill on recipe previews (per serving) and meal plans (per person per day), with a hover table of macros and energy shares. Needs a Cook Basic or Pro plan. Install it from the Extensions view. Shows one badge command on both badge outlets and a template that branches on the engine's `plan` context. |
```

If another plugin branch merged rows after `corevitals` first, keep both rows. Order doesn't matter beyond `meal-journal` staying first.

- [ ] **Step 3: Check**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros && grep -n "\[\`macros\`\]" README.md && grep -c "38P 52C 14F" macros/README.md`
Expected: one table line, and `1`.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add macros/README.md README.md
git commit -m "docs(macros): plugin README and root table row"
```

---

### Task 12: CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add `macros` to the matrix**

In `.github/workflows/ci.yml`, change

```yaml
        package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

to

```yaml
        package: [allergens, corevitals, favourites, macros, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

If other plugin branches have added entries since, keep them and insert `macros` in alphabetical order.

- [ ] **Step 2: Run what CI runs, locally**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && rm -rf node_modules out && npm ci && npm run compile && npm test && npm run package
```

Expected: `69 passing`, then `DONE  Packaged: …/macros-0.1.0.vsix`. Delete the `.vsix` afterwards (`rm macros-0.1.0.vsix`); Task 13 packages it again.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
git add .github/workflows/ci.yml
git commit -m "ci: run the macros plugin in the matrix"
```

---

### Task 13: Packaging and deploy

**Files:**
- No source changes. Produces `macros/macros-0.1.0.vsix` (not committed) and `editor/plugins/cooklang.macros/`.

- [ ] **Step 1: Package and inspect the `.vsix`**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm run package && unzip -l macros-0.1.0.vsix
```

Expected: the archive lists `extension/package.json`, `extension/README.md`, `extension/LICENSE.txt` (or `LICENSE`), and `extension/out/*.js` for `badge`, `cooklang-api`, `extension`, `hover`, `macros`, `markdown`, `match`, `nutrition-template`, `provider`, `servings`, `settings`, `support-check`. There must be no `*.spec.js`, no `*.map`, no `src/` and no `package-lock.json`. If any of those appear, fix `macros/.vscodeignore` to match `corevitals/.vscodeignore` and re-package.

- [ ] **Step 2: Deploy into the editor checkout**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros/macros && npm run deploy && ls /Users/alexeydubovskoy/Cooklang/editor/plugins/cooklang.macros
```

Expected: `Deployed to /Users/alexeydubovskoy/Cooklang/editor/plugins/cooklang.macros`, then `LICENSE  README.md  out  package.json`.

- [ ] **Step 3: Leave the `.vsix` uncommitted**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins-macros && git status --short`
Expected: no tracked changes. If `macros/macros-0.1.0.vsix` shows as untracked, leave it (or delete it). Publishing to plugins.cook.md follows the root README ("Publishing to plugins.cook.md") once the PR is merged.

---

### Task 14: Manual verification in Cook Editor

No unit test runs the template against the real engine, so this task does. Use an editor build from `main` (it has `cooklang/menuPreview/badge` and `cooklang.api.refreshBadges`), with the plugin deployed (Task 13).

- [ ] **Step 1: Create a fixture workspace**

```bash
rm -rf /tmp/macros-ws && mkdir -p /tmp/macros-ws
cat > "/tmp/macros-ws/Chicken and Rice.cook" <<'COOK'
---
title: Chicken and rice
servings: 4
---
Season @chicken breast{600%g} with @salt{1%tsp} and fry in @olive oil{2%tbsp}.

Cook @white rice{300%g} in @water{600%ml}. Serve with @onion{1}.
COOK
cat > "/tmp/macros-ws/Porridge.cook" <<'COOK'
---
title: Porridge
---
Simmer @rolled oats{80%g} in @milk{300%ml}. Top with @banana{1}.
COOK
cat > "/tmp/macros-ws/Mystery Curry.cook" <<'COOK'
---
title: Mystery curry
servings: 2
---
Fry @zorblax paste{2%tbsp} with @quuxberries{100%g}, @flimflam{50%g} and @ghee{1%tbsp}. Add @rice{150%g}.
COOK
cat > "/tmp/macros-ws/week.menu" <<'MENU'
---
title: Two days for two
servings: 2
---
= Day 1 =

Breakfast:

@./Porridge{2}

Dinner:

@./Chicken and Rice{2%servings}

= Day 2 =

Dinner:

@./Chicken and Rice{2%servings}
MENU
cat > "/tmp/macros-ws/broken.menu" <<'MENU'
---
servings: 1
---
= Day 1 =

Dinner:

@./Does Not Exist{1}
MENU
ls /tmp/macros-ws
```

Expected: `Chicken and Rice.cook  Mystery Curry.cook  Porridge.cook  broken.menu  week.menu`.

- [ ] **Step 2: Start the editor**

Run `cd /Users/alexeydubovskoy/Cooklang/editor && npm run start:electron`. Open `/tmp/macros-ws` as the workspace. Sign in with a Cook Basic or Pro account. If `.menu` files open as XML, add `"files.associations": { "*.menu": "cooklang" }` to the user settings.

- [ ] **Step 3: Recipe checks** (open each preview; tick each one off)

1. `Chicken and Rice.cook`: a neutral pill like `NNP NNC NNF · NNN kcal` appears after a moment. If no pill appears, open View → Output → Macros. A `Macros unavailable (template): …` line names the failing Jinja construct. Fix `MACROS_TEMPLATE` in `macros/src/nutrition-template.ts`, update the spec's string assertions if they change, run `npm test && npm run deploy`, and restart the editor.
2. Hover the pill: the second block reads `Per serving (4 servings)`. A table lists Protein / Carbs / Fat / Fiber / Sugar / Saturated fat with `% energy` on the first three, followed by `Energy: **… kcal**`, `Ingredients matched: n / m`, and the footer. **If the table renders as raw `|` text**, the badge hover's markdown renderer has no GFM tables. Then replace the table block in `hoverMarkdown` with one line per nutrient (`Protein **38 g** · 31 % of energy`), update `hover.spec.ts`, and re-deploy.
3. Scale the preview to ×2: the pill text does not change. The hover reads `Per serving (8 servings)`.
4. `Porridge.cook` (no servings): the pill ends with `· whole`, and the hover says ``No `servings:` in the frontmatter, so this is the whole recipe.`` At ×2 the figures double.
5. `Mystery Curry.cook`: an amber `Macros ?`. The hover starts `**Macros** · not enough data`, says `Only n of 5 ingredients matched…`, and lists the invented names.
6. Settings → Extensions → Macros → **Show Energy** off: open pills lose the energy without an edit. **Basis** `100g`: the chicken pill shows `… /100g` (with `kcal/100g` when it fits), and the hover reads `Per 100 g`. Set both back.

- [ ] **Step 4: Menu checks**

1. `week.menu` preview: a neutral pill ending in `/day`. The hover reads `Per person per day (2 people × 2 days)`.
2. Remove `servings: 2` from `week.menu` and save: the hover reads `(1 person × 2 days)`, and the figures double. Restore it.
3. `broken.menu`: an amber `Macros ?`. The hover says `Missing recipes, so the totals would undercount: Does Not Exist`.

- [ ] **Step 5: Locked and failure states**

1. Sign out of cook.md: every pill turns into a grey `🔒 Macros`, and its hover links to `https://cook.md/pricing`. Turn **Show When Locked** off: the pills disappear. Turn it back on and sign in again.
2. Set `cooklang.nutrition.serviceUrl` to `http://127.0.0.1:9` in the settings: the recipe pill becomes an amber `Macros ?` whose hover starts `**Macros** · unavailable` and names `network`. Reset the setting: the pill recovers without an edit, because the config change cleared the cache and refreshed badges.
3. The Macros output channel shows each failure reason once, not once per refresh.

- [ ] **Step 6: Commit any fixes found here**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros
export PATH="$HOME/.local/bin:$PATH" && npm --prefix macros test
git add macros/src
git diff --cached --quiet || git commit -m "fix(macros): adjustments from the Cook Editor run"
```

- [ ] **Step 7: Open the PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins-macros && git push -u origin feature/macros
gh pr create --title "feat(macros): Macros plugin, protein/carbs/fat pill on recipe and meal-plan previews" --body "Implements docs/superpowers/specs/2026-10-10-macros-plugin-design.md per docs/superpowers/plans/2026-10-10-macros-plugin.md (see its Deviations from spec)."
```

---

## Self-review: spec coverage

| Spec section | Requirement | Task |
|---|---|---|
| Scope | New optional plugin `cooklang.macros`, nothing outside this repo | 1 (publisher `cooklang`, name `macros`), 11–13 |
| Goals | One-glance `P · C · F · kcal` | 8 (compacted to 24 chars, see Deviation 1), 9 |
| Goals | Cook Basic or Pro (`nutrition_api`) | 9 (`hasFeature('nutrition_api')`), 14 Step 5 |
| Non-goals | No targets / verdict colours; no micros; no per-ingredient table | 8 (tone `neutral`, `warning` only for `Macros ?`), 7 (totals only) |
| Preferences | `macros.showEnergy`, `macros.basis` (`serving`/`100g`), `macros.showWhenLocked` | 1 (manifest), 2 (`readSettings`), 8 (`showEnergy`), 6 (`basis`), 9 (`showWhenLocked`) |
| Preferences | Config change → `cooklang.api.refreshBadges` | 1 (`refreshBadges`), 10 |
| Numbers | One `renderReport` with `aggregate_nutrition(...) \| tojson`, validated like Nutri-Score | 3 |
| Numbers | Recipe per serving; `servings`/`serves`/`yield` via `parseServings` | 4, 6, 9 |
| Numbers | Scale passed to `renderReport`, servings × scale | 6 (`portionFor`), 9 (`scale` passed), Deviation 3 |
| Numbers | No servings → whole recipe, ` · whole recipe`, hover note | 6, 7 (`WHOLE_RECIPE_NOTE`), 8 (` · whole`, Deviation 1) |
| Numbers | Basis `100g`: totals × 100 ÷ `mass_g` | 6 (`divisorFor`), 8 (`/100g`) |
| Numbers | Menu: ÷ (people × days), defaults 1, `/day` | 3 (template), 6, 8, Deviation 2 |
| Numbers | Rounding: grams integer, kcal nearest 10 | 6 (`roundGrams`, `roundKcal`) |
| Badge | `kind: 'pill'`, tone `neutral` | 8 |
| Badge | Low confidence < 70 % by count, placeholders + failures unmatched → `Macros ?` warning, hover lists unmatched | 5, 6, 7, 8 |
| Badge | Locked: grey `🔒 Macros` | 8 (`lockedBadge`), 9 |
| Hover | Protein/carbs/fat/fiber/sugar/sat fat g; P/C/F % energy; basis; matched n / m; unmatched; footer | 7 |
| Architecture | `cooklang-api.ts`, `nutrition-template.ts`, `servings.ts`, `macros.ts`, `badge.ts`, `provider.ts` (both outlets, cache), `extension.ts` | 1, 3, 4, 6, 8, 9, 10 (plus `match.ts`, `hover.ts`, `settings.ts`, `markdown.ts`, `support-check.ts`) |
| Error handling | Service errors → `Macros ?` warning with reason | 7 (`serviceErrorTooltip`), 8, 9 |
| Error handling | Template / malformed output → no pill, `console.warn` | 9, 10 (`log` writes the output channel and `console.warn`) |
| Testing | Fixtures: per serving, scaled, no servings, per 100 g, menu 2 × 7, below threshold, rounding, locked | 6 (`macros.spec.ts`), 8 (`badge.spec.ts`), 9 (`provider.spec.ts`), 14 (live engine) |
| Repo integration | Plugin README, root README row, CI matrix, packaging | 11, 12, 13 |

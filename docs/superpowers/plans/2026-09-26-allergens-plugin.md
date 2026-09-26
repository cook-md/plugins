# Allergens Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cooklang.allergens` plugin that flags user-chosen allergens (EU-14 via the cook.md nutrition service for Basic/Pro, plus free custom words) as a pill badge on the recipe preview.

**Architecture:** The plugin contributes `cooklang.allergens.provideBadge` to the existing `cooklang/recipePreview/badge` outlet, renders a Jinja template through `cooklang.api.renderReport` (per-item `allergens` blocks from `aggregate_nutrition(ingredients, "eu")`, plus the recipe's ingredient names), and turns the result into a `pill` badge. Two small additive upstream changes: an optional `standard` argument for `aggregate_nutrition` (cooklang-reports-nutrition 0.1.2) and a `cooklang.api.refreshBadges` editor command so settings changes re-query badges.

**Tech Stack:** TypeScript 5.4 + mocha (plugin, VS Code API 1.100), Rust + minijinja + wiremock (library), Theia/Inversify + mocha/chai (editor).

**Spec:** `docs/superpowers/specs/2026-09-26-allergens-plugin-design.md` (plugins repo).

**Repos and branches:**
- Library: `~/Cooklang/cooklang-reports-nutrition`, branch `feat/aggregate-standard`
- Editor: `~/Cooklang/editor`, branch `feat/refresh-badges`
- Plugin: `~/Cooklang/plugins`, branch `feat/allergens` (already exists, spec committed)

**Environment notes:**
- Editor mocha needs Node 22: prefix commands with `PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH`. Do not install Node.
- Never print the nutrition token (`editor/.env`, `NUTRITION_TOKEN`).
- Never use the deprecated `>>` metadata syntax in any `.cook` fixture; use YAML frontmatter.

---

## File map

**Library** (`crates/cooklang-reports-nutrition`)
- Modify `src/lib.rs` (`aggregate_nutrition` closure, ~line 460): optional `standard` argument.
- Modify `tests/jinja_test.rs`: forwarding test.
- Modify `Cargo.toml` of both crates: versions 0.1.1 (client) / 0.1.2 (reports-nutrition).

**Editor** (`packages/cooklang/src/browser`)
- Modify `cooklang-outlet-service.ts`: `refresh()`.
- Modify `cooklang-plugin-api-contribution.ts`: `REFRESH_BADGES` command.
- Modify both `.spec.ts` files.
- Modify `packages/cooklang-native/Cargo.toml` + `Cargo.lock`: nutrition crates bump (after the library is published).

**Plugin** (`allergens/`)
- `package.json`, `tsconfig.json`, `.vscodeignore`, `LICENSE`, `README.md`, `scripts/deploy.js`
- `src/cooklang-api.ts` — command wrapper (+ `refreshBadges`)
- `src/support-check.ts` — copied from nutriscore
- `src/allergen-classes.ts` — EU-14 slug/key/label table
- `src/settings.ts` — read + normalise configuration
- `src/custom-match.ts` — word-boundary matcher
- `src/allergen-template.ts` — templates, output validation, name alignment
- `src/markdown.ts` — escaping helpers (copied from nutriscore `trust.ts`)
- `src/hover.ts` — hover markdown + locked tooltip
- `src/evaluate.ts` — findings → pill badge
- `src/provider.ts` — the outlet provider
- `src/extension.ts` — activation
- Root `README.md`: table row

---

### Task 1: Library — `aggregate_nutrition(ingredients, standard?)`

**Repo:** `~/Cooklang/cooklang-reports-nutrition`. Start with `git checkout main && git pull && git checkout -b feat/aggregate-standard`.

**Files:**
- Modify: `crates/cooklang-reports-nutrition/src/lib.rs` (the `"aggregate_nutrition"` registration, ~line 455–482)
- Test: `crates/cooklang-reports-nutrition/tests/jinja_test.rs`
- Modify: `crates/cookmd-nutrition-client/Cargo.toml`, `crates/cooklang-reports-nutrition/Cargo.toml`, `Cargo.lock`

- [ ] **Step 1: Write the failing test**

In `tests/jinja_test.rs`, extend the wiremock import on line 102 to `use wiremock::matchers::{body_partial_json, method, path, query_param};` and append after `aggregate_nutrition_returns_totals`:

```rust
#[tokio::test(flavor = "multi_thread")]
async fn aggregate_nutrition_forwards_optional_standard() {
    let server = MockServer::start().await;
    // Only matches when the request body carries `"reference": "eu"`; an
    // unmatched request gets wiremock's 404 and the render fails.
    Mock::given(method("POST"))
        .and(path("/aggregate"))
        .and(body_partial_json(serde_json::json!({ "reference": "eu" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "items": [{
                "ingredient": "butter", "preparation": "raw",
                "amount": { "value": 50.0, "unit": "g", "mass_g": 50.0 },
                "macros": { "kcal": 358.0, "protein_g": 0.4, "fat_g": 40.5,
                            "carb_g": 0.0, "fiber_g": 0.0, "sugar_g": 0.0, "sat_fat_g": 25.7 },
                "micros": {}, "vitamins": {}, "source": "usda",
                "confidence": "confirmed", "warnings": [],
                "allergens": { "status": "verified",
                               "contains": [{ "class": "milk", "label": "Milk" }], "view": "eu" }
            }],
            "failures": [],
            "totals": {
                "mass_g": 50.0,
                "macros": { "kcal": 358.0, "protein_g": 0.4, "fat_g": 40.5,
                            "carb_g": 0.0, "fiber_g": 0.0, "sugar_g": 0.0, "sat_fat_g": 25.7 },
                "micros": {}, "vitamins": {},
                "confidence": "confirmed", "is_partial": false,
                "included_count": 1, "failed_count": 0
            },
            "confidence_breakdown": {
                "confirmed_items": 1, "partial_items": 0, "estimated_items": 0,
                "estimated_ingredients": [], "estimated_share_of_micronutrients": null
            },
            "allergen_summary": { "contains": [{ "class": "milk", "label": "Milk" }],
                                  "unverified_ingredients": [], "view": "eu" }
        })))
        .mount(&server)
        .await;

    let base = server.uri();
    let rendered = tokio::task::spawn_blocking(move || {
        let client = Arc::new(Client::new(base));
        let ext = NutritionExtension::new(client);
        let config = Config::builder().build().with_extension(ext);
        let recipe = "Melt @butter{50%g}.";
        let template = r#"{% set agg = aggregate_nutrition(ingredients, "eu") %}{{ agg["items"][0].allergens.status }}|{{ agg["items"][0].allergens.contains[0].class }}"#;
        render_template_with_config(recipe, template, &config).unwrap()
    })
    .await
    .unwrap();

    assert_eq!(rendered, "verified|milk");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p cooklang-reports-nutrition --test jinja_test aggregate_nutrition_forwards_optional_standard`
Expected: FAIL — minijinja rejects the extra argument ("too many arguments").

- [ ] **Step 3: Implement**

In `src/lib.rs`, replace the `aggregate_nutrition` closure header and client call:

```rust
        env.add_function(
            "aggregate_nutrition",
            move |ingredients: minijinja::Value,
                  standard: Option<String>|
                  -> Result<minijinja::Value, minijinja::Error> {
                let items = ingredients_to_items(&ingredients)?;
                if items.is_empty() {
                    return Ok(minijinja::Value::from_serialize(empty_aggregate_response()));
                }
                // Optional reference standard (`fda`, `eu`, `uk`); it also selects
                // the allergen view. Empty or absent keeps the service default.
                let std_slug = standard.filter(|s| !s.is_empty());
                let resp = client
                    .aggregate(&items, &exclusions, std_slug.as_deref())
                    .map_err(|e| {
                        minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, e.to_string())
                    })?;
```

Leave the rest of the closure body (`record_failures`, exclusion tracking, `Ok(...)`) unchanged. Update the comment above the registration, if there is one describing the signature, to `aggregate_nutrition(ingredients, standard?)`.

- [ ] **Step 4: Run the whole crate's tests**

Run: `cargo test --workspace`
Expected: all pass, including the new test.

- [ ] **Step 5: Bump versions**

- `crates/cookmd-nutrition-client/Cargo.toml`: `version = "0.1.1"` (ships the already-merged `subscription required:` fix).
- `crates/cooklang-reports-nutrition/Cargo.toml`: `version = "0.1.2"`, and its dependency line becomes `cookmd-nutrition-client = { path = "../cookmd-nutrition-client", version = "0.1.1" }`.
- Run `cargo build --workspace` so `Cargo.lock` updates. Run `cargo publish --dry-run -p cookmd-nutrition-client` — Expected: succeeds. (The reports-nutrition dry run can't resolve 0.1.1 until the client is published; skip it.)

- [ ] **Step 6: Commit**

```bash
git add -A crates Cargo.lock
git commit -m "feat(jinja): optional standard argument for aggregate_nutrition; release client 0.1.1, reports-nutrition 0.1.2"
```

The controller opens the PR, merges it, and publishes (client first, then reports-nutrition).

---

### Task 2: Editor — `cooklang.api.refreshBadges`

**Repo:** `~/Cooklang/editor`. `git checkout main && git pull && git checkout -b feat/refresh-badges`.

**Files:**
- Modify: `packages/cooklang/src/browser/cooklang-outlet-service.ts`
- Modify: `packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts`
- Test: `packages/cooklang/src/browser/cooklang-outlet-service.spec.ts`, `packages/cooklang/src/browser/cooklang-plugin-api-contribution.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `cooklang-outlet-service.spec.ts`, after the test `'fires onDidChange when menus or commands change'`:

```ts
    it('fires onDidChange on refresh', () => {
        const fixture = new Fixture();
        const service = fixture.create();
        let fired = 0;
        service.onDidChange(() => { fired += 1; });
        service.refresh();
        expect(fired).to.equal(1);
    });
```

In `cooklang-plugin-api-contribution.spec.ts`:
- Add a field to the `Fixture` class next to the other recorded state: `refreshes = 0;`
- In `Fixture.create()`, next to `(contribution as any).pluginReports = …`, add:
  `(contribution as any).outlets = { refresh: () => { this.refreshes += 1; } };`
- Append a new describe block at the end of the file:

```ts
describe('CooklangPluginApiContribution — refreshBadges', () => {
    const { REFRESH_BADGES } = CooklangPluginApi.Commands;

    it('asks the outlet service to re-query badges', async () => {
        const fixture = new Fixture();
        fixture.create();
        expect(await fixture.run(REFRESH_BADGES)).to.equal(undefined);
        expect(fixture.refreshes).to.equal(1);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx lerna run compile --scope @theia/cooklang` — Expected: compile errors (`refresh` / `REFRESH_BADGES` don't exist).

- [ ] **Step 3: Implement**

`cooklang-outlet-service.ts`, directly after `init()`:

```ts
    /**
     * Tells outlet hosts that contents may have changed although no menu or
     * command did, e.g. a badge provider's settings. Hosts re-query on
     * {@link onDidChange}; the recipe preview debounces badge refreshes.
     */
    refresh(): void {
        this.onDidChangeEmitter.fire();
    }
```

`cooklang-plugin-api-contribution.ts`:
- Import: `import { CooklangOutletService } from './cooklang-outlet-service';`
- In `Commands`, after `RENDER_REPORT`:

```ts
        /**
         * No argument → `undefined`: asks open previews to re-query their badges, e.g. after a
         * badge provider's settings changed. Refreshes are debounced, so calling it often is cheap.
         */
        REFRESH_BADGES: 'cooklang.api.refreshBadges',
```

- Property injection next to the others:

```ts
    @inject(CooklangOutletService)
    protected readonly outlets: CooklangOutletService;
```

- In `registerCommands`, after the `RENDER_REPORT` registration:

```ts
        registry.registerCommand({ id: Commands.REFRESH_BADGES }, { execute: () => this.outlets.refresh() });
```

- [ ] **Step 4: Run the tests**

Run:
```bash
PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx lerna run compile --scope @theia/cooklang
PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH npx lerna run test --scope @theia/cooklang
```
Expected: all pass. Also `npx eslint packages/cooklang/src/browser/cooklang-outlet-service.ts packages/cooklang/src/browser/cooklang-plugin-api-contribution.ts` — clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang/src/browser
git commit -m "feat(cooklang): cooklang.api.refreshBadges for plugins whose badge settings changed"
```

(The native crate bump is Task 10, after the library is published.)

---

### Task 3: Plugin scaffold, API wrapper, class table

**Repo:** `~/Cooklang/plugins`, branch `feat/allergens`.

**Files:**
- Create: `allergens/package.json`, `allergens/tsconfig.json`, `allergens/.vscodeignore`, `allergens/LICENSE`, `allergens/scripts/deploy.js`
- Create: `allergens/src/cooklang-api.ts`, `allergens/src/support-check.ts`, `allergens/src/allergen-classes.ts`
- Test: `allergens/src/cooklang-api.spec.ts`, `allergens/src/allergen-classes.spec.ts`

- [ ] **Step 1: Scaffold**

Copy verbatim from `nutriscore/`: `tsconfig.json`, `.vscodeignore`, `LICENSE`, `src/support-check.ts`. Copy `nutriscore/scripts/deploy.js` and change the target line to `const target = path.join(editor, 'plugins/cooklang.allergens');`.

`allergens/package.json` — the 14 boolean settings are listed in EU-14 order:

```json
{
  "name": "allergens",
  "displayName": "Allergens",
  "description": "Flags the allergens you choose on recipe previews. Custom words work for everyone; the 14 regulated allergens use the cook.md nutrition service (Cook Basic or Pro).",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "allergens" },
  "keywords": ["cooklang", "allergens", "nutrition", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "cooklang.allergens.provideBadge", "title": "Allergens", "category": "Allergens" }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.allergens.provideBadge", "when": "false" }
      ],
      "cooklang/recipePreview/badge": [
        { "command": "cooklang.allergens.provideBadge" }
      ]
    },
    "configuration": {
      "title": "Allergens",
      "properties": {
        "allergens.gluten": { "type": "boolean", "default": false, "order": 1, "description": "Flag gluten (wheat, rye, barley, oats). Needs Cook Basic or Pro." },
        "allergens.crustaceans": { "type": "boolean", "default": false, "order": 2, "description": "Flag crustaceans. Needs Cook Basic or Pro." },
        "allergens.eggs": { "type": "boolean", "default": false, "order": 3, "description": "Flag eggs. Needs Cook Basic or Pro." },
        "allergens.fish": { "type": "boolean", "default": false, "order": 4, "description": "Flag fish. Needs Cook Basic or Pro." },
        "allergens.peanuts": { "type": "boolean", "default": false, "order": 5, "description": "Flag peanuts. Needs Cook Basic or Pro." },
        "allergens.soybeans": { "type": "boolean", "default": false, "order": 6, "description": "Flag soy. Needs Cook Basic or Pro." },
        "allergens.milk": { "type": "boolean", "default": false, "order": 7, "description": "Flag milk. Needs Cook Basic or Pro." },
        "allergens.treeNuts": { "type": "boolean", "default": false, "order": 8, "description": "Flag tree nuts (almonds, hazelnuts, walnuts…). Needs Cook Basic or Pro." },
        "allergens.celery": { "type": "boolean", "default": false, "order": 9, "description": "Flag celery. Needs Cook Basic or Pro." },
        "allergens.mustard": { "type": "boolean", "default": false, "order": 10, "description": "Flag mustard. Needs Cook Basic or Pro." },
        "allergens.sesame": { "type": "boolean", "default": false, "order": 11, "description": "Flag sesame. Needs Cook Basic or Pro." },
        "allergens.sulphites": { "type": "boolean", "default": false, "order": 12, "description": "Flag sulphites. Needs Cook Basic or Pro." },
        "allergens.lupin": { "type": "boolean", "default": false, "order": 13, "description": "Flag lupin. Needs Cook Basic or Pro." },
        "allergens.molluscs": { "type": "boolean", "default": false, "order": 14, "description": "Flag molluscs. Needs Cook Basic or Pro." },
        "allergens.custom": {
          "type": "array", "items": { "type": "string" }, "default": [], "order": 15,
          "description": "Other words to flag, matched against ingredient names (e.g. coriander). Plurals match both ways. Free for everyone."
        },
        "allergens.showWhenLocked": {
          "type": "boolean", "default": true, "order": 16,
          "description": "When your plan doesn't include nutrition data, show a hint that the standard allergens can't be checked."
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
    "publish:marketplace": "ovsx publish --packagePath allergens-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^3.3.0",
    "mocha": "^10.4.0",
    "ovsx": "^1.0.0",
    "typescript": "~5.4.5"
  }
}
```

Run `cd allergens && npm install` (creates `package-lock.json`, which is committed).

- [ ] **Step 2: Write the failing tests**

`src/allergen-classes.spec.ts`:

```ts
import * as assert from 'assert';
import { ALLERGEN_CLASSES } from './allergen-classes';

describe('ALLERGEN_CLASSES', () => {
    it('lists the 14 EU classes with unique slugs, keys and labels', () => {
        assert.strictEqual(ALLERGEN_CLASSES.length, 14);
        for (const field of ['slug', 'key', 'label'] as const) {
            assert.strictEqual(new Set(ALLERGEN_CLASSES.map(c => c[field])).size, 14, field);
        }
    });

    it('maps the camelCase setting to the service slug', () => {
        const treeNuts = ALLERGEN_CLASSES.find(c => c.key === 'treeNuts');
        assert.deepStrictEqual(treeNuts, { slug: 'tree_nuts', key: 'treeNuts', label: 'Tree nuts' });
    });

    it('matches the contributed settings', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../package.json');
        const keys = Object.keys(pkg.contributes.configuration.properties)
            .filter(key => pkg.contributes.configuration.properties[key].type === 'boolean' && key !== 'allergens.showWhenLocked');
        assert.deepStrictEqual(keys, ALLERGEN_CLASSES.map(c => `allergens.${c.key}`));
    });
});
```

`src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, REFRESH_BADGES_COMMAND } from './cooklang-api';

describe('CooklangApi.refreshBadges', () => {
    it('calls the command when the editor has it', async () => {
        const calls: string[] = [];
        const api = new CooklangApi(async command => { calls.push(command); }, async () => [REFRESH_BADGES_COMMAND]);
        assert.strictEqual(await api.refreshBadges(), true);
        assert.deepStrictEqual(calls, [REFRESH_BADGES_COMMAND]);
    });

    it('does nothing on an editor without it', async () => {
        const calls: string[] = [];
        const api = new CooklangApi(async command => { calls.push(command); }, async () => []);
        assert.strictEqual(await api.refreshBadges(), false);
        assert.deepStrictEqual(calls, []);
    });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd allergens && npm test` — Expected: tsc errors (modules missing).

- [ ] **Step 4: Implement**

`src/allergen-classes.ts`:

```ts
/** One of the 14 EU-regulated allergen classes the cook.md nutrition service tags. */
export interface AllergenClass {
    /** The service's class slug, e.g. `tree_nuts`. */
    slug: string;
    /** The setting name under `allergens.`, e.g. `treeNuts`. */
    key: string;
    /** Shown in the pill, e.g. `Tree nuts`. */
    label: string;
}

/** EU-14, in the order settings and pill labels appear. */
export const ALLERGEN_CLASSES: readonly AllergenClass[] = [
    { slug: 'gluten', key: 'gluten', label: 'Gluten' },
    { slug: 'crustaceans', key: 'crustaceans', label: 'Crustaceans' },
    { slug: 'eggs', key: 'eggs', label: 'Eggs' },
    { slug: 'fish', key: 'fish', label: 'Fish' },
    { slug: 'peanuts', key: 'peanuts', label: 'Peanuts' },
    { slug: 'soybeans', key: 'soybeans', label: 'Soy' },
    { slug: 'milk', key: 'milk', label: 'Milk' },
    { slug: 'tree_nuts', key: 'treeNuts', label: 'Tree nuts' },
    { slug: 'celery', key: 'celery', label: 'Celery' },
    { slug: 'mustard', key: 'mustard', label: 'Mustard' },
    { slug: 'sesame', key: 'sesame', label: 'Sesame' },
    { slug: 'sulphites', key: 'sulphites', label: 'Sulphites' },
    { slug: 'lupin', key: 'lupin', label: 'Lupin' },
    { slug: 'molluscs', key: 'molluscs', label: 'Molluscs' },
];
```

`src/cooklang-api.ts`:

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

- [ ] **Step 5: Run the tests**

Run: `cd allergens && npm test` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add allergens
git commit -m "feat(allergens): scaffold, API wrapper and EU-14 class table"
```

---

### Task 4: Settings

**Files:**
- Create: `allergens/src/settings.ts`
- Test: `allergens/src/settings.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as assert from 'assert';
import { isInactive, readSettings } from './settings';

const reader = (values: Record<string, unknown>) => (key: string): unknown => values[key];

describe('readSettings', () => {
    it('returns the ticked classes in EU-14 order', () => {
        const settings = readSettings(reader({ milk: true, gluten: true, treeNuts: false, eggs: 'yes' }));
        assert.deepStrictEqual(settings.classes.map(c => c.slug), ['gluten', 'milk']);
    });

    it('trims custom words, drops blanks, over-long and non-string entries, dedupes case-insensitively', () => {
        const settings = readSettings(reader({ custom: [' Coriander ', 'coriander', '', '   ', 42, 'x'.repeat(41), 'Mushroom'] }));
        assert.deepStrictEqual(settings.customWords, ['Coriander', 'Mushroom']);
    });

    it('treats a non-array custom setting as empty', () => {
        assert.deepStrictEqual(readSettings(reader({ custom: 'coriander' })).customWords, []);
    });

    it('shows the locked hint unless explicitly disabled', () => {
        assert.strictEqual(readSettings(reader({})).showWhenLocked, true);
        assert.strictEqual(readSettings(reader({ showWhenLocked: false })).showWhenLocked, false);
    });

    it('is inactive with nothing ticked and no custom words', () => {
        assert.strictEqual(isInactive(readSettings(reader({}))), true);
        assert.strictEqual(isInactive(readSettings(reader({ custom: ['kiwi'] }))), false);
        assert.strictEqual(isInactive(readSettings(reader({ fish: true }))), false);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`, expected tsc error (module missing).

- [ ] **Step 3: Implement** `src/settings.ts`:

```ts
import { ALLERGEN_CLASSES, AllergenClass } from './allergen-classes';

export const MAX_CUSTOM_WORD_LENGTH = 40;

export interface AllergenSettings {
    /** Ticked EU-14 classes, in table order. */
    classes: readonly AllergenClass[];
    /** Custom words as the user typed them (trimmed), deduplicated case-insensitively. */
    customWords: readonly string[];
    showWhenLocked: boolean;
}

/** Reads one setting under `allergens.`; extension.ts passes `getConfiguration('allergens').get`. */
export type ReadSetting = (key: string) => unknown;

export function readSettings(read: ReadSetting): AllergenSettings {
    const classes = ALLERGEN_CLASSES.filter(allergenClass => read(allergenClass.key) === true);
    const raw = read('custom');
    const seen = new Set<string>();
    const customWords: string[] = [];
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (typeof entry !== 'string') {
            continue;
        }
        const word = entry.trim();
        const folded = word.toLowerCase();
        if (word === '' || word.length > MAX_CUSTOM_WORD_LENGTH || seen.has(folded)) {
            continue;
        }
        seen.add(folded);
        customWords.push(word);
    }
    return { classes, customWords, showWhenLocked: read('showWhenLocked') !== false };
}

/** Nothing to look for: the provider returns no badge without rendering anything. */
export function isInactive(settings: AllergenSettings): boolean {
    return settings.classes.length === 0 && settings.customWords.length === 0;
}
```

- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** — `git add allergens/src && git commit -m "feat(allergens): read and normalise settings"`

---

### Task 5: Custom-word matcher

**Files:**
- Create: `allergens/src/custom-match.ts`
- Test: `allergens/src/custom-match.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as assert from 'assert';
import { matchCustomWords, matchesWord } from './custom-match';

describe('matchesWord', () => {
    const cases: Array<[string, string, boolean]> = [
        ['nut', 'nuts', true],
        ['nut', 'walnuts', false],
        ['nuts', 'nut', true],
        ['pea', 'peanut butter', false],
        ['pea', 'frozen peas', true],
        ['tomato', 'tomatoes', true],
        ['tomatoes', 'cherry tomato', true],
        ['cheeses', 'cheese', true],
        ['Coriander', 'fresh coriander leaves', true],
        ['soy sauce', 'dark soy  sauce', true],
        ['c++', 'c++ flour', true],
        ['a.b', 'axb', false],
        ['crème', 'crème fraîche', true],
        ['egg', 'eggplant', false],
    ];
    for (const [word, name, expected] of cases) {
        it(`${JSON.stringify(word)} ${expected ? 'matches' : 'does not match'} ${JSON.stringify(name)}`, () => {
            assert.strictEqual(matchesWord(word, name), expected);
        });
    }
});

describe('matchCustomWords', () => {
    it('groups matching ingredient names per word, in word order, deduplicated', () => {
        const matches = matchCustomWords(['kiwi', 'coriander', 'mango'], ['coriander', 'Kiwis', 'coriander', 'lime']);
        assert.deepStrictEqual(matches, [
            { word: 'kiwi', ingredients: ['Kiwis'] },
            { word: 'coriander', ingredients: ['coriander'] },
        ]);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement** `src/custom-match.ts`:

```ts
export interface CustomWordMatch {
    /** The word as the user typed it. */
    word: string;
    /** Recipe ingredient names it matched, first-seen order, no duplicates. */
    ingredients: string[];
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive, on word boundaries (letters/digits of any script), allowing a plural
 * `s`/`es` on either side: the word minus a trailing `es` or `s` is tried too, and any
 * alternative may be followed by `s`/`es`. `nut` matches "nuts" but not "walnuts";
 * `pea` does not match "peanut". Whitespace inside a word matches any whitespace run.
 */
function wordPattern(word: string): RegExp {
    const lower = word.trim().toLowerCase();
    const bases = new Set([lower]);
    if (lower.endsWith('es') && lower.length > 3) {
        bases.add(lower.slice(0, -2));
    }
    if (lower.endsWith('s') && lower.length > 2) {
        bases.add(lower.slice(0, -1));
    }
    const alternatives = [...bases].map(base => escapeRegExp(base).replace(/\s+/g, '\\s+'));
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
}

export function matchesWord(word: string, ingredientName: string): boolean {
    return wordPattern(word).test(ingredientName);
}

/** Words with at least one match, in the order given. */
export function matchCustomWords(words: readonly string[], ingredientNames: readonly string[]): CustomWordMatch[] {
    const matches: CustomWordMatch[] = [];
    for (const word of words) {
        const pattern = wordPattern(word);
        const ingredients = [...new Set(ingredientNames.filter(name => pattern.test(name)))];
        if (ingredients.length > 0) {
            matches.push({ word, ingredients });
        }
    }
    return matches;
}
```

Note: `c++` → escaped `c\+\+`; the trailing lookahead `(?![\p{L}\p{N}])` holds before the space, and the leading lookbehind holds at string start, so it matches.

- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(allergens): custom word matcher" ` (after `git add allergens/src`).

---

### Task 6: Templates, output validation, name alignment

**Files:**
- Create: `allergens/src/allergen-template.ts`
- Test: `allergens/src/allergen-template.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as assert from 'assert';
import { NAMES_TEMPLATE, STANDARD_TEMPLATE, parseAllergenOutput } from './allergen-template';

const verified = (...contains: Array<{ class: string; subtype?: string; label: string }>) =>
    ({ status: 'verified', contains, view: 'eu' });
const item = (ingredient: string, allergens?: unknown) => ({ ingredient, amount: { mass_g: 10 }, allergens });

describe('templates', () => {
    it('the names template makes no nutrition call', () => {
        assert.ok(!NAMES_TEMPLATE.includes('aggregate_nutrition'));
        assert.ok(NAMES_TEMPLATE.includes('tojson'));
    });

    it('the standard template asks for the EU view', () => {
        assert.ok(STANDARD_TEMPLATE.includes('aggregate_nutrition(ingredients, "eu")'));
    });
});

describe('parseAllergenOutput', () => {
    it('reads names only for the names template, stripping `?` and whitespace', () => {
        const parsed = parseAllergenOutput(JSON.stringify({ names: ['?salt ', 'butter'] }), false);
        assert.deepStrictEqual(parsed, { names: ['salt', 'butter'], ingredients: undefined });
    });

    it('aligns items and failures back to recipe names', () => {
        const output = JSON.stringify({
            names: ['plain flour', 'almonds', 'unobtainium', 'butter'],
            aggregate: {
                items: [
                    item('flour', { status: 'unverified', contains: [], view: 'eu' }),
                    item('almond', verified({ class: 'tree_nuts', subtype: 'almond', label: 'Almonds' })),
                    item('butter', verified({ class: 'milk', label: 'Milk' })),
                ],
                failures: [{ index: 2, ingredient: 'unobtainium', error: { code: 'not_found', message: '' } }],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'plain flour', status: 'unknown', contains: [] },
            { name: 'almonds', status: 'verified', contains: [{ class: 'tree_nuts', subtype: 'almond', label: 'Almonds' }] },
            { name: 'unobtainium', status: 'unknown', contains: [] },
            { name: 'butter', status: 'verified', contains: [{ class: 'milk', label: 'Milk' }] },
        ]);
    });

    it('falls back to service names when counts do not line up', () => {
        const output = JSON.stringify({
            names: ['a', 'b', 'c'],
            aggregate: { items: [item('egg', verified({ class: 'eggs', label: 'Eggs' }))], failures: [{ index: 1, ingredient: 'zzz' }] },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'egg', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
            { name: 'zzz', status: 'unknown', contains: [] },
        ]);
    });

    it('treats a missing or malformed allergens block as unknown and drops malformed entries', () => {
        const output = JSON.stringify({
            names: ['x', 'y'],
            aggregate: {
                items: [
                    item('x'),
                    item('y', { status: 'verified', contains: [{ class: 'milk' }, { class: 'eggs', label: 'Eggs', subtype: 3 }, 'nope'] }),
                ],
                failures: [],
            },
        });
        assert.deepStrictEqual(parseAllergenOutput(output, true)?.ingredients, [
            { name: 'x', status: 'unknown', contains: [] },
            { name: 'y', status: 'verified', contains: [{ class: 'eggs', label: 'Eggs' }] },
        ]);
    });

    it('rejects output that is not what the template produces', () => {
        assert.strictEqual(parseAllergenOutput('not json', false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [1] }), false), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [] }), true), undefined);
        assert.strictEqual(parseAllergenOutput(JSON.stringify({ names: [], aggregate: { items: {} , failures: [] } }), true), undefined);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement** `src/allergen-template.ts`:

```ts
// The Jinja templates this plugin asks the editor's Reports engine to render, and the
// validation of what comes back. Output is untrusted: every field is checked.

/**
 * Recipe ingredient names in the order `aggregate_nutrition` sends them: recipe
 * references skipped (the leading `?` of optional ingredients is stripped in
 * `parseAllergenOutput`). `names[i]` is therefore the i-th item sent to the service.
 */
const NAMES_PRELUDE = [
    '{%- set names = namespace(list=[]) -%}',
    '{%- for ing in ingredients -%}',
    '{%- if not ing.reference -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
].join('\n');

/** Ingredient names only: no nutrition call, works signed out. */
export const NAMES_TEMPLATE = `${NAMES_PRELUDE}\n{{ {"names": names.list} | tojson }}`;

/** Names plus the `/aggregate` response in the EU allergen view (all 14 classes). */
export const STANDARD_TEMPLATE = [
    NAMES_PRELUDE,
    '{%- set agg = aggregate_nutrition(ingredients, "eu") -%}',
    '{{ {"names": names.list, "aggregate": agg} | tojson }}',
].join('\n');

export interface AllergenEntry {
    class: string;
    subtype?: string;
    label: string;
}

export interface IngredientAllergens {
    /** Recipe name when alignment worked, otherwise the service's name. */
    name: string;
    /** `unknown`: unverified by the service, no allergen data, or not matched at all. */
    status: 'verified' | 'unknown';
    contains: AllergenEntry[];
}

export interface AllergenOutput {
    names: string[];
    /** Undefined for the names-only template. */
    ingredients: IngredientAllergens[] | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toEntry(value: unknown): AllergenEntry | undefined {
    if (!isPlainObject(value) || typeof value.class !== 'string' || typeof value.label !== 'string') {
        return undefined;
    }
    if (value.subtype !== undefined && typeof value.subtype !== 'string') {
        return { class: value.class, label: value.label };
    }
    return value.subtype === undefined
        ? { class: value.class, label: value.label }
        : { class: value.class, subtype: value.subtype, label: value.label };
}

function allergensOf(block: unknown): Pick<IngredientAllergens, 'status' | 'contains'> {
    if (!isPlainObject(block) || block.status !== 'verified' || !Array.isArray(block.contains)) {
        return { status: 'unknown', contains: [] };
    }
    const contains = block.contains.map(toEntry).filter((entry): entry is AllergenEntry => entry !== undefined);
    return { status: 'verified', contains };
}

function alignIngredients(names: string[], aggregate: unknown): IngredientAllergens[] | undefined {
    if (!isPlainObject(aggregate) || !Array.isArray(aggregate.items) || !Array.isArray(aggregate.failures)) {
        return undefined;
    }
    const items = aggregate.items.filter(isPlainObject).filter(item => typeof item.ingredient === 'string');
    const failures = aggregate.failures.filter(isPlainObject).filter(failure => typeof failure.ingredient === 'string');
    const failedIndices = new Set(failures
        .map(failure => failure.index)
        .filter((index): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < names.length));
    if (items.length + failures.length === names.length && failedIndices.size === failures.length) {
        let next = 0;
        return names.map((name, index) => failedIndices.has(index)
            ? { name, status: 'unknown', contains: [] }
            : { name, ...allergensOf(items[next++].allergens) });
    }
    return [
        ...items.map(item => ({ name: item.ingredient as string, ...allergensOf(item.allergens) })),
        ...failures.map(failure => ({ name: failure.ingredient as string, status: 'unknown' as const, contains: [] })),
    ];
}

/** `standard`: the output came from `STANDARD_TEMPLATE`. Undefined when the output is malformed. */
export function parseAllergenOutput(output: string, standard: boolean): AllergenOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data) || !Array.isArray(data.names) || !data.names.every(name => typeof name === 'string')) {
        return undefined;
    }
    const names = (data.names as string[]).map(name => name.replace(/^\?/, '').trim());
    if (!standard) {
        return { names, ingredients: undefined };
    }
    const ingredients = alignIngredients(names, data.aggregate);
    return ingredients ? { names, ingredients } : undefined;
}
```

- [ ] **Step 4: Run** `npm test` — all pass. (The `subtype: 3` case yields `{ class: 'eggs', label: 'Eggs' }`; the `{ class: 'milk' }` without a label is dropped.)
- [ ] **Step 5: Commit** — `git add allergens/src && git commit -m "feat(allergens): report templates and output alignment"`

---

### Task 7: Findings, pill text, hover

**Files:**
- Create: `allergens/src/markdown.ts`, `allergens/src/hover.ts`, `allergens/src/evaluate.ts`
- Test: `allergens/src/hover.spec.ts`, `allergens/src/evaluate.spec.ts`

- [ ] **Step 1: Write the failing tests**

`src/evaluate.spec.ts`:

```ts
import * as assert from 'assert';
import { ALLERGEN_CLASSES } from './allergen-classes';
import { IngredientAllergens } from './allergen-template';
import { badgeFor, findAllergens, pillText } from './evaluate';
import { LOCKED_TOOLTIP } from './hover';

const cls = (...slugs: string[]) => ALLERGEN_CLASSES.filter(c => slugs.includes(c.slug));
const verified = (name: string, ...contains: IngredientAllergens['contains']): IngredientAllergens => ({ name, status: 'verified', contains });
const unknown = (name: string): IngredientAllergens => ({ name, status: 'unknown', contains: [] });

describe('findAllergens', () => {
    const ingredients = [
        verified('soy sauce', { class: 'gluten', subtype: 'wheat', label: 'Wheat' }, { class: 'soybeans', label: 'Soybeans' }),
        verified('butter', { class: 'milk', label: 'Milk' }),
        verified('parmesan', { class: 'milk', label: 'Milk' }),
        unknown('saffron'),
        unknown('saffron'),
    ];
    const names = ['soy sauce', 'butter', 'parmesan', 'saffron', 'fresh coriander'];

    it('collects hits for ticked classes only, in class order, then custom words', () => {
        const findings = findAllergens(cls('milk', 'gluten'), ['coriander'], names, ingredients);
        assert.deepStrictEqual(findings.pillLabels, ['Gluten', 'Milk', 'coriander']);
        assert.deepStrictEqual(findings.lines, [
            { label: 'Wheat', ingredients: ['soy sauce'] },
            { label: 'Milk', ingredients: ['butter', 'parmesan'] },
            { label: 'coriander', ingredients: ['fresh coriander'] },
        ]);
        assert.deepStrictEqual(findings.unknown, ['saffron']);
    });

    it('reports no unknowns when no class is checked', () => {
        const findings = findAllergens([], ['kiwi'], names, undefined);
        assert.deepStrictEqual(findings, { pillLabels: [], lines: [], unknown: [] });
    });
});

describe('pillText', () => {
    it('fits as many labels as possible into 24 characters', () => {
        assert.strictEqual(pillText(['Milk']), '⚠ Milk');
        assert.strictEqual(pillText(['Milk', 'Tree nuts']), '⚠ Milk, Tree nuts');
        assert.strictEqual(pillText(['Milk', 'Tree nuts', 'Sesame']), '⚠ Milk, Tree nuts +1');
        for (const text of [pillText(['Crustaceans', 'Sulphites', 'Molluscs', 'Mustard']), pillText(['x'.repeat(40), 'Milk'])]) {
            assert.ok(text.length <= 24, text);
        }
        assert.strictEqual(pillText(['x'.repeat(40), 'Milk']), `⚠ ${'x'.repeat(18)}… +1`);
    });
});

describe('badgeFor', () => {
    const hit = { pillLabels: ['Milk'], lines: [{ label: 'Milk', ingredients: ['butter'] }], unknown: [] };
    const unsure = { pillLabels: [], lines: [], unknown: ['saffron'] };
    const clear = { pillLabels: [], lines: [], unknown: [] };

    it('flags hits in red', () => {
        const badge = badgeFor(hit, false, true);
        assert.strictEqual(badge?.tone, 'bad');
        assert.strictEqual(badge?.text, '⚠ Milk');
    });

    it('warns in amber when nothing matched but something could not be checked', () => {
        assert.deepStrictEqual([badgeFor(unsure, false, true)?.tone, badgeFor(unsure, false, true)?.text], ['warning', '⚠ Check allergens']);
    });

    it('shows nothing when everything was checked and nothing matched', () => {
        assert.strictEqual(badgeFor(clear, false, true), undefined);
    });

    it('shows the locked pill when standard classes could not be checked', () => {
        assert.deepStrictEqual(badgeFor(clear, true, true), { kind: 'pill', text: '🔒 Allergens', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(badgeFor(clear, true, false), undefined);
    });

    it('adds the locked line to a red pill unless the hint is disabled', () => {
        assert.ok(badgeFor(hit, true, true)?.tooltipMarkdown.includes('Cook Basic or Pro'));
        assert.ok(!badgeFor(hit, true, false)?.tooltipMarkdown.includes('Cook Basic or Pro'));
    });
});
```

`src/hover.spec.ts`:

```ts
import * as assert from 'assert';
import { hoverMarkdown } from './hover';

describe('hoverMarkdown', () => {
    it('lists hits, unknowns and the disclaimer', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['Milk'],
            lines: [{ label: 'Milk', ingredients: ['butter', 'parmesan'] }],
            unknown: ['saffron'],
        }, false);
        assert.strictEqual(markdown, [
            '**Allergens**',
            '- **Milk** — butter, parmesan',
            "Couldn't check: saffron",
            '_Informational only — always check product labels._',
        ].join('\n\n'));
    });

    it('says nothing tracked was found when only unknowns remain', () => {
        const markdown = hoverMarkdown({ pillLabels: [], lines: [], unknown: ['saffron'] }, false);
        assert.ok(markdown.includes('None of your allergens were found in the ingredients that could be checked.'));
    });

    it('escapes names and caps long lists', () => {
        const markdown = hoverMarkdown({
            pillLabels: ['x'],
            lines: [{ label: '**x**', ingredients: ['[a](https://evil)', ...Array.from({ length: 10 }, (_, i) => `i${i}`)] }],
            unknown: [],
        }, false);
        assert.ok(markdown.includes('\\*\\*x\\*\\*'));
        assert.ok(markdown.includes('\\[a\\]\\(https\\://evil\\)'));
        assert.ok(markdown.includes('and 3 more'));
    });

    it('adds the locked line when asked', () => {
        assert.ok(hoverMarkdown({ pillLabels: [], lines: [], unknown: [] }, true)
            .includes('Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)'));
    });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test`.

- [ ] **Step 3: Implement**

`src/markdown.ts` (same rules as nutriscore's `trust.ts`):

```ts
const MAX_LIST_ENTRIES = 8;
const MAX_NAME_LENGTH = 60;

/** Caps a display name at 60 characters, appending an ellipsis, before it is escaped. */
export function truncateName(name: string): string {
    return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH)}…` : name;
}

/**
 * Escapes markdown/HTML specials so untrusted names can't break out of the hover text. Collapses
 * whitespace runs containing a newline first, so a name can't start a new block; escapes `:` so
 * `https://…` substrings can't be autolinked.
 */
export function escapeMarkdown(text: string): string {
    const collapsed = text.replace(/\s*[\r\n]+\s*/g, ' ');
    return collapsed.replace(/[\\`*_{}[\]()#+\-.!|<>~:]/g, character => `\\${character}`);
}

/** Truncates and escapes each name, then joins them, capping the list at 8 with an "and N more" tail. */
export function formatNames(names: readonly string[]): string {
    const escaped = names.map(name => escapeMarkdown(truncateName(name)));
    if (escaped.length <= MAX_LIST_ENTRIES) {
        return escaped.join(', ');
    }
    return `${escaped.slice(0, MAX_LIST_ENTRIES).join(', ')}, and ${escaped.length - MAX_LIST_ENTRIES} more`;
}
```

`src/hover.ts`:

```ts
import { escapeMarkdown, formatNames, truncateName } from './markdown';

/** What was found; built by `findAllergens` in evaluate.ts. */
export interface AllergenFindings {
    /** Class labels (ticked classes, table order), then custom words: the pill text. */
    pillLabels: string[];
    /** One hover line per service label (e.g. "Wheat", "Almonds") or custom word. */
    lines: Array<{ label: string; ingredients: string[] }>;
    /** Ingredient names whose allergens couldn't be checked. */
    unknown: string[];
}

const MAX_LINES = 8;
export const DISCLAIMER = '_Informational only — always check product labels._';
export const LOCKED_LINE = 'Checking the standard allergens needs a Cook Basic or Pro plan. [See plans](https://cook.md/pricing)';

/** Tooltip of the neutral "🔒 Allergens" pill. */
export const LOCKED_TOOLTIP = `**Allergens** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to check recipes for the allergens you ticked in Settings.

[See plans](https://cook.md/pricing)`;

export function hoverMarkdown(findings: AllergenFindings, locked: boolean): string {
    const blocks = ['**Allergens**'];
    if (findings.lines.length > 0) {
        const shown = findings.lines.slice(0, MAX_LINES)
            .map(line => `- **${escapeMarkdown(truncateName(line.label))}** — ${formatNames(line.ingredients)}`);
        if (findings.lines.length > MAX_LINES) {
            shown.push(`- and ${findings.lines.length - MAX_LINES} more`);
        }
        blocks.push(shown.join('\n'));
    } else if (findings.unknown.length > 0) {
        blocks.push('None of your allergens were found in the ingredients that could be checked.');
    }
    if (findings.unknown.length > 0) {
        blocks.push(`Couldn't check: ${formatNames(findings.unknown)}`);
    }
    if (locked) {
        blocks.push(LOCKED_LINE);
    }
    blocks.push(DISCLAIMER);
    return blocks.join('\n\n');
}
```

`src/evaluate.ts`:

```ts
import { AllergenClass } from './allergen-classes';
import { IngredientAllergens } from './allergen-template';
import { PillBadge } from './cooklang-api';
import { matchCustomWords } from './custom-match';
import { AllergenFindings, LOCKED_TOOLTIP, hoverMarkdown } from './hover';

/** The editor's `PreviewBadge.MAX_TEXT_LENGTH`, in UTF-16 units. */
export const MAX_PILL_TEXT = 24;
const WARNING_TEXT = '⚠ Check allergens';
const LOCKED_TEXT = '🔒 Allergens';

/**
 * `classes`: ticked classes the service checked (empty when it didn't). `ingredients`: the
 * service's per-ingredient data, undefined for the names-only template.
 */
export function findAllergens(
    classes: readonly AllergenClass[],
    customWords: readonly string[],
    names: readonly string[],
    ingredients: readonly IngredientAllergens[] | undefined,
): AllergenFindings {
    const findings: AllergenFindings = { pillLabels: [], lines: [], unknown: [] };
    for (const allergenClass of classes) {
        const byLabel = new Map<string, string[]>();
        for (const ingredient of ingredients ?? []) {
            for (const entry of ingredient.contains) {
                if (entry.class !== allergenClass.slug) {
                    continue;
                }
                const list = byLabel.get(entry.label) ?? [];
                if (!list.includes(ingredient.name)) {
                    list.push(ingredient.name);
                }
                byLabel.set(entry.label, list);
            }
        }
        if (byLabel.size > 0) {
            findings.pillLabels.push(allergenClass.label);
            for (const [label, list] of byLabel) {
                findings.lines.push({ label, ingredients: list });
            }
        }
    }
    for (const match of matchCustomWords(customWords, names)) {
        findings.pillLabels.push(match.word);
        findings.lines.push({ label: match.word, ingredients: match.ingredients });
    }
    if (classes.length > 0 && ingredients) {
        findings.unknown = [...new Set(ingredients.filter(i => i.status === 'unknown').map(i => i.name))];
    }
    return findings;
}

/** `⚠ ` + as many labels as fit in 24 characters, ` +N` for the rest; a single over-long label is cut with `…`. */
export function pillText(labels: readonly string[]): string {
    for (let shown = labels.length; shown >= 1; shown--) {
        const rest = labels.length - shown;
        const text = `⚠ ${labels.slice(0, shown).join(', ')}${rest > 0 ? ` +${rest}` : ''}`;
        if (text.length <= MAX_PILL_TEXT) {
            return text;
        }
    }
    const suffix = labels.length > 1 ? ` +${labels.length - 1}` : '';
    const room = MAX_PILL_TEXT - '⚠ '.length - '…'.length - suffix.length;
    return `⚠ ${labels[0].slice(0, room)}…${suffix}`;
}

/**
 * Red when something matched, amber when nothing matched but something couldn't be checked,
 * the neutral locked pill when the standard classes couldn't be checked at all, else nothing.
 * `locked`: standard classes are ticked but the plan doesn't include nutrition data.
 */
export function badgeFor(findings: AllergenFindings, locked: boolean, showWhenLocked: boolean): PillBadge | undefined {
    const showLock = locked && showWhenLocked;
    if (findings.pillLabels.length > 0) {
        return { kind: 'pill', text: pillText(findings.pillLabels), tone: 'bad', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (findings.unknown.length > 0) {
        return { kind: 'pill', text: WARNING_TEXT, tone: 'warning', tooltipMarkdown: hoverMarkdown(findings, showLock) };
    }
    if (showLock) {
        return { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP };
    }
    return undefined;
}
```

Check: `pillText(['x'.repeat(40), 'Milk'])` → room = 24 − 2 − 1 − 3 = 18 → `⚠ xxxxxxxxxxxxxxxxxx… +1` (24 units). `pillText(['Milk','Tree nuts','Sesame'])`: all three = `⚠ Milk, Tree nuts, Sesame` (25) → too long; two + ` +1` = `⚠ Milk, Tree nuts +1` (20). 

- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** — `git add allergens/src && git commit -m "feat(allergens): findings, pill text and hover card"`

---

### Task 8: Provider

**Files:**
- Create: `allergens/src/provider.ts`
- Test: `allergens/src/provider.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as assert from 'assert';
import { NAMES_TEMPLATE, STANDARD_TEMPLATE } from './allergen-template';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { LOCKED_TOOLTIP } from './hover';
import { AllergenBadgeProvider } from './provider';
import { AllergenSettings, readSettings } from './settings';

const CONTEXT = { version: 1, uri: 'file:///ws/a.cook', path: 'a.cook', scale: 1 };

const settings = (values: Record<string, unknown>): AllergenSettings => readSettings(key => values[key]);

const standardOutput: PluginReportResult = {
    ok: true,
    output: JSON.stringify({
        names: ['butter', 'saffron', 'coriander'],
        aggregate: {
            items: [
                { ingredient: 'butter', allergens: { status: 'verified', contains: [{ class: 'milk', label: 'Milk' }], view: 'eu' } },
                { ingredient: 'saffron', allergens: { status: 'unverified', contains: [], view: 'eu' } },
                { ingredient: 'coriander', allergens: { status: 'verified', contains: [], view: 'eu' } },
            ],
            failures: [],
        },
    }),
};
const namesOutput: PluginReportResult = { ok: true, output: JSON.stringify({ names: ['butter', 'saffron', 'coriander'] }) };

function setup(options: { values: Record<string, unknown>; feature?: boolean; results?: PluginReportResult[] }): {
    provider: AllergenBadgeProvider; templates: string[]; logs: string[]; featureChecks: number;
} {
    const state = { templates: [] as string[], logs: [] as string[], featureChecks: 0 };
    const results = options.results ?? [];
    const api = new CooklangApi(async (command, ...args) => {
        if (command === 'cooklang.api.hasFeature') {
            state.featureChecks += 1;
            return options.feature ?? true;
        }
        state.templates.push((args[0] as { template: string }).template);
        return results.shift();
    }, async () => []);
    const provider = new AllergenBadgeProvider(api, message => state.logs.push(message), () => settings(options.values));
    return { provider, get templates() { return state.templates; }, get logs() { return state.logs; }, get featureChecks() { return state.featureChecks; } };
}

describe('AllergenBadgeProvider', () => {
    it('does nothing when no allergen is chosen', async () => {
        const s = setup({ values: {} });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual([s.templates, s.featureChecks], [[], 0]);
    });

    it('ignores a malformed context', async () => {
        const s = setup({ values: { milk: true } });
        assert.strictEqual(await s.provider.provide({ uri: 1 }), undefined);
    });

    it('flags standard and custom hits from one standard render', async () => {
        const s = setup({ values: { milk: true, custom: ['coriander'] }, results: [standardOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.deepStrictEqual([badge?.tone, badge?.text], ['bad', '⚠ Milk, coriander']);
        assert.ok(badge?.tooltipMarkdown.includes("Couldn't check: saffron"));
        assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE]);
    });

    it('uses the names template without a feature check when only custom words are set', async () => {
        const s = setup({ values: { custom: ['butter'] }, results: [namesOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ butter');
        assert.deepStrictEqual([s.templates, s.featureChecks], [[NAMES_TEMPLATE], 0]);
    });

    it('shows the locked pill without rendering when the plan lacks nutrition and there are no custom words', async () => {
        const s = setup({ values: { milk: true }, feature: false });
        assert.deepStrictEqual(await s.provider.provide(CONTEXT), { kind: 'pill', text: '🔒 Allergens', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.deepStrictEqual(s.templates, []);
    });

    it('still matches custom words for a plan without nutrition, with the locked line', async () => {
        const s = setup({ values: { milk: true, custom: ['coriander'] }, feature: false, results: [namesOutput] });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ coriander');
        assert.ok(badge?.tooltipMarkdown.includes('Cook Basic or Pro'));
        assert.deepStrictEqual(s.templates, [NAMES_TEMPLATE]);
    });

    it('falls back to custom words when the service refuses', async () => {
        const s = setup({
            values: { milk: true, custom: ['coriander'] },
            results: [{ ok: false, reason: 'forbidden', message: 'subscription required: x' }, namesOutput],
        });
        const badge = await s.provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, '⚠ coriander');
        assert.deepStrictEqual(s.templates, [STANDARD_TEMPLATE, NAMES_TEMPLATE]);
    });

    it('shows the locked pill when the service refuses and there are no custom words', async () => {
        const s = setup({ values: { milk: true }, results: [{ ok: false, reason: 'unauthenticated', message: 'x' }] });
        assert.strictEqual((await s.provider.provide(CONTEXT))?.text, '🔒 Allergens');
    });

    it('shows nothing on other failures and logs each reason once', async () => {
        const failure: PluginReportResult = { ok: false, reason: 'network', message: 'offline' };
        const s = setup({ values: { milk: true }, results: [failure, failure] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (network): offline']);
    });

    it('shows nothing for malformed output', async () => {
        const s = setup({ values: { milk: true }, results: [{ ok: true, output: '{}' }] });
        assert.strictEqual(await s.provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(s.logs, ['Allergens unavailable (output): unexpected template output']);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement** `src/provider.ts`:

```ts
import { NAMES_TEMPLATE, STANDARD_TEMPLATE, parseAllergenOutput } from './allergen-template';
import { CooklangApi, PillBadge, PluginReportResult, PreviewOutletContext } from './cooklang-api';
import { badgeFor, findAllergens } from './evaluate';
import { AllergenSettings, isInactive } from './settings';

const NO_FINDINGS = { pillLabels: [], lines: [], unknown: [] };

function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Backs `cooklang.allergens.provideBadge` (outlet `cooklang/recipePreview/badge`). */
export class AllergenBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => AllergenSettings,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        if (isInactive(settings)) {
            return undefined;
        }
        const wantsStandard = settings.classes.length > 0;
        // Only ask about the plan when a standard class is ticked: custom words are free.
        let standard = wantsStandard && await this.api.hasFeature('nutrition_api');
        if (wantsStandard && !standard && settings.customWords.length === 0) {
            return badgeFor(NO_FINDINGS, true, settings.showWhenLocked);
        }
        let result = await this.render(context, standard);
        if (!result.ok && standard && (result.reason === 'unauthenticated' || result.reason === 'forbidden')) {
            // The cached plan said yes but the service disagreed (expired sign-in, lapsed plan).
            this.logOnce(result.reason, result.message);
            standard = false;
            if (settings.customWords.length === 0) {
                return badgeFor(NO_FINDINGS, true, settings.showWhenLocked);
            }
            result = await this.render(context, false);
        }
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            return undefined;
        }
        const output = parseAllergenOutput(result.output, standard);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return undefined;
        }
        // A badge is about to be computed: earlier failures are superseded.
        this.logged.clear();
        const findings = findAllergens(standard ? settings.classes : [], settings.customWords, output.names, output.ingredients);
        return badgeFor(findings, wantsStandard && !standard, settings.showWhenLocked);
    }

    protected render(context: PreviewOutletContext, standard: boolean): Promise<PluginReportResult> {
        return this.api.renderReport({ uri: context.uri, template: standard ? STANDARD_TEMPLATE : NAMES_TEMPLATE, scale: context.scale });
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Allergens unavailable (${reason}): ${message}`);
        }
    }
}
```

Check the "falls back when the service refuses" test: log contains the forbidden line, and `logged.clear()` then runs after the successful names render — fine, the test doesn't assert logs there.

- [ ] **Step 4: Run** `npm test` — all pass.
- [ ] **Step 5: Commit** — `git add allergens/src && git commit -m "feat(allergens): badge provider"`

---

### Task 9: Activation, README, packaging

**Files:**
- Create: `allergens/src/extension.ts`, `allergens/README.md`
- Modify: root `README.md` (plugin table)

- [ ] **Step 1: Implement** `src/extension.ts`:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { AllergenBadgeProvider } from './provider';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Allergens');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const supportCheck = new SupportCheck(api);
    const provider = new AllergenBadgeProvider(
        api,
        message => output.appendLine(message),
        () => {
            const configuration = vscode.workspace.getConfiguration('allergens');
            return readSettings(key => configuration.get(key));
        },
    );
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.allergens.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Allergens needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    // Ticking an allergen should update the open preview without an edit.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('allergens')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 2: Write** `allergens/README.md`:

```markdown
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
| amber `⚠ Check allergens` | nothing found, but some ingredients couldn't be checked |
| no badge | every ingredient was checked and none of your allergens was found |
| grey `🔒 Allergens` | you ticked standard allergens but your plan doesn't include nutrition data |

Hover the badge to see which ingredients triggered each allergen and which ones couldn't be checked.

**This is informational only.** It never says a recipe is allergen-free: ingredient data can be incomplete, and it knows nothing about cross-contamination. Always check product labels.

## Plans

Custom words work for everyone, offline included. The 14 standard allergens come from the cook.md nutrition service and need a Cook Basic or Pro plan. Turn off **Show When Locked** to hide the grey hint.

## For plugin authors

Shows the preview badge outlet (`cooklang/recipePreview/badge`) with a `pill` badge, rendering a report template with `cooklang.api.renderReport` (`aggregate_nutrition(ingredients, "eu")` for per-ingredient allergen data), and `cooklang.api.refreshBadges` after a settings change.
```

- [ ] **Step 3: Root README row** — after the `nutriscore` row add:

```markdown
| [`allergens`](./allergens) | Flags the allergens you choose on recipe previews: the 14 regulated allergens (Cook Basic or Pro) and your own words (free). Install it from the Extensions view. Shows a `pill` preview badge and `cooklang.api.refreshBadges`. |
```

- [ ] **Step 4: Verify**

Run: `cd allergens && npm test && npm run package`
Expected: all tests pass; `allergens-0.1.0.vsix` produced. Check its contents with `unzip -l allergens-0.1.0.vsix`: only `package.json`, `README.md`, `LICENSE`, `out/*.js` (no specs, maps, `src`).

- [ ] **Step 5: Commit**

```bash
git add allergens README.md
git commit -m "feat(allergens): activation, README and packaging"
```

---

### Task 10: Editor native bump + E2E (controller)

Runs after the library is published (Task 1 merged + `cargo publish`).

- [ ] **Step 1:** In `~/Cooklang/editor` on `feat/refresh-badges`: set `cooklang-reports-nutrition = { version = "0.1.2", optional = true }` and `cookmd-nutrition-client = { version = "0.1.1", optional = true }` in `packages/cooklang-native/Cargo.toml`; run `cargo update -p cooklang-reports-nutrition -p cookmd-nutrition-client` in that folder; `npm run build` there. Commit `chore(cooklang-native): cooklang-reports-nutrition 0.1.2 (aggregate_nutrition standard argument)`.
- [ ] **Step 2:** Bundle and start the app (`cd app && npm run bundle`, `npm run start:electron`), deploy the plugin (`cd ~/Cooklang/plugins/allergens && npm run deploy`).
- [ ] **Step 3:** E2E via CDP with the signed-in account: tick Milk + Tree nuts, add custom `coriander`; a recipe with butter shows the red pill; a recipe whose ingredients are all unverified shows the amber pill; unticking everything removes the badge without editing the recipe; hover has no clickable links except "See plans" in the locked state.
- [ ] **Step 4:** Open PRs (library, editor, plugins), merge when CI is green, publish the plugin (`npm run package && npm run publish:marketplace`), and add the unverified-coverage note to cook-md/db#54.

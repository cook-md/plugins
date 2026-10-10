# Pantry Match Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free `cooklang.pantry-match` plugin ("What can I cook?") that ranks the workspace's recipes by how much of each is already in `config/pantry.conf`, shows them in an Explorer view (Cook now / Missing 1–2 / Use it up / Couldn't read), adds a `Have 9/11` pill badge to recipe previews, and hands a recipe to the Shopping List plugin for what's missing. Works signed out.

**Architecture:** Every decision lives in small pure modules with mocha specs (`match.ts`, `expiry.ts`, `names-template.ts`, `pantry-file.ts`, `references.ts`, `recipe-index.ts`, `view-model.ts`, `badge.ts`, `settings.ts`). The editor does the parsing: `cooklang.api.parsePantry` for the pantry, `cooklang.api.renderReport` with the Allergens names-only template for ingredient names, and `cooklang.api.resolveRecipeReferences` for linked recipes. A thin `vscode` layer (`tree.ts`, `controller.ts`, `extension.ts`) owns the tree view, file watchers, context keys and commands.

**Tech Stack:** TypeScript (`typescript ~7.0.2`, like the other plugins), VS Code extension API 1.100 (via Theia, Cook Editor), mocha + node `assert`, `@vscode/vsce` for packaging.

**Spec:** `docs/superpowers/specs/2026-10-10-pantry-match-plugin-design.md`

---

## Deviations from spec

Checked against the real code on 2026-10-10:

1. **Optional flag comes from a leading `?`, not a template field.** The Reports engine's `Ingredient` (`cooklang-reports/src/model/ingredient.rs`) exposes only `name`, `note`, `alias`, `quantity`, `reference`, `reference_path`. There is no `optional`. The engine parses with `CooklangParser::canonical()` (no extensions), so `@?parsley{}` arrives as the name `?parsley`. That's why Allergens strips a leading `?`. The template stays exactly the Allergens `NAMES_TEMPLATE` (`{"names": [string], "refs": [string]}`), and `parseNamesOutput` turns a leading `?` into `optional: true`. The TypeScript shape is the spec's `{ names: [{ name, optional }], refs }`.
2. **Reference expansion uses the editor's tree.** `cooklang.api.resolveRecipeReferences({ path })` already recurses, is cycle-safe and caps depth at 100. It returns a `{ path, scale, children? }` tree. Its paths are workspace-relative, with no leading `./` and usually no `.cook`. The plugin calls it once per recipe that has refs (from the template's `refs`). It then flattens the tree to depth 3 with its own visited set (still cycle-safe) and appends `.cook` before looking up names.
3. **The empty-state button runs `pantry.show`, not `pantry.openFile`.** The Pantry plugin's `pantry.openFile` only opens an existing file. With no file it says "Use Create pantry in the Pantry view". So **Set up pantry** runs `pantry.show` (that view has "Create pantry") when the Pantry plugin is installed, and otherwise opens `https://cook.md/help/plugins/pantry`. The malformed-pantry state uses the plugin's own `pantryMatch.openPantryFile`, which works without the Pantry plugin.
4. **The progress indicator is `TreeView.message`** ("Reading recipes… 40/120") plus an `indexing` welcome text. `window.withProgress({ viewId })` isn't used. Theia implements `TreeView.message` (`@theia/plugin-ext/lib/plugin/tree/tree-views.js`), but `viewId` progress isn't verified.
5. **Indexing is lazy.** The workspace scan starts the first time the view becomes visible, or on Refresh. The badge renders only the previewed recipe and works without the index.
6. **More modules than the spec lists:** `settings.ts`, `references.ts`, `expiry.ts`, `view-model.ts` (pure tree model), `markdown.ts` (hover escaping, copied from Allergens) and `controller.ts` (vscode glue).
7. **Ranking edges the spec leaves open.** Recipes with 3 or more missing appear only under *Use it up*. Recipes with no required ingredients (everything optional or in `alwaysHave`) appear in neither Cook now nor Missing. Out-of-stock items are never listed under *Use it up*. Missing names drop the text after a comma (`Garlic, minced` → `Garlic`).

---

## Conventions for every task

- **Repo root:** `/Users/alexeydubovskoy/Cooklang/plugins`. All paths below are relative to it. The approved spec sits on `docs/four-plugin-specs`. Implement on a new branch `feat/pantry-match` from `main`. Use a worktree if other work is checked out (`git worktree add ../plugins-pantry-match -b feat/pantry-match main`), and then the repo root is that worktree. The plugin folder is `pantry-match/`.
- **Tests:** `cd pantry-match && npm test` (`tsc -p .`, then `mocha "out/**/*.spec.js"`). Before the module exists, the expected failure is a compile error: `error TS2307: Cannot find module './<name>'`. Node 20 is fine. If `npm` complains, use Node 22: `export PATH=~/.local/node-v22.23.2-darwin-x64/bin:$PATH`.
- **Style:** 4-space indent, single quotes, `undefined` not `null`, explicit return types. No `vscode` import outside `tree.ts`, `controller.ts` and `extension.ts`, and no spec imports those three.
- **Commits:** conventional commits scoped `pantry-match`, e.g. `feat(pantry-match): …`. Never `git add -A`; add the listed files.
- **Fixtures:** never use the deprecated `>>` metadata syntax in any `.cook` fixture. Use YAML frontmatter.

---

## File structure

| File | Responsibility |
|---|---|
| `pantry-match/package.json` | Manifest: settings, Explorer view "What can I cook", welcome views, commands, view-title Refresh, item context action, badge outlet. |
| `pantry-match/tsconfig.json` | Compiler options (same as `favourites/`). |
| `pantry-match/.vscodeignore` | Keeps sources, specs and maps out of the `.vsix`. |
| `pantry-match/LICENSE` | MIT, copied from `favourites/LICENSE`. |
| `pantry-match/README.md` | User guide plus a "For plugin authors" section. |
| `pantry-match/scripts/deploy.js` | Copies the built plugin into `../../editor/plugins/cooklang.pantry-match`. |
| `pantry-match/src/cooklang-api.ts` | Typed wrapper over `cooklang.api.*` (renderReport, parsePantry, resolveRecipeReferences, openPreview, refreshBadges) and command detection. |
| `pantry-match/src/settings.ts` | Reads and normalises `pantryMatch.*` settings. |
| `pantry-match/src/pantry-file.ts` | `config/pantry.conf` location and loading into a `PantryState` (missing / error / ok + flat items). |
| `pantry-match/src/names-template.ts` | Names-only Jinja template, output validation (`?` → optional), `renderNames`. |
| `pantry-match/src/match.ts` | Name normalisation, pantry lookup, per-recipe coverage. |
| `pantry-match/src/recipe-index.ts` | Per-file render cache keyed by mtime, invalidation, batched (10) refresh, coalescing. |
| `pantry-match/src/references.ts` | Reference path normalisation, depth-3 cycle-safe flattening, `ReferenceExpander` (merges linked recipes' names). |
| `pantry-match/src/expiry.ts` | Days-until math, expiring-item selection, expiry wording. |
| `pantry-match/src/markdown.ts` | Escaping and truncating untrusted names for hover markdown. |
| `pantry-match/src/view-model.ts` | Builds groups and rows, ranks them, defines tree nodes and `childrenOf`, `recipeUriOf`. |
| `pantry-match/src/badge.ts` | `badgeFor` + `PantryBadgeProvider` for `cooklang/recipePreview/badge`. |
| `pantry-match/src/tree.ts` | `vscode.TreeDataProvider` mapping view-model nodes to `TreeItem`s. |
| `pantry-match/src/controller.ts` | vscode glue: watchers, debounce, pantry loading, index refresh, context keys, tree updates. |
| `pantry-match/src/extension.ts` | `activate`: API wrapper, controller, command registrations, Shopping List context key. |
| `pantry-match/src/*.spec.ts` | Mocha specs for every pure module. |
| `.github/workflows/ci.yml` | Adds `pantry-match` to the matrix. |
| `README.md` (root) | Adds the plugin row. |

---

### Task 1: Scaffold the plugin

**Files:**
- Create: `pantry-match/package.json`, `pantry-match/tsconfig.json`, `pantry-match/.vscodeignore`, `pantry-match/LICENSE`, `pantry-match/README.md` (stub, finished in Task 13), `pantry-match/scripts/deploy.js`, `pantry-match/src/extension.ts` (stub, replaced in Task 12)

- [ ] **Step 1: Create the manifest**

`pantry-match/package.json`:

```json
{
  "name": "pantry-match",
  "displayName": "Pantry Match",
  "description": "What can I cook? Ranks your recipes by what's already in your pantry and suggests recipes for pantry items that expire soon. Free, works signed out.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cook-md/plugins.git",
    "directory": "pantry-match"
  },
  "keywords": [
    "cooklang",
    "pantry",
    "recipes",
    "meal-planning",
    "what can I cook"
  ],
  "engines": {
    "vscode": "^1.100.0"
  },
  "categories": [
    "Other"
  ],
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "commands": [
      {
        "command": "pantryMatch.refresh",
        "title": "Refresh",
        "category": "Pantry Match",
        "icon": "$(refresh)"
      },
      {
        "command": "pantryMatch.openRecipe",
        "title": "Open Recipe",
        "category": "Pantry Match"
      },
      {
        "command": "pantryMatch.addMissingToShoppingList",
        "title": "Add missing to shopping list",
        "category": "Pantry Match"
      },
      {
        "command": "pantryMatch.setUpPantry",
        "title": "Set Up Pantry",
        "category": "Pantry Match"
      },
      {
        "command": "pantryMatch.openPantryFile",
        "title": "Open pantry.conf",
        "category": "Pantry Match"
      },
      {
        "command": "pantryMatch.provideBadge",
        "title": "Pantry Match",
        "category": "Pantry Match"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "pantryMatch.openRecipe",
          "when": "false"
        },
        {
          "command": "pantryMatch.addMissingToShoppingList",
          "when": "false"
        },
        {
          "command": "pantryMatch.provideBadge",
          "when": "false"
        }
      ],
      "view/title": [
        {
          "command": "pantryMatch.refresh",
          "when": "view == pantryMatch.view",
          "group": "navigation@1"
        }
      ],
      "view/item/context": [
        {
          "command": "pantryMatch.addMissingToShoppingList",
          "when": "view == pantryMatch.view && viewItem == recipeMissing && pantryMatch.shoppingListAvailable",
          "group": "1_shopping@1"
        }
      ],
      "cooklang/recipePreview/badge": [
        {
          "command": "pantryMatch.provideBadge"
        }
      ]
    },
    "views": {
      "explorer": [
        {
          "id": "pantryMatch.view",
          "name": "What can I cook",
          "visibility": "collapsed"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "pantryMatch.view",
        "contents": "Open a recipe folder to see what you can cook.",
        "when": "pantryMatch.state == noWorkspace"
      },
      {
        "view": "pantryMatch.view",
        "contents": "What can I cook needs a newer Cook Editor. Update Cook Editor to use it.",
        "when": "pantryMatch.state == unsupported"
      },
      {
        "view": "pantryMatch.view",
        "contents": "Add a pantry to see what you can cook.\n[Set up pantry](command:pantryMatch.setUpPantry)",
        "when": "pantryMatch.state == noPantry"
      },
      {
        "view": "pantryMatch.view",
        "contents": "Your pantry.conf couldn't be read.\n[Open pantry.conf](command:pantryMatch.openPantryFile)",
        "when": "pantryMatch.state == pantryError"
      },
      {
        "view": "pantryMatch.view",
        "contents": "Reading your recipes…",
        "when": "pantryMatch.state == indexing"
      },
      {
        "view": "pantryMatch.view",
        "contents": "No recipe is within two ingredients of your pantry yet, and nothing in it expires soon.\n[Refresh](command:pantryMatch.refresh)",
        "when": "pantryMatch.state == empty"
      }
    ],
    "configuration": {
      "title": "Pantry Match",
      "properties": {
        "pantryMatch.alwaysHave": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": [
            "salt",
            "pepper",
            "black pepper",
            "water"
          ],
          "order": 1,
          "description": "Ingredients you always have. They're never listed as missing and don't count towards a recipe's score."
        },
        "pantryMatch.expiringWithinDays": {
          "type": "number",
          "default": 5,
          "minimum": 0,
          "maximum": 365,
          "order": 2,
          "description": "Pantry items that expire within this many days, or already have, appear under \"Use it up\"."
        },
        "pantryMatch.showBadge": {
          "type": "boolean",
          "default": true,
          "order": 3,
          "description": "Show a \"Have 9/11\" badge on recipe previews."
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
    "publish:marketplace": "ovsx publish --packagePath pantry-match-$npm_package_version.vsix -r https://plugins.cook.md"
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

- [ ] **Step 2: Create `pantry-match/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "mocha"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `pantry-match/.vscodeignore`**

```
src/**
scripts/**
tsconfig.json
package-lock.json
.vscodeignore
out/**/*.spec.js
out/**/*.map
**/.DS_Store
```

- [ ] **Step 4: Copy the licence**

```bash
cp favourites/LICENSE pantry-match/LICENSE
```

- [ ] **Step 5: Create `pantry-match/scripts/deploy.js`**

```js
// Copies the built plugin into the Cook Editor checkout's plugins folder,
// which the app copies into its own plugins folder on start (app's copy:plugins).
// Override the editor location with COOK_EDITOR_DIR (e.g. an editor worktree).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const editor = process.env.COOK_EDITOR_DIR ?? path.resolve(root, '../../editor');
const target = path.join(editor, 'plugins/cooklang.pantry-match');

// Skips test specs and source maps, which the packaged plugin doesn't need.
const skipTestArtifacts = src => !/\.spec\.js$|\.map$/.test(src);

const required = ['package.json', 'out', 'LICENSE'];
const optional = ['README.md'];

for (const entry of required) {
    if (!fs.existsSync(path.join(root, entry))) {
        throw new Error(`Missing ${entry}${entry === 'out' ? '; run npm run compile first' : ''}`);
    }
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of [...required, ...optional]) {
    if (!fs.existsSync(path.join(root, entry))) {
        continue;
    }
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: skipTestArtifacts });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 6: Create the stub entry point and README**

`pantry-match/src/extension.ts`:

```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
    // Wired in Task 12.
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

`pantry-match/README.md`:

```markdown
# Pantry Match

What can I cook? Work in progress.
```

- [ ] **Step 7: Install and compile**

Run: `cd pantry-match && npm install && npm run compile && ls out`
Expected: `npm install` creates `package-lock.json` and `out/extension.js` exists.

- [ ] **Step 8: Commit**

```bash
git add pantry-match/package.json pantry-match/package-lock.json pantry-match/tsconfig.json pantry-match/.vscodeignore pantry-match/LICENSE pantry-match/README.md pantry-match/scripts/deploy.js pantry-match/src/extension.ts
git commit -m "feat(pantry-match): scaffold the Pantry Match plugin"
```

---

### Task 2: Cooklang API wrapper and settings

**Files:**
- Create: `pantry-match/src/cooklang-api.ts`, `pantry-match/src/settings.ts`
- Test: `pantry-match/src/cooklang-api.spec.ts`, `pantry-match/src/settings.spec.ts`

- [ ] **Step 1: Write the failing tests**

`pantry-match/src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { Commands, CooklangApi, REQUIRED_COMMANDS } from './cooklang-api';

function recordingApi(commands: readonly string[], result: unknown = undefined): {
    api: CooklangApi; calls: Array<{ command: string; args: unknown[] }>;
} {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('is supported only when every required command exists', async () => {
        assert.strictEqual(await recordingApi(REQUIRED_COMMANDS).api.supported(), true);
        const withoutRender = REQUIRED_COMMANDS.filter(command => command !== Commands.RENDER_REPORT);
        assert.strictEqual(await recordingApi(withoutRender).api.supported(), false);
    });

    it('detects other plugins\' commands', async () => {
        const { api } = recordingApi(['shoppingList.addRecipe']);
        assert.strictEqual(await api.hasCommands(['shoppingList.addRecipe']), true);
        assert.strictEqual(await api.hasCommands(['pantry.show']), false);
    });

    it('passes the documented argument shapes', async () => {
        const { api, calls } = recordingApi([]);
        await api.renderReport({ uri: 'file:///ws/a.cook', template: 'T', scale: 1 });
        await api.parsePantry('[fridge]\n');
        await api.resolveRecipeReferences('Dinners/Pasta.cook');
        await api.openPreview('file:///ws/a.cook');
        assert.deepStrictEqual(calls, [
            { command: Commands.RENDER_REPORT, args: [{ uri: 'file:///ws/a.cook', template: 'T', scale: 1 }] },
            { command: Commands.PARSE_PANTRY, args: [{ text: '[fridge]\n' }] },
            { command: Commands.RESOLVE_RECIPE_REFERENCES, args: [{ path: 'Dinners/Pasta.cook' }] },
            { command: Commands.OPEN_PREVIEW, args: [{ uri: 'file:///ws/a.cook' }] },
        ]);
    });

    it('refreshes badges only on editors that have the command', async () => {
        const present = recordingApi([Commands.REFRESH_BADGES]);
        assert.strictEqual(await present.api.refreshBadges(), true);
        assert.deepStrictEqual(present.calls.map(call => call.command), [Commands.REFRESH_BADGES]);
        const absent = recordingApi([]);
        assert.strictEqual(await absent.api.refreshBadges(), false);
        assert.deepStrictEqual(absent.calls, []);
    });
});
```

`pantry-match/src/settings.spec.ts`:

```ts
import * as assert from 'assert';
import { readSettings } from './settings';

const read = (values: Record<string, unknown>) => readSettings(key => values[key]);

describe('readSettings', () => {
    it('falls back to the defaults', () => {
        assert.deepStrictEqual(read({}), {
            alwaysHave: ['salt', 'pepper', 'black pepper', 'water'],
            expiringWithinDays: 5,
            showBadge: true,
        });
    });

    it('keeps trimmed, non-empty strings from alwaysHave', () => {
        assert.deepStrictEqual(read({ alwaysHave: [' olive oil ', '', 3, 'salt'] }).alwaysHave, ['olive oil', 'salt']);
    });

    it('treats an empty alwaysHave as "assume nothing"', () => {
        assert.deepStrictEqual(read({ alwaysHave: [] }).alwaysHave, []);
    });

    it('floors and caps expiringWithinDays, rejecting negatives and non-numbers', () => {
        assert.strictEqual(read({ expiringWithinDays: 2.7 }).expiringWithinDays, 2);
        assert.strictEqual(read({ expiringWithinDays: 1000 }).expiringWithinDays, 365);
        assert.strictEqual(read({ expiringWithinDays: 0 }).expiringWithinDays, 0);
        assert.strictEqual(read({ expiringWithinDays: -1 }).expiringWithinDays, 5);
        assert.strictEqual(read({ expiringWithinDays: '3' }).expiringWithinDays, 5);
    });

    it('turns the badge off only for false', () => {
        assert.strictEqual(read({ showBadge: false }).showBadge, false);
        assert.strictEqual(read({ showBadge: 'no' }).showBadge, true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './cooklang-api'` and `'./settings'`.

- [ ] **Step 3: Implement**

`pantry-match/src/cooklang-api.ts`:

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `plugin-report-types.ts`, `pantry-types.ts`,
// `recipe-reference-resolver.ts` and `cooklang-outlet-context.ts`. Free of the
// `vscode` import so it can be unit-tested; extension.ts passes
// `vscode.commands.executeCommand` and `vscode.commands.getCommands`.

export const Commands = {
    RENDER_REPORT: 'cooklang.api.renderReport',
    PARSE_PANTRY: 'cooklang.api.parsePantry',
    RESOLVE_RECIPE_REFERENCES: 'cooklang.api.resolveRecipeReferences',
    OPEN_PREVIEW: 'cooklang.api.openPreview',
    REFRESH_BADGES: 'cooklang.api.refreshBadges',
} as const;

/** Without these the plugin can't work; older editors get the "needs a newer Cook Editor" view. */
export const REQUIRED_COMMANDS: readonly string[] = [
    Commands.RENDER_REPORT,
    Commands.PARSE_PANTRY,
    Commands.RESOLVE_RECIPE_REFERENCES,
    Commands.OPEN_PREVIEW,
];

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template'; message: string };

export interface PantryItem {
    name: string;
    /** As written in pantry.conf, e.g. `500%g`. */
    quantity?: string;
    bought?: string;
    expire?: string;
    low?: string;
    isLow: boolean;
    /** Quantity parses to zero. No quantity means in stock. */
    isOutOfStock: boolean;
    /** `expire` as `YYYY-MM-DD`, when parseable. */
    expireDate?: string;
    /** `bought` as `YYYY-MM-DD`, when parseable. */
    boughtDate?: string;
}

export interface PantrySection {
    name: string;
    items: PantryItem[];
}

export interface PantryContents {
    sections: PantrySection[];
}

/** A `@./recipe{}` reference; `path` is workspace-relative without a leading `./`. */
export interface ResolvedRecipeReference {
    path: string;
    /** Multiplier relative to the recipe holding the reference. */
    scale: number;
    children?: ResolvedRecipeReference[];
}

export interface PreviewOutletContext {
    version: 1;
    uri: string;
    /** Workspace-relative; `''` outside the workspace. */
    path: string;
    scale: number;
}

/** The `pill` kind of the editor's `PreviewBadge`. `text` is at most 24 UTF-16 units. */
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

    /** True when every id is a registered command (editor API or another plugin). */
    async hasCommands(ids: readonly string[]): Promise<boolean> {
        const registered = new Set(await this.listCommands());
        return ids.every(id => registered.has(id));
    }

    supported(): Promise<boolean> {
        return this.hasCommands(REQUIRED_COMMANDS);
    }

    renderReport(args: { uri: string; template: string; scale: number }): Promise<PluginReportResult> {
        return this.call(Commands.RENDER_REPORT, args);
    }

    parsePantry(text: string): Promise<PantryContents> {
        return this.call(Commands.PARSE_PANTRY, { text });
    }

    /** Accepts a workspace-relative path or a `file://` URI inside the workspace; rejects when the recipe is missing. */
    resolveRecipeReferences(path: string): Promise<ResolvedRecipeReference[]> {
        return this.call(Commands.RESOLVE_RECIPE_REFERENCES, { path });
    }

    async openPreview(uri: string): Promise<void> {
        await this.call(Commands.OPEN_PREVIEW, { uri });
    }

    /** Asks open previews to re-query badges. False when the editor predates the command. */
    async refreshBadges(): Promise<boolean> {
        if (!(await this.hasCommands([Commands.REFRESH_BADGES]))) {
            return false;
        }
        await this.call(Commands.REFRESH_BADGES);
        return true;
    }

    protected async call<T>(command: string, ...args: unknown[]): Promise<T> {
        return await this.execute(command, ...args) as T;
    }
}
```

`pantry-match/src/settings.ts`:

```ts
export const DEFAULT_ALWAYS_HAVE: readonly string[] = ['salt', 'pepper', 'black pepper', 'water'];
export const DEFAULT_EXPIRING_WITHIN_DAYS = 5;
export const MAX_EXPIRING_WITHIN_DAYS = 365;

export interface PantryMatchSettings {
    /** As typed (trimmed); normalised later by `pantryLookup`. */
    alwaysHave: readonly string[];
    expiringWithinDays: number;
    showBadge: boolean;
}

/** Reads one setting under `pantryMatch.`; extension code passes `getConfiguration('pantryMatch').get`. */
export type ReadSetting = (key: string) => unknown;

export function readSettings(read: ReadSetting): PantryMatchSettings {
    const rawAlwaysHave = read('alwaysHave');
    const alwaysHave = Array.isArray(rawAlwaysHave)
        ? rawAlwaysHave
            .filter((entry): entry is string => typeof entry === 'string')
            .map(entry => entry.trim())
            .filter(entry => entry !== '')
        : [...DEFAULT_ALWAYS_HAVE];
    const rawDays = read('expiringWithinDays');
    const expiringWithinDays = typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays >= 0
        ? Math.min(Math.floor(rawDays), MAX_EXPIRING_WITHIN_DAYS)
        : DEFAULT_EXPIRING_WITHIN_DAYS;
    return { alwaysHave, expiringWithinDays, showBadge: read('showBadge') !== false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pantry-match && npm test`
Expected: PASS, 9 passing.

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/cooklang-api.ts pantry-match/src/cooklang-api.spec.ts pantry-match/src/settings.ts pantry-match/src/settings.spec.ts
git commit -m "feat(pantry-match): Cooklang API wrapper and settings"
```

---

### Task 3: Pantry file locate + parse

**Files:**
- Create: `pantry-match/src/pantry-file.ts`
- Test: `pantry-match/src/pantry-file.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/pantry-file.spec.ts`:

```ts
import * as assert from 'assert';
import { PantryContents, PantryItem } from './cooklang-api';
import { loadPantry, PANTRY_FILE } from './pantry-file';

const item = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const unused = async (): Promise<PantryContents> => { throw new Error('parse should not be called'); };

describe('loadPantry', () => {
    it('lives at config/pantry.conf, like the Shopping List and Pantry plugins', () => {
        assert.strictEqual(PANTRY_FILE, 'config/pantry.conf');
    });

    it('is missing when the file does not exist', async () => {
        assert.deepStrictEqual(await loadPantry({ read: async () => undefined, parse: unused }), { kind: 'missing' });
    });

    it('flattens every section in file order', async () => {
        const texts: string[] = [];
        const state = await loadPantry({
            read: async () => '[fridge]\nmilk\n[pantry]\nrice\nflour\n',
            parse: async text => {
                texts.push(text);
                return { sections: [{ name: 'fridge', items: [item('milk')] }, { name: 'pantry', items: [item('rice'), item('flour')] }] };
            },
        });
        assert.deepStrictEqual(texts, ['[fridge]\nmilk\n[pantry]\nrice\nflour\n']);
        assert.deepStrictEqual(state, { kind: 'ok', items: [item('milk'), item('rice'), item('flour')] });
    });

    it('reports a read failure', async () => {
        const state = await loadPantry({ read: async () => { throw new Error('EACCES'); }, parse: unused });
        assert.deepStrictEqual(state, { kind: 'error', message: 'Could not read config/pantry.conf: EACCES' });
    });

    it('reports a parse failure with the editor message', async () => {
        const state = await loadPantry({ read: async () => '[fridge', parse: async () => { throw new Error('line 1: expected ]'); } });
        assert.deepStrictEqual(state, { kind: 'error', message: 'config/pantry.conf has an error: line 1: expected ]' });
    });

    it('rejects an unexpected parse result', async () => {
        const state = await loadPantry({ read: async () => '', parse: async () => ({}) as PantryContents });
        assert.deepStrictEqual(state, { kind: 'error', message: 'config/pantry.conf: unexpected result from the editor' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './pantry-file'`.

- [ ] **Step 3: Implement**

`pantry-match/src/pantry-file.ts`:

```ts
import { PantryContents, PantryItem } from './cooklang-api';

/** Same location the Shopping List and Pantry plugins use, under the first workspace folder. */
export const PANTRY_FILE = 'config/pantry.conf';

export type PantryState =
    | { kind: 'missing' }
    | { kind: 'error'; message: string }
    | { kind: 'ok'; items: PantryItem[] };

export interface PantrySource {
    /** File text, or undefined when the file does not exist. */
    read(): Promise<string | undefined>;
    /** `cooklang.api.parsePantry`. */
    parse(text: string): Promise<PantryContents>;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function loadPantry(source: PantrySource): Promise<PantryState> {
    let text: string | undefined;
    try {
        text = await source.read();
    } catch (error) {
        return { kind: 'error', message: `Could not read ${PANTRY_FILE}: ${messageOf(error)}` };
    }
    if (text === undefined) {
        return { kind: 'missing' };
    }
    let contents: PantryContents;
    try {
        contents = await source.parse(text);
    } catch (error) {
        return { kind: 'error', message: `${PANTRY_FILE} has an error: ${messageOf(error)}` };
    }
    if (typeof contents !== 'object' || contents === null || !Array.isArray(contents.sections)) {
        return { kind: 'error', message: `${PANTRY_FILE}: unexpected result from the editor` };
    }
    return { kind: 'ok', items: contents.sections.flatMap(section => Array.isArray(section.items) ? section.items : []) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (6 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/pantry-file.ts pantry-match/src/pantry-file.spec.ts
git commit -m "feat(pantry-match): load config/pantry.conf through parsePantry"
```

---

### Task 4: Names template + validation

**Files:**
- Create: `pantry-match/src/names-template.ts`
- Test: `pantry-match/src/names-template.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/names-template.spec.ts`:

```ts
import * as assert from 'assert';
import { PluginReportResult } from './cooklang-api';
import { NAMES_TEMPLATE, parseNamesOutput, renderNames } from './names-template';

describe('NAMES_TEMPLATE', () => {
    it('makes no nutrition call and emits names and refs as JSON', () => {
        assert.ok(!NAMES_TEMPLATE.includes('aggregate_nutrition'));
        assert.ok(NAMES_TEMPLATE.includes('"names": names.list'));
        assert.ok(NAMES_TEMPLATE.includes('"refs": refs.list'));
        assert.ok(NAMES_TEMPLATE.includes('tojson'));
    });
});

describe('parseNamesOutput', () => {
    it('marks names with a leading ? as optional and strips it', () => {
        const parsed = parseNamesOutput(JSON.stringify({ names: ['?parsley', ' flour ', '??chives'], refs: [] }));
        assert.deepStrictEqual(parsed, {
            names: [{ name: 'parsley', optional: true }, { name: 'flour', optional: false }, { name: 'chives', optional: true }],
            refs: [],
        });
    });

    it('drops empty names', () => {
        assert.deepStrictEqual(parseNamesOutput(JSON.stringify({ names: ['', '?', '  '], refs: [] }))?.names, []);
    });

    it('keeps refs, trimmed', () => {
        assert.deepStrictEqual(parseNamesOutput(JSON.stringify({ names: [], refs: [' ./Sauces/Pesto '] }))?.refs, ['./Sauces/Pesto']);
    });

    it('rejects malformed output', () => {
        for (const output of ['not json', '[]', JSON.stringify({ names: 'x', refs: [] }), JSON.stringify({ names: [1], refs: [] }), JSON.stringify({ names: [] })]) {
            assert.strictEqual(parseNamesOutput(output), undefined, output);
        }
    });
});

describe('renderNames', () => {
    function fakeApi(result: PluginReportResult | Error): { renderReport: (args: { uri: string; template: string; scale: number }) => Promise<PluginReportResult>; calls: unknown[] } {
        const calls: unknown[] = [];
        return {
            calls,
            renderReport: async args => {
                calls.push(args);
                if (result instanceof Error) {
                    throw result;
                }
                return result;
            },
        };
    }

    it('renders the names template at scale 1', async () => {
        const api = fakeApi({ ok: true, output: JSON.stringify({ names: ['rice'], refs: [] }) });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: true, names: { names: [{ name: 'rice', optional: false }], refs: [] } });
        assert.deepStrictEqual(api.calls, [{ uri: 'file:///ws/a.cook', template: NAMES_TEMPLATE, scale: 1 }]);
    });

    it('passes on render failures', async () => {
        const api = fakeApi({ ok: false, reason: 'template', message: 'syntax error' });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'syntax error' });
    });

    it('treats malformed output as a failure', async () => {
        const api = fakeApi({ ok: true, output: '{}' });
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'unexpected template output' });
    });

    it('turns a thrown error into a failure', async () => {
        const api = fakeApi(new Error('Invalid arguments: bad uri'));
        assert.deepStrictEqual(await renderNames(api, 'file:///ws/a.cook'), { ok: false, message: 'Invalid arguments: bad uri' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './names-template'`.

- [ ] **Step 3: Implement**

`pantry-match/src/names-template.ts`:

```ts
// The names-only template (the Allergens `NAMES_TEMPLATE`): no nutrition call, so it
// works signed out. The editor's Reports engine parses with no extensions, so an
// optional ingredient `@?parsley{}` arrives as the name `?parsley`; the engine has no
// `optional` field. `parseNamesOutput` turns that leading `?` into `optional: true`.
import { CooklangApi } from './cooklang-api';

export const NAMES_TEMPLATE = [
    '{%- set names = namespace(list=[]) -%}',
    '{%- set refs = namespace(list=[]) -%}',
    '{%- for ing in ingredients -%}',
    '{%- if ing.reference -%}{%- set refs.list = refs.list + [ing.name | string] -%}',
    '{%- else -%}{%- set names.list = names.list + [ing.name | string] -%}{%- endif -%}',
    '{%- endfor -%}',
    '{{ {"names": names.list, "refs": refs.list} | tojson }}',
].join('\n');

export interface IngredientName {
    name: string;
    /** `@?x`: never counts as missing. */
    optional: boolean;
}

export interface RecipeNames {
    names: IngredientName[];
    /** Linked recipes as written (`./Sauces/Pesto`); only their presence matters. */
    refs: string[];
}

export type RenderedNames = { ok: true; names: RecipeNames } | { ok: false; message: string };

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function toIngredientName(raw: string): IngredientName | undefined {
    const optional = /^\s*\?/.test(raw);
    const name = raw.replace(/^\s*\?+/, '').trim();
    return name === '' ? undefined : { name, optional };
}

/** Untrusted template output → names; undefined when malformed. */
export function parseNamesOutput(output: string): RecipeNames | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return undefined;
    }
    const { names, refs } = data as { names?: unknown; refs?: unknown };
    if (!isStringArray(names) || !isStringArray(refs)) {
        return undefined;
    }
    return {
        names: names.map(toIngredientName).filter((entry): entry is IngredientName => entry !== undefined),
        refs: refs.map(ref => ref.trim()).filter(ref => ref !== ''),
    };
}

/** Renders the names template for a `.cook` URI; never throws. */
export async function renderNames(api: Pick<CooklangApi, 'renderReport'>, uri: string): Promise<RenderedNames> {
    try {
        const result = await api.renderReport({ uri, template: NAMES_TEMPLATE, scale: 1 });
        if (!result.ok) {
            return { ok: false, message: result.message || result.reason };
        }
        const names = parseNamesOutput(result.output);
        return names ? { ok: true, names } : { ok: false, message: 'unexpected template output' };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (9 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/names-template.ts pantry-match/src/names-template.spec.ts
git commit -m "feat(pantry-match): names-only report template with optional flag"
```

---

### Task 5: Matching and normalisation

**Files:**
- Create: `pantry-match/src/match.ts`
- Test: `pantry-match/src/match.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/match.spec.ts`:

```ts
import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { coverage, matchIngredients, normaliseName, pantryLookup } from './match';
import { IngredientName } from './names-template';

const pantryItem = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const req = (name: string): IngredientName => ({ name, optional: false });
const opt = (name: string): IngredientName => ({ name, optional: true });

describe('normaliseName', () => {
    const cases: Array<[string, string]> = [
        ['Tomatoes', 'tomato'],
        ['  Red   Onions ', 'red onion'],
        ['eggs', 'egg'],
        ['olives', 'olive'],
        ['peaches', 'peach'],
        ['radishes', 'radish'],
        ['potatoes', 'potato'],
        ['glasses', 'glass'],
        ['cress', 'cress'],
        ['garlic, minced', 'garlic'],
        ['gas', 'gas'],
        ['', ''],
        [' , chopped', ''],
    ];
    for (const [input, expected] of cases) {
        it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
            assert.strictEqual(normaliseName(input), expected);
        });
    }

    it('makes singular and plural forms equal', () => {
        assert.strictEqual(normaliseName('Tomato'), normaliseName('tomatoes'));
        assert.strictEqual(normaliseName('onion'), normaliseName('Onions'));
    });
});

describe('pantryLookup', () => {
    it('normalises in-stock pantry names and alwaysHave, skipping out-of-stock items', () => {
        const lookup = pantryLookup([pantryItem('Tomatoes'), pantryItem('mozzarella', { isOutOfStock: true })], ['Black Pepper', ' ']);
        assert.deepStrictEqual([...lookup.inStock], ['tomato']);
        assert.deepStrictEqual([...lookup.alwaysHave], ['black pepper']);
    });
});

describe('matchIngredients', () => {
    const lookup = pantryLookup(
        [pantryItem('Tomatoes'), pantryItem('basil', { isLow: true }), pantryItem('mozzarella', { isOutOfStock: true })],
        ['salt', 'Black Pepper'],
    );

    it('covers plural/singular pantry names and counts low stock as in stock', () => {
        const match = matchIngredients([req('tomato'), req('Basil')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [2, 2, []]);
    });

    it('treats out-of-stock items as missing', () => {
        const match = matchIngredients([req('mozzarella')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [0, 1, ['mozzarella']]);
    });

    it('leaves alwaysHave out of both sides', () => {
        const match = matchIngredients([req('salt'), req('black peppers'), req('tomatoes')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [1, 1, []]);
        assert.ok(!match.uses.has('salt'));
    });

    it('never counts optional ingredients as missing, but records that the recipe uses them', () => {
        const match = matchIngredients([req('tomato'), opt('parmesan')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [1, 1, []]);
        assert.ok(match.uses.has('parmesan'));
    });

    it('counts a name once, and required wins over optional', () => {
        const match = matchIngredients([opt('onion'), req('Onions'), req('onion')], lookup);
        assert.deepStrictEqual([match.covered, match.total, match.missing], [0, 1, ['Onions']]);
    });

    it('keeps missing names in recipe order, without the text after a comma', () => {
        const match = matchIngredients([req('Garlic, minced'), req('tomato'), req('Olive Oil')], lookup);
        assert.deepStrictEqual(match.missing, ['Garlic', 'Olive Oil']);
    });

    it('has full coverage with no required ingredients', () => {
        assert.strictEqual(coverage(matchIngredients([opt('parsley'), req('salt')], lookup)), 1);
        assert.strictEqual(coverage(matchIngredients([req('tomato'), req('mozzarella')], lookup)), 0.5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './match'`.

- [ ] **Step 3: Implement**

`pantry-match/src/match.ts`:

```ts
import { PantryItem } from './cooklang-api';
import { IngredientName } from './names-template';

/** Simple plurals only: `-es` after s/x/z/ch/sh/o, else a trailing `s` (not `ss`); words of 3 letters or fewer stay. */
function singular(word: string): string {
    if (word.length <= 3) {
        return word;
    }
    if (/(?:ss|x|z|ch|sh|o)es$/.test(word)) {
        return word.slice(0, -2);
    }
    if (word.endsWith('ss')) {
        return word;
    }
    if (word.endsWith('s')) {
        return word.slice(0, -1);
    }
    return word;
}

/** Lowercase, drop text after a comma, collapse whitespace, trim, singularise the last word. */
export function normaliseName(raw: string): string {
    const collapsed = raw.split(',')[0].toLowerCase().replace(/\s+/g, ' ').trim();
    if (collapsed === '') {
        return '';
    }
    const words = collapsed.split(' ');
    words[words.length - 1] = singular(words[words.length - 1]);
    return words.join(' ');
}

/** The name as written, minus the text after a comma (`Garlic, minced` → `Garlic`). */
function displayName(raw: string): string {
    return raw.split(',')[0].trim();
}

export interface PantryLookup {
    /** Normalised names of items that aren't out of stock (low counts as in stock). */
    readonly inStock: ReadonlySet<string>;
    /** Normalised `pantryMatch.alwaysHave`. */
    readonly alwaysHave: ReadonlySet<string>;
}

export function pantryLookup(items: readonly PantryItem[], alwaysHave: readonly string[]): PantryLookup {
    const inStock = new Set<string>();
    for (const item of items) {
        const key = normaliseName(item.name);
        if (!item.isOutOfStock && key !== '') {
            inStock.add(key);
        }
    }
    return { inStock, alwaysHave: new Set(alwaysHave.map(normaliseName).filter(key => key !== '')) };
}

export interface RecipeMatch {
    /** Required, non-alwaysHave ingredients that are in stock. */
    covered: number;
    /** Required, non-alwaysHave ingredients. */
    total: number;
    /** Display names of required ingredients not in stock, in recipe order. */
    missing: string[];
    /** Normalised names of every non-alwaysHave ingredient, optional included (for "Use it up"). */
    uses: ReadonlySet<string>;
}

export function matchIngredients(names: readonly IngredientName[], lookup: PantryLookup): RecipeMatch {
    const required = new Map<string, string>();
    const uses = new Set<string>();
    for (const { name, optional } of names) {
        const key = normaliseName(name);
        if (key === '' || lookup.alwaysHave.has(key)) {
            continue;
        }
        uses.add(key);
        if (!optional && !required.has(key)) {
            required.set(key, displayName(name));
        }
    }
    let covered = 0;
    const missing: string[] = [];
    for (const [key, name] of required) {
        if (lookup.inStock.has(key)) {
            covered++;
        } else {
            missing.push(name);
        }
    }
    return { covered, total: required.size, missing, uses };
}

/** Share of required ingredients in stock; 1 when there is nothing to check. */
export function coverage(match: Pick<RecipeMatch, 'covered' | 'total'>): number {
    return match.total === 0 ? 1 : match.covered / match.total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (all `normaliseName`, `pantryLookup` and `matchIngredients` cases).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/match.ts pantry-match/src/match.spec.ts
git commit -m "feat(pantry-match): normalise names and score recipes against the pantry"
```

---

### Task 6: Recipe index with cache (pure core)

**Files:**
- Create: `pantry-match/src/recipe-index.ts`
- Test: `pantry-match/src/recipe-index.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/recipe-index.spec.ts`:

```ts
import * as assert from 'assert';
import { RenderedNames } from './names-template';
import { IndexDeps, mapInBatches, RecipeFile, RecipeIndex } from './recipe-index';

const ok = (...names: string[]): RenderedNames => ({ ok: true, names: { names: names.map(name => ({ name, optional: false })), refs: [] } });
const file = (path: string): RecipeFile => ({ uri: `file:///ws/${path}`, path });
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

class FakeWorkspace implements IndexDeps {
    files: RecipeFile[] = [];
    mtimes = new Map<string, number>();
    results = new Map<string, RenderedNames>();
    renders: string[] = [];
    lists = 0;
    inFlight = 0;
    maxInFlight = 0;

    add(path: string, mtime = 1, result: RenderedNames = ok(path)): RecipeFile {
        const recipe = file(path);
        this.files.push(recipe);
        this.mtimes.set(recipe.uri, mtime);
        this.results.set(recipe.uri, result);
        return recipe;
    }

    async list(): Promise<RecipeFile[]> {
        this.lists++;
        return [...this.files];
    }

    async mtime(uri: string): Promise<number | undefined> {
        return this.mtimes.get(uri);
    }

    async render(uri: string): Promise<RenderedNames> {
        this.renders.push(uri);
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await tick();
        this.inFlight--;
        return this.results.get(uri) ?? { ok: false, message: 'gone' };
    }
}

describe('mapInBatches', () => {
    it('runs at most `size` at once, keeps order and reports progress', async () => {
        let inFlight = 0;
        let max = 0;
        const progress: number[] = [];
        const out = await mapInBatches([1, 2, 3, 4, 5], 2, async n => {
            inFlight++;
            max = Math.max(max, inFlight);
            await tick();
            inFlight--;
            return n * 10;
        }, done => progress.push(done));
        assert.deepStrictEqual(out, [10, 20, 30, 40, 50]);
        assert.strictEqual(max, 2);
        assert.deepStrictEqual(progress, [2, 4, 5]);
    });
});

describe('RecipeIndex', () => {
    it('renders every recipe in batches of 10 and reports progress', async () => {
        const ws = new FakeWorkspace();
        for (let i = 0; i < 12; i++) {
            ws.add(`r${String(i).padStart(2, '0')}.cook`);
        }
        const index = new RecipeIndex(ws);
        const progress: Array<[number, number]> = [];
        await index.refresh((done, total) => progress.push([done, total]));
        assert.strictEqual(ws.renders.length, 12);
        assert.strictEqual(ws.maxInFlight, 10);
        assert.deepStrictEqual(progress, [[0, 12], [10, 12], [12, 12]]);
        assert.deepStrictEqual(index.entries().map(entry => entry.path), ws.files.map(recipe => recipe.path));
    });

    it('reuses a cached render while the mtime is unchanged', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        await index.refresh();
        assert.strictEqual(ws.renders.length, 1);
    });

    it('re-renders when the mtime changes', async () => {
        const ws = new FakeWorkspace();
        const recipe = ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        ws.mtimes.set(recipe.uri, 2);
        ws.results.set(recipe.uri, ok('rice'));
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
        assert.deepStrictEqual(index.byPath('a.cook')?.result, ok('rice'));
    });

    it('re-renders an invalidated file even with the same mtime, and hides it from byPath until then', async () => {
        const ws = new FakeWorkspace();
        const recipe = ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        index.invalidate(recipe.uri);
        assert.strictEqual(index.byPath('a.cook'), undefined);
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
        assert.ok(index.byPath('a.cook'));
    });

    it('drops files that are no longer listed or cannot be stat-ed', async () => {
        const ws = new FakeWorkspace();
        const a = ws.add('a.cook');
        ws.add('b.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        ws.files = [a];
        await index.refresh();
        assert.deepStrictEqual(index.entries().map(entry => entry.path), ['a.cook']);
        ws.mtimes.delete(a.uri);
        await index.refresh();
        assert.deepStrictEqual(index.entries(), []);
    });

    it('keeps failed renders so the view can list them', async () => {
        const ws = new FakeWorkspace();
        ws.add('bad.cook', 1, { ok: false, message: 'syntax error' });
        const index = new RecipeIndex(ws);
        await index.refresh();
        assert.deepStrictEqual(index.entries()[0].result, { ok: false, message: 'syntax error' });
    });

    it('coalesces overlapping refreshes into one extra pass', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        const first = index.refresh();
        const second = index.refresh();
        const third = index.refresh();
        assert.strictEqual(first, second);
        await Promise.all([first, second, third]);
        assert.strictEqual(ws.lists, 2);
    });

    it('clear forgets every cached render', async () => {
        const ws = new FakeWorkspace();
        ws.add('a.cook');
        const index = new RecipeIndex(ws);
        await index.refresh();
        index.clear();
        assert.deepStrictEqual(index.entries(), []);
        await index.refresh();
        assert.strictEqual(ws.renders.length, 2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './recipe-index'`.

- [ ] **Step 3: Implement**

`pantry-match/src/recipe-index.ts`:

```ts
// Cache of every recipe's ingredient names, keyed by URI and file mtime. The vscode
// layer supplies listing (`workspace.findFiles`), mtimes (`workspace.fs.stat`) and
// renders (`renderNames`), and calls `invalidate` from its FileSystemWatcher.
import { RenderedNames } from './names-template';

export const BATCH_SIZE = 10;

export interface RecipeFile {
    /** URI string. */
    uri: string;
    /** Workspace-relative, `/`-separated. */
    path: string;
}

export interface IndexEntry extends RecipeFile {
    mtime: number;
    result: RenderedNames;
}

export interface IndexDeps {
    list(): Promise<RecipeFile[]>;
    /** Undefined when the file is gone. */
    mtime(uri: string): Promise<number | undefined>;
    render(uri: string): Promise<RenderedNames>;
}

export type Progress = (done: number, total: number) => void;

/** Runs `fn` over `items` with at most `size` calls in flight, in order; `onBatch` gets the running count. */
export async function mapInBatches<T, R>(
    items: readonly T[],
    size: number,
    fn: (item: T) => Promise<R>,
    onBatch?: (done: number) => void,
): Promise<R[]> {
    const results: R[] = [];
    for (let start = 0; start < items.length; start += size) {
        results.push(...await Promise.all(items.slice(start, start + size).map(fn)));
        onBatch?.(results.length);
    }
    return results;
}

export class RecipeIndex {

    protected readonly files = new Map<string, IndexEntry>();
    protected readonly stale = new Set<string>();
    protected running: Promise<void> | undefined;
    protected rerun = false;

    constructor(protected readonly deps: IndexDeps, protected readonly batchSize = BATCH_SIZE) { }

    /** Brings the cache up to date. A call during a refresh returns the running promise and schedules one more pass. */
    refresh(onProgress?: Progress): Promise<void> {
        if (this.running) {
            this.rerun = true;
            return this.running;
        }
        const run = async (): Promise<void> => {
            try {
                do {
                    this.rerun = false;
                    await this.scan(onProgress);
                } while (this.rerun);
            } finally {
                this.running = undefined;
            }
        };
        this.running = run();
        return this.running;
    }

    /** Forces a re-render on the next refresh (a watcher saw the file change). */
    invalidate(uri: string): void {
        this.stale.add(uri);
    }

    clear(): void {
        this.files.clear();
        this.stale.clear();
    }

    entries(): IndexEntry[] {
        return [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    /** The cached, up-to-date entry for a workspace-relative path. */
    byPath(path: string): IndexEntry | undefined {
        for (const entry of this.files.values()) {
            if (entry.path === path && !this.stale.has(entry.uri)) {
                return entry;
            }
        }
        return undefined;
    }

    protected async scan(onProgress?: Progress): Promise<void> {
        const listed = await this.deps.list();
        const present = new Set(listed.map(recipe => recipe.uri));
        for (const uri of [...this.files.keys()]) {
            if (!present.has(uri)) {
                this.files.delete(uri);
                this.stale.delete(uri);
            }
        }
        onProgress?.(0, listed.length);
        await mapInBatches(listed, this.batchSize, recipe => this.update(recipe), done => onProgress?.(done, listed.length));
    }

    protected async update(recipe: RecipeFile): Promise<void> {
        const mtime = await this.deps.mtime(recipe.uri);
        if (mtime === undefined) {
            this.files.delete(recipe.uri);
            this.stale.delete(recipe.uri);
            return;
        }
        const cached = this.files.get(recipe.uri);
        if (cached && cached.mtime === mtime && !this.stale.has(recipe.uri)) {
            return;
        }
        // Cleared before the render, so an invalidation during it marks the file stale again.
        this.stale.delete(recipe.uri);
        const result = await this.deps.render(recipe.uri);
        this.files.set(recipe.uri, { ...recipe, mtime, result });
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (9 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/recipe-index.ts pantry-match/src/recipe-index.spec.ts
git commit -m "feat(pantry-match): mtime-keyed recipe index with batched refresh"
```

---

### Task 7: Reference expansion (cycle-safe, depth 3)

**Files:**
- Create: `pantry-match/src/references.ts`
- Test: `pantry-match/src/references.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/references.spec.ts`:

```ts
import * as assert from 'assert';
import { ResolvedRecipeReference } from './cooklang-api';
import { RecipeNames } from './names-template';
import { flattenReferencePaths, ReferenceExpander, referencePath } from './references';

const ref = (path: string, children?: ResolvedRecipeReference[]): ResolvedRecipeReference =>
    children ? { path, scale: 1, children } : { path, scale: 1 };
const names = (...list: string[]): RecipeNames => ({ names: list.map(name => ({ name, optional: false })), refs: [] });

describe('referencePath', () => {
    it('adds .cook and drops ./ and backslashes', () => {
        assert.strictEqual(referencePath('./Sauces/Pesto'), 'Sauces/Pesto.cook');
        assert.strictEqual(referencePath('Sauces\\Pesto'), 'Sauces/Pesto.cook');
        assert.strictEqual(referencePath('Pesto.cook'), 'Pesto.cook');
    });
});

describe('flattenReferencePaths', () => {
    it('lists nested references depth-first', () => {
        const tree = [ref('Sauces/Pesto', [ref('Basics/Garlic oil')]), ref('Bread')];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'Pasta.cook'), ['Sauces/Pesto.cook', 'Basics/Garlic oil.cook', 'Bread.cook']);
    });

    it('skips a cycle back to the recipe itself or an ancestor', () => {
        const tree = [ref('B', [ref('A', [ref('B')])])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook']);
    });

    it('stops after three levels', () => {
        const tree = [ref('B', [ref('C', [ref('D', [ref('E')])])])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook', 'C.cook', 'D.cook']);
    });

    it('lists a recipe referenced twice once', () => {
        const tree = [ref('Stock'), ref('Soup', [ref('Stock')])];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['Stock.cook', 'Soup.cook']);
    });

    it('ignores malformed entries', () => {
        const tree = [{ path: '', scale: 1 }, { scale: 1 } as unknown as ResolvedRecipeReference, ref('B')];
        assert.deepStrictEqual(flattenReferencePaths(tree, 'A.cook'), ['B.cook']);
    });
});

describe('ReferenceExpander', () => {
    function setup(trees: Record<string, ResolvedRecipeReference[]>, recipes: Record<string, RecipeNames>): {
        expander: ReferenceExpander; resolved: string[];
    } {
        const resolved: string[] = [];
        const expander = new ReferenceExpander({
            resolve: async path => {
                resolved.push(path);
                const tree = trees[path];
                if (!tree) {
                    throw new Error(`Recipe not found: ${path}`);
                }
                return tree;
            },
            names: async path => recipes[path],
        });
        return { expander, resolved };
    }

    it('returns the recipe\'s own names when it has no references, without resolving', async () => {
        const { expander, resolved } = setup({}, {});
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', names('rice')), names('rice').names);
        assert.deepStrictEqual(resolved, []);
    });

    it('merges the ingredients of referenced recipes, keeping optional flags', async () => {
        const { expander } = setup(
            { 'Pasta.cook': [ref('Sauces/Pesto')] },
            { 'Sauces/Pesto.cook': { names: [{ name: 'basil', optional: false }, { name: 'pine nuts', optional: true }], refs: [] } },
        );
        const own: RecipeNames = { names: [{ name: 'pasta', optional: false }], refs: ['./Sauces/Pesto'] };
        assert.deepStrictEqual(await expander.ingredientsFor('Pasta.cook', own), [
            { name: 'pasta', optional: false },
            { name: 'basil', optional: false },
            { name: 'pine nuts', optional: true },
        ]);
    });

    it('survives a reference cycle', async () => {
        const { expander } = setup({ 'A.cook': [ref('B', [ref('A')])] }, { 'A.cook': names('a'), 'B.cook': names('b') });
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), [{ name: 'a', optional: false }, { name: 'b', optional: false }]);
    });

    it('skips references it cannot read', async () => {
        const { expander } = setup({ 'A.cook': [ref('Missing')] }, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./Missing'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), own.names);
    });

    it('falls back to the own names when resolving fails', async () => {
        const { expander } = setup({}, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('A.cook', own), own.names);
    });

    it('does not resolve recipes outside the workspace', async () => {
        const { expander, resolved } = setup({}, {});
        const own: RecipeNames = { names: [{ name: 'a', optional: false }], refs: ['./B'] };
        assert.deepStrictEqual(await expander.ingredientsFor('', own), own.names);
        assert.deepStrictEqual(resolved, []);
    });

    it('caches resolved trees until cleared', async () => {
        const { expander, resolved } = setup({ 'A.cook': [ref('B')] }, { 'B.cook': names('b') });
        const own: RecipeNames = { names: [], refs: ['./B'] };
        await expander.ingredientsFor('A.cook', own);
        await expander.ingredientsFor('A.cook', own);
        assert.deepStrictEqual(resolved, ['A.cook']);
        expander.clear();
        await expander.ingredientsFor('A.cook', own);
        assert.deepStrictEqual(resolved, ['A.cook', 'A.cook']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './references'`.

- [ ] **Step 3: Implement**

`pantry-match/src/references.ts`:

```ts
// Linked recipes (`@./Sauces/Pesto{}`): the editor's `resolveRecipeReferences` returns
// the whole (cycle-safe) tree; this module flattens it to MAX_REFERENCE_DEPTH levels and
// merges the referenced recipes' ingredient names into the parent's.
import { ResolvedRecipeReference } from './cooklang-api';
import { IngredientName, RecipeNames } from './names-template';

export const MAX_REFERENCE_DEPTH = 3;

/** A resolver path (`Sauces/Pesto`, maybe `./`-prefixed or with backslashes) as a workspace-relative `.cook` path. */
export function referencePath(path: string): string {
    const portable = path.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    return /\.cook$/i.test(portable) ? portable : `${portable}.cook`;
}

/** Depth-first, de-duplicated, never revisiting `selfPath` or any recipe already listed. */
export function flattenReferencePaths(
    tree: readonly ResolvedRecipeReference[],
    selfPath: string,
    maxDepth = MAX_REFERENCE_DEPTH,
): string[] {
    const seen = new Set<string>([referencePath(selfPath).toLowerCase()]);
    const out: string[] = [];
    const walk = (refs: readonly ResolvedRecipeReference[], depth: number): void => {
        if (depth > maxDepth) {
            return;
        }
        for (const ref of refs) {
            if (typeof ref?.path !== 'string' || ref.path.trim() === '') {
                continue;
            }
            const path = referencePath(ref.path);
            const key = path.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(path);
            walk(Array.isArray(ref.children) ? ref.children : [], depth + 1);
        }
    };
    walk(tree, 1);
    return out;
}

export interface ExpanderDeps {
    /** `cooklang.api.resolveRecipeReferences`; may reject. */
    resolve(path: string): Promise<ResolvedRecipeReference[]>;
    /** Names of a workspace-relative `.cook` path; undefined when unreadable. */
    names(path: string): Promise<RecipeNames | undefined>;
}

export class ReferenceExpander {

    protected readonly trees = new Map<string, Promise<ResolvedRecipeReference[]>>();

    constructor(protected readonly deps: ExpanderDeps, protected readonly maxDepth = MAX_REFERENCE_DEPTH) { }

    /** The recipe's own names plus those of every recipe it links to (up to three levels). */
    async ingredientsFor(path: string, own: RecipeNames): Promise<IngredientName[]> {
        if (own.refs.length === 0 || path === '') {
            return own.names;
        }
        const merged = [...own.names];
        for (const refPath of flattenReferencePaths(await this.tree(path), path, this.maxDepth)) {
            const names = await this.deps.names(refPath);
            if (names) {
                merged.push(...names.names);
            }
        }
        return merged;
    }

    /** Drops cached trees; call when any recipe changes. */
    clear(): void {
        this.trees.clear();
    }

    protected tree(path: string): Promise<ResolvedRecipeReference[]> {
        let tree = this.trees.get(path);
        if (!tree) {
            tree = this.deps.resolve(path).then(result => Array.isArray(result) ? result : [], () => []);
            this.trees.set(path, tree);
        }
        return tree;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (13 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/references.ts pantry-match/src/references.spec.ts
git commit -m "feat(pantry-match): merge linked recipes' ingredients, cycle-safe to depth 3"
```

---

### Task 8: Expiry grouping

**Files:**
- Create: `pantry-match/src/expiry.ts`
- Test: `pantry-match/src/expiry.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/expiry.spec.ts`:

```ts
import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { daysUntil, describeExpiry, expiringItems, todayString } from './expiry';

const item = (name: string, extra: Partial<PantryItem> = {}): PantryItem => ({ name, isLow: false, isOutOfStock: false, ...extra });
const TODAY = '2026-10-10';

describe('daysUntil', () => {
    it('counts calendar days, negative when past', () => {
        assert.strictEqual(daysUntil(TODAY, '2026-10-12'), 2);
        assert.strictEqual(daysUntil(TODAY, '2026-10-08'), -2);
        assert.strictEqual(daysUntil('2026-10-31', '2026-11-01'), 1);
        assert.strictEqual(daysUntil('2026-03-28', '2026-03-30'), 2);
    });

    it('is undefined for a malformed date', () => {
        assert.strictEqual(daysUntil(TODAY, 'soon'), undefined);
    });
});

describe('todayString', () => {
    it('uses the local calendar date', () => {
        assert.strictEqual(todayString(new Date(2026, 9, 3, 23, 30)), '2026-10-03');
    });
});

describe('expiringItems', () => {
    it('includes expired items and those within N days, and leaves out later ones and items without a date', () => {
        const items = [
            item('spinach', { expireDate: '2026-10-12' }),
            item('yogurt', { expireDate: '2026-10-08' }),
            item('cheddar', { expireDate: '2026-10-16' }),
            item('rice'),
        ];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5).map(entry => [entry.name, entry.daysLeft]), [['yogurt', -2], ['spinach', 2]]);
    });

    it('counts the boundary day as within', () => {
        assert.deepStrictEqual(expiringItems([item('milk', { expireDate: '2026-10-15' })], TODAY, 5).map(entry => entry.daysLeft), [5]);
    });

    it('skips out-of-stock items', () => {
        assert.deepStrictEqual(expiringItems([item('cream', { expireDate: '2026-10-11', isOutOfStock: true })], TODAY, 5), []);
    });

    it('keeps the earliest date when a name appears twice', () => {
        const items = [item('Eggs', { expireDate: '2026-10-14' }), item('egg', { expireDate: '2026-10-11' })];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5), [{ name: 'egg', key: 'egg', expireDate: '2026-10-11', daysLeft: 1 }]);
    });

    it('sorts by days left, then name', () => {
        const items = [item('leeks', { expireDate: '2026-10-11' }), item('kale', { expireDate: '2026-10-11' }), item('ham', { expireDate: '2026-10-10' })];
        assert.deepStrictEqual(expiringItems(items, TODAY, 5).map(entry => entry.name), ['ham', 'kale', 'leeks']);
    });
});

describe('describeExpiry', () => {
    it('words the days left', () => {
        assert.strictEqual(describeExpiry(-3), 'expired 3 days ago');
        assert.strictEqual(describeExpiry(-1), 'expired yesterday');
        assert.strictEqual(describeExpiry(0), 'expires today');
        assert.strictEqual(describeExpiry(1), 'expires tomorrow');
        assert.strictEqual(describeExpiry(4), 'expires in 4 days');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './expiry'`.

- [ ] **Step 3: Implement**

`pantry-match/src/expiry.ts`:

```ts
import { PantryItem } from './cooklang-api';
import { normaliseName } from './match';

export interface ExpiringItem {
    /** As written in pantry.conf. */
    name: string;
    /** `normaliseName(name)`, matched against `RecipeMatch.uses`. */
    key: string;
    expireDate: string;
    /** Negative when already expired. */
    daysLeft: number;
}

const DAY_MS = 86_400_000;

function utcDay(date: string): number | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

/** The local calendar date as `YYYY-MM-DD` (pantry dates have no time zone). */
export function todayString(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `today` to `date` (both `YYYY-MM-DD`). */
export function daysUntil(today: string, date: string): number | undefined {
    const from = utcDay(today);
    const to = utcDay(date);
    return from === undefined || to === undefined ? undefined : Math.round((to - from) / DAY_MS);
}

/** In-stock items with an expiry date at most `withinDays` away (or past), one per normalised name, soonest first. */
export function expiringItems(items: readonly PantryItem[], today: string, withinDays: number): ExpiringItem[] {
    const byKey = new Map<string, ExpiringItem>();
    for (const item of items) {
        if (item.isOutOfStock || !item.expireDate) {
            continue;
        }
        const daysLeft = daysUntil(today, item.expireDate);
        const key = normaliseName(item.name);
        if (daysLeft === undefined || daysLeft > withinDays || key === '') {
            continue;
        }
        const existing = byKey.get(key);
        if (!existing || daysLeft < existing.daysLeft) {
            byKey.set(key, { name: item.name, key, expireDate: item.expireDate, daysLeft });
        }
    }
    return [...byKey.values()].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

export function describeExpiry(daysLeft: number): string {
    if (daysLeft < -1) {
        return `expired ${-daysLeft} days ago`;
    }
    if (daysLeft === -1) {
        return 'expired yesterday';
    }
    if (daysLeft === 0) {
        return 'expires today';
    }
    if (daysLeft === 1) {
        return 'expires tomorrow';
    }
    return `expires in ${daysLeft} days`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (10 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/expiry.ts pantry-match/src/expiry.spec.ts
git commit -m "feat(pantry-match): pick pantry items that expire soon"
```

---

### Task 9: View model (groups, ranking, tree nodes)

**Files:**
- Create: `pantry-match/src/markdown.ts`, `pantry-match/src/view-model.ts`
- Test: `pantry-match/src/markdown.spec.ts`, `pantry-match/src/view-model.spec.ts`

- [ ] **Step 1: Write the failing tests**

`pantry-match/src/markdown.spec.ts`:

```ts
import * as assert from 'assert';
import { escapeMarkdown, formatNames, truncateName } from './markdown';

describe('markdown helpers', () => {
    it('escapes markdown specials and folds newlines', () => {
        assert.strictEqual(escapeMarkdown('a*b_[c](d)\nx'), 'a\\*b\\_\\[c\\]\\(d\\) x');
    });

    it('truncates long names at 60 characters', () => {
        assert.strictEqual(truncateName('x'.repeat(61)), `${'x'.repeat(60)}…`);
    });

    it('caps a list at 8 names', () => {
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        assert.strictEqual(formatNames(names), 'a, b, c, d, e, f, g, h, and 2 more');
    });
});
```

`pantry-match/src/view-model.spec.ts`:

```ts
import * as assert from 'assert';
import { PantryItem } from './cooklang-api';
import { ExpiringItem } from './expiry';
import { pantryLookup } from './match';
import { buildViewModel, childrenOf, EMPTY_MODEL, IndexedRecipe, isEmptyModel, nodeId, recipeTitle, recipeUriOf, TreeNode } from './view-model';

const pantryItem = (name: string): PantryItem => ({ name, isLow: false, isOutOfStock: false });
const lookup = pantryLookup(['rice', 'onion', 'garlic', 'spinach', 'egg'].map(pantryItem), ['salt']);
const recipe = (path: string, ...names: string[]): IndexedRecipe => ({
    uri: `file:///ws/${path}`,
    path,
    ingredients: names.map(name => name.startsWith('?') ? { name: name.slice(1), optional: true } : { name, optional: false }),
});
const spinach: ExpiringItem = { name: 'spinach', key: 'spinach', expireDate: '2026-10-12', daysLeft: 2 };

const recipes = [
    recipe('Fried rice.cook', 'rice', 'egg', 'onion', 'salt'),
    recipe('Dinners/Risotto.cook', 'rice', 'onion', 'parmesan', 'stock'),
    recipe('Omelette.cook', 'egg', 'cheese', '?spinach'),
    recipe('Spinach pie.cook', 'spinach', 'pastry', 'feta', 'egg', 'cream'),
    recipe('Salted water.cook', 'salt'),
];
const model = buildViewModel(recipes, [{ uri: 'file:///ws/Broken.cook', path: 'Broken.cook', message: 'syntax error' }], lookup, [spinach]);

describe('recipeTitle', () => {
    it('is the file name without .cook', () => {
        assert.strictEqual(recipeTitle('Dinners/Risotto.cook'), 'Risotto');
        assert.strictEqual(recipeTitle('a.COOK'), 'a');
    });
});

describe('buildViewModel', () => {
    it('puts complete recipes under Cook now', () => {
        assert.deepStrictEqual(model.cookNow.map(row => [row.title, row.covered, row.total]), [['Fried rice', 3, 3]]);
    });

    it('ranks Missing 1–2 by missing count, then coverage, and leaves out 3+ missing', () => {
        assert.deepStrictEqual(model.missingFew.map(row => [row.title, row.missing]), [
            ['Omelette', ['cheese']],
            ['Risotto', ['parmesan', 'stock']],
        ]);
    });

    it('lists recipes that use an expiring item, optional uses included, best coverage first', () => {
        assert.deepStrictEqual(model.useItUp.map(entry => [entry.item.name, entry.recipes.map(row => row.title)]), [
            ['spinach', ['Omelette', 'Spinach pie']],
        ]);
    });

    it('orders Use it up by coverage even when another recipe misses fewer', () => {
        const big = recipe('Big.cook', 'spinach', 'rice', 'onion', 'garlic', 'egg', 'kale', 'leek');
        const small = recipe('Small.cook', 'spinach', 'tofu');
        const result = buildViewModel([small, big], [], lookup, [spinach]);
        assert.deepStrictEqual(result.useItUp[0].recipes.map(row => row.title), ['Big', 'Small']);
    });

    it('lists failed recipes under Couldn\'t read', () => {
        assert.deepStrictEqual(model.unreadable, [{ uri: 'file:///ws/Broken.cook', path: 'Broken.cook', title: 'Broken', message: 'syntax error' }]);
    });

    it('leaves out recipes with nothing to check', () => {
        const titles = [...model.cookNow, ...model.missingFew].map(row => row.title);
        assert.ok(!titles.includes('Salted water'));
    });
});

describe('childrenOf', () => {
    const group = (id: string): TreeNode => {
        const found = childrenOf(model).find(node => node.kind === 'group' && node.group === id);
        assert.ok(found, id);
        return found;
    };

    it('shows only non-empty groups, in order', () => {
        assert.deepStrictEqual(childrenOf(model).map(node => node.kind === 'group' ? node.group : node.kind), ['cookNow', 'missingFew', 'useItUp', 'unreadable']);
        assert.deepStrictEqual(childrenOf(EMPTY_MODEL), []);
        assert.ok(isEmptyModel(EMPTY_MODEL));
        assert.ok(!isEmptyModel(model));
    });

    it('lists missing ingredients under a recipe', () => {
        const [omelette] = childrenOf(model, group('missingFew'));
        assert.deepStrictEqual(childrenOf(model, omelette).map(node => node.kind === 'missing' ? node.name : node.kind), ['cheese']);
    });

    it('lists recipes under an expiring item', () => {
        const [spinachNode] = childrenOf(model, group('useItUp'));
        assert.strictEqual(spinachNode.kind, 'expiring');
        assert.deepStrictEqual(childrenOf(model, spinachNode).map(node => node.kind === 'recipe' ? node.row.title : node.kind), ['Omelette', 'Spinach pie']);
    });

    it('gives a recipe shown in two groups two distinct ids', () => {
        const [omeletteInMissing] = childrenOf(model, group('missingFew'));
        const [spinachNode] = childrenOf(model, group('useItUp'));
        const [omeletteInUseItUp] = childrenOf(model, spinachNode);
        assert.notStrictEqual(nodeId(omeletteInMissing), nodeId(omeletteInUseItUp));
    });
});

describe('recipeUriOf', () => {
    it('reads the URI of recipe and unreadable nodes only', () => {
        const [fried] = childrenOf(model, childrenOf(model)[0]);
        assert.strictEqual(recipeUriOf(fried), 'file:///ws/Fried rice.cook');
        const [broken] = childrenOf(model, childrenOf(model)[3]);
        assert.strictEqual(recipeUriOf(broken), 'file:///ws/Broken.cook');
        assert.strictEqual(recipeUriOf(childrenOf(model)[0]), undefined);
        assert.strictEqual(recipeUriOf(undefined), undefined);
        assert.strictEqual(recipeUriOf({ kind: 'recipe' }), undefined);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './markdown'` and `'./view-model'`.

- [ ] **Step 3: Implement**

`pantry-match/src/markdown.ts` (same helpers as `allergens/src/markdown.ts`):

```ts
const MAX_LIST_ENTRIES = 8;
const MAX_NAME_LENGTH = 60;

/** Caps a display name at 60 code points (never splitting a surrogate pair), appending an ellipsis. */
export function truncateName(name: string): string {
    const characters = Array.from(name);
    return characters.length > MAX_NAME_LENGTH ? `${characters.slice(0, MAX_NAME_LENGTH).join('')}…` : name;
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

`pantry-match/src/view-model.ts`:

```ts
// What the "What can I cook" view shows, as plain data: tree.ts only maps these nodes to TreeItems.
import { ExpiringItem } from './expiry';
import { coverage, matchIngredients, PantryLookup } from './match';
import { IngredientName } from './names-template';

export const MAX_MISSING = 2;

export interface IndexedRecipe {
    uri: string;
    path: string;
    /** Own ingredients plus those of linked recipes. */
    ingredients: readonly IngredientName[];
}

export interface FailedRecipe {
    uri: string;
    path: string;
    message: string;
}

export interface RecipeRow {
    uri: string;
    path: string;
    title: string;
    covered: number;
    total: number;
    missing: readonly string[];
}

export interface ExpiringRow {
    item: ExpiringItem;
    recipes: RecipeRow[];
}

export interface UnreadableRow extends FailedRecipe {
    title: string;
}

export interface ViewModel {
    cookNow: RecipeRow[];
    missingFew: RecipeRow[];
    useItUp: ExpiringRow[];
    unreadable: UnreadableRow[];
}

export const EMPTY_MODEL: ViewModel = { cookNow: [], missingFew: [], useItUp: [], unreadable: [] };

export function isEmptyModel(model: ViewModel): boolean {
    return model.cookNow.length + model.missingFew.length + model.useItUp.length + model.unreadable.length === 0;
}

export function recipeTitle(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.cook$/i, '');
}

function byTitle(a: RecipeRow, b: RecipeRow): number {
    return a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

/** Cook now / Missing 1–2: fewest missing first, then best coverage. */
export function compareByMissing(a: RecipeRow, b: RecipeRow): number {
    return a.missing.length - b.missing.length || coverage(b) - coverage(a) || byTitle(a, b);
}

/** Use it up: best coverage first, then fewest missing. */
export function compareByCoverage(a: RecipeRow, b: RecipeRow): number {
    return coverage(b) - coverage(a) || a.missing.length - b.missing.length || byTitle(a, b);
}

export function buildViewModel(
    recipes: readonly IndexedRecipe[],
    failed: readonly FailedRecipe[],
    lookup: PantryLookup,
    expiring: readonly ExpiringItem[],
): ViewModel {
    const matched = recipes.map(recipe => {
        const match = matchIngredients(recipe.ingredients, lookup);
        const row: RecipeRow = {
            uri: recipe.uri,
            path: recipe.path,
            title: recipeTitle(recipe.path),
            covered: match.covered,
            total: match.total,
            missing: match.missing,
        };
        return { row, uses: match.uses };
    });
    const ranked = matched.map(entry => entry.row).filter(row => row.total > 0).sort(compareByMissing);
    return {
        cookNow: ranked.filter(row => row.missing.length === 0),
        missingFew: ranked.filter(row => row.missing.length > 0 && row.missing.length <= MAX_MISSING),
        useItUp: expiring.map(item => ({
            item,
            recipes: matched.filter(entry => entry.uses.has(item.key)).map(entry => entry.row).sort(compareByCoverage),
        })),
        unreadable: failed
            .map(entry => ({ uri: entry.uri, path: entry.path, title: recipeTitle(entry.path), message: entry.message }))
            .sort((a, b) => a.path.localeCompare(b.path)),
    };
}

export type GroupId = 'cookNow' | 'missingFew' | 'useItUp' | 'unreadable';

export const GROUP_LABELS: Record<GroupId, string> = {
    cookNow: 'Cook now',
    missingFew: 'Missing 1–2',
    useItUp: 'Use it up',
    unreadable: 'Couldn\'t read',
};

export type TreeNode =
    | { kind: 'group'; group: GroupId; count: number }
    | { kind: 'recipe'; row: RecipeRow; parentId: string }
    | { kind: 'missing'; name: string; parentId: string }
    | { kind: 'expiring'; row: ExpiringRow }
    | { kind: 'unreadable'; row: UnreadableRow };

/** Stable and unique, even when a recipe appears under several groups. */
export function nodeId(node: TreeNode): string {
    switch (node.kind) {
        case 'group': return `group:${node.group}`;
        case 'recipe': return `${node.parentId}/recipe:${node.row.uri}`;
        case 'missing': return `${node.parentId}/missing:${node.name}`;
        case 'expiring': return `expiring:${node.row.item.key}`;
        case 'unreadable': return `unreadable:${node.row.uri}`;
    }
}

function recipeNodes(rows: readonly RecipeRow[], parentId: string): TreeNode[] {
    return rows.map((row): TreeNode => ({ kind: 'recipe', row, parentId }));
}

function groupChildren(model: ViewModel, group: GroupId, parentId: string): TreeNode[] {
    if (group === 'cookNow') {
        return recipeNodes(model.cookNow, parentId);
    }
    if (group === 'missingFew') {
        return recipeNodes(model.missingFew, parentId);
    }
    if (group === 'useItUp') {
        return model.useItUp.map((row): TreeNode => ({ kind: 'expiring', row }));
    }
    return model.unreadable.map((row): TreeNode => ({ kind: 'unreadable', row }));
}

export function childrenOf(model: ViewModel, node?: TreeNode): TreeNode[] {
    if (!node) {
        const counts: Array<[GroupId, number]> = [
            ['cookNow', model.cookNow.length],
            ['missingFew', model.missingFew.length],
            ['useItUp', model.useItUp.length],
            ['unreadable', model.unreadable.length],
        ];
        return counts.filter(([, count]) => count > 0).map(([group, count]): TreeNode => ({ kind: 'group', group, count }));
    }
    if (node.kind === 'group') {
        return groupChildren(model, node.group, nodeId(node));
    }
    if (node.kind === 'expiring') {
        return recipeNodes(node.row.recipes, nodeId(node));
    }
    if (node.kind === 'recipe') {
        const parentId = nodeId(node);
        return node.row.missing.map((name): TreeNode => ({ kind: 'missing', name, parentId }));
    }
    return [];
}

/** The recipe URI of a tree node passed to a command (row click or context menu). */
export function recipeUriOf(node: unknown): string | undefined {
    if (typeof node !== 'object' || node === null) {
        return undefined;
    }
    const candidate = node as { kind?: unknown; row?: { uri?: unknown } };
    if ((candidate.kind !== 'recipe' && candidate.kind !== 'unreadable') || typeof candidate.row?.uri !== 'string') {
        return undefined;
    }
    return candidate.row.uri;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pantry-match && npm test`
Expected: PASS (all `markdown helpers`, `recipeTitle`, `buildViewModel`, `childrenOf`, `recipeUriOf` cases).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/markdown.ts pantry-match/src/markdown.spec.ts pantry-match/src/view-model.ts pantry-match/src/view-model.spec.ts
git commit -m "feat(pantry-match): rank recipes into Cook now, Missing 1-2 and Use it up"
```

---

### Task 10: Tree data provider

**Files:**
- Create: `pantry-match/src/tree.ts`

This is the thin `vscode` layer over `view-model.ts`, so there's no spec (it would need the `vscode` module). It is checked by compiling here and by the manual checks in Task 16.

- [ ] **Step 1: Implement**

`pantry-match/src/tree.ts`:

```ts
// The "What can I cook" view in the Explorer. All structure comes from view-model.ts.
import * as vscode from 'vscode';
import { describeExpiry } from './expiry';
import { childrenOf, EMPTY_MODEL, GROUP_LABELS, nodeId, TreeNode, ViewModel } from './view-model';

export const VIEW_ID = 'pantryMatch.view';
export const OPEN_RECIPE_COMMAND = 'pantryMatch.openRecipe';

export class PantryMatchTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private model: ViewModel = EMPTY_MODEL;

    setModel(model: ViewModel): void {
        this.model = model;
        this.onDidChangeTreeDataEmitter.fire();
    }

    getChildren(element?: TreeNode): TreeNode[] {
        return childrenOf(this.model, element);
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const item = this.createItem(node);
        item.id = nodeId(node);
        return item;
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }

    protected createItem(node: TreeNode): vscode.TreeItem {
        const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
        switch (node.kind) {
            case 'group': {
                const item = new vscode.TreeItem(GROUP_LABELS[node.group], node.group === 'unreadable' ? Collapsed : Expanded);
                item.description = String(node.count);
                item.contextValue = 'group';
                return item;
            }
            case 'recipe': {
                const { row } = node;
                const hasMissing = row.missing.length > 0;
                const item = new vscode.TreeItem(row.title, hasMissing ? Collapsed : None);
                item.description = `${row.covered}/${row.total}`;
                item.tooltip = hasMissing ? `${row.path}\nMissing: ${row.missing.join(', ')}` : `${row.path}\nYou have everything.`;
                item.resourceUri = vscode.Uri.parse(row.uri);
                item.contextValue = hasMissing ? 'recipeMissing' : 'recipe';
                item.command = { command: OPEN_RECIPE_COMMAND, title: 'Open Recipe', arguments: [node] };
                return item;
            }
            case 'missing': {
                const item = new vscode.TreeItem(node.name, None);
                item.iconPath = new vscode.ThemeIcon('circle-slash');
                item.tooltip = 'Not in your pantry';
                item.contextValue = 'missingIngredient';
                return item;
            }
            case 'expiring': {
                const { item: pantryItem, recipes } = node.row;
                const when = describeExpiry(pantryItem.daysLeft);
                const item = new vscode.TreeItem(pantryItem.name, recipes.length > 0 ? Expanded : None);
                item.description = recipes.length > 0 ? when : `${when} · no recipes use it`;
                item.tooltip = `${pantryItem.name}: ${when} (${pantryItem.expireDate})`;
                item.iconPath = new vscode.ThemeIcon(pantryItem.daysLeft < 0 ? 'warning' : 'clock');
                item.contextValue = 'expiring';
                return item;
            }
            case 'unreadable': {
                const { row } = node;
                const item = new vscode.TreeItem(row.title, None);
                item.description = row.message;
                item.tooltip = `${row.path}: ${row.message}`;
                item.iconPath = new vscode.ThemeIcon('warning');
                item.contextValue = 'unreadable';
                // The preview would fail the same way, so open the source.
                item.command = { command: 'vscode.open', title: 'Open Recipe', arguments: [vscode.Uri.parse(row.uri)] };
                return item;
            }
        }
    }
}
```

- [ ] **Step 2: Compile and run the suite**

Run: `cd pantry-match && npm test`
Expected: compiles with no errors; all existing specs still PASS.

- [ ] **Step 3: Commit**

```bash
git add pantry-match/src/tree.ts
git commit -m "feat(pantry-match): tree data provider for the What can I cook view"
```

---

### Task 11: Preview badge

**Files:**
- Create: `pantry-match/src/badge.ts`
- Test: `pantry-match/src/badge.spec.ts`

- [ ] **Step 1: Write the failing test**

`pantry-match/src/badge.spec.ts`:

```ts
import * as assert from 'assert';
import { badgeFor, PantryBadgeProvider } from './badge';
import { PantryItem } from './cooklang-api';
import { PantryLookup, pantryLookup } from './match';
import { IngredientName, RenderedNames } from './names-template';

const CONTEXT = { version: 1, uri: 'file:///ws/Pasta.cook', path: 'Pasta.cook', scale: 1 };
const pantryItem = (name: string): PantryItem => ({ name, isLow: false, isOutOfStock: false });
const rendered = (...names: string[]): RenderedNames => ({ ok: true, names: { names: names.map(name => ({ name, optional: false })), refs: [] } });

function setup(options: { show?: boolean; lookup?: PantryLookup | undefined; result?: RenderedNames; extra?: IngredientName[] }): {
    provider: PantryBadgeProvider; logs: string[]; expanded: string[];
} {
    const logs: string[] = [];
    const expanded: string[] = [];
    const provider = new PantryBadgeProvider({
        showBadge: () => options.show ?? true,
        lookup: () => 'lookup' in options ? options.lookup : pantryLookup([pantryItem('pasta'), pantryItem('basil')], ['salt']),
        render: async () => options.result ?? rendered('pasta', 'basil', 'salt'),
        expand: async (path, own) => {
            expanded.push(path);
            return [...own.names, ...(options.extra ?? [])];
        },
        log: message => logs.push(message),
    });
    return { provider, logs, expanded };
}

describe('badgeFor', () => {
    it('is good with everything in stock', () => {
        assert.deepStrictEqual(badgeFor({ covered: 2, total: 2, missing: [], uses: new Set() }), {
            kind: 'pill', text: 'Have 2/2', tone: 'good', tooltipMarkdown: '**You have all 2 ingredients** in your pantry.',
        });
    });

    it('is neutral and lists what is missing', () => {
        assert.deepStrictEqual(badgeFor({ covered: 9, total: 11, missing: ['pine nuts', 'parmesan'], uses: new Set() }), {
            kind: 'pill', text: 'Have 9/11', tone: 'neutral', tooltipMarkdown: '**Have 9 of 11 ingredients.**\n\nMissing: pine nuts, parmesan',
        });
    });

    it('escapes ingredient names in the hover', () => {
        const badge = badgeFor({ covered: 0, total: 1, missing: ['[x](y)'], uses: new Set() });
        assert.strictEqual(badge?.tooltipMarkdown, '**Have 0 of 1 ingredients.**\n\nMissing: \\[x\\]\\(y\\)');
    });

    it('shows nothing when the recipe has nothing to check', () => {
        assert.strictEqual(badgeFor({ covered: 0, total: 0, missing: [], uses: new Set() }), undefined);
    });
});

describe('PantryBadgeProvider', () => {
    it('counts the recipe and its linked recipes, leaving alwaysHave out', async () => {
        const { provider, expanded } = setup({ extra: [{ name: 'pine nuts', optional: false }] });
        const badge = await provider.provide(CONTEXT);
        assert.strictEqual(badge?.text, 'Have 2/3');
        assert.strictEqual(badge?.tone, 'neutral');
        assert.deepStrictEqual(expanded, ['Pasta.cook']);
    });

    it('returns nothing when turned off, without a usable pantry, or for a bad context', async () => {
        assert.strictEqual(await setup({ show: false }).provider.provide(CONTEXT), undefined);
        assert.strictEqual(await setup({ lookup: undefined }).provider.provide(CONTEXT), undefined);
        assert.strictEqual(await setup({}).provider.provide({ uri: 'x' }), undefined);
    });

    it('logs and returns nothing when the recipe cannot be rendered', async () => {
        const { provider, logs } = setup({ result: { ok: false, message: 'syntax error' } });
        assert.strictEqual(await provider.provide(CONTEXT), undefined);
        assert.deepStrictEqual(logs, ['Pantry Match: could not read Pasta.cook: syntax error']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pantry-match && npm test`
Expected: FAIL with `error TS2307: Cannot find module './badge'`.

- [ ] **Step 3: Implement**

`pantry-match/src/badge.ts`:

```ts
// `Have 9/11` pill on the recipe preview (outlet `cooklang/recipePreview/badge`).
import { PillBadge, PreviewOutletContext } from './cooklang-api';
import { formatNames } from './markdown';
import { matchIngredients, PantryLookup, RecipeMatch } from './match';
import { IngredientName, RecipeNames, RenderedNames } from './names-template';

export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

export function badgeFor(match: RecipeMatch): PillBadge | undefined {
    if (match.total === 0) {
        return undefined;
    }
    const complete = match.covered === match.total;
    return {
        kind: 'pill',
        text: `Have ${match.covered}/${match.total}`,
        tone: complete ? 'good' : 'neutral',
        tooltipMarkdown: complete
            ? `**You have all ${match.total} ingredients** in your pantry.`
            : `**Have ${match.covered} of ${match.total} ingredients.**\n\nMissing: ${formatNames(match.missing)}`,
    };
}

export interface BadgeDeps {
    showBadge(): boolean;
    /** Undefined while there is no usable pantry (none, malformed, or not loaded yet). */
    lookup(): PantryLookup | undefined;
    render(uri: string): Promise<RenderedNames>;
    /** Merges linked recipes' names; `path` is `''` outside the workspace. */
    expand(path: string, own: RecipeNames): Promise<IngredientName[]>;
    log(message: string): void;
}

export class PantryBadgeProvider {

    constructor(protected readonly deps: BadgeDeps) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context) || !this.deps.showBadge()) {
            return undefined;
        }
        const lookup = this.deps.lookup();
        if (!lookup) {
            return undefined;
        }
        const rendered = await this.deps.render(context.uri);
        if (!rendered.ok) {
            this.deps.log(`Pantry Match: could not read ${context.path || context.uri}: ${rendered.message}`);
            return undefined;
        }
        const ingredients = await this.deps.expand(context.path, rendered.names);
        return badgeFor(matchIngredients(ingredients, lookup));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd pantry-match && npm test`
Expected: PASS (7 new tests).

- [ ] **Step 5: Commit**

```bash
git add pantry-match/src/badge.ts pantry-match/src/badge.spec.ts
git commit -m "feat(pantry-match): Have N/M pill badge on recipe previews"
```

---

### Task 12: Extension wiring (controller + activate)

**Files:**
- Create: `pantry-match/src/controller.ts`
- Modify (replace stub): `pantry-match/src/extension.ts`

Glue only. Every decision is in the tested modules. It's checked by compiling here and by Task 16.

- [ ] **Step 1: Implement the controller**

`pantry-match/src/controller.ts`:

```ts
// vscode glue: file watchers, debounce, pantry loading, index refresh, context keys and
// the tree. Decisions live in the pure modules (pantry-file, recipe-index, references,
// expiry, view-model, badge).
import * as vscode from 'vscode';
import { PantryBadgeProvider } from './badge';
import { CooklangApi, PantryItem } from './cooklang-api';
import { expiringItems, todayString } from './expiry';
import { PantryLookup, pantryLookup } from './match';
import { RecipeNames, renderNames } from './names-template';
import { loadPantry, PANTRY_FILE, PantryState } from './pantry-file';
import { RecipeFile, RecipeIndex } from './recipe-index';
import { ReferenceExpander } from './references';
import { PantryMatchSettings, readSettings } from './settings';
import { PantryMatchTreeProvider, VIEW_ID } from './tree';
import { buildViewModel, EMPTY_MODEL, FailedRecipe, IndexedRecipe, isEmptyModel, TreeNode, ViewModel } from './view-model';

export const STATE_CONTEXT_KEY = 'pantryMatch.state';
export type ViewState = 'noWorkspace' | 'unsupported' | 'noPantry' | 'pantryError' | 'indexing' | 'empty' | 'ready';

const RECIPE_GLOB = '**/*.cook';
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**}';
const DEBOUNCE_MS = 300;

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class PantryMatchController implements vscode.Disposable {

    readonly badges: PantryBadgeProvider;
    protected readonly tree = new PantryMatchTreeProvider();
    protected readonly treeView: vscode.TreeView<TreeNode>;
    protected readonly index: RecipeIndex;
    protected readonly expander: ReferenceExpander;
    protected readonly disposables: vscode.Disposable[] = [];
    protected watchers: vscode.Disposable[] = [];
    protected pantry: PantryState = { kind: 'missing' };
    protected lookup: PantryLookup | undefined;
    protected supported: Promise<boolean> | undefined;
    /** The workspace is only scanned once the view has been shown (or Refresh was pressed). */
    protected viewed = false;
    protected pantryChanged = true;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected queue: Promise<void> = Promise.resolve();

    constructor(protected readonly api: CooklangApi, protected readonly log: (message: string) => void) {
        this.index = new RecipeIndex({
            list: () => this.listRecipes(),
            mtime: uri => this.mtime(uri),
            render: uri => renderNames(api, uri),
        });
        this.expander = new ReferenceExpander({
            resolve: path => api.resolveRecipeReferences(path),
            names: path => this.namesForPath(path),
        });
        this.badges = new PantryBadgeProvider({
            showBadge: () => this.settings().showBadge,
            lookup: () => this.lookup,
            render: uri => renderNames(api, uri),
            expand: (path, own) => this.expander.ingredientsFor(path, own),
            log,
        });
        this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this.tree, showCollapseAll: true });
        this.disposables.push(
            this.tree,
            this.treeView,
            this.treeView.onDidChangeVisibility(event => {
                if (event.visible && !this.viewed) {
                    this.viewed = true;
                    this.scheduleUpdate(0);
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.bind();
                this.index.clear();
                this.expander.clear();
                this.pantryChanged = true;
                this.scheduleUpdate(0);
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('pantryMatch')) {
                    // alwaysHave feeds the lookup and showBadge the badges: reload both.
                    this.pantryChanged = true;
                    this.scheduleUpdate(0);
                }
            }),
        );
    }

    isSupported(): Promise<boolean> {
        this.supported ??= this.api.supported();
        return this.supported;
    }

    async start(): Promise<void> {
        this.viewed = this.treeView.visible;
        this.bind();
        await this.enqueue();
    }

    /** View title Refresh: forget every cached render and rescan. */
    refresh(): Promise<void> {
        this.index.clear();
        this.expander.clear();
        this.pantryChanged = true;
        this.viewed = true;
        return this.enqueue();
    }

    async openPantryFile(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            return;
        }
        try {
            await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...PANTRY_FILE.split('/')));
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open ${PANTRY_FILE}: ${messageOf(error)}`);
        }
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.watchers.forEach(disposable => disposable.dispose());
        this.disposables.forEach(disposable => disposable.dispose());
    }

    protected settings(): PantryMatchSettings {
        const configuration = vscode.workspace.getConfiguration('pantryMatch');
        return readSettings(key => configuration.get(key));
    }

    protected folder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    protected bind(): void {
        this.watchers.forEach(disposable => disposable.dispose());
        this.watchers = [];
        const folder = this.folder();
        if (!folder) {
            return;
        }
        const recipes = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, RECIPE_GLOB));
        const onRecipe = (uri: vscode.Uri): void => {
            this.index.invalidate(uri.toString());
            // A changed recipe can change any tree it is linked from.
            this.expander.clear();
            this.scheduleUpdate();
        };
        const pantry = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, PANTRY_FILE));
        const onPantry = (): void => {
            this.pantryChanged = true;
            this.scheduleUpdate();
        };
        this.watchers = [
            recipes, recipes.onDidCreate(onRecipe), recipes.onDidChange(onRecipe), recipes.onDidDelete(onRecipe),
            pantry, pantry.onDidCreate(onPantry), pantry.onDidChange(onPantry), pantry.onDidDelete(onPantry),
        ];
    }

    protected scheduleUpdate(delay = DEBOUNCE_MS): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.enqueue(); }, delay);
    }

    /** Updates run one at a time, in order. */
    protected enqueue(): Promise<void> {
        this.queue = this.queue
            .then(() => this.update())
            .catch(error => this.log(`Pantry Match: update failed: ${messageOf(error)}`));
        return this.queue;
    }

    protected async update(): Promise<void> {
        const folder = this.folder();
        if (!folder) {
            this.lookup = undefined;
            this.show(EMPTY_MODEL, undefined);
            await this.setState('noWorkspace');
            return;
        }
        if (!await this.isSupported()) {
            this.lookup = undefined;
            this.show(EMPTY_MODEL, undefined);
            await this.setState('unsupported');
            return;
        }
        if (this.pantryChanged) {
            this.pantryChanged = false;
            this.pantry = await loadPantry({ read: () => this.readPantry(folder.uri), parse: text => this.api.parsePantry(text) });
            this.lookup = this.pantry.kind === 'ok' ? pantryLookup(this.pantry.items, this.settings().alwaysHave) : undefined;
            await this.api.refreshBadges().catch(() => false);
        }
        const pantry = this.pantry;
        if (pantry.kind === 'missing') {
            this.show(EMPTY_MODEL, undefined);
            await this.setState('noPantry');
            return;
        }
        if (pantry.kind === 'error') {
            this.show(EMPTY_MODEL, pantry.message);
            await this.setState('pantryError');
            return;
        }
        if (!this.viewed) {
            return;
        }
        await this.setState('indexing');
        await this.index.refresh((done, total) => {
            this.treeView.message = done < total ? `Reading recipes… ${done}/${total}` : undefined;
        });
        const model = await this.buildModel(pantry.items);
        this.show(model, undefined);
        await this.setState(isEmptyModel(model) ? 'empty' : 'ready');
    }

    protected async buildModel(items: readonly PantryItem[]): Promise<ViewModel> {
        const lookup = this.lookup;
        if (!lookup) {
            return EMPTY_MODEL;
        }
        const recipes: IndexedRecipe[] = [];
        const failed: FailedRecipe[] = [];
        for (const entry of this.index.entries()) {
            if (entry.result.ok) {
                recipes.push({ uri: entry.uri, path: entry.path, ingredients: await this.expander.ingredientsFor(entry.path, entry.result.names) });
            } else {
                failed.push({ uri: entry.uri, path: entry.path, message: entry.result.message });
            }
        }
        const expiring = expiringItems(items, todayString(new Date()), this.settings().expiringWithinDays);
        return buildViewModel(recipes, failed, lookup, expiring);
    }

    protected show(model: ViewModel, message: string | undefined): void {
        this.tree.setModel(model);
        this.treeView.message = message;
    }

    protected async setState(state: ViewState): Promise<void> {
        await vscode.commands.executeCommand('setContext', STATE_CONTEXT_KEY, state);
    }

    protected async readPantry(root: vscode.Uri): Promise<string | undefined> {
        const uri = vscode.Uri.joinPath(root, ...PANTRY_FILE.split('/'));
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            return undefined;
        }
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    }

    protected async listRecipes(): Promise<RecipeFile[]> {
        const folder = this.folder();
        if (!folder) {
            return [];
        }
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, RECIPE_GLOB), EXCLUDE_GLOB);
        return uris.map(uri => ({ uri: uri.toString(), path: vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/') }));
    }

    protected async mtime(uri: string): Promise<number | undefined> {
        try {
            return (await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).mtime;
        } catch {
            return undefined;
        }
    }

    /** A linked recipe's names: from the index when fresh, otherwise rendered now. */
    protected async namesForPath(path: string): Promise<RecipeNames | undefined> {
        const entry = this.index.byPath(path);
        if (entry) {
            return entry.result.ok ? entry.result.names : undefined;
        }
        const folder = this.folder();
        if (!folder) {
            return undefined;
        }
        const rendered = await renderNames(this.api, vscode.Uri.joinPath(folder.uri, ...path.split('/')).toString());
        return rendered.ok ? rendered.names : undefined;
    }
}
```

- [ ] **Step 2: Replace `pantry-match/src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { PantryMatchController } from './controller';
import { OPEN_RECIPE_COMMAND } from './tree';
import { recipeUriOf } from './view-model';

/** The Shopping List plugin's command; takes a `vscode.Uri` like the Explorer passes. */
export const SHOPPING_LIST_ADD_RECIPE = 'shoppingList.addRecipe';
export const SHOPPING_LIST_CONTEXT_KEY = 'pantryMatch.shoppingListAvailable';
/** The Pantry plugin's view, which offers "Create pantry". */
export const PANTRY_SHOW = 'pantry.show';
export const PANTRY_DOCS_URL = 'https://cook.md/help/plugins/pantry';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Pantry Match');
    const log = (message: string): void => output.appendLine(message);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const controller = new PantryMatchController(api, log);
    context.subscriptions.push(output, controller);

    // Hides "Add missing to shopping list" when the Shopping List plugin isn't installed.
    const syncShoppingList = async (): Promise<void> => {
        await vscode.commands.executeCommand('setContext', SHOPPING_LIST_CONTEXT_KEY, await api.hasCommands([SHOPPING_LIST_ADD_RECIPE]));
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('pantryMatch.refresh', () => controller.refresh()),
        vscode.commands.registerCommand(OPEN_RECIPE_COMMAND, async (node: unknown) => {
            const uri = recipeUriOf(node);
            if (!uri) {
                return;
            }
            try {
                await api.openPreview(uri);
            } catch (error) {
                log(`Pantry Match: could not open ${uri}: ${messageOf(error)}`);
                vscode.window.showErrorMessage(`Could not open the recipe: ${messageOf(error)}`);
            }
        }),
        vscode.commands.registerCommand('pantryMatch.addMissingToShoppingList', async (node: unknown) => {
            const uri = recipeUriOf(node);
            if (!uri) {
                return;
            }
            if (!await api.hasCommands([SHOPPING_LIST_ADD_RECIPE])) {
                vscode.window.showInformationMessage('Install the Shopping List plugin to add recipes to a shopping list.');
                return;
            }
            // The whole recipe goes on the list; the list subtracts the pantry, so only the missing items show.
            await vscode.commands.executeCommand(SHOPPING_LIST_ADD_RECIPE, vscode.Uri.parse(uri));
        }),
        vscode.commands.registerCommand('pantryMatch.setUpPantry', async () => {
            if (await api.hasCommands([PANTRY_SHOW])) {
                await vscode.commands.executeCommand(PANTRY_SHOW);
                return;
            }
            await vscode.env.openExternal(vscode.Uri.parse(PANTRY_DOCS_URL));
        }),
        vscode.commands.registerCommand('pantryMatch.openPantryFile', () => controller.openPantryFile()),
        vscode.commands.registerCommand('pantryMatch.provideBadge', async (outletContext: unknown) =>
            await controller.isSupported() ? controller.badges.provide(outletContext) : undefined),
        vscode.extensions.onDidChange(() => {
            syncShoppingList().catch(error => log(`Pantry Match: ${messageOf(error)}`));
        }),
    );

    await syncShoppingList().catch(error => log(`Pantry Match: ${messageOf(error)}`));
    await controller.start().catch(error => log(`Pantry Match: start failed: ${messageOf(error)}`));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 3: Compile and run the suite**

Run: `cd pantry-match && npm test`
Expected: compiles with no errors; all specs PASS.

- [ ] **Step 4: Commit**

```bash
git add pantry-match/src/controller.ts pantry-match/src/extension.ts
git commit -m "feat(pantry-match): wire the view, watchers, badge and commands"
```

---

### Task 13: Plugin README

**Files:**
- Modify (replace stub): `pantry-match/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Pantry Match

What can I cook tonight without shopping? Pantry Match ranks the recipes in
your folder by how much of each is already in your pantry, and suggests
recipes for the things that expire soon. Free, and works signed out.
Install it from the Extensions view.

## What you see

A **What can I cook** view in the Explorer:

| Group | What's in it |
|---|---|
| **Cook now** | Recipes you have everything for. |
| **Missing 1–2** | Recipes missing one or two ingredients, fewest missing first. Expand a recipe to see what's missing. |
| **Use it up** | Each pantry item that expires within 5 days (or already has), with the recipes that use it, best match first. |
| **Couldn't read** | Recipes that couldn't be read (open them to fix the error). |

Each recipe shows how many ingredients you have, e.g. `9/11`. Click it to
open the preview. Right-click a recipe with missing ingredients and choose
**Add missing to shopping list** (needs the Shopping List plugin). The
whole recipe goes on the list, and the list leaves out what's in your
pantry, so only the missing items show.

Recipe previews also get a `Have 9/11` badge (green when you have
everything). Hover it to see what's missing.

## How matching works

- Your pantry is `config/pantry.conf`, the file the Pantry and Shopping List
  plugins use. No pantry yet? The view offers to set one up.
- An item counts as in stock unless its quantity is zero. Low stock still
  counts.
- Names match ignoring case, extra spaces, simple plurals (`tomatoes` =
  `tomato`) and anything after a comma (`garlic, minced` = `garlic`).
- Optional ingredients (`@?parsley{}`) never count as missing.
- Ingredients of linked recipes (`@./Sauces/Pesto{}`) count too, up to three
  levels deep.
- Quantities aren't compared: 100 g of a 500 g requirement counts as "have".

## Settings

| Setting | Default | |
|---|---|---|
| `pantryMatch.alwaysHave` | `salt`, `pepper`, `black pepper`, `water` | Never listed as missing and left out of the score. |
| `pantryMatch.expiringWithinDays` | `5` | How soon an item must expire to appear under **Use it up**. |
| `pantryMatch.showBadge` | `true` | The `Have 9/11` badge on recipe previews. |

## For plugin authors

This plugin shows:

- an Explorer tree view over the whole workspace (`src/tree.ts`,
  `src/view-model.ts`) with welcome views driven by a context key;
- a names-only report template rendered with `cooklang.api.renderReport`
  (no nutrition call, so it works signed out) and linked recipes expanded
  with `cooklang.api.resolveRecipeReferences` (`src/names-template.ts`,
  `src/references.ts`);
- reading `config/pantry.conf` with `cooklang.api.parsePantry`
  (`src/pantry-file.ts`);
- a `pill` badge on `cooklang/recipePreview/badge` (`src/badge.ts`);
- calling another plugin's command (`shoppingList.addRecipe`), hidden with
  a `when` clause when that plugin isn't installed.

Reference: https://cook.md/help/plugins/api
```

- [ ] **Step 2: Commit**

```bash
git add pantry-match/README.md
git commit -m "docs(pantry-match): README"
```

---

### Task 14: CI matrix and root README row

**Files:**
- Modify: `.github/workflows/ci.yml` (the `package:` matrix line)
- Modify: `README.md` (plugin table, after the `pantry` row)

Other plugin branches may also edit these lines. Re-read both files right before editing and keep any entries already there.

- [ ] **Step 1: Add the plugin to the CI matrix**

In `.github/workflows/ci.yml`, change

```yaml
        package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

to

```yaml
        package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, pantry-match, recipe-hub, shopping-list]
```

- [ ] **Step 2: Add the root README row**

In `README.md`, insert directly after the line that starts with ``| [`pantry`](./pantry) |``:

```markdown
| [`pantry-match`](./pantry-match) | "What can I cook?": ranks your recipes by what's in `config/pantry.conf` (Cook now, Missing 1–2, Use it up) and adds a `Have 9/11` badge to recipe previews. Free, works signed out. Install it from the Extensions view. Shows an Explorer tree view over the whole workspace, a names-only template rendered with `cooklang.api.renderReport`, and calling another plugin's command (`shoppingList.addRecipe`). |
```

- [ ] **Step 3: Verify that the CI steps pass locally**

Run: `cd pantry-match && rm -rf node_modules out && npm ci && npm run compile && npm test && npm run package`
Expected: every step exits 0, and `pantry-match-0.1.0.vsix` is created.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: run the pantry-match plugin in the matrix; list it in the README"
```

---

### Task 15: Packaging and deploy

**Files:** none changed (verification only; `*.vsix` is git-ignored).

- [ ] **Step 1: Check the package contents**

Run: `cd pantry-match && npm run package && unzip -l pantry-match-0.1.0.vsix`
Expected: the listing has `extension/package.json`, `extension/LICENSE.txt` (or `LICENSE`), `extension/README.md` and `extension/out/*.js` (`extension.js`, `controller.js`, `tree.js`, `badge.js`, `view-model.js`, `match.js`, `expiry.js`, `references.js`, `recipe-index.js`, `names-template.js`, `pantry-file.js`, `settings.js`, `markdown.js`, `cooklang-api.js`). It has no `src/`, no `*.spec.js`, no `*.map` and no `node_modules`.

- [ ] **Step 2: Deploy to the local editor checkout**

Run: `cd pantry-match && npm run deploy && ls ../../editor/plugins/cooklang.pantry-match`
Expected: `Deployed to …/editor/plugins/cooklang.pantry-match`, and the folder holds `package.json  out  LICENSE  README.md`, with no `*.spec.js` under `out/`.

---

### Task 16: Manual verification in Cook Editor

Start the editor with `cd ../editor && npm run start:electron` (after Task 15's deploy), with the Shopping List and Pantry plugins present. Use a scratch recipe folder. Fixtures use YAML frontmatter only, never `>>`.

Fixture folder:

`config/pantry.conf`:

```
[fridge]
eggs = { quantity = "6" }
spinach = { quantity = "200%g", expire = "<today + 2 days, YYYY-MM-DD>" }
cream = { quantity = "0%ml", expire = "<today + 1 day>" }

[pantry]
rice = { quantity = "1%kg" }
onions = { quantity = "3" }
basil = { quantity = "1", low = "2" }
pasta = { quantity = "500%g" }
```

`Fried rice.cook`:

```
---
servings: 2
---
Fry @onion{1} and @rice{200%g}, stir in @eggs{2} and @salt.
```

`Omelette.cook`:

```
---
servings: 1
---
Whisk @eggs{3} with @cheese{50%g}, add @?spinach{30%g}.
```

`Sauces/Pesto.cook`:

```
---
servings: 4
---
Blend @basil{1%bunch} with @pine nuts{30%g} and @parmesan{40%g}.
```

`Pasta.cook`:

```
---
servings: 2
---
Cook @pasta{200%g} and toss with @./Sauces/Pesto{}.
```

`Loop A.cook` (`@./Loop B{}`) and `Loop B.cook` (`@./Loop A{}`, plus `@rice{}`), to test the reference cycle.

- [ ] The Explorer shows **What can I cook** (collapsed). Expanding it shows "Reading your recipes…" briefly, then the groups.
- [ ] **Cook now** lists `Fried rice 3/3` (salt not counted). Expanding the group shows no children under Fried rice.
- [ ] **Missing 1–2** lists `Omelette 1/2` (missing `cheese`; optional spinach not missing) before `Pasta 2/4` (missing `pine nuts`, `parmesan`; basil from the linked pesto counts, and low stock counts as in stock).
- [ ] **Use it up** lists `spinach`, "expires in 2 days", with `Omelette` under it. `cream` (out of stock) isn't listed.
- [ ] `Loop A` and `Loop B` appear without hanging the view (the cycle is skipped).
- [ ] Clicking a recipe row opens the recipe preview.
- [ ] Right-clicking `Pasta` shows **Add missing to shopping list**. Running it opens the Shopping List with only pine nuts and parmesan (pasta and basil subtracted by the pantry). Right-clicking `Fried rice` doesn't show the action.
- [ ] With the Shopping List plugin removed from `editor/plugins` and the editor restarted, the action is hidden.
- [ ] The `Pasta` preview shows a grey `Have 2/4` pill whose hover lists `pine nuts, parmesan`. `Fried rice` shows a green `Have 3/3`.
- [ ] Adding `pine nuts = { quantity = "50%g" }` and `parmesan = { quantity = "100%g" }` to `pantry.conf` and saving moves `Pasta` to **Cook now** within a second and turns its badge green without re-opening the preview.
- [ ] Editing `Omelette.cook` (remove `@cheese`) and saving moves it to **Cook now**.
- [ ] Setting `pantryMatch.showBadge` to false removes the badge. Setting `pantryMatch.expiringWithinDays` to 1 removes `spinach` from **Use it up**. Adding `cheese` to `pantryMatch.alwaysHave` makes Omelette `1/1`.
- [ ] Breaking `pantry.conf` (e.g. `[fridge` on the first line) shows the parse error message and an **Open pantry.conf** button that opens the file. If the editor's parser accepts the text, note that instead.
- [ ] Deleting `config/pantry.conf` shows "Add a pantry to see what you can cook" with **Set up pantry**. With the Pantry plugin installed, the button opens the Pantry view ("Create pantry"). Without it, the button opens https://cook.md/help/plugins/pantry.
- [ ] A recipe with a syntax error the Reports engine rejects appears under a collapsed **Couldn't read** group. Clicking it opens the source file.
- [ ] **Refresh** in the view title rescans (watch the "Reading recipes…" message on a large folder).
- [ ] Signed out of cook.md, everything above still works.
- [ ] The Output panel's "Pantry Match" channel shows no unexpected errors.

---

## Self-review

| Spec section | Covered by |
|---|---|
| Goals: "cook tonight without shopping", "use up the spinach", leads into Shopping List, free/signed out | Tasks 5, 8, 9 (groups), 12 (`addMissingToShoppingList`), 4 (names-only template, no nutrition call), 16 (signed-out check) |
| Non-goals: presence only, no substitutions, no pantry writes, no outside recipes | Task 5 (presence only); no write paths anywhere; Task 12 lists only `**/*.cook` in the first workspace folder |
| Preferences `alwaysHave` / `expiringWithinDays` / `showBadge` | Task 1 (manifest), Task 2 (`readSettings`), Task 12 (config change reloads), Task 16 |
| Data: pantry `config/pantry.conf` via `workspace.fs` + `parsePantry`, in-stock unless `isOutOfStock`, `expireDate` | Task 3 (`loadPantry`), Task 5 (`pantryLookup`), Task 8, Task 12 (`readPantry`) |
| Data: every `.cook` via `findFiles`, `node_modules`/`.git` excluded, `Drafts/` included | Task 12 (`RECIPE_GLOB`, `EXCLUDE_GLOB`) |
| Data: names-only template, optional flag, refs | Task 4 (deviation 1: optional from leading `?`) |
| Data: refs expanded with `resolveRecipeReferences`, cycle-safe, depth 3 | Task 7 (deviation 2) |
| Data: cache per URI keyed by mtime, watcher on `**/*.cook` + `config/pantry.conf`, background index with progress, batches of 10 | Task 6 (`RecipeIndex`, `mapInBatches`), Task 12 (watchers, debounce, `TreeView.message` progress; deviations 4 and 5) |
| Matching: normalisation rules, covered rule, coverage with alwaysHave excluded both sides | Task 5 |
| UI: Explorer view, Cook now, Missing 1–2 sorted, Use it up per expiring item best coverage first | Tasks 1, 9, 10 |
| UI: recipe row title + `9/11`, expand for missing, click opens preview | Tasks 9, 10, 12 (`openPreview`) |
| UI: "Add missing to shopping list" via `shoppingList.addRecipe`, hidden when not registered | Task 1 (`when` clause), Task 12 (context key + command) |
| UI: view title Refresh | Task 1, Task 12 |
| UI: empty state for no pantry, button to Pantry plugin or docs | Task 1 (`viewsWelcome`), Task 12 (`setUpPantry`; deviation 3) |
| Badge: pill `Have 9/11`, `good` at 100 %, `neutral` otherwise, hover lists missing | Task 11, Task 12 (`provideBadge`, `refreshBadges` on pantry/config change) |
| Architecture: listed modules | File structure; extra modules per deviation 6 |
| Error handling: malformed pantry → message + "Open pantry.conf"; failed render → collapsed "Couldn't read" | Task 3, Task 1 (`pantryError` welcome), Task 12 (`treeView.message`, `openPantryFile`), Task 9 (`unreadable`), Task 10 (collapsed group) |
| Testing: normalisation/plurals, alwaysHave exclusion, optional, out-of-stock vs low, expiry grouping, reference cycle, ranking order | Task 5, Task 8, Task 7, Task 9 specs |
| Repo plumbing: CI matrix, root README, packaging, deploy | Tasks 14, 15 |

Type consistency check: `IngredientName`/`RecipeNames`/`RenderedNames` (Task 4) are used by Tasks 5, 6, 7, 9, 11, 12. `PantryItem`/`ResolvedRecipeReference`/`PillBadge`/`PreviewOutletContext` (Task 2) are used by Tasks 3, 5, 7, 8, 11, 12. `PantryLookup`/`RecipeMatch`/`coverage` (Task 5) are used by Tasks 9 and 11. `ExpiringItem` (Task 8) is used by Task 9. `TreeNode`/`ViewModel`/`EMPTY_MODEL`/`nodeId`/`childrenOf`/`recipeUriOf` (Task 9) are used by Tasks 10 and 12. `VIEW_ID`/`OPEN_RECIPE_COMMAND` (Task 10) are used by Task 12. Command ids in `package.json` (Task 1) match the registrations in Task 12: `pantryMatch.refresh`, `pantryMatch.openRecipe`, `pantryMatch.addMissingToShoppingList`, `pantryMatch.setUpPantry`, `pantryMatch.openPantryFile`, `pantryMatch.provideBadge`. The context keys `pantryMatch.state` and `pantryMatch.shoppingListAvailable` match the `when` clauses.

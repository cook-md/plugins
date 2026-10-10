# Cookbook Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free `cooklang.cookbook` plugin whose **Export as Cookbook (PDF)…** command (Explorer folder context menu + command palette) turns a folder of recipes into one printable PDF: cover from the root `README.md`, linked contents, one chapter per subfolder with its README as intro, recipes with photos, an optional per-serving nutrition line (Cook Basic / Pro), an ingredient index and a "Not included" appendix.

**Architecture:** The plugin never parses Cooklang. For each recipe it calls `cooklang.api.renderReport` with a constant Jinja template that returns the recipe as JSON (`tojson`), validates it, and builds escaped HTML in TypeScript. Photos come from `cooklang.api.recipeImages` and are inlined as `data:` URIs read with `workspace.fs`. Folder walking, ordering, Markdown, HTML assembly and the export flow are pure modules with mocha specs (the editor API is faked); `extension.ts` only adapts `vscode`. The finished HTML goes to `cooklang.api.exportPdf`, which renders it in the editor's hidden window, shows the save dialog and writes the PDF. Both new commands are feature-detected, so everything here builds and tests before the editor ships them.

**Tech Stack:** TypeScript 7 (`typescript ~7.0.2`, same as the other plugins), VS Code extension API 1.100 via Theia, minijinja 2 templates rendered by the editor's Reports engine (cooklang-reports 0.5.2), mocha 12 + node `assert`, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-10-cookbook-plugin-design.md` (plugin) and `~/Cooklang/editor/docs/superpowers/specs/2026-10-10-cookbook-plugin-api-design.md` (the two editor commands; separate plan).

**Depends on (only for Task 17, the manual check):** an editor build with `cooklang.api.exportPdf` (including the optional `pageSize`) and `cooklang.api.recipeImages`.

---

## Deviations from spec

Each of these follows the real code; the reasons were checked against the sources named.

1. **No `optional` field from the engine; modifiers come through as name prefixes.** The editor renders reports with `cooklang-reports` 0.5.2 (`editor/packages/cooklang-native/Cargo.toml`), whose `Ingredient` object exposes only `name`, `note`, `alias`, `quantity`, `reference`, `reference_path` (`cooklang-reports/src/model/ingredient.rs`), and parses with `CooklangParser::canonical()` (no extensions). Rendering the template against that crate shows `@?salt{}` arriving as the name `"?salt"`, `@-pepper` as `"-pepper"`, `@&onion` as `"&onion"`, and the step text as `"Add ?salt and -pepper and &onion."`. `parseRecipeOutput` therefore sets `optional` from a leading `?`, drops `-` (hidden) and `&` (reused) entries from the ingredient list, and removes the prefixes from step text.
2. **Steps are told apart from text blocks by their number prefix.** A section's items are `Content` objects with `ObjectRepr::Plain` (`model/content.rs`): they only render as text, and `tojson` on them gives that string (minijinja `Value` serialises `Plain` objects with `to_string()`). A step renders as `"N. text"` with ingredients, cookware and timers already flattened to plain text including quantities (`"Chop 1 onion and 2 cloves garlic."`); a text block renders bare. Step numbers start at 1 in each section and skip text blocks (cooklang `model.rs`), so the template keeps a per-section counter and tests `text is startingwith(prefix)`. Verified by rendering `RECIPE_TEMPLATE` with cooklang-reports 0.5.2. A text block that itself starts with the next step's `"N. "` would show as a step (harmless).
3. **`recipeImages` step keys are zero-based, with a fallback.** The API spec says "inner key = step number"; the shape the editor's preview uses (`editor/packages/cooklang/src/common/recipe-images.ts`, `lookupStepImage`) is section index → step index, both zero-based, counting steps only, with section `"0"` also holding the linear `Recipe.N.jpg` form keyed by the global step index. `images.ts` copies that lookup exactly.
4. **The plugin always sends `pageSize`.** `ReportExportServiceImpl.exportPdf` calls `printToPDF({ printBackground: true })`, and Electron's default page is Letter and it ignores CSS `@page size` unless `preferCSSPageSize` is set. A4 (the spec's default) therefore needs the API spec's optional `pageSize: 'A4' | 'Letter'`, which the editor plan must implement (and the argument validation must accept). The CSS also sets `@page { size }` so a browser preview matches.
5. **`exportPdf` result path.** The service returns `filePath`; the API spec names it `path`. The wrapper accepts either.
6. **`defaultFileName`.** The plugin sends `<Book title>.pdf` with `\ / : * ? " < > |` and control characters replaced, at most 200 characters (the API's validation rules). Today's `saveBuffer` appends `.pdf` again; the editor plan must not double it (the API spec says ".pdf appended when missing").
7. **Image budget.** Besides the 10 MB per-image cap, inlined images stop at 80 M data-URI characters in total (the editor rejects HTML over 100 M characters); skipped photos are counted and reported in a warning after export. Only `jpg`, `jpeg`, `png` and `webp` are inlined (the preview's list). README images must resolve inside the exported folder.
8. **Nutrition is switched off for the rest of the book** after the first `unauthenticated` / `forbidden` result, instead of failing once per recipe.
9. **Extra modules.** `frontmatter.ts` (README frontmatter, shared by `book-tree.ts` and `markdown.ts`), `ingredient-index.ts` and `settings.ts` are split out of the spec's module list so each has one job and its own spec.
10. **Command palette** offers folders of the first workspace folder only (Cook Editor opens one folder).
11. **Task order.** `images.ts` is built before `recipe-html.ts` because the recipe HTML uses its `lookupStepImage`.

## Conventions for every task

- Repo: `/Users/alexeydubovskoy/Cooklang/plugins`. Before Task 1, create a worktree on a new branch `feature/cookbook-plugin` from `main` (superpowers:using-git-worktrees); other work happens in this repo concurrently, so never switch the main checkout's branch. All paths below are relative to the repo root; the plugin folder is `cookbook/`.
- Node 22 is required (mocha 12 fails on Node 20.11 with `ERR_REQUIRE_ESM`). Check with `node --version`.
- Tests: `cd cookbook && npm test` compiles with `tsc -p .` and runs `mocha "out/**/*.spec.js"`. A spec importing a module that does not exist yet fails at compile time with `error TS2307: Cannot find module './<name>' or its corresponding type declarations.` — that is the expected red for every task.
- Specs use `import * as assert from 'assert'` and `describe` / `it`, like `corevitals/src/servings.spec.ts`.
- Style: 4 spaces, single quotes, `undefined` not `null`, explicit return types on exported functions, no `vscode` import outside `src/extension.ts`.
- Commits: conventional commits scoped `cookbook`, e.g. `feat(cookbook): …`.
- Cooklang fixtures use YAML frontmatter, never the deprecated `>>` metadata syntax.

## File structure (`cookbook/`)

| File | Responsibility |
|---|---|
| `package.json` | Manifest: `cookbook.export` command, Explorer folder menu, palette entry, `cookbook.exclude` / `cookbook.nutrition` / `cookbook.pageSize` settings, scripts |
| `tsconfig.json` | Same compiler options as `corevitals/` |
| `.vscodeignore` | Keeps sources, specs, maps and `test-fixtures/` out of the `.vsix` |
| `LICENSE` | MIT, copied from `corevitals/` |
| `scripts/deploy.js` | Copies the built plugin to `../../editor/plugins/cooklang.cookbook` |
| `README.md` | User and plugin-author docs |
| `src/cooklang-api.ts` | Typed wrapper over `cooklang.api.*`: missing-command detection, `hasFeature`, `renderReport`, `recipeImages` (validated), `exportPdf` (normalised) |
| `src/frontmatter.ts` | README frontmatter (`title`, `order`) and first `#` heading |
| `src/book-tree.ts` | Paths → book tree: chapters, ordering, prefix stripping, depth ≤ 3, excludes, README image path resolution |
| `src/markdown.ts` | Dependency-free Markdown → escaped HTML for READMEs |
| `src/recipe-template.ts` | The per-recipe Jinja template and validation of its JSON output |
| `src/images.ts` | Image MIME types, data URIs, step-image lookup, `ImageInliner` (size cap, budget, cache) |
| `src/recipe-html.ts` | One recipe's `<article>` from validated data, everything escaped |
| `src/nutrition-line.ts` | Nutrition template, aggregate parsing, servings, the "Per serving" line |
| `src/ingredient-index.ts` | Ingredient name normalisation and the index entries |
| `src/book-html.ts` | Ids, README intros, print CSS, the whole book document |
| `src/settings.ts` | Normalised `cookbook.*` settings |
| `src/export-command.ts` | The export flow with injected workspace/UI: feature check, limits, progress, concurrency 4, cancellation, "Not included", toasts |
| `src/extension.ts` | `vscode` adapters, command registration, folder pick |
| `src/*.spec.ts` | One mocha spec per module |
| `test-fixtures/family-book/**` | A small recipe folder plus the engine's real JSON output per recipe |
| `test-fixtures/family-book.snapshot.html` | The reviewed book HTML snapshot |

Repo root: `.github/workflows/ci.yml` (matrix) and `README.md` (plugin table row).

---

### Task 1: Scaffold the plugin

**Files:**
- Create: `cookbook/package.json`, `cookbook/tsconfig.json`, `cookbook/.vscodeignore`, `cookbook/LICENSE`, `cookbook/scripts/deploy.js`, `cookbook/README.md` (placeholder heading, replaced in Task 14), `cookbook/src/extension.ts` (empty activation, replaced in Task 13)

- [ ] **Step 1: Folder, license, tsconfig, deploy script**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
mkdir -p cookbook/src cookbook/scripts cookbook/test-fixtures
cp corevitals/LICENSE cookbook/LICENSE
cp corevitals/tsconfig.json cookbook/tsconfig.json
sed "s/cooklang\.corevitals/cooklang.cookbook/; s/const required = \['package.json', 'out', 'media', 'LICENSE'\];/const required = ['package.json', 'out', 'LICENSE'];/" corevitals/scripts/deploy.js > cookbook/scripts/deploy.js
grep -n "cooklang.cookbook\|const required" cookbook/scripts/deploy.js
```

Expected:
```
9:const target = path.join(editor, 'plugins/cooklang.cookbook');
14:const required = ['package.json', 'out', 'LICENSE'];
```

- [ ] **Step 2: Manifest**

Create `cookbook/package.json`:

```json
{
  "name": "cookbook",
  "displayName": "Cookbook",
  "description": "Turns a folder of recipes into a printable PDF cookbook: cover, contents, a chapter per subfolder, photos and an ingredient index.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "cookbook" },
  "keywords": ["cooklang", "cookbook", "pdf", "print", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onCommand:cookbook.export"],
  "contributes": {
    "commands": [
      { "command": "cookbook.export", "title": "Export as Cookbook (PDF)…", "category": "Cookbook" }
    ],
    "menus": {
      "explorer/context": [
        { "command": "cookbook.export", "when": "explorerResourceIsFolder", "group": "navigation@95" }
      ]
    },
    "configuration": {
      "title": "Cookbook",
      "properties": {
        "cookbook.exclude": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["Drafts", "config"],
          "order": 1,
          "description": "Folders left out of the book: a name matches a folder of that name at any depth, a path with a slash (e.g. Mains/Old) matches that folder. Dot-folders and node_modules are always skipped."
        },
        "cookbook.nutrition": {
          "type": "boolean",
          "default": true,
          "order": 2,
          "description": "Print a per-serving nutrition line under each recipe. Needs a Cook Basic or Pro plan; left out otherwise."
        },
        "cookbook.pageSize": {
          "type": "string",
          "enum": ["A4", "Letter"],
          "default": "A4",
          "order": 3,
          "description": "Paper size of the PDF."
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
    "publish:marketplace": "ovsx publish --packagePath cookbook-$npm_package_version.vsix -r https://plugins.cook.md"
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

The command has no `when` in `commandPalette`, so it is always in the palette; the Explorer entry shows only on folders (`explorerResourceIsFolder`).

- [ ] **Step 3: `.vscodeignore`, placeholder README, empty activation**

Create `cookbook/.vscodeignore`:

```
src/**
scripts/**
test-fixtures/**
tsconfig.json
package-lock.json
.vscodeignore
out/**/*.spec.js
out/**/*.map
**/.DS_Store
```

Create `cookbook/README.md`:

```markdown
# Cookbook
```

Create `cookbook/src/extension.ts`:

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand('cookbook.export', () => undefined));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 4: Install and compile**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm install && npm run compile && ls out
```

Expected: `npm install` writes `package-lock.json`; compile prints nothing; `ls out` shows `extension.js  extension.js.map`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/package.json cookbook/package-lock.json cookbook/tsconfig.json cookbook/.vscodeignore cookbook/LICENSE cookbook/scripts/deploy.js cookbook/README.md cookbook/src/extension.ts
git commit -m "feat(cookbook): scaffold the Cookbook plugin"
```

---

### Task 2: Cooklang API wrapper

**Files:**
- Create: `cookbook/src/cooklang-api.ts`
- Test: `cookbook/src/cooklang-api.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/cooklang-api.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, REQUIRED_COMMANDS, parseRecipeImages } from './cooklang-api';

function recorder(result: unknown, commands: readonly string[] = REQUIRED_COMMANDS): { api: CooklangApi; calls: Array<{ command: string; args: unknown[] }> } {
    const calls: Array<{ command: string; args: unknown[] }> = [];
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        return result;
    }, async () => commands);
    return { api, calls };
}

describe('CooklangApi', () => {
    it('lists the required commands the editor lacks', async () => {
        assert.deepStrictEqual(await recorder(undefined).api.missingCommands(), []);
        assert.deepStrictEqual(await recorder(undefined, ['cooklang.api.renderReport', 'cooklang.api.hasFeature']).api.missingCommands(),
            ['cooklang.api.exportPdf', 'cooklang.api.recipeImages']);
    });

    it('renders a report at scale 1 and passes results through', async () => {
        const { api, calls } = recorder({ ok: true, output: '{}' });
        assert.deepStrictEqual(await api.renderReport({ uri: 'file:///b/a.cook', template: '{{ 1 }}' }), { ok: true, output: '{}' });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.renderReport', args: [{ uri: 'file:///b/a.cook', template: '{{ 1 }}', scale: 1 }] }]);
    });

    it('normalises render failures and unexpected payloads', async () => {
        assert.deepStrictEqual(await recorder({ ok: false, reason: 'forbidden', message: 'Subscription required' }).api.renderReport({ uri: 'u', template: 't' }),
            { ok: false, reason: 'forbidden', message: 'Subscription required' });
        assert.deepStrictEqual(await recorder({ ok: false, reason: 'weird' }).api.renderReport({ uri: 'u', template: 't' }),
            { ok: false, reason: 'template', message: 'The report engine failed.' });
        assert.strictEqual((await recorder('nope').api.renderReport({ uri: 'u', template: 't' })).ok, false);
    });

    it('treats hasFeature errors and non-true results as false', async () => {
        assert.strictEqual(await recorder(true).api.hasFeature('nutrition_api'), true);
        assert.strictEqual(await recorder('yes').api.hasFeature('nutrition_api'), false);
        const throwing = new CooklangApi(async () => { throw new Error('offline'); }, async () => []);
        assert.strictEqual(await throwing.hasFeature('nutrition_api'), false);
    });

    it('calls exportPdf with one argument and accepts path or filePath', async () => {
        const { api, calls } = recorder({ saved: true, filePath: '/tmp/Book.pdf' });
        const args = { html: '<p>x</p>', defaultFileName: 'Book.pdf', pageSize: 'A4' as const };
        assert.deepStrictEqual(await api.exportPdf(args), { saved: true, path: '/tmp/Book.pdf' });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.exportPdf', args: [args] }]);
        assert.deepStrictEqual(await recorder({ saved: false }).api.exportPdf(args), { saved: false });
        assert.deepStrictEqual(await recorder({ saved: false, error: 'disk full' }).api.exportPdf(args), { saved: false, error: 'disk full' });
        assert.strictEqual((await recorder(undefined).api.exportPdf(args)).saved, false);
    });

    it('asks for recipe images by uri', async () => {
        const { api, calls } = recorder({ title: 'file:///b/a.jpg', steps: { 0: { 1: 'file:///b/a.1.jpg' } } });
        assert.deepStrictEqual(await api.recipeImages('file:///b/a.cook'), { title: 'file:///b/a.jpg', steps: { 0: { 1: 'file:///b/a.1.jpg' } } });
        assert.deepStrictEqual(calls, [{ command: 'cooklang.api.recipeImages', args: [{ uri: 'file:///b/a.cook' }] }]);
    });
});

describe('parseRecipeImages', () => {
    it('drops malformed entries', () => {
        assert.deepStrictEqual(parseRecipeImages({ title: '  ', steps: { a: { 0: 'x' }, 1: { b: 'y', 2: 3, 3: 'file:///s.jpg' }, 2: 'z' } }),
            { steps: { 1: { 3: 'file:///s.jpg' } } });
        assert.deepStrictEqual(parseRecipeImages(null), { steps: {} });
        assert.deepStrictEqual(parseRecipeImages([1]), { steps: {} });
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `src/cooklang-api.spec.ts(2,...): error TS2307: Cannot find module './cooklang-api' or its corresponding type declarations.`

- [ ] **Step 3: Implement**

Create `cookbook/src/cooklang-api.ts`:

```ts
// Typed wrapper over Cook Editor's `cooklang.api.*` commands (API version 1).
// Types mirror the editor's `packages/cooklang/src/common/plugin-report-types.ts`
// and `common/recipe-images.ts`. Free of the `vscode` import so it can be
// unit-tested; extension.ts passes `vscode.commands.executeCommand` and
// `vscode.commands.getCommands`.

/**
 * Every command the cookbook export needs. `exportPdf` and `recipeImages` were
 * added after `renderReport`; the editor feature-detects by command presence
 * (`cooklang.api.version` stays 1), so this plugin does too.
 */
export const REQUIRED_COMMANDS = [
    'cooklang.api.renderReport',
    'cooklang.api.hasFeature',
    'cooklang.api.exportPdf',
    'cooklang.api.recipeImages',
] as const;

export type PageSize = 'A4' | 'Letter';

export type PluginReportFailureReason = 'unauthenticated' | 'forbidden' | 'network' | 'server' | 'template';

export type PluginReportResult =
    | { ok: true; output: string }
    | { ok: false; reason: PluginReportFailureReason; message: string };

/**
 * Photos for one recipe: absolute URIs (or verbatim `http(s)` URLs from metadata).
 * `steps` is section index → step index → URI, both zero-based and counting only
 * steps (not text blocks), with section `0` also holding the linear `Recipe.N.jpg`
 * form; see {@link lookupStepImage} in `images.ts`.
 */
export interface RecipeImages {
    title?: string;
    steps: Record<string, Record<string, string>>;
}

export interface ExportPdfArgs {
    html: string;
    defaultFileName: string;
    pageSize: PageSize;
}

export interface ExportPdfResult {
    saved: boolean;
    path?: string;
    error?: string;
}

export type ExecuteCommand = (command: string, ...args: unknown[]) => Promise<unknown>;
export type ListCommands = () => Promise<readonly string[]>;

const FAILURE_REASONS: readonly PluginReportFailureReason[] = ['unauthenticated', 'forbidden', 'network', 'server', 'template'];

export class CooklangApi {

    constructor(protected readonly execute: ExecuteCommand, protected readonly listCommands: ListCommands) { }

    /** The required commands this editor lacks; empty when the cookbook export can run. */
    async missingCommands(): Promise<string[]> {
        const available = new Set(await this.listCommands());
        return REQUIRED_COMMANDS.filter(command => !available.has(command));
    }

    /** False on any error: signed out, offline, or an editor without the command. */
    async hasFeature(name: string): Promise<boolean> {
        try {
            return await this.execute('cooklang.api.hasFeature', { name }) === true;
        } catch {
            return false;
        }
    }

    /** Throws `Invalid arguments: …` like the editor does; render failures resolve to `ok: false`. */
    async renderReport(args: { uri: string; template: string }): Promise<PluginReportResult> {
        const result = await this.execute('cooklang.api.renderReport', { uri: args.uri, template: args.template, scale: 1 });
        if (isRecord(result) && result.ok === true && typeof result.output === 'string') {
            return { ok: true, output: result.output };
        }
        if (isRecord(result) && result.ok === false) {
            const reason = FAILURE_REASONS.find(candidate => candidate === result.reason) ?? 'template';
            const message = typeof result.message === 'string' && result.message !== '' ? result.message : 'The report engine failed.';
            return { ok: false, reason, message };
        }
        return { ok: false, reason: 'template', message: 'Unexpected response from cooklang.api.renderReport.' };
    }

    /** Malformed entries are dropped, so a bad payload means "no photos", never a crash. */
    async recipeImages(uri: string): Promise<RecipeImages> {
        return parseRecipeImages(await this.execute('cooklang.api.recipeImages', { uri }));
    }

    /**
     * The editor renders `html` in a hidden window, shows the save dialog and writes the PDF.
     * `filePath` is accepted as an alias of `path` (the name `ReportExportService` uses).
     */
    async exportPdf(args: ExportPdfArgs): Promise<ExportPdfResult> {
        const result = await this.execute('cooklang.api.exportPdf', args);
        if (!isRecord(result)) {
            return { saved: false, error: 'Unexpected response from cooklang.api.exportPdf.' };
        }
        const path = typeof result.path === 'string' ? result.path : typeof result.filePath === 'string' ? result.filePath : undefined;
        const error = typeof result.error === 'string' && result.error !== '' ? result.error : undefined;
        return { saved: result.saved === true, ...(path !== undefined ? { path } : {}), ...(error !== undefined ? { error } : {}) };
    }
}

export function parseRecipeImages(value: unknown): RecipeImages {
    const images: RecipeImages = { steps: {} };
    if (!isRecord(value)) {
        return images;
    }
    if (typeof value.title === 'string' && value.title.trim() !== '') {
        images.title = value.title;
    }
    if (isRecord(value.steps)) {
        for (const [section, steps] of Object.entries(value.steps)) {
            if (!/^\d+$/.test(section) || !isRecord(steps)) {
                continue;
            }
            for (const [step, uri] of Object.entries(steps)) {
                if (/^\d+$/.test(step) && typeof uri === 'string' && uri.trim() !== '') {
                    (images.steps[section] ??= {})[step] = uri;
                }
            }
        }
    }
    return images;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `7 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/cooklang-api.ts cookbook/src/cooklang-api.spec.ts
git commit -m "feat(cookbook): typed wrapper over the cooklang.api commands, feature-detecting exportPdf and recipeImages"
```

---

### Task 3: Book tree (folders → chapters)

**Files:**
- Create: `cookbook/src/frontmatter.ts`, `cookbook/src/book-tree.ts`
- Test: `cookbook/src/frontmatter.spec.ts`, `cookbook/src/book-tree.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `cookbook/src/frontmatter.spec.ts`:

```ts
import * as assert from 'assert';
import { firstHeading, parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
    it('reads title and order and returns the body', () => {
        assert.deepStrictEqual(parseFrontmatter('---\ntitle: "Soups & Stews"\norder: 2\n---\nHot bowls.\n'),
            { title: 'Soups & Stews', order: 2, body: 'Hot bowls.\n' });
        assert.deepStrictEqual(parseFrontmatter('﻿---\r\nTitle: Breakfast\r\norder: -1.5\r\n---\r\nEggs.'),
            { title: 'Breakfast', order: -1.5, body: 'Eggs.' });
    });

    it('ignores a non-numeric order and an empty title', () => {
        assert.deepStrictEqual(parseFrontmatter("---\ntitle: ''\norder: first\n---\nx"), { body: 'x' });
    });

    it('treats text without a closed block as body', () => {
        assert.deepStrictEqual(parseFrontmatter('# Hello\n'), { body: '# Hello\n' });
        assert.deepStrictEqual(parseFrontmatter('---\ntitle: x\n'), { body: '---\ntitle: x\n' });
    });
});

describe('firstHeading', () => {
    it('finds the first level-1 heading only', () => {
        assert.strictEqual(firstHeading('intro\n## Not this\n# Family Cookbook #\n# Second'), 'Family Cookbook');
        assert.strictEqual(firstHeading('## Only h2\n#hashtag'), undefined);
    });
});
```

Create `cookbook/src/book-tree.spec.ts`:

```ts
import * as assert from 'assert';
import {
    BookTree, buildBookTree, chaptersInOrder, compareNames, isExcluded, readmePaths, recipesInOrder,
    resolveRelativeImage, stripNumericPrefix,
} from './book-tree';

function tree(paths: string[], readmes: Record<string, string> = {}, exclude: string[] = ['Drafts', 'config']): BookTree {
    return buildBookTree({ rootName: 'Recipes', paths, readmes: new Map(Object.entries(readmes)), exclude });
}

describe('compareNames', () => {
    it('sorts case-insensitively and numeric-aware', () => {
        assert.deepStrictEqual(['10 Mains', 'apple', '2 Soups', 'Banana'].sort(compareNames), ['2 Soups', '10 Mains', 'apple', 'Banana']);
    });
});

describe('stripNumericPrefix', () => {
    it('strips NN- and NN prefixes only', () => {
        assert.strictEqual(stripNumericPrefix('01-Pancakes'), 'Pancakes');
        assert.strictEqual(stripNumericPrefix('2 Soups'), 'Soups');
        assert.strictEqual(stripNumericPrefix('03 - Mains'), 'Mains');
        assert.strictEqual(stripNumericPrefix('7up Cake'), '7up Cake');
        assert.strictEqual(stripNumericPrefix('42'), '42');
    });
});

describe('isExcluded', () => {
    it('skips dot-folders, node_modules and excluded folder names at any depth', () => {
        assert.strictEqual(isExcluded('.git/a.cook', []), true);
        assert.strictEqual(isExcluded('x/node_modules/a.cook', []), true);
        assert.strictEqual(isExcluded('.hidden.cook', []), true);
        assert.strictEqual(isExcluded('Mains/drafts/a.cook', ['Drafts']), true);
        assert.strictEqual(isExcluded('config/a.cook', ['config']), true);
        assert.strictEqual(isExcluded('Mains/a.cook', ['Drafts']), false);
        assert.strictEqual(isExcluded('Drafts.cook', ['Drafts']), false);
    });

    it('matches an exclude entry with a slash as a folder path prefix', () => {
        assert.strictEqual(isExcluded('Mains/old/a.cook', ['mains/old']), true);
        assert.strictEqual(isExcluded('Other/Mains/old/a.cook', ['Mains/old']), false);
    });
});

describe('readmePaths', () => {
    it('lists non-excluded READMEs in either spelling', () => {
        assert.deepStrictEqual(readmePaths(['README.md', 'Soups/readme.markdown', 'Drafts/README.md', 'Soups/notes.md', 'a.cook'], ['Drafts']),
            ['README.md', 'Soups/readme.markdown']);
    });
});

describe('buildBookTree', () => {
    it('puts root recipes first and orders chapters numerically with prefixes stripped', () => {
        const book = tree(['Toast.cook', '10 Mains/Pasta.cook', '2 Soups/Tomato.cook', '2 Soups/01-Leek.cook']);
        assert.strictEqual(book.title, 'Recipes');
        assert.deepStrictEqual(book.recipes, [{ path: 'Toast.cook', title: 'Toast' }]);
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.title), ['Soups', 'Mains']);
        assert.deepStrictEqual(book.chapters[0].recipes, [
            { path: '2 Soups/01-Leek.cook', title: 'Leek' },
            { path: '2 Soups/Tomato.cook', title: 'Tomato' },
        ]);
    });

    it('drops folders without recipes and skips excluded folders', () => {
        const book = tree(['Empty/README.md', 'Drafts/Idea.cook', 'config/x.cook', 'Mains/a.cook'], { 'Empty/README.md': '# Empty' });
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.path), ['Mains']);
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path), ['Mains/a.cook']);
    });

    it('applies README frontmatter title and order; unordered chapters follow ordered ones', () => {
        const book = tree(['A/x.cook', 'B/x.cook', 'C/x.cook', 'D/x.cook', 'C/README.md', 'D/README.md'], {
            'C/README.md': '---\norder: 1\n---\n',
            'D/README.md': '---\ntitle: Desserts\norder: 0\n---\nSweet things.',
        });
        assert.deepStrictEqual(book.chapters.map(chapter => chapter.title), ['Desserts', 'C', 'A', 'B']);
        assert.strictEqual(book.chapters[0].readme, 'D/README.md');
    });

    it('takes the cover title from frontmatter, then the first # heading, then the folder', () => {
        assert.strictEqual(tree(['a.cook', 'README.md'], { 'README.md': '---\ntitle: Family Book\n---\n# Ignored' }).title, 'Family Book');
        const fromHeading = tree(['a.cook', 'README.md'], { 'README.md': 'Intro\n\n# Our Kitchen\n' });
        assert.strictEqual(fromHeading.title, 'Our Kitchen');
        assert.strictEqual(fromHeading.titleFromHeading, true);
        assert.strictEqual(fromHeading.readme, 'README.md');
        assert.strictEqual(tree(['a.cook']).titleFromHeading, false);
        assert.strictEqual(buildBookTree({ rootName: '01 Recipes', paths: ['a.cook'], readmes: new Map(), exclude: [] }).title, 'Recipes');
    });

    it('nests chapters up to depth 3 and flattens deeper folders into the depth-3 chapter', () => {
        const book = tree(['A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook', 'A/B/C/a2.cook', 'A/a.cook']);
        const [a] = book.chapters;
        assert.strictEqual(a.depth, 1);
        const [b] = a.chapters;
        assert.strictEqual(b.depth, 2);
        const [c] = b.chapters;
        assert.strictEqual(c.depth, 3);
        assert.deepStrictEqual(c.chapters, []);
        assert.deepStrictEqual(c.recipes.map(recipe => recipe.path), ['A/B/C/a2.cook', 'A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook']);
        assert.deepStrictEqual(chaptersInOrder(book).map(chapter => chapter.path), ['A', 'A/B', 'A/B/C']);
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path),
            ['A/a.cook', 'A/B/C/a2.cook', 'A/B/C/c.cook', 'A/B/C/D/d.cook', 'A/B/C/D/E/e.cook']);
    });

    it('prefers README.md over readme.markdown and ignores menus and other files', () => {
        const book = tree(['S/readme.markdown', 'S/README.md', 'S/a.cook', 'S/week.menu', 'S/photo.jpg']);
        assert.strictEqual(book.chapters[0].readme, 'S/README.md');
        assert.deepStrictEqual(recipesInOrder(book).map(recipe => recipe.path), ['S/a.cook']);
    });

    it('returns an empty book for a folder without recipes', () => {
        const book = tree(['README.md', 'notes/x.md']);
        assert.deepStrictEqual(recipesInOrder(book), []);
        assert.deepStrictEqual(book.chapters, []);
    });
});

describe('resolveRelativeImage', () => {
    it('resolves against the README folder and stays inside the book', () => {
        assert.strictEqual(resolveRelativeImage('Soups/README.md', 'img/bowl.jpg'), 'Soups/img/bowl.jpg');
        assert.strictEqual(resolveRelativeImage('Soups/README.md', '../cover%20photo.jpg'), 'cover photo.jpg');
        assert.strictEqual(resolveRelativeImage('README.md', './a.png?x=1'), 'a.png');
        assert.strictEqual(resolveRelativeImage('README.md', '../outside.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', '/etc/a.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', 'https://x.org/a.png'), undefined);
        assert.strictEqual(resolveRelativeImage('README.md', 'data:image/png;base64,AA'), undefined);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './frontmatter' …` and `… './book-tree' …`.

- [ ] **Step 3: Implement the frontmatter reader**

Create `cookbook/src/frontmatter.ts`:

```ts
/** A README split into its YAML frontmatter fields this plugin reads and the Markdown body. */
export interface Frontmatter {
    title?: string;
    order?: number;
    body: string;
}

/**
 * Reads `title:` and `order:` from a leading `---` … `---` block. Only those two
 * top-level keys are read, line by line (no YAML library); quotes around the title
 * are removed. An unclosed block is not frontmatter: the whole text is the body.
 */
export function parseFrontmatter(text: string): Frontmatter {
    const source = text.replace(/^﻿/, '');
    const lines = source.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return { body: source };
    }
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) {
        return { body: source };
    }
    const result: Frontmatter = { body: lines.slice(end + 1).join('\n') };
    for (const line of lines.slice(1, end)) {
        const title = /^title\s*:\s*(.*)$/i.exec(line);
        if (title && result.title === undefined) {
            const value = title[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim();
            if (value !== '') {
                result.title = value;
            }
        }
        const order = /^order\s*:\s*["']?(-?\d+(?:\.\d+)?)["']?\s*$/i.exec(line);
        if (order && result.order === undefined) {
            result.order = Number.parseFloat(order[1]);
        }
    }
    return result;
}

/** The text of the first level-1 ATX heading (`# Title`) in a Markdown body. */
export function firstHeading(body: string): string | undefined {
    for (const line of body.split(/\r?\n/)) {
        const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}
```

- [ ] **Step 4: Implement the tree**

Create `cookbook/src/book-tree.ts`:

```ts
import { firstHeading, parseFrontmatter } from './frontmatter';

/** Chapters nest at most this deep; recipes in deeper folders join their depth-3 ancestor. */
export const MAX_CHAPTER_DEPTH = 3;

export interface RecipeEntry {
    /** Relative to the book folder, `/`-separated. */
    path: string;
    /** File name without `.cook` and without a leading number prefix; the recipe's `title` metadata wins later. */
    title: string;
}

export interface Chapter {
    /** Folder path relative to the book folder. */
    path: string;
    title: string;
    /** 1 for a folder directly in the book, up to {@link MAX_CHAPTER_DEPTH}. */
    depth: number;
    /** README path relative to the book folder, when the folder has one. */
    readme?: string;
    recipes: RecipeEntry[];
    chapters: Chapter[];
}

export interface BookTree {
    title: string;
    /** The root README, which becomes the cover text. */
    readme?: string;
    /** True when the cover title is the README's first `#` heading (the cover drops that heading from the body). */
    titleFromHeading: boolean;
    /** Recipes directly in the book folder, before the first chapter. */
    recipes: RecipeEntry[];
    chapters: Chapter[];
}

export interface BookTreeInput {
    /** Display name of the book folder (its last path segment). */
    rootName: string;
    /** Files under the book folder, relative to it; anything other than `.cook` and READMEs is ignored. */
    paths: readonly string[];
    /** README path → text, for the READMEs listed by {@link readmePaths}. */
    readmes: ReadonlyMap<string, string>;
    /** Folder names (any depth) or folder paths (`Drafts/old`) to skip, case-insensitive. */
    exclude: readonly string[];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Case-insensitive and numeric-aware (`2 Soups` before `10 Mains`), with a stable tie-break. */
export function compareNames(a: string, b: string): number {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** `01-Pancakes` → `Pancakes`, `2 Soups` → `Soups`; a name that is only a number is kept. */
export function stripNumericPrefix(name: string): string {
    const stripped = name.replace(/^\d+(?:\s*-\s*|\s+)/, '').trim();
    return stripped === '' ? name : stripped;
}

export function isReadme(fileName: string): boolean {
    return /^readme\.(md|markdown)$/i.test(fileName);
}

export function isRecipe(fileName: string): boolean {
    return /\.cook$/i.test(fileName) && !fileName.startsWith('.');
}

function normalisePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** Dot-folders, `node_modules` and the `exclude` entries are skipped wherever they appear. */
export function isExcluded(path: string, exclude: readonly string[]): boolean {
    const segments = normalisePath(path).split('/');
    const folders = segments.slice(0, -1).map(segment => segment.toLowerCase());
    if (segments[segments.length - 1].startsWith('.') || folders.some(folder => folder.startsWith('.') || folder === 'node_modules')) {
        return true;
    }
    const folderPath = folders.join('/');
    return exclude.some(entry => {
        const name = entry.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
        if (name === '') {
            return false;
        }
        return name.includes('/') ? folderPath === name || folderPath.startsWith(`${name}/`) : folders.includes(name);
    });
}

/** The READMEs the tree may use; read them and pass them back as {@link BookTreeInput.readmes}. */
export function readmePaths(paths: readonly string[], exclude: readonly string[]): string[] {
    return paths.map(normalisePath)
        .filter(path => isReadme(path.split('/').pop() ?? '') && !isExcluded(path, exclude))
        .sort(compareNames);
}

interface Folder {
    path: string;
    name: string;
    recipes: string[];
    folders: Map<string, Folder>;
    readme?: string;
    hasRecipes: boolean;
}

function folderAt(root: Folder, segments: readonly string[]): Folder {
    let folder = root;
    for (const segment of segments) {
        let child = folder.folders.get(segment);
        if (!child) {
            child = { path: folder.path === '' ? segment : `${folder.path}/${segment}`, name: segment, recipes: [], folders: new Map(), hasRecipes: false };
            folder.folders.set(segment, child);
        }
        folder = child;
    }
    return folder;
}

export function buildBookTree(input: BookTreeInput): BookTree {
    const root: Folder = { path: '', name: input.rootName, recipes: [], folders: new Map(), hasRecipes: false };
    for (const path of [...input.paths].map(normalisePath).sort(compareNames)) {
        if (path === '' || isExcluded(path, input.exclude)) {
            continue;
        }
        const segments = path.split('/');
        const fileName = segments.pop()!;
        if (isRecipe(fileName)) {
            const folder = folderAt(root, segments);
            folder.recipes.push(path);
            let ancestor = root;
            ancestor.hasRecipes = true;
            for (const segment of segments) {
                ancestor = ancestor.folders.get(segment)!;
                ancestor.hasRecipes = true;
            }
        } else if (isReadme(fileName)) {
            const folder = folderAt(root, segments);
            // README.md wins over readme.markdown when a folder has both.
            if (folder.readme === undefined || /\.md$/i.test(fileName)) {
                folder.readme = path;
            }
        }
    }

    const frontmatterOf = (folder: Folder) => parseFrontmatter(folder.readme !== undefined ? input.readmes.get(folder.readme) ?? '' : '');

    const sortedFolders = (folder: Folder): Folder[] => {
        const children = [...folder.folders.values()].filter(child => child.hasRecipes)
            .map(child => ({ child, order: frontmatterOf(child).order }));
        children.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
                return a.order - b.order;
            }
            if (a.order !== undefined && b.order === undefined) {
                return -1;
            }
            if (a.order === undefined && b.order !== undefined) {
                return 1;
            }
            return compareNames(a.child.name, b.child.name);
        });
        return children.map(entry => entry.child);
    };

    const entries = (paths: readonly string[]): RecipeEntry[] => [...paths].sort(compareNames).map(path => ({
        path,
        title: stripNumericPrefix((path.split('/').pop() ?? path).replace(/\.cook$/i, '')),
    }));

    const flattened = (folder: Folder): RecipeEntry[] =>
        [...entries(folder.recipes), ...sortedFolders(folder).flatMap(flattened)];

    const chapter = (folder: Folder, depth: number): Chapter => {
        const frontmatter = frontmatterOf(folder);
        return {
            path: folder.path,
            title: frontmatter.title ?? stripNumericPrefix(folder.name),
            depth,
            ...(folder.readme !== undefined ? { readme: folder.readme } : {}),
            recipes: depth >= MAX_CHAPTER_DEPTH ? flattened(folder) : entries(folder.recipes),
            chapters: depth >= MAX_CHAPTER_DEPTH ? [] : sortedFolders(folder).map(child => chapter(child, depth + 1)),
        };
    };

    const cover = frontmatterOf(root);
    const heading = cover.title === undefined ? firstHeading(cover.body) : undefined;
    return {
        title: cover.title ?? heading ?? stripNumericPrefix(input.rootName),
        ...(root.readme !== undefined ? { readme: root.readme } : {}),
        titleFromHeading: cover.title === undefined && heading !== undefined,
        recipes: entries(root.recipes),
        chapters: sortedFolders(root).map(child => chapter(child, 1)),
    };
}

/** Every recipe in reading order: root recipes, then each chapter's recipes before its sub-chapters. */
export function recipesInOrder(tree: BookTree): RecipeEntry[] {
    const walk = (chapter: Chapter): RecipeEntry[] => [...chapter.recipes, ...chapter.chapters.flatMap(walk)];
    return [...tree.recipes, ...tree.chapters.flatMap(walk)];
}

/** Every chapter in reading order, depth-first. */
export function chaptersInOrder(tree: BookTree): Chapter[] {
    const walk = (chapter: Chapter): Chapter[] => [chapter, ...chapter.chapters.flatMap(walk)];
    return tree.chapters.flatMap(walk);
}

/**
 * A README's relative image `src`, resolved against the README's folder, as a path
 * relative to the book folder. Undefined for URLs, absolute paths and paths that
 * leave the book folder.
 */
export function resolveRelativeImage(readmePath: string, src: string): string | undefined {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('\\')) {
        return undefined;
    }
    let decoded: string;
    try {
        decoded = decodeURIComponent(src.split(/[?#]/)[0]);
    } catch {
        return undefined;
    }
    const folder = readmePath.includes('/') ? readmePath.slice(0, readmePath.lastIndexOf('/')) : '';
    const parts: string[] = [];
    for (const segment of [...folder.split('/'), ...decoded.replace(/\\/g, '/').split('/')]) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (parts.length === 0) {
                return undefined;
            }
            parts.pop();
        } else {
            parts.push(segment);
        }
    }
    return parts.length > 0 ? parts.join('/') : undefined;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `24 passing`.

- [ ] **Step 6: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/frontmatter.ts cookbook/src/frontmatter.spec.ts cookbook/src/book-tree.ts cookbook/src/book-tree.spec.ts
git commit -m "feat(cookbook): build the book tree from folders, README order/title and numeric-aware sorting"
```

---

### Task 4: Markdown converter

**Files:**
- Create: `cookbook/src/markdown.ts`
- Test: `cookbook/src/markdown.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/markdown.spec.ts`:

```ts
import * as assert from 'assert';
import { escapeHtml, inlineMarkdown, markdownImageSources, markdownToHtml } from './markdown';

const md = (source: string, headingShift = 0): string => markdownToHtml(source, { headingShift });

describe('escapeHtml', () => {
    it('escapes the five HTML-significant characters', () => {
        assert.strictEqual(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    });
});

describe('markdownToHtml', () => {
    it('renders headings shifted below the chapter heading, capped at h6', () => {
        assert.strictEqual(md('# One\n## Two\n### Three', 1), '<h2>One</h2>\n<h3>Two</h3>\n<h4>Three</h4>');
        assert.strictEqual(md('### Deep', 4), '<h6>Deep</h6>');
        assert.strictEqual(md('#### Four'), '<p>#### Four</p>');
    });

    it('drops the first # heading when asked', () => {
        assert.strictEqual(markdownToHtml('# Title\n\nText\n\n# Again', { headingShift: 1, dropFirstHeading: true }), '<p>Text</p>\n<h2>Again</h2>');
    });

    it('joins paragraph lines and splits on blank lines', () => {
        assert.strictEqual(md('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
    });

    it('renders emphasis, strong and inline code', () => {
        assert.strictEqual(md('*soft* and **bold** with `a < b`'), '<p><em>soft</em> and <strong>bold</strong> with <code>a &lt; b</code></p>');
    });

    it('renders one-level lists with continuation lines', () => {
        assert.strictEqual(md('- eggs\n- flour\n  sifted\n\n1. mix\n2) bake'), '<ul><li>eggs</li><li>flour sifted</li></ul>\n<ol><li>mix</li><li>bake</li></ol>');
        assert.strictEqual(md('- a\n1. b'), '<ul><li>a</li></ul>\n<ol><li>b</li></ol>');
    });

    it('renders blockquotes and horizontal rules', () => {
        assert.strictEqual(md('> Cook with\n> love\n\n---\n\n***'), '<blockquote><p>Cook with love</p></blockquote>\n<hr>\n<hr>');
    });

    it('keeps http(s) links and renders other links as text', () => {
        assert.strictEqual(md('[site](https://cooklang.org/?a=1&b=2) [bad](javascript:void0) [mail](mailto:x@y.z) [doc](notes.md)'),
            '<p><a href="https://cooklang.org/?a=1&amp;b=2">site</a> bad mail doc</p>');
    });

    it('escapes all HTML in the source', () => {
        assert.strictEqual(md('<script>alert(1)</script>\n\n**<b>x</b>**'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
        assert.strictEqual(md('[x"><img src=x onerror=alert(1)>](https://a.b)'),
            '<p><a href="https://a.b">x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</a></p>');
        assert.strictEqual(md('[x](https://a.b/"onmouseover="alert(1))'), '<p>[x](https://a.b/&quot;onmouseover=&quot;alert(1))</p>');
    });

    it('strips frontmatter', () => {
        assert.strictEqual(md('---\ntitle: Soups\norder: 2\n---\nHot.'), '<p>Hot.</p>');
    });

    it('inlines relative images through the resolver and keeps http(s) images', () => {
        const resolveImage = (src: string): string | undefined => src === 'bowl.jpg' ? 'data:image/jpeg;base64,AAAA' : undefined;
        assert.strictEqual(markdownToHtml('![Bowl](bowl.jpg) ![Gone](gone.png) ![Web](https://x.org/a.png)', { headingShift: 0, resolveImage }),
            '<p><img src="data:image/jpeg;base64,AAAA" alt="Bowl"> Gone <img src="https://x.org/a.png" alt="Web"></p>');
    });

    it('rejects resolver output that is not an image data URI', () => {
        assert.strictEqual(inlineMarkdown('![a](b.png)', { headingShift: 0, resolveImage: () => 'javascript:alert(1)' }), 'a');
        assert.strictEqual(inlineMarkdown('![a](data:text/html,x)', { headingShift: 0, resolveImage: () => 'data:image/png;base64,AA' }), 'a');
    });
});

describe('markdownImageSources', () => {
    it('lists distinct relative image sources outside the frontmatter', () => {
        assert.deepStrictEqual(markdownImageSources('---\ntitle: x\n---\n![a](a.jpg) ![b](https://x/b.png) ![c](img/c.png) ![a2](a.jpg)'), ['a.jpg', 'img/c.png']);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './markdown' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/markdown.ts`:

```ts
// A small Markdown → HTML converter for README intros. No dependencies; every
// piece of source text is HTML-escaped, so a README can't inject markup. Supports
// `#`–`###` headings, paragraphs, `*em*` / `**strong**`, inline code, one-level
// lists, `http(s)` links, images, blockquotes and horizontal rules; anything else
// is paragraph text.
import { parseFrontmatter } from './frontmatter';

export interface MarkdownOptions {
    /** Added to each heading level: with 1, `#` becomes `<h2>`. Capped at `<h6>`. */
    headingShift: number;
    /** Skip the first `#` heading (it is already the cover title). */
    dropFirstHeading?: boolean;
    /** A relative image `src` → a `data:image/…` URI, or undefined to show the alt text instead. */
    resolveImage?: (src: string) => string | undefined;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INLINE = /(`+)([^`]+?)\1|!\[([^\]]*)\]\(([^()\s]+)\)|\[([^\]]+)\]\(([^()\s]+)\)|\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*/g;
const IMAGE = /!\[([^\]]*)\]\(([^()\s]+)\)/g;

function isHttp(url: string): boolean {
    return /^https?:\/\/[^\s]+$/i.test(url);
}

function isRelative(url: string): boolean {
    return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
}

function image(alt: string, src: string, options: MarkdownOptions): string {
    if (isHttp(src)) {
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    }
    const resolved = isRelative(src) ? options.resolveImage?.(src) : undefined;
    if (resolved !== undefined && /^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(resolved)) {
        return `<img src="${resolved}" alt="${escapeHtml(alt)}">`;
    }
    return escapeHtml(alt);
}

export function inlineMarkdown(text: string, options: MarkdownOptions): string {
    let html = '';
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
        html += escapeHtml(text.slice(last, match.index));
        if (match[1] !== undefined) {
            html += `<code>${escapeHtml(match[2])}</code>`;
        } else if (match[4] !== undefined) {
            html += image(match[3], match[4], options);
        } else if (match[6] !== undefined) {
            const label = inlineMarkdown(match[5], options);
            html += isHttp(match[6]) ? `<a href="${escapeHtml(match[6])}">${label}</a>` : label;
        } else if (match[7] !== undefined) {
            html += `<strong>${inlineMarkdown(match[7], options)}</strong>`;
        } else {
            html += `<em>${inlineMarkdown(match[8], options)}</em>`;
        }
        last = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(last));
}

/** Relative image sources in a README body, to read and inline before {@link markdownToHtml}. */
export function markdownImageSources(source: string): string[] {
    const sources = new Set<string>();
    for (const match of parseFrontmatter(source).body.matchAll(IMAGE)) {
        if (isRelative(match[2])) {
            sources.add(match[2]);
        }
    }
    return [...sources];
}

export function markdownToHtml(source: string, options: MarkdownOptions): string {
    const out: string[] = [];
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | undefined;
    let quote: string[] | undefined;
    let dropHeading = options.dropFirstHeading === true;

    const flushParagraph = (): void => {
        if (paragraph.length > 0) {
            out.push(`<p>${inlineMarkdown(paragraph.join(' '), options)}</p>`);
            paragraph = [];
        }
    };
    const flushList = (): void => {
        if (list) {
            const tag = list.ordered ? 'ol' : 'ul';
            out.push(`<${tag}>${list.items.map(item => `<li>${inlineMarkdown(item, options)}</li>`).join('')}</${tag}>`);
            list = undefined;
        }
    };
    const flushQuote = (): void => {
        if (quote) {
            out.push(`<blockquote><p>${inlineMarkdown(quote.join(' '), options)}</p></blockquote>`);
            quote = undefined;
        }
    };
    const flushAll = (): void => {
        flushParagraph();
        flushList();
        flushQuote();
    };

    for (const raw of parseFrontmatter(source).body.split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (line.trim() === '') {
            flushAll();
            continue;
        }
        const heading = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
        if (heading) {
            flushAll();
            if (dropHeading && heading[1].length === 1) {
                dropHeading = false;
                continue;
            }
            const level = Math.min(heading[1].length + options.headingShift, 6);
            out.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
            continue;
        }
        if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
            flushAll();
            out.push('<hr>');
            continue;
        }
        const quoted = /^ {0,3}> ?(.*)$/.exec(line);
        if (quoted) {
            flushParagraph();
            flushList();
            (quote ??= []).push(quoted[1].trim());
            continue;
        }
        const bullet = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
        const numbered = /^ {0,3}\d{1,9}[.)]\s+(.*)$/.exec(line);
        const item = bullet ?? numbered;
        if (item) {
            flushParagraph();
            flushQuote();
            if (list && list.ordered !== (bullet === null)) {
                flushList();
            }
            (list ??= { ordered: bullet === null, items: [] }).items.push(item[1].trim());
            continue;
        }
        if (list && /^\s/.test(raw)) {
            list.items[list.items.length - 1] += ` ${line.trim()}`;
            continue;
        }
        if (quote) {
            quote.push(line.trim());
            continue;
        }
        flushList();
        paragraph.push(line.trim());
    }
    flushAll();
    return out.join('\n');
}
```

Inline syntax is matched on the raw text and every gap is escaped, so escaping never runs twice and no source character reaches the output unescaped. A link whose URL holds `(`, `)` or whitespace does not match and stays literal (escaped) text.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `37 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/markdown.ts cookbook/src/markdown.spec.ts
git commit -m "feat(cookbook): dependency-free Markdown converter for README intros"
```

---

### Task 5: Recipe template and output validation

**Files:**
- Create: `cookbook/src/recipe-template.ts`
- Test: `cookbook/src/recipe-template.spec.ts`

The two JSON strings in the spec are verbatim output of `RECIPE_TEMPLATE` rendered by cooklang-reports 0.5.2 (the version the editor bundles) for:

```
---
title: Tomato Soup
servings: 4
prep time: 10 min
tags: [soup, vegan]
source:
  name: Grandma
  url: https://example.com/soup
---

> A family favourite. "Best" <served> hot & fresh.

Chop @onion{1}(diced) and @garlic{2%cloves}.

Fry in #pot{} with @olive oil{2%tbsp} for ~{5%minutes}.

== Finish ==

> Taste first.

Blend @./Sauces/Pesto{1%tbsp} and @salt{} until smooth.
```

and `Add @?salt{} and @-pepper{} and @&onion{}.`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/recipe-template.spec.ts`:

```ts
import * as assert from 'assert';
import { RECIPE_TEMPLATE, parseRecipeOutput, recipeTitle } from './recipe-template';

/** Real cooklang-reports 0.5.2 output of RECIPE_TEMPLATE for a soup recipe (two sections, text blocks, a reference). */
const SOUP = '{"metadata":{"title":"Tomato Soup","servings":4,"prep time":"10 min","tags":["soup","vegan"],"source":{"name":"Grandma","url":"https://example.com/soup"}},"ingredients":[{"name":"onion","quantity":"1","note":"diced","reference":false},{"name":"garlic","quantity":"2 cloves","note":"","reference":false},{"name":"olive oil","quantity":"2 tbsp","note":"","reference":false},{"name":"Pesto","quantity":"1 tbsp","note":"","reference":true},{"name":"salt","quantity":"","note":"","reference":false}],"cookware":[{"name":"pot","quantity":"","note":""}],"sections":[{"name":"","blocks":[{"kind":"text","text":"A family favourite. \\"Best\\" \\u003cserved\\u003e hot \\u0026 fresh."},{"kind":"step","number":1,"text":"Chop 1 onion and 2 cloves garlic."},{"kind":"step","number":2,"text":"Fry in pot with 2 tbsp olive oil for 5 minutes."}]},{"name":"Finish","blocks":[{"kind":"text","text":"Taste first."},{"kind":"step","number":1,"text":"Blend 1 tbsp Pesto and salt until smooth."}]}]}';

/** Real output for `Add @?salt{} and @-pepper{} and @&onion{}.` (the engine keeps modifiers in names). */
const MODIFIERS = '{"metadata":{},"ingredients":[{"name":"?salt","quantity":"","note":"","reference":false},{"name":"-pepper","quantity":"","note":"","reference":false},{"name":"\\u0026onion","quantity":"","note":"","reference":false}],"cookware":[],"sections":[{"name":"","blocks":[{"kind":"step","number":1,"text":"Add ?salt and -pepper and \\u0026onion."}]}]}';

describe('RECIPE_TEMPLATE', () => {
    it('emits one JSON document through tojson and stays far below the 64K template limit', () => {
        assert.ok(RECIPE_TEMPLATE.trimEnd().endsWith('| tojson }}'));
        assert.ok(RECIPE_TEMPLATE.includes('text is startingwith(prefix)'));
        assert.ok(RECIPE_TEMPLATE.length < 4096);
    });
});

describe('parseRecipeOutput', () => {
    it('reads metadata, ingredients, cookware and sections with steps and text blocks', () => {
        const data = parseRecipeOutput(SOUP)!;
        assert.strictEqual(data.metadata.title, 'Tomato Soup');
        assert.deepStrictEqual(data.ingredients[0], { name: 'onion', quantity: '1', note: 'diced', optional: false, reference: false });
        assert.deepStrictEqual(data.ingredients[3], { name: 'Pesto', quantity: '1 tbsp', note: '', optional: false, reference: true });
        assert.deepStrictEqual(data.cookware, [{ name: 'pot', quantity: '', note: '' }]);
        assert.strictEqual(data.sections.length, 2);
        assert.deepStrictEqual(data.sections[0].blocks[0], { kind: 'text', text: 'A family favourite. "Best" <served> hot & fresh.' });
        assert.deepStrictEqual(data.sections[0].blocks[2], { kind: 'step', number: 2, text: 'Fry in pot with 2 tbsp olive oil for 5 minutes.' });
        assert.strictEqual(data.sections[1].name, 'Finish');
        assert.deepStrictEqual(data.sections[1].blocks[1], { kind: 'step', number: 1, text: 'Blend 1 tbsp Pesto and salt until smooth.' });
    });

    it('marks ?optional ingredients, drops -hidden and &reused ones and cleans the step text', () => {
        const data = parseRecipeOutput(MODIFIERS)!;
        assert.deepStrictEqual(data.ingredients, [{ name: 'salt', quantity: '', note: '', optional: true, reference: false }]);
        assert.deepStrictEqual(data.sections[0].blocks, [{ kind: 'step', number: 1, text: 'Add salt and pepper and onion.' }]);
    });

    it('drops malformed entries and rejects a malformed document', () => {
        const data = parseRecipeOutput(JSON.stringify({
            metadata: [],
            ingredients: [{ name: '' }, { quantity: '1' }, 'x', { name: 'egg', quantity: 2 }],
            cookware: [null, { name: 'pan' }],
            sections: [{ blocks: [{ kind: 'step', number: 0, text: 'x' }, { kind: 'step', number: 1, text: 'Go.' }, { kind: 'odd', text: 'y' }] }, 'bad'],
        }))!;
        assert.deepStrictEqual(data.metadata, {});
        assert.deepStrictEqual(data.ingredients, [{ name: 'egg', quantity: '2', note: '', optional: false, reference: false }]);
        assert.deepStrictEqual(data.cookware, [{ name: 'pan', quantity: '', note: '' }]);
        assert.deepStrictEqual(data.sections, [{ name: '', blocks: [{ kind: 'step', number: 1, text: 'Go.' }] }]);
        assert.strictEqual(parseRecipeOutput('not json'), undefined);
        assert.strictEqual(parseRecipeOutput('{"ingredients":[]}'), undefined);
    });
});

describe('recipeTitle', () => {
    it('prefers the title metadata', () => {
        assert.strictEqual(recipeTitle(parseRecipeOutput(SOUP)!, 'Tomato'), 'Tomato Soup');
        assert.strictEqual(recipeTitle(parseRecipeOutput(MODIFIERS)!, 'Seasoning'), 'Seasoning');
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './recipe-template' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/recipe-template.ts`:

```ts
// The Jinja template rendered once per recipe by `cooklang.api.renderReport`, and
// validation of its JSON output. The Reports engine (cooklang-reports 0.5) exposes
// `metadata` (a map), `ingredients` / `cookware` (objects with `name`, `quantity`,
// `note`, and `reference` for ingredients) and `sections` (iterable, with `name`).
// A section's items render as text only: a step as `"N. text"` with ingredients,
// cookware and timers already flattened ("Chop 1 onion"), a text block as its text.
// Step numbers restart at 1 in each section and skip text blocks, so a counter
// tells them apart. The engine parses with no extensions, so the `?`, `-`, `&` and
// `+` ingredient modifiers stay in the name ("?salt"); `parseRecipeOutput` handles them.

import { isRecord } from './cooklang-api';

export const RECIPE_TEMPLATE = [
    '{%- set book = namespace(sections=[], ingredients=[], cookware=[]) -%}',
    '{%- for section in sections -%}',
    '{%- set part = namespace(blocks=[], next=1) -%}',
    '{%- for content in section -%}',
    '{%- set text = content | string -%}',
    '{%- set prefix = part.next ~ ". " -%}',
    '{%- if text is startingwith(prefix) -%}',
    '{%- set part.blocks = part.blocks + [{"kind": "step", "number": part.next, "text": text[prefix | length:]}] -%}',
    '{%- set part.next = part.next + 1 -%}',
    '{%- else -%}',
    '{%- set part.blocks = part.blocks + [{"kind": "text", "text": text}] -%}',
    '{%- endif -%}',
    '{%- endfor -%}',
    '{%- set book.sections = book.sections + [{"name": section.name, "blocks": part.blocks}] -%}',
    '{%- endfor -%}',
    '{%- for ingredient in ingredients -%}',
    '{%- set book.ingredients = book.ingredients + [{"name": ingredient.name, "quantity": (ingredient.quantity | string) if ingredient.quantity is defined else "", "note": ingredient.note if ingredient.note is defined else "", "reference": ingredient.reference}] -%}',
    '{%- endfor -%}',
    '{%- for item in cookware -%}',
    '{%- set book.cookware = book.cookware + [{"name": item.name, "quantity": item.quantity if item.quantity is defined else "", "note": item.note if item.note is defined else ""}] -%}',
    '{%- endfor -%}',
    '{{ {"metadata": metadata, "ingredients": book.ingredients, "cookware": book.cookware, "sections": book.sections} | tojson }}',
].join('\n');

export interface RecipeIngredient {
    name: string;
    quantity: string;
    note: string;
    /** `@?name`: may be left out. */
    optional: boolean;
    /** A reference to another recipe (`@./Sauces/Pesto{}`); `name` is the recipe's name. */
    reference: boolean;
}

export interface RecipeCookware {
    name: string;
    quantity: string;
    note: string;
}

export type RecipeBlock =
    | { kind: 'step'; number: number; text: string }
    | { kind: 'text'; text: string };

export interface RecipeSection {
    /** Empty for the unnamed first section. */
    name: string;
    blocks: RecipeBlock[];
}

export interface RecipeData {
    metadata: Record<string, unknown>;
    /** Without `@-hidden` and `@&reused` entries; those stay only in the step text. */
    ingredients: RecipeIngredient[];
    cookware: RecipeCookware[];
    sections: RecipeSection[];
}

const MODIFIERS = /^[?\-&+]+/;

function text(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Removes modifier prefixes from the flattened step text: "Add ?salt" → "Add salt". */
function cleanStepText(value: string, rawNames: readonly string[]): string {
    let cleaned = value;
    for (const raw of [...rawNames].sort((a, b) => b.length - a.length)) {
        cleaned = cleaned.split(raw).join(raw.replace(MODIFIERS, ''));
    }
    return cleaned;
}

/** Parses and validates the template output; malformed entries are dropped, a malformed document is undefined. */
export function parseRecipeOutput(output: string): RecipeData | undefined {
    let value: unknown;
    try {
        value = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isRecord(value) || !Array.isArray(value.ingredients) || !Array.isArray(value.cookware) || !Array.isArray(value.sections)) {
        return undefined;
    }
    const modified: string[] = [];
    const ingredients: RecipeIngredient[] = [];
    for (const entry of value.ingredients) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
            continue;
        }
        const modifiers = MODIFIERS.exec(entry.name)?.[0] ?? '';
        if (modifiers !== '') {
            modified.push(entry.name);
        }
        const name = entry.name.slice(modifiers.length).trim();
        if (name === '' || modifiers.includes('-') || modifiers.includes('&')) {
            continue;
        }
        ingredients.push({
            name,
            quantity: text(entry.quantity),
            note: text(entry.note),
            optional: modifiers.includes('?'),
            reference: entry.reference === true,
        });
    }
    const cookware: RecipeCookware[] = [];
    for (const entry of value.cookware) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.trim() === '') {
            continue;
        }
        const modifiers = MODIFIERS.exec(entry.name)?.[0] ?? '';
        if (modifiers !== '') {
            modified.push(entry.name);
        }
        const name = entry.name.slice(modifiers.length).trim();
        if (name === '' || modifiers.includes('-') || modifiers.includes('&')) {
            continue;
        }
        cookware.push({ name, quantity: text(entry.quantity), note: text(entry.note) });
    }
    const sections: RecipeSection[] = [];
    for (const entry of value.sections) {
        if (!isRecord(entry) || !Array.isArray(entry.blocks)) {
            continue;
        }
        const blocks: RecipeBlock[] = [];
        for (const block of entry.blocks) {
            if (!isRecord(block) || typeof block.text !== 'string') {
                continue;
            }
            if (block.kind === 'step' && typeof block.number === 'number' && Number.isInteger(block.number) && block.number > 0) {
                blocks.push({ kind: 'step', number: block.number, text: cleanStepText(block.text, modified) });
            } else if (block.kind === 'text') {
                blocks.push({ kind: 'text', text: block.text });
            }
        }
        sections.push({ name: text(entry.name), blocks });
    }
    return { metadata: isRecord(value.metadata) ? value.metadata : {}, ingredients, cookware, sections };
}

/** The recipe's `title` metadata, else the file-name title from the book tree. */
export function recipeTitle(data: RecipeData, fallback: string): string {
    const title = data.metadata.title;
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : fallback;
}
```

Template notes (all checked against the engine): `content | string` renders a section item; `is startingwith` is a minijinja built-in test (Python-style `.startswith()` is not available without pycompat); string slicing `text[n:]` works; `ingredient.quantity | string` renders `"2 cloves"`; missing `note` / `quantity` are undefined, hence the `is defined` guards; `metadata | tojson` serialises the whole frontmatter map (nested values included); the engine's environment does not autoescape (template name `base`), and `tojson` escapes `<`, `>`, `&` as `<…`, which `JSON.parse` decodes. The template is about 1.9 K characters, far under the 64 K `renderReport` limit.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `42 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/recipe-template.ts cookbook/src/recipe-template.spec.ts
git commit -m "feat(cookbook): recipe-as-JSON report template and output validation"
```

---

### Task 6: Images

**Files:**
- Create: `cookbook/src/images.ts`
- Test: `cookbook/src/images.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/images.spec.ts`:

```ts
import * as assert from 'assert';
import { ImageFiles, ImageInliner, lookupStepImage, mimeType, toDataUri } from './images';

function files(contents: Record<string, Uint8Array>): ImageFiles & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        size: async uri => contents[uri]?.length,
        read: async uri => {
            reads.push(uri);
            const bytes = contents[uri];
            if (!bytes) {
                throw new Error('missing');
            }
            return bytes;
        },
    };
}

describe('mimeType', () => {
    it('maps the preview extensions, case-insensitively', () => {
        assert.strictEqual(mimeType('file:///b/Pancakes.JPG'), 'image/jpeg');
        assert.strictEqual(mimeType('file:///b/a.webp?x=1'), 'image/webp');
        assert.strictEqual(mimeType('file:///b/a.gif'), undefined);
        assert.strictEqual(mimeType('file:///b.d/noext'), undefined);
    });
});

describe('toDataUri', () => {
    it('base64-encodes the bytes', () => {
        assert.strictEqual(toDataUri(new Uint8Array([1, 2, 3]), 'image/png'), 'data:image/png;base64,AQID');
    });
});

describe('lookupStepImage', () => {
    it('prefers the section image and falls back to the linear one', () => {
        const images = { steps: { 0: { 0: 'a', 3: 'linear' }, 1: { 0: 'section' } } };
        assert.strictEqual(lookupStepImage(images, 1, 0, 3), 'section');
        assert.strictEqual(lookupStepImage(images, 1, 1, 3), 'linear');
        assert.strictEqual(lookupStepImage(images, 0, 0, 0), 'a');
        assert.strictEqual(lookupStepImage(images, 2, 0, 9), undefined);
    });
});

describe('ImageInliner', () => {
    it('inlines files, keeps http(s) URLs and reads each file once', async () => {
        const fs = files({ 'file:///b/a.png': new Uint8Array([1, 2, 3]) });
        const inliner = new ImageInliner(fs);
        assert.strictEqual(await inliner.inline('file:///b/a.png'), 'data:image/png;base64,AQID');
        assert.strictEqual(await inliner.inline('file:///b/a.png'), 'data:image/png;base64,AQID');
        assert.strictEqual(await inliner.inline('https://x.org/a.jpg'), 'https://x.org/a.jpg');
        assert.deepStrictEqual(fs.reads, ['file:///b/a.png']);
    });

    it('skips unknown types, unreadable files, oversized files and files past the budget', async () => {
        const fs = files({ 'file:///b/big.jpg': new Uint8Array(11), 'file:///b/a.jpg': new Uint8Array(3), 'file:///b/c.jpg': new Uint8Array(3), 'file:///b/x.gif': new Uint8Array(1) });
        const inliner = new ImageInliner(fs, 10, 6);
        assert.strictEqual(await inliner.inline('file:///b/x.gif'), undefined);
        assert.strictEqual(await inliner.inline('file:///b/missing.jpg'), undefined);
        assert.strictEqual(await inliner.inline('javascript:alert(1).png'), undefined);
        assert.strictEqual(await inliner.inline('relative/a.jpg'), undefined);
        assert.strictEqual(await inliner.inline('file:///b/big.jpg'), undefined);
        assert.ok((await inliner.inline('file:///b/a.jpg'))?.startsWith('data:image/jpeg;base64,'));
        assert.strictEqual(await inliner.inline('file:///b/c.jpg'), undefined);
        assert.strictEqual(inliner.skipped, 2);
    });

    it('inlines a whole RecipeImages result and drops what it cannot inline', async () => {
        const fs = files({ 'file:///b/t.jpg': new Uint8Array([0]), 'file:///b/t.0.jpg': new Uint8Array([1]) });
        const inliner = new ImageInliner(fs);
        assert.deepStrictEqual(await inliner.inlineAll({ title: 'file:///b/t.jpg', steps: { 0: { 0: 'file:///b/t.0.jpg', 1: 'file:///b/gone.jpg' } } }), {
            title: 'data:image/jpeg;base64,AA==',
            steps: { 0: { 0: 'data:image/jpeg;base64,AQ==' } },
        });
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './images' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/images.ts`:

```ts
// Recipe and README photos, inlined into the book as `data:` URIs so the PDF
// window needs no file access. `http(s)` URLs (from recipe metadata) are kept.
import { RecipeImages } from './cooklang-api';

/** Bigger files are skipped. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * All inlined images together, in data-URI characters. The editor rejects export
 * HTML over 100 M characters; this leaves room for the text. Images past the budget
 * are left out and counted in {@link ImageInliner.skipped}.
 */
export const MAX_TOTAL_IMAGE_CHARS = 80 * 1024 * 1024;

/** The extensions the editor's preview understands (`common/recipe-images.ts`). */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

export function mimeType(uri: string): string | undefined {
    const path = uri.split(/[?#]/)[0];
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot < 0 ? undefined : IMAGE_MIME_TYPES[name.slice(dot + 1).toLowerCase()];
}

export function toDataUri(bytes: Uint8Array, mime: string): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * The image for one step, with the preview's rules (`lookupStepImage` in the editor):
 * the section-specific `Recipe.S.N.jpg` wins, the linear `Recipe.N.jpg` (section 0,
 * counted across sections) is the fallback. All indices are zero-based and count steps only.
 */
export function lookupStepImage(images: RecipeImages, sectionIndex: number, stepInSection: number, globalStepIndex: number): string | undefined {
    return images.steps[String(sectionIndex)]?.[String(stepInSection)] ?? images.steps['0']?.[String(globalStepIndex)];
}

export interface ImageFiles {
    /** Size in bytes, or undefined when the file can't be read. */
    size(uri: string): Promise<number | undefined>;
    read(uri: string): Promise<Uint8Array>;
}

export class ImageInliner {

    /** Images left out because they were too big or over the book's budget. */
    skipped = 0;
    protected used = 0;
    protected readonly cache = new Map<string, Promise<string | undefined>>();

    constructor(
        protected readonly files: ImageFiles,
        protected readonly maxBytes = MAX_IMAGE_BYTES,
        protected readonly budget = MAX_TOTAL_IMAGE_CHARS,
    ) { }

    /** `http(s)` URLs as they are; readable image files as data URIs; anything else undefined. Each URI is read once. */
    inline(uri: string): Promise<string | undefined> {
        if (/^https?:\/\/\S+$/i.test(uri)) {
            return Promise.resolve(uri);
        }
        let pending = this.cache.get(uri);
        if (!pending) {
            pending = this.load(uri);
            this.cache.set(uri, pending);
        }
        return pending;
    }

    async inlineAll(images: RecipeImages): Promise<RecipeImages> {
        const result: RecipeImages = { steps: {} };
        if (images.title !== undefined) {
            const title = await this.inline(images.title);
            if (title !== undefined) {
                result.title = title;
            }
        }
        for (const [section, steps] of Object.entries(images.steps)) {
            for (const [step, uri] of Object.entries(steps)) {
                const src = await this.inline(uri);
                if (src !== undefined) {
                    (result.steps[section] ??= {})[step] = src;
                }
            }
        }
        return result;
    }

    protected async load(uri: string): Promise<string | undefined> {
        const mime = mimeType(uri);
        if (!mime || !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
            return undefined;
        }
        try {
            const size = await this.files.size(uri);
            if (size === undefined) {
                return undefined;
            }
            // Base64 is 4 characters per 3 bytes.
            if (size > this.maxBytes || this.used + Math.ceil(size / 3) * 4 > this.budget) {
                this.skipped++;
                return undefined;
            }
            const dataUri = toDataUri(await this.files.read(uri), mime);
            this.used += dataUri.length;
            return dataUri;
        } catch {
            return undefined;
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `48 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/images.ts cookbook/src/images.spec.ts
git commit -m "feat(cookbook): inline recipe photos as data URIs with a size cap and a book budget"
```

---

### Task 7: Recipe HTML

**Files:**
- Create: `cookbook/src/recipe-html.ts`
- Test: `cookbook/src/recipe-html.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/recipe-html.spec.ts`:

```ts
import * as assert from 'assert';
import { ingredientName, renderRecipeHtml } from './recipe-html';
import { RecipeData } from './recipe-template';

const DATA: RecipeData = {
    metadata: { title: 'Soup', servings: 4, 'prep time': '10 min', cook_time: 20, source: { name: 'Gran <3', url: 'https://example.com/soup' }, tags: ['soup', '<b>'] },
    ingredients: [
        { name: 'onion', quantity: '1', note: 'diced', optional: false, reference: false },
        { name: 'salt', quantity: '', note: '', optional: true, reference: false },
        { name: './Sauces/Pesto', quantity: '1 tbsp', note: '', optional: false, reference: true },
    ],
    cookware: [{ name: 'pot', quantity: '1', note: '' }],
    sections: [
        { name: '', blocks: [{ kind: 'text', text: 'Serve <hot> & fresh.' }, { kind: 'step', number: 1, text: 'Chop 1 onion.' }, { kind: 'step', number: 2, text: 'Fry.' }] },
        { name: 'Finish', blocks: [{ kind: 'step', number: 1, text: 'Blend.' }] },
    ],
};

const IMG = 'data:image/jpeg;base64,AAAA';

describe('ingredientName', () => {
    it('shows a referenced recipe by its file name', () => {
        assert.strictEqual(ingredientName(DATA.ingredients[2]), 'Pesto');
        assert.strictEqual(ingredientName(DATA.ingredients[0]), 'onion');
    });
});

describe('renderRecipeHtml', () => {
    const html = renderRecipeHtml({ id: 'r-1', title: 'Soup & <Co>', data: DATA, images: { steps: {} }, nutritionLine: 'Per serving: 1 kcal · 0 g protein · 0 g carbs · 0 g fat' });

    it('renders an article with an escaped title and anchor id', () => {
        assert.ok(html.startsWith('<article class="recipe" id="r-1">\n<h2 class="recipe-title">Soup &amp; &lt;Co&gt;</h2>'));
        assert.ok(html.endsWith('</section>\n</article>'));
    });

    it('renders the metadata line, source link, tags and nutrition line', () => {
        assert.ok(html.includes('<p class="meta">Serves 4 · Prep 10 min · Cook 20 min</p>'));
        assert.ok(html.includes('<p class="source">Source: <a href="https://example.com/soup">Gran &lt;3</a></p>'));
        assert.ok(html.includes('<span class="tag">&lt;b&gt;</span>'));
        assert.ok(html.includes('<p class="nutrition">Per serving: 1 kcal · 0 g protein · 0 g carbs · 0 g fat</p>'));
    });

    it('renders ingredients with quantity, note, optional marker and reference names', () => {
        assert.ok(html.includes('<li><span class="qty">1</span> onion <span class="note">(diced)</span></li>'));
        assert.ok(html.includes('<li>salt <span class="optional">optional</span></li>'));
        assert.ok(html.includes('<li><span class="qty">1 tbsp</span> Pesto</li>'));
        assert.ok(html.includes('<section class="cookware"><h3>Cookware</h3><ul><li><span class="qty">1</span> pot</li></ul></section>'));
    });

    it('renders text blocks, numbered steps and named sections', () => {
        assert.ok(html.includes('<p class="text">Serve &lt;hot&gt; &amp; fresh.</p>'));
        assert.ok(html.includes('<div class="step"><span class="step-number">2</span><p>Fry.</p></div>'));
        assert.ok(html.includes('<h4 class="section-name">Finish</h4>\n<div class="step"><span class="step-number">1</span><p>Blend.</p></div>'));
    });

    it('omits empty parts', () => {
        const bare = renderRecipeHtml({ id: 'r-2', title: 'Bare', data: { metadata: {}, ingredients: [], cookware: [], sections: [] }, images: { steps: {} } });
        assert.strictEqual(bare, '<article class="recipe" id="r-2">\n<h2 class="recipe-title">Bare</h2>\n<section class="method"><h3>Method</h3>\n</section>\n</article>');
    });

    it('places the title image and step images by section and step index', () => {
        const withImages = renderRecipeHtml({
            id: 'r-3', title: 'Soup', data: DATA,
            images: { title: IMG, steps: { 0: { 1: IMG }, 1: { 0: 'https://x.org/blend.jpg' } } },
        });
        assert.ok(withImages.includes(`<h2 class="recipe-title">Soup</h2>\n<img class="title-image" src="${IMG}" alt="">`));
        assert.ok(withImages.includes(`<p>Fry.</p><img class="step-image" src="${IMG}" alt=""></div>`));
        assert.ok(withImages.includes('<p>Blend.</p><img class="step-image" src="https://x.org/blend.jpg" alt=""></div>'));
        assert.ok(withImages.includes('<p>Chop 1 onion.</p></div>'));
    });

    it('drops unsafe image sources and links', () => {
        const unsafe = renderRecipeHtml({
            id: 'r-4', title: 'X',
            data: { ...DATA, metadata: { source: 'javascript:alert(1)' } },
            images: { title: 'javascript:alert(1)', steps: { 0: { 0: 'file:///etc/passwd' } } },
        });
        assert.ok(!unsafe.includes('<img'));
        assert.ok(unsafe.includes('<p class="source">Source: javascript:alert(1)</p>'));
    });

    it('links a plain URL source', () => {
        const linked = renderRecipeHtml({ id: 'r-5', title: 'X', data: { ...DATA, metadata: { source: 'https://a.b/c' } }, images: { steps: {} } });
        assert.ok(linked.includes('<p class="source">Source: <a href="https://a.b/c">https://a.b/c</a></p>'));
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './recipe-html' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/recipe-html.ts`:

```ts
// One recipe as an <article>, built from the validated template output. Every
// value from the recipe is escaped; image sources must be data URIs or http(s).
import { RecipeImages } from './cooklang-api';
import { lookupStepImage } from './images';
import { escapeHtml } from './markdown';
import { RecipeData, RecipeIngredient } from './recipe-template';

export interface RecipeHtmlInput {
    /** Anchor id used by the contents and the index, e.g. `r-12`. */
    id: string;
    title: string;
    data: RecipeData;
    /** Already inlined (see `ImageInliner.inlineAll`). */
    images: RecipeImages;
    nutritionLine?: string;
}

const SAFE_IMAGE_SRC = /^(data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+|https?:\/\/\S+)$/i;

function imageTag(src: string | undefined, className: string): string {
    return src !== undefined && SAFE_IMAGE_SRC.test(src) ? `<img class="${className}" src="${escapeHtml(src)}" alt="">` : '';
}

function scalar(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
    }
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/** First metadata value among `keys`, matched case-insensitively and with `_` or `-` as spaces. */
function field(metadata: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const [key, value] of Object.entries(metadata)) {
        if (keys.includes(key.toLowerCase().replace(/[_-]/g, ' '))) {
            return value;
        }
    }
    return undefined;
}

function minutes(value: unknown): string | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? `${value} min` : scalar(value);
}

function metaLine(metadata: Record<string, unknown>): string[] {
    const parts: string[] = [];
    const servings = scalar(field(metadata, ['servings', 'serves', 'yield']));
    if (servings !== undefined) {
        parts.push(`Serves ${servings}`);
    }
    for (const [label, keys] of [
        ['Prep', ['prep time', 'prep']],
        ['Cook', ['cook time', 'cook']],
        ['Total', ['time', 'total time', 'duration']],
    ] as const) {
        const value = minutes(field(metadata, keys));
        if (value !== undefined) {
            parts.push(`${label} ${value}`);
        }
    }
    return parts;
}

function sourceHtml(metadata: Record<string, unknown>): string {
    const source = field(metadata, ['source']);
    let name: string | undefined;
    let url: string | undefined;
    if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
        const record = source as Record<string, unknown>;
        name = scalar(record.name);
        url = scalar(record.url);
    } else {
        name = scalar(source);
    }
    if (name === undefined && url === undefined) {
        return '';
    }
    if (url === undefined && name !== undefined && /^https?:\/\/\S+$/i.test(name)) {
        url = name;
    }
    const label = escapeHtml(name ?? url!);
    const linked = url !== undefined && /^https?:\/\/\S+$/i.test(url) ? `<a href="${escapeHtml(url)}">${label}</a>` : label;
    return `<p class="source">Source: ${linked}</p>`;
}

function tags(metadata: Record<string, unknown>): string[] {
    const value = field(metadata, ['tags']);
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return list.map(scalar).filter((tag): tag is string => tag !== undefined);
}

/** A reference's display name: `./Sauces/Pesto` → `Pesto`. */
export function ingredientName(ingredient: RecipeIngredient): string {
    return ingredient.reference ? ingredient.name.split('/').pop()!.replace(/\.cook$/i, '') : ingredient.name;
}

function ingredientHtml(ingredient: RecipeIngredient): string {
    const quantity = ingredient.quantity !== '' ? `<span class="qty">${escapeHtml(ingredient.quantity)}</span> ` : '';
    const note = ingredient.note !== '' ? ` <span class="note">(${escapeHtml(ingredient.note)})</span>` : '';
    const optional = ingredient.optional ? ' <span class="optional">optional</span>' : '';
    return `<li>${quantity}${escapeHtml(ingredientName(ingredient))}${note}${optional}</li>`;
}

export function renderRecipeHtml(input: RecipeHtmlInput): string {
    const { data } = input;
    const out: string[] = [`<article class="recipe" id="${escapeHtml(input.id)}">`, `<h2 class="recipe-title">${escapeHtml(input.title)}</h2>`];
    out.push(imageTag(input.images.title, 'title-image'));
    const meta = metaLine(data.metadata);
    if (meta.length > 0) {
        out.push(`<p class="meta">${meta.map(escapeHtml).join(' · ')}</p>`);
    }
    out.push(sourceHtml(data.metadata));
    const tagList = tags(data.metadata);
    if (tagList.length > 0) {
        out.push(`<p class="tags">${tagList.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</p>`);
    }
    if (input.nutritionLine !== undefined) {
        out.push(`<p class="nutrition">${escapeHtml(input.nutritionLine)}</p>`);
    }
    if (data.ingredients.length > 0) {
        out.push(`<section class="ingredients"><h3>Ingredients</h3><ul>${data.ingredients.map(ingredientHtml).join('')}</ul></section>`);
    }
    if (data.cookware.length > 0) {
        const items = data.cookware.map(item => {
            const quantity = item.quantity !== '' ? `<span class="qty">${escapeHtml(item.quantity)}</span> ` : '';
            const note = item.note !== '' ? ` <span class="note">(${escapeHtml(item.note)})</span>` : '';
            return `<li>${quantity}${escapeHtml(item.name)}${note}</li>`;
        });
        out.push(`<section class="cookware"><h3>Cookware</h3><ul>${items.join('')}</ul></section>`);
    }
    out.push('<section class="method"><h3>Method</h3>');
    let globalStep = 0;
    data.sections.forEach((section, sectionIndex) => {
        if (section.name !== '') {
            out.push(`<h4 class="section-name">${escapeHtml(section.name)}</h4>`);
        }
        let stepInSection = 0;
        for (const block of section.blocks) {
            if (block.kind === 'text') {
                out.push(`<p class="text">${escapeHtml(block.text)}</p>`);
                continue;
            }
            const image = imageTag(lookupStepImage(input.images, sectionIndex, stepInSection, globalStep), 'step-image');
            out.push(`<div class="step"><span class="step-number">${block.number}</span><p>${escapeHtml(block.text)}</p>${image}</div>`);
            stepInSection++;
            globalStep++;
        }
    });
    out.push('</section>', '</article>');
    return out.filter(part => part !== '').join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `57 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/recipe-html.ts cookbook/src/recipe-html.spec.ts
git commit -m "feat(cookbook): render one recipe as an escaped HTML article with photos"
```

---

### Task 8: Nutrition line

**Files:**
- Create: `cookbook/src/nutrition-line.ts`
- Test: `cookbook/src/nutrition-line.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/nutrition-line.spec.ts`:

```ts
import * as assert from 'assert';
import { NUTRITION_TEMPLATE, nutritionLine, parseNutritionOutput, servingsFromMetadata } from './nutrition-line';

const macros = { kcal: 2080, protein_g: 152, fat_g: 56, carb_g: 208, fiber_g: 6, sugar_g: 8, sat_fat_g: 2 };
const item = (ingredient: string, warnings: unknown[] = []) => ({ ingredient, amount: { value: 1, unit: '', mass_g: 100 }, macros, micros: {}, warnings });

describe('NUTRITION_TEMPLATE', () => {
    it('returns the aggregate as JSON', () => {
        assert.strictEqual(NUTRITION_TEMPLATE, '{{ aggregate_nutrition(ingredients) | tojson }}');
    });
});

describe('parseNutritionOutput', () => {
    it('reads the macros and counts placeholders and failures as unmatched', () => {
        const output = JSON.stringify({
            items: [item('a'), item('b'), item('c', [{ code: 'nutrition_placeholder' }]), item('d', ['nutrition_placeholder'])],
            failures: [{ index: 4, ingredient: 'e', error: { code: 'x', message: 'y' } }],
            totals: { mass_g: 400, macros, micros: {} },
        });
        assert.deepStrictEqual(parseNutritionOutput(output), { kcal: 2080, protein_g: 152, carb_g: 208, fat_g: 56, matched: 2, total: 5 });
    });

    it('rejects output that is not an aggregate', () => {
        assert.strictEqual(parseNutritionOutput('nope'), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ items: [], failures: [], totals: { macros: { kcal: '1' } } })), undefined);
        assert.strictEqual(parseNutritionOutput(JSON.stringify({ items: [], totals: { macros } })), undefined);
    });
});

describe('servingsFromMetadata', () => {
    it('reads servings, serves or yield', () => {
        assert.strictEqual(servingsFromMetadata({ servings: 4 }), 4);
        assert.strictEqual(servingsFromMetadata({ Serves: '6 people' }), 6);
        assert.strictEqual(servingsFromMetadata({ yield: '2|4' }), 2);
    });

    it('is undefined when absent, non-numeric or out of range', () => {
        assert.strictEqual(servingsFromMetadata({}), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 'a few' }), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 0 }), undefined);
        assert.strictEqual(servingsFromMetadata({ servings: 5000 }), undefined);
    });
});

describe('nutritionLine', () => {
    const summary = { kcal: 2080, protein_g: 152, carb_g: 208, fat_g: 56, matched: 7, total: 10 };

    it('divides by servings', () => {
        assert.strictEqual(nutritionLine(summary, 4), 'Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat');
    });

    it('labels the whole recipe when servings are unknown', () => {
        assert.strictEqual(nutritionLine(summary, undefined), 'Whole recipe: 2080 kcal · 152 g protein · 208 g carbs · 56 g fat');
    });

    it('is withheld below a 70 % match or with nothing matched', () => {
        assert.strictEqual(nutritionLine({ ...summary, matched: 6 }, 4), undefined);
        assert.strictEqual(nutritionLine({ ...summary, matched: 0, total: 0 }, 4), undefined);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './nutrition-line' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/nutrition-line.ts`:

```ts
// The optional "Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat" line,
// from the Reports engine's `aggregate_nutrition` (cook.md nutrition service; needs
// the `nutrition_api` feature). Same `/aggregate` shape the nutriscore plugin reads.
import { isRecord } from './cooklang-api';

export const NUTRITION_TEMPLATE = '{{ aggregate_nutrition(ingredients) | tojson }}';

/** Below this share of matched ingredients the totals undercount too much to print. */
export const MIN_MATCH_RATIO = 0.7;

export const MAX_SERVINGS = 1000;

export interface NutritionSummary {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    /** Ingredients the service resolved (placeholders excluded). */
    matched: number;
    /** Every ingredient sent: resolved, placeholders and failures. */
    total: number;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** The service returns unresolved ingredients as items tagged `nutrition_placeholder`. */
function isPlaceholder(item: unknown): boolean {
    return isRecord(item) && Array.isArray(item.warnings) && item.warnings.some(warning =>
        warning === 'nutrition_placeholder' || (isRecord(warning) && warning.code === 'nutrition_placeholder'));
}

export function parseNutritionOutput(output: string): NutritionSummary | undefined {
    let value: unknown;
    try {
        value = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.failures) || !isRecord(value.totals)) {
        return undefined;
    }
    const macros = value.totals.macros;
    if (!isRecord(macros) || !finite(macros.kcal) || !finite(macros.protein_g) || !finite(macros.carb_g) || !finite(macros.fat_g)) {
        return undefined;
    }
    const placeholders = value.items.filter(isPlaceholder).length;
    return {
        kcal: macros.kcal,
        protein_g: macros.protein_g,
        carb_g: macros.carb_g,
        fat_g: macros.fat_g,
        matched: value.items.length - placeholders,
        total: value.items.length + value.failures.length,
    };
}

/** `servings`, `serves` or `yield` metadata (any case) as a whole number 1–1000: `4`, `"4"`, `"4 people"`. */
export function servingsFromMetadata(metadata: Record<string, unknown>): number | undefined {
    for (const [key, value] of Object.entries(metadata)) {
        if (!/^(servings|serves|yield)$/i.test(key)) {
            continue;
        }
        const match = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
        const leading = /^(\d+)/.exec(match);
        if (!leading) {
            return undefined;
        }
        const servings = Number.parseInt(leading[1], 10);
        return servings >= 1 && servings <= MAX_SERVINGS ? servings : undefined;
    }
    return undefined;
}

/** Undefined when nothing matched or under {@link MIN_MATCH_RATIO} of the ingredients matched. */
export function nutritionLine(summary: NutritionSummary, servings: number | undefined): string | undefined {
    if (summary.total === 0 || summary.matched / summary.total < MIN_MATCH_RATIO) {
        return undefined;
    }
    const divisor = servings ?? 1;
    const round = (value: number): number => Math.round(value / divisor);
    const label = servings === undefined ? 'Whole recipe' : 'Per serving';
    return `${label}: ${round(summary.kcal)} kcal · ${round(summary.protein_g)} g protein · ${round(summary.carb_g)} g carbs · ${round(summary.fat_g)} g fat`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `65 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/nutrition-line.ts cookbook/src/nutrition-line.spec.ts
git commit -m "feat(cookbook): per-serving nutrition line from aggregate_nutrition, withheld below 70 % match"
```

---

### Task 9: Ingredient index

**Files:**
- Create: `cookbook/src/ingredient-index.ts`
- Test: `cookbook/src/ingredient-index.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/ingredient-index.spec.ts`:

```ts
import * as assert from 'assert';
import { buildIngredientIndex, normaliseIngredient } from './ingredient-index';
import { RecipeIngredient } from './recipe-template';

const ingredient = (name: string, reference = false): RecipeIngredient => ({ name, quantity: '', note: '', optional: false, reference });

describe('normaliseIngredient', () => {
    it('lowercases, collapses spaces and strips a simple plural from the last word', () => {
        assert.strictEqual(normaliseIngredient('  Cherry   Tomatoes '), 'cherry tomato');
        assert.strictEqual(normaliseIngredient('Eggs'), 'egg');
        assert.strictEqual(normaliseIngredient('berries'), 'berry');
        assert.strictEqual(normaliseIngredient('peaches'), 'peach');
        assert.strictEqual(normaliseIngredient('green beans'), 'green bean');
    });

    it('leaves words that only look plural', () => {
        assert.strictEqual(normaliseIngredient('hummus'), 'hummus');
        assert.strictEqual(normaliseIngredient('Swiss'), 'swiss');
        assert.strictEqual(normaliseIngredient('gas'), 'gas');
        assert.strictEqual(normaliseIngredient('rice'), 'rice');
        assert.strictEqual(normaliseIngredient(''), '');
    });
});

describe('buildIngredientIndex', () => {
    it('groups recipes under normalised names, sorted, without recipe references or duplicates', () => {
        const index = buildIngredientIndex([
            { id: 'r-2', title: 'Tomato Soup', ingredients: [ingredient('Tomatoes'), ingredient('salt'), ingredient('./Sauces/Pesto', true), ingredient('tomato')] },
            { id: 'r-1', title: 'Bruschetta', ingredients: [ingredient('tomato'), ingredient('Bread')] },
        ]);
        assert.deepStrictEqual(index, [
            { name: 'bread', recipes: [{ id: 'r-1', title: 'Bruschetta' }] },
            { name: 'salt', recipes: [{ id: 'r-2', title: 'Tomato Soup' }] },
            { name: 'tomato', recipes: [{ id: 'r-1', title: 'Bruschetta' }, { id: 'r-2', title: 'Tomato Soup' }] },
        ]);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './ingredient-index' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/ingredient-index.ts`:

```ts
// The "Index of ingredients": every ingredient name, normalised, with links to
// the recipes that use it. References to other recipes are not ingredients.
import { compareNames } from './book-tree';
import { RecipeIngredient } from './recipe-template';

export interface IndexedRecipe {
    id: string;
    title: string;
    ingredients: readonly RecipeIngredient[];
}

export interface IndexEntry {
    name: string;
    recipes: { id: string; title: string }[];
}

/** Lowercase, single spaces, and a simple plural on the last word stripped: `Cherry Tomatoes` → `cherry tomato`. */
export function normaliseIngredient(name: string): string {
    const words = name.toLowerCase().trim().split(/\s+/).filter(word => word !== '');
    if (words.length === 0) {
        return '';
    }
    const last = words[words.length - 1];
    let singular = last;
    if (/[a-z]ies$/.test(last) && last.length > 4) {
        singular = `${last.slice(0, -3)}y`;
    } else if (/(oes|ches|shes|xes|sses)$/.test(last)) {
        singular = last.slice(0, -2);
    } else if (/[a-z]s$/.test(last) && !/(ss|us|is)$/.test(last) && last.length > 3) {
        singular = last.slice(0, -1);
    }
    words[words.length - 1] = singular;
    return words.join(' ');
}

export function buildIngredientIndex(recipes: readonly IndexedRecipe[]): IndexEntry[] {
    const entries = new Map<string, Map<string, string>>();
    for (const recipe of recipes) {
        for (const ingredient of recipe.ingredients) {
            const name = ingredient.reference ? '' : normaliseIngredient(ingredient.name);
            if (name === '') {
                continue;
            }
            let users = entries.get(name);
            if (!users) {
                users = new Map();
                entries.set(name, users);
            }
            users.set(recipe.id, recipe.title);
        }
    }
    return [...entries.entries()]
        .sort(([a], [b]) => compareNames(a, b))
        .map(([name, users]) => ({
            name,
            recipes: [...users.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => compareNames(a.title, b.title) || compareNames(a.id, b.id)),
        }));
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `68 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/ingredient-index.ts cookbook/src/ingredient-index.spec.ts
git commit -m "feat(cookbook): ingredient index with normalised names"
```

---

### Task 10: Book HTML with print CSS, plus a fixture snapshot

**Files:**
- Create: `cookbook/src/book-html.ts`
- Create: `cookbook/test-fixtures/family-book/**` (below), `cookbook/test-fixtures/family-book.snapshot.html` (generated in Step 6)
- Test: `cookbook/src/book-html.spec.ts`

Each `.json` file in the fixture is the real cooklang-reports 0.5.2 output of `RECIPE_TEMPLATE` for the `.cook` next to it; the snapshot test uses it in place of the editor's render. `Broken.cook` has no `.json`, which the test treats as a failed render, and `Drafts/` is excluded by default.

- [ ] **Step 1: Create the fixture folder**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook
mkdir -p "test-fixtures/family-book/01 Breakfast" "test-fixtures/family-book/2 Soups" "test-fixtures/family-book/10 Mains/Pasta" "test-fixtures/family-book/Drafts"
```

Create `cookbook/test-fixtures/family-book/README.md`:

```markdown
---
title: The Family Book
---
Recipes we **actually** cook, kept in plain text.

> Cook with whatever is in the fridge.
```

Create `cookbook/test-fixtures/family-book/Quick Toast.cook`:

```
---
servings: 1
---

Toast @bread{2%slices} and spread with @butter{10%g}.
```

Create `cookbook/test-fixtures/family-book/Quick Toast.json`:

```json
{"metadata":{"servings":1},"ingredients":[{"name":"bread","quantity":"2 slices","note":"","reference":false},{"name":"butter","quantity":"10 g","note":"","reference":false}],"cookware":[],"sections":[{"name":"","blocks":[{"kind":"step","number":1,"text":"Toast 2 slices bread and spread with 10 g butter."}]}]}
```

Create `cookbook/test-fixtures/family-book/Broken.cook`:

```
---
title: Broken
---

The test treats this recipe as one the editor failed to render.
```

Create `cookbook/test-fixtures/family-book/01 Breakfast/Pancakes.cook`:

```
---
title: Fluffy Pancakes
servings: 4
time: 25 min
tags: [breakfast, sweet]
---

Whisk @eggs{2}, @milk{300%ml} and @flour{200%g} in a #bowl{}.

Fry ladlefuls in a #frying pan{} with @?butter{} for ~{2%minutes} a side.
```

Create `cookbook/test-fixtures/family-book/01 Breakfast/Pancakes.json`:

```json
{"metadata":{"title":"Fluffy Pancakes","servings":4,"time":"25 min","tags":["breakfast","sweet"]},"ingredients":[{"name":"eggs","quantity":"2","note":"","reference":false},{"name":"milk","quantity":"300 ml","note":"","reference":false},{"name":"flour","quantity":"200 g","note":"","reference":false},{"name":"?butter","quantity":"","note":"","reference":false}],"cookware":[{"name":"bowl","quantity":"","note":""},{"name":"frying pan","quantity":"","note":""}],"sections":[{"name":"","blocks":[{"kind":"step","number":1,"text":"Whisk 2 eggs, 300 ml milk and 200 g flour in a bowl."},{"kind":"step","number":2,"text":"Fry ladlefuls in a frying pan with ?butter for 2 minutes a side."}]}]}
```

Create `cookbook/test-fixtures/family-book/2 Soups/README.md`:

```markdown
---
title: Soups & Stews
order: 1
---
# Why soup

Cheap, warm and forgiving. See [Cooklang](https://cooklang.org) for the format.

- freezes well
- better the next day
```

Create `cookbook/test-fixtures/family-book/2 Soups/Tomato Soup.cook`:

```
---
title: Tomato Soup
servings: 4
prep time: 10 min
cook time: 30 min
source:
  name: Grandma
  url: https://example.com/soup
---

> A family favourite.

Chop @onion{1}(diced) and @garlic{2%cloves}.

Fry in #pot{} with @olive oil{2%tbsp}, add @tomatoes{800%g} and simmer for ~{25%minutes}.

== Finish ==

Blend with @salt{} until smooth.
```

Create `cookbook/test-fixtures/family-book/2 Soups/Tomato Soup.json`:

```json
{"metadata":{"title":"Tomato Soup","servings":4,"prep time":"10 min","cook time":"30 min","source":{"name":"Grandma","url":"https://example.com/soup"}},"ingredients":[{"name":"onion","quantity":"1","note":"diced","reference":false},{"name":"garlic","quantity":"2 cloves","note":"","reference":false},{"name":"olive oil","quantity":"2 tbsp","note":"","reference":false},{"name":"tomatoes","quantity":"800 g","note":"","reference":false},{"name":"salt","quantity":"","note":"","reference":false}],"cookware":[{"name":"pot","quantity":"","note":""}],"sections":[{"name":"","blocks":[{"kind":"text","text":"A family favourite."},{"kind":"step","number":1,"text":"Chop 1 onion and 2 cloves garlic."},{"kind":"step","number":2,"text":"Fry in pot with 2 tbsp olive oil, add 800 g tomatoes and simmer for 25 minutes."}]},{"name":"Finish","blocks":[{"kind":"step","number":1,"text":"Blend with salt until smooth."}]}]}
```

Create `cookbook/test-fixtures/family-book/10 Mains/Pasta/Carbonara.cook`:

```
---
title: Carbonara
servings: 2
---

Boil @spaghetti{200%g} in salted water.

Mix @eggs{2} with @pecorino{50%g} and toss with the pasta and @guanciale{100%g}.
```

Create `cookbook/test-fixtures/family-book/10 Mains/Pasta/Carbonara.json`:

```json
{"metadata":{"title":"Carbonara","servings":2},"ingredients":[{"name":"spaghetti","quantity":"200 g","note":"","reference":false},{"name":"eggs","quantity":"2","note":"","reference":false},{"name":"pecorino","quantity":"50 g","note":"","reference":false},{"name":"guanciale","quantity":"100 g","note":"","reference":false}],"cookware":[],"sections":[{"name":"","blocks":[{"kind":"step","number":1,"text":"Boil 200 g spaghetti in salted water."},{"kind":"step","number":2,"text":"Mix 2 eggs with 50 g pecorino and toss with the pasta and 100 g guanciale."}]}]}
```

Create `cookbook/test-fixtures/family-book/Drafts/Idea.cook`:

```
Excluded by the default cookbook.exclude setting.
```

- [ ] **Step 2: Write the failing test**

Create `cookbook/src/book-html.spec.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { BookHtmlInput, NotIncluded, RenderedRecipe, bookCss, bookIntros, buildBookHtml, chapterIds, recipeIds } from './book-html';
import { BookTree, buildBookTree, readmePaths, recipesInOrder } from './book-tree';
import { IndexedRecipe, buildIngredientIndex } from './ingredient-index';
import { renderRecipeHtml } from './recipe-html';
import { parseRecipeOutput, recipeTitle } from './recipe-template';

const FIXTURE = path.resolve(__dirname, '../test-fixtures/family-book');
const SNAPSHOT = path.resolve(__dirname, '../test-fixtures/family-book.snapshot.html');
const EXCLUDE = ['Drafts', 'config'];

function tree(paths: string[], readmes: Record<string, string> = {}): BookTree {
    return buildBookTree({ rootName: 'Book', paths, readmes: new Map(Object.entries(readmes)), exclude: EXCLUDE });
}

function recipe(id: string, path: string, title: string): RenderedRecipe {
    return { id, path, title, html: `<article class="recipe" id="${id}">${title}</article>` };
}

function input(overrides: Partial<BookHtmlInput>): BookHtmlInput {
    return {
        tree: tree(['a.cook']), recipes: new Map(), intros: new Map(), index: [], notIncluded: [],
        generatedOn: '10 October 2026', pageSize: 'A4', ...overrides,
    };
}

describe('recipeIds and chapterIds', () => {
    it('number recipes and chapters in reading order', () => {
        const book = tree(['z.cook', 'B/b.cook', 'A/a.cook', 'A/Sub/s.cook']);
        assert.deepStrictEqual([...recipeIds(book)], [['z.cook', 'r-1'], ['A/a.cook', 'r-2'], ['A/Sub/s.cook', 'r-3'], ['B/b.cook', 'r-4']]);
        assert.deepStrictEqual([...chapterIds(book)], [['A', 'c-1'], ['A/Sub', 'c-2'], ['B', 'c-3']]);
    });
});

describe('bookIntros', () => {
    it('shifts cover headings by 1 and chapter headings by depth, dropping a heading used as the title', () => {
        const readmes = { 'README.md': '# My Book\n\n## Hello', 'A/README.md': '# Intro', 'A/Sub/README.md': '# Deeper' };
        const book = tree(['README.md', 'A/README.md', 'A/a.cook', 'A/Sub/README.md', 'A/Sub/s.cook'], readmes);
        assert.deepStrictEqual([...bookIntros(book, new Map(Object.entries(readmes)))], [
            ['README.md', '<h3>Hello</h3>'],
            ['A/README.md', '<h2>Intro</h2>'],
            ['A/Sub/README.md', '<h3>Deeper</h3>'],
        ]);
    });

    it('resolves README images through the callback with the README path', () => {
        const readmes = { 'A/README.md': '![Bowl](bowl.jpg)' };
        const book = tree(['A/README.md', 'A/a.cook'], readmes);
        const seen: string[] = [];
        const intros = bookIntros(book, new Map(Object.entries(readmes)), (readme, src) => {
            seen.push(`${readme}:${src}`);
            return 'data:image/jpeg;base64,AAAA';
        });
        assert.deepStrictEqual(seen, ['A/README.md:bowl.jpg']);
        assert.strictEqual(intros.get('A/README.md'), '<p><img src="data:image/jpeg;base64,AAAA" alt="Bowl"></p>');
    });
});

describe('bookCss', () => {
    it('sets the page size and breaks pages before chapters and recipes', () => {
        assert.ok(bookCss('Letter').includes('@page { size: Letter;'));
        assert.ok(bookCss('A4').includes('.chapter, .recipe, .index, .appendix { break-before: page; page-break-before: always; }'));
        assert.ok(bookCss('A4').includes('.ingredients { break-inside: avoid;'));
    });
});

describe('buildBookHtml', () => {
    it('links the contents to recipes and chapters and leaves out recipes that failed', () => {
        const book = tree(['top.cook', 'A/a.cook', 'A/gone.cook']);
        const html = buildBookHtml(input({
            tree: book,
            recipes: new Map([['top.cook', recipe('r-1', 'top.cook', 'Top')], ['A/a.cook', recipe('r-2', 'A/a.cook', 'A & B')]]),
            notIncluded: [{ path: 'A/gone.cook', reason: 'Template error: <bad>' }],
        }));
        assert.ok(html.includes('<ul><li class="toc-recipe"><a href="#r-1">Top</a></li><li class="toc-chapter"><a href="#c-1">A</a><ul><li class="toc-recipe"><a href="#r-2">A &amp; B</a></li></ul></li><li class="toc-extra"><a href="#not-included">Not included</a></li></ul>'));
        assert.ok(html.includes('<section class="chapter depth-1" id="c-1">\n<h1 class="chapter-title">A</h1>\n<article class="recipe" id="r-2">A & B</article>\n</section>'));
        assert.ok(html.includes('<li><code>A/gone.cook</code>: Template error: &lt;bad&gt;</li>'));
        assert.ok(!html.includes('id="index"'));
    });

    it('groups the index by first letter with links', () => {
        const html = buildBookHtml(input({
            index: [{ name: '7up', recipes: [{ id: 'r-1', title: 'Fizz' }] }, { name: 'apple', recipes: [{ id: 'r-1', title: 'Fizz' }, { id: 'r-2', title: 'Pie' }] }],
        }));
        assert.ok(html.includes('<h2 class="index-letter">#</h2>\n<p class="index-entry"><span class="index-name">7up</span> <a href="#r-1">Fizz</a></p>\n<h2 class="index-letter">A</h2>'));
        assert.ok(html.includes('<span class="index-name">apple</span> <a href="#r-1">Fizz</a>, <a href="#r-2">Pie</a>'));
        assert.ok(html.includes('<li class="toc-extra"><a href="#index">Index of ingredients</a></li>'));
    });

    it('escapes the title and the generated date', () => {
        const html = buildBookHtml(input({ tree: tree(['README.md', 'a.cook'], { 'README.md': '---\ntitle: <Ours>\n---\n' }), generatedOn: '<today>' }));
        assert.ok(html.includes('<title>&lt;Ours&gt;</title>'));
        assert.ok(html.includes('<h1 class="book-title">&lt;Ours&gt;</h1>'));
        assert.ok(html.includes('<p class="generated">Generated on &lt;today&gt;</p>'));
    });
});

function walk(dir: string, prefix = ''): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(path.join(dir, entry.name), relative) : [relative];
    });
}

/** Builds the fixture book the way the export command does, with each `.json` standing in for the editor's render. */
function fixtureBook(): string {
    const paths = walk(FIXTURE);
    const readmes = new Map(readmePaths(paths, EXCLUDE).map(readme => [readme, fs.readFileSync(path.join(FIXTURE, readme), 'utf8')]));
    const book = buildBookTree({ rootName: 'family-book', paths, readmes, exclude: EXCLUDE });
    const ids = recipeIds(book);
    const recipes = new Map<string, RenderedRecipe>();
    const notIncluded: NotIncluded[] = [];
    const indexed: IndexedRecipe[] = [];
    for (const entry of recipesInOrder(book)) {
        const json = path.join(FIXTURE, entry.path.replace(/\.cook$/, '.json'));
        const data = fs.existsSync(json) ? parseRecipeOutput(fs.readFileSync(json, 'utf8')) : undefined;
        if (!data) {
            notIncluded.push({ path: entry.path, reason: 'syntax error: unexpected end of input' });
            continue;
        }
        const id = ids.get(entry.path)!;
        const title = recipeTitle(data, entry.title);
        const nutritionLine = entry.path === '2 Soups/Tomato Soup.cook' ? 'Per serving: 180 kcal · 4 g protein · 20 g carbs · 9 g fat' : undefined;
        recipes.set(entry.path, { id, path: entry.path, title, html: renderRecipeHtml({ id, title, data, images: { steps: {} }, nutritionLine }) });
        indexed.push({ id, title, ingredients: data.ingredients });
    }
    return buildBookHtml({
        tree: book, recipes, intros: bookIntros(book, readmes), index: buildIngredientIndex(indexed),
        notIncluded, generatedOn: '10 October 2026', pageSize: 'A4',
    });
}

describe('fixture book', () => {
    it('matches the reviewed snapshot (UPDATE_SNAPSHOT=1 rewrites it)', () => {
        const html = fixtureBook();
        if (process.env.UPDATE_SNAPSHOT === '1') {
            fs.writeFileSync(SNAPSHOT, html);
        }
        assert.ok(fs.existsSync(SNAPSHOT), `Missing ${SNAPSHOT}; run UPDATE_SNAPSHOT=1 npm test and review it`);
        assert.strictEqual(html, fs.readFileSync(SNAPSHOT, 'utf8'));
    });

    it('orders chapters by README order then numeric name and skips Drafts', () => {
        const html = fixtureBook();
        const order = ['id="c-1"', 'Soups &amp; Stews', 'Tomato Soup', 'Breakfast', 'Fluffy Pancakes', 'Mains', 'Pasta', 'Carbonara', 'id="index"', 'id="not-included"']
            .map(marker => html.indexOf(marker, html.indexOf('</nav>')));
        assert.ok(order.every(position => position > 0), String(order));
        assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
        assert.ok(!html.includes('Idea'));
        assert.ok(html.includes('<li><code>Broken.cook</code>: syntax error: unexpected end of input</li>'));
    });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './book-html' …`.

- [ ] **Step 4: Implement**

Create `cookbook/src/book-html.ts`:

```ts
// Assembles the whole book as one HTML document with print CSS: cover, contents,
// chapters with intros and recipes, the ingredient index and the "Not included"
// appendix. Links are in-document anchors, which Chromium keeps as PDF links.
import { BookTree, Chapter, chaptersInOrder, recipesInOrder } from './book-tree';
import { PageSize } from './cooklang-api';
import { IndexEntry } from './ingredient-index';
import { escapeHtml, markdownToHtml } from './markdown';

export interface RenderedRecipe {
    id: string;
    path: string;
    title: string;
    /** The `<article>` from `renderRecipeHtml`. */
    html: string;
}

export interface NotIncluded {
    path: string;
    reason: string;
}

export interface BookHtmlInput {
    tree: BookTree;
    /** By recipe path; recipes missing here are left out (and listed in {@link notIncluded}). */
    recipes: ReadonlyMap<string, RenderedRecipe>;
    /** README path → intro HTML, from {@link bookIntros}. */
    intros: ReadonlyMap<string, string>;
    index: readonly IndexEntry[];
    notIncluded: readonly NotIncluded[];
    /** E.g. `10 October 2026`. */
    generatedOn: string;
    pageSize: PageSize;
}

/** `r-1`, `r-2`, … in reading order. */
export function recipeIds(tree: BookTree): Map<string, string> {
    return new Map(recipesInOrder(tree).map((recipe, index) => [recipe.path, `r-${index + 1}`]));
}

/** `c-1`, `c-2`, … in reading order. */
export function chapterIds(tree: BookTree): Map<string, string> {
    return new Map(chaptersInOrder(tree).map((chapter, index) => [chapter.path, `c-${index + 1}`]));
}

/**
 * Intro HTML for the cover README and every chapter README. Cover headings start at
 * `<h2>` (and its first `#` heading is dropped when it is the book title); a chapter
 * at depth d shifts its headings below its own `<h{d}>`.
 */
export function bookIntros(
    tree: BookTree,
    readmes: ReadonlyMap<string, string>,
    resolveImage?: (readmePath: string, src: string) => string | undefined,
): Map<string, string> {
    const intros = new Map<string, string>();
    const add = (readme: string | undefined, headingShift: number, dropFirstHeading: boolean): void => {
        const text = readme !== undefined ? readmes.get(readme) : undefined;
        if (readme === undefined || text === undefined) {
            return;
        }
        const html = markdownToHtml(text, { headingShift, dropFirstHeading, resolveImage: src => resolveImage?.(readme, src) });
        if (html !== '') {
            intros.set(readme, html);
        }
    };
    add(tree.readme, 1, tree.titleFromHeading);
    for (const chapter of chaptersInOrder(tree)) {
        add(chapter.readme, chapter.depth, false);
    }
    return intros;
}

/** Usable page height minus a margin, so the cover never spills onto a second page. */
const COVER_HEIGHT: Record<PageSize, string> = { A4: '252mm', Letter: '234mm' };

export function bookCss(pageSize: PageSize): string {
    return `
@page { size: ${pageSize}; margin: 18mm 16mm 20mm; }
html { font-size: 11pt; }
body { margin: 0; color: #1d1d1b; background: #fff; font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; line-height: 1.45; }
h1, h2, h3, h4, .meta, .step-number, .toc, .index-letter, .generated { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
a { color: inherit; text-decoration: none; }
img { max-width: 100%; }
blockquote { border-left: 0.8mm solid #d8d8d0; margin: 3mm 0; padding-left: 4mm; color: #4a4a45; }
.cover { position: relative; height: ${COVER_HEIGHT[pageSize]}; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; page-break-after: always; }
.book-title { font-size: 34pt; line-height: 1.15; margin: 0 0 10mm; }
.cover-intro { max-width: 130mm; margin: 0 auto; text-align: left; }
.generated { position: absolute; left: 0; right: 0; bottom: 0; margin: 0; font-size: 9pt; color: #6b6b66; }
.toc h1 { font-size: 24pt; margin: 0 0 8mm; }
.toc ul { list-style: none; padding-left: 0; margin: 0; }
.toc ul ul { padding-left: 6mm; }
.toc li { margin: 1.4mm 0; }
.toc-chapter > a { font-weight: 600; }
.chapter, .recipe, .index, .appendix { break-before: page; page-break-before: always; }
.chapter-title { font-size: 26pt; margin: 30mm 0 8mm; }
.depth-2 > .chapter-title { font-size: 21pt; }
.depth-3 > .chapter-title { font-size: 17pt; }
.recipe-title { font-size: 20pt; margin: 0 0 4mm; }
.title-image { display: block; width: 100%; max-height: 110mm; object-fit: cover; margin: 0 0 4mm; border-radius: 2mm; }
.meta, .source, .tags, .nutrition { font-size: 9.5pt; color: #4a4a45; margin: 1mm 0; }
.tag { border: 0.3mm solid #c9c9c2; border-radius: 3mm; padding: 0 2mm; }
.nutrition { font-weight: 600; }
h3 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.06em; margin: 6mm 0 2mm; }
.section-name { font-size: 11pt; margin: 4mm 0 2mm; }
.ingredients { break-inside: avoid; page-break-inside: avoid; }
.ingredients ul, .cookware ul { columns: 2; column-gap: 8mm; padding-left: 4mm; margin: 0; }
.qty { font-weight: 600; }
.note, .optional { color: #6b6b66; }
.optional { font-style: italic; font-size: 9pt; }
.text { font-style: italic; color: #4a4a45; }
.step { position: relative; padding-left: 9mm; margin: 0 0 2.5mm; break-inside: avoid; page-break-inside: avoid; }
.step-number { position: absolute; left: 0; top: 0; font-weight: 700; }
.step p { margin: 0; }
.step-image { display: block; max-width: 60%; margin: 2mm 0 0; border-radius: 1.5mm; }
.index-columns { columns: 2; column-gap: 10mm; font-size: 9.5pt; }
.index-letter { font-size: 12pt; margin: 4mm 0 1mm; break-after: avoid; page-break-after: avoid; }
.index-entry { margin: 0.6mm 0; break-inside: avoid; page-break-inside: avoid; }
.index-name { font-weight: 600; }
.appendix code { font-size: 9pt; }
`.trim();
}

function tocRecipes(entries: readonly { path: string }[], recipes: ReadonlyMap<string, RenderedRecipe>): string[] {
    return entries.flatMap(entry => {
        const recipe = recipes.get(entry.path);
        return recipe ? [`<li class="toc-recipe"><a href="#${recipe.id}">${escapeHtml(recipe.title)}</a></li>`] : [];
    });
}

export function buildBookHtml(input: BookHtmlInput): string {
    const { tree, recipes, intros } = input;
    const chapterId = chapterIds(tree);
    const recipeHtml = (entries: readonly { path: string }[]): string[] =>
        entries.flatMap(entry => recipes.get(entry.path)?.html ?? []);

    const tocChapter = (chapter: Chapter): string => {
        const children = [...tocRecipes(chapter.recipes, recipes), ...chapter.chapters.map(tocChapter)];
        const list = children.length > 0 ? `<ul>${children.join('')}</ul>` : '';
        return `<li class="toc-chapter"><a href="#${chapterId.get(chapter.path)}">${escapeHtml(chapter.title)}</a>${list}</li>`;
    };

    const chapterHtml = (chapter: Chapter): string => {
        const level = Math.min(chapter.depth, 3);
        const intro = chapter.readme !== undefined ? intros.get(chapter.readme) : undefined;
        return [
            `<section class="chapter depth-${chapter.depth}" id="${chapterId.get(chapter.path)}">`,
            `<h${level} class="chapter-title">${escapeHtml(chapter.title)}</h${level}>`,
            ...(intro !== undefined ? [`<div class="intro">${intro}</div>`] : []),
            ...recipeHtml(chapter.recipes),
            ...chapter.chapters.map(chapterHtml),
            '</section>',
        ].join('\n');
    };

    const cover = tree.readme !== undefined ? intros.get(tree.readme) : undefined;
    const toc = [
        ...tocRecipes(tree.recipes, recipes),
        ...tree.chapters.map(tocChapter),
        ...(input.index.length > 0 ? ['<li class="toc-extra"><a href="#index">Index of ingredients</a></li>'] : []),
        ...(input.notIncluded.length > 0 ? ['<li class="toc-extra"><a href="#not-included">Not included</a></li>'] : []),
    ];

    const parts: string[] = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        `<title>${escapeHtml(tree.title)}</title>`,
        `<style>\n${bookCss(input.pageSize)}\n</style>`,
        '</head>',
        '<body>',
        '<section class="cover">',
        `<h1 class="book-title">${escapeHtml(tree.title)}</h1>`,
        ...(cover !== undefined ? [`<div class="cover-intro">${cover}</div>`] : []),
        `<p class="generated">Generated on ${escapeHtml(input.generatedOn)}</p>`,
        '</section>',
        '<nav class="toc">',
        '<h1>Contents</h1>',
        `<ul>${toc.join('')}</ul>`,
        '</nav>',
        ...recipeHtml(tree.recipes),
        ...tree.chapters.map(chapterHtml),
    ];

    if (input.index.length > 0) {
        parts.push('<section class="index" id="index">', '<h1>Index of ingredients</h1>', '<div class="index-columns">');
        let letter = '';
        for (const entry of input.index) {
            const first = entry.name.charAt(0).toUpperCase();
            const group = /[A-Z]/.test(first) ? first : '#';
            if (group !== letter) {
                letter = group;
                parts.push(`<h2 class="index-letter">${escapeHtml(group)}</h2>`);
            }
            const links = entry.recipes.map(recipe => `<a href="#${recipe.id}">${escapeHtml(recipe.title)}</a>`).join(', ');
            parts.push(`<p class="index-entry"><span class="index-name">${escapeHtml(entry.name)}</span> ${links}</p>`);
        }
        parts.push('</div>', '</section>');
    }

    if (input.notIncluded.length > 0) {
        parts.push(
            '<section class="appendix" id="not-included">',
            '<h1>Not included</h1>',
            '<p>These recipes could not be rendered. Open each one in Cook Editor to see what is wrong.</p>',
            `<ul>${input.notIncluded.map(entry => `<li><code>${escapeHtml(entry.path)}</code>: ${escapeHtml(entry.reason)}</li>`).join('')}</ul>`,
            '</section>',
        );
    }

    parts.push('</body>', '</html>', '');
    return parts.join('\n');
}
```

- [ ] **Step 5: Run the tests (only the snapshot fails)**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: `76 passing`, `1 failing`: `fixture book matches the reviewed snapshot` with `Missing …/test-fixtures/family-book.snapshot.html; run UPDATE_SNAPSHOT=1 npm test and review it`.

- [ ] **Step 6: Generate and review the snapshot**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook
UPDATE_SNAPSHOT=1 npm test
sed -n '/<body>/,$p' test-fixtures/family-book.snapshot.html
open test-fixtures/family-book.snapshot.html
```

Check the body and the browser print preview (Cmd-P) before accepting it:
- cover `<h1 class="book-title">The Family Book</h1>` with the bold intro and quote, `Generated on 10 October 2026`;
- contents order: Quick Toast (r-2), **Soups & Stews** (README `order: 1`) › Tomato Soup, Breakfast › Fluffy Pancakes, Mains › Pasta › Carbonara, Index of ingredients, Not included;
- Soups intro starts with `<h2>Why soup</h2>`, has the `https://cooklang.org` link and a two-item list;
- Tomato Soup has `Serves 4 · Prep 10 min · Cook 30 min`, the Grandma source link, the nutrition line, the italic "A family favourite." text block, steps 1–2 then `Finish` with step 1;
- Fluffy Pancakes lists `butter` with `optional`, and its step text reads "with butter" (no `?`);
- the index has `egg` → Carbonara, Fluffy Pancakes and `tomato` → Tomato Soup; no `Idea` anywhere; `Broken.cook` under Not included;
- print preview: each chapter and recipe starts on a new page.

- [ ] **Step 7: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `77 passing`.

- [ ] **Step 8: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/book-html.ts cookbook/src/book-html.spec.ts cookbook/test-fixtures
git commit -m "feat(cookbook): assemble the book HTML with print CSS, contents, index and appendix"
```

---

### Task 11: Settings

**Files:**
- Create: `cookbook/src/settings.ts`
- Test: `cookbook/src/settings.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/settings.spec.ts`:

```ts
import * as assert from 'assert';
import { readSettings } from './settings';

describe('readSettings', () => {
    it('uses the defaults when nothing is set', () => {
        assert.deepStrictEqual(readSettings(() => undefined), { exclude: ['Drafts', 'config'], nutrition: true, pageSize: 'A4' });
    });

    it('reads valid values and drops invalid ones', () => {
        const values: Record<string, unknown> = { exclude: [' Old ', '', 3, 'Drafts/2019'], nutrition: false, pageSize: 'Letter' };
        assert.deepStrictEqual(readSettings(key => values[key]), { exclude: ['Old', 'Drafts/2019'], nutrition: false, pageSize: 'Letter' });
        assert.strictEqual(readSettings(key => (key === 'pageSize' ? 'A3' : undefined)).pageSize, 'A4');
        assert.deepStrictEqual(readSettings(key => (key === 'exclude' ? [] : undefined)).exclude, []);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './settings' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/settings.ts`:

```ts
import { PageSize } from './cooklang-api';

export interface CookbookSettings {
    /** Folder names or folder paths left out of the book. */
    exclude: string[];
    /** Print a nutrition line per recipe when the plan includes `nutrition_api`. */
    nutrition: boolean;
    pageSize: PageSize;
}

export const DEFAULT_EXCLUDE: readonly string[] = ['Drafts', 'config'];

/** Normalises the `cookbook.*` settings; `get` is `workspace.getConfiguration('cookbook').get`. */
export function readSettings(get: (key: string) => unknown): CookbookSettings {
    const exclude = get('exclude');
    return {
        exclude: Array.isArray(exclude)
            ? exclude.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(entry => entry !== '')
            : [...DEFAULT_EXCLUDE],
        nutrition: get('nutrition') !== false,
        pageSize: get('pageSize') === 'Letter' ? 'Letter' : 'A4',
    };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `79 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/settings.ts cookbook/src/settings.spec.ts
git commit -m "feat(cookbook): read cookbook.exclude, cookbook.nutrition and cookbook.pageSize"
```

---

### Task 12: Export command

**Files:**
- Create: `cookbook/src/export-command.ts`
- Test: `cookbook/src/export-command.spec.ts`

The spec fakes the editor API (`CooklangApi` over a fake `execute`), the workspace and the UI, so it covers the missing-API path, the 500-recipe limit, progress messages, concurrency 4, cancellation, failures listed under "Not included", nutrition gating, photo inlining, the save toast with **Open**, cancel and error results.

- [ ] **Step 1: Write the failing test**

Create `cookbook/src/export-command.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, ExportPdfArgs, REQUIRED_COMMANDS } from './cooklang-api';
import {
    BookFolder, CookbookExporter, CookbookUi, CookbookWorkspace, EDITOR_DOWNLOAD_URL, MAX_RECIPES, UPDATE_MESSAGE,
    folderChoices, mapLimit, pdfFileName,
} from './export-command';
import { CookbookSettings } from './settings';

const FOLDER: BookFolder = { uri: 'file:///ws/Book', name: 'Book' };
const SETTINGS: CookbookSettings = { exclude: ['Drafts', 'config'], nutrition: true, pageSize: 'A4' };

const recipeJson = (title: string, ingredient = 'egg'): string => JSON.stringify({
    metadata: { title, servings: 2 },
    ingredients: [{ name: ingredient, quantity: '1', note: '', reference: false }],
    cookware: [],
    sections: [{ name: '', blocks: [{ kind: 'step', number: 1, text: `Cook ${ingredient}.` }] }],
});

const aggregate = JSON.stringify({
    items: [{ ingredient: 'egg', amount: { mass_g: 50 }, warnings: [] }],
    failures: [],
    totals: { mass_g: 50, macros: { kcal: 144, protein_g: 12.6, carb_g: 0.8, fat_g: 9.6 }, micros: {} },
});

interface Fixture {
    exporter: CookbookExporter;
    calls: Array<{ command: string; args: unknown[] }>;
    ui: { messages: string[]; opened: string[]; progress: string[] };
    exported: () => ExportPdfArgs | undefined;
}

interface Options {
    commands?: readonly string[];
    files?: Record<string, string>;
    paths?: string[];
    hasFeature?: boolean;
    renders?: Record<string, unknown>;
    nutrition?: unknown;
    images?: Record<string, unknown>;
    exportResult?: unknown;
    choice?: string;
    cancelAfter?: number;
    settings?: Partial<CookbookSettings>;
}

function fixture(options: Options = {}): Fixture {
    const files = options.files ?? {};
    const calls: Array<{ command: string; args: unknown[] }> = [];
    let renderCount = 0;
    const api = new CooklangApi(async (command, ...args) => {
        calls.push({ command, args });
        const arg = args[0] as { uri: string; template?: string };
        switch (command) {
            case 'cooklang.api.hasFeature':
                return options.hasFeature ?? false;
            case 'cooklang.api.renderReport':
                if (arg.template!.includes('aggregate_nutrition')) {
                    return options.nutrition ?? { ok: true, output: aggregate };
                }
                renderCount++;
                return options.renders?.[arg.uri] ?? { ok: true, output: recipeJson(decodeURIComponent(arg.uri.split('/').pop()!.replace('.cook', ''))) };
            case 'cooklang.api.recipeImages':
                return options.images?.[arg.uri] ?? { steps: {} };
            case 'cooklang.api.exportPdf':
                return options.exportResult ?? { saved: true, path: '/Users/me/Book.pdf' };
        }
        throw new Error(`unexpected ${command}`);
    }, async () => options.commands ?? REQUIRED_COMMANDS);
    const workspace: CookbookWorkspace = {
        listFiles: async () => options.paths ?? Object.keys(files),
        uriOf: (folder, path) => `${folder.uri}/${path.split('/').map(encodeURIComponent).join('/')}`,
        readText: async uri => files[decodeURIComponent(uri.slice(FOLDER.uri.length + 1))],
        images: {
            size: async uri => (uri.endsWith('.jpg') ? 3 : undefined),
            read: async () => new Uint8Array([1, 2, 3]),
        },
    };
    const state = { messages: [] as string[], opened: [] as string[], progress: [] as string[] };
    const ui: CookbookUi = {
        withProgress: (_title, task) => task(message => state.progress.push(message), {
            get isCancellationRequested() { return options.cancelAfter !== undefined && renderCount >= options.cancelAfter; },
        }),
        showInformation: async (message, ...actions) => { state.messages.push(`info: ${message} [${actions.join(',')}]`); return options.choice; },
        showWarning: async (message, ...actions) => { state.messages.push(`warning: ${message} [${actions.join(',')}]`); return options.choice; },
        showError: async message => { state.messages.push(`error: ${message}`); },
        openExternal: async url => { state.opened.push(url); },
        openFile: async path => { state.opened.push(`file:${path}`); },
    };
    const exporter = new CookbookExporter(api, workspace, ui, () => ({ ...SETTINGS, ...options.settings }), () => '10 October 2026');
    const exported = (): ExportPdfArgs | undefined => calls.find(call => call.command === 'cooklang.api.exportPdf')?.args[0] as ExportPdfArgs | undefined;
    return { exporter, calls, ui: state, exported };
}

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('pdfFileName', () => {
    it('removes reserved and control characters and caps the length', () => {
        assert.strictEqual(pdfFileName('Soups / Stews: "best"'), 'Soups Stews best.pdf');
        assert.strictEqual(pdfFileName('a\u0000b'), 'a b.pdf');
        assert.strictEqual(pdfFileName(' ?? '), 'Cookbook.pdf');
        assert.strictEqual(pdfFileName('x'.repeat(300)).length, 200);
    });
});

describe('mapLimit', () => {
    it('keeps at most `limit` calls in flight and preserves order', async () => {
        let active = 0;
        let peak = 0;
        const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async value => {
            active++;
            peak = Math.max(peak, active);
            await tick();
            active--;
            return value * 2;
        });
        assert.strictEqual(peak, 4);
        assert.deepStrictEqual(results, [2, 4, 6, 8, 10, 12, 14, 16, 18]);
    });

    it('stops starting work once cancelled', async () => {
        let started = 0;
        const results = await mapLimit([1, 2, 3, 4, 5], 1, async value => { started++; return value; }, () => started >= 2);
        assert.deepStrictEqual(results, [1, 2, undefined, undefined, undefined]);
    });
});

describe('folderChoices', () => {
    it('lists every folder holding recipes, root first, without excluded folders', () => {
        assert.deepStrictEqual(folderChoices(['Soups/Tomato.cook', 'Mains/Pasta/Carbonara.cook', 'Drafts/x.cook', 'toast.cook'], ['Drafts']),
            ['', 'Mains', 'Mains/Pasta', 'Soups']);
    });
});

describe('CookbookExporter', () => {
    it('asks for an editor update when exportPdf or recipeImages is missing', async () => {
        const { exporter, calls, ui } = fixture({ commands: ['cooklang.api.renderReport', 'cooklang.api.hasFeature'], choice: 'Get Cook Editor' });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'unsupported', missing: ['cooklang.api.exportPdf', 'cooklang.api.recipeImages'] });
        await tick();
        assert.deepStrictEqual(ui.messages, [`warning: ${UPDATE_MESSAGE} [Get Cook Editor]`]);
        assert.deepStrictEqual(ui.opened, [EDITOR_DOWNLOAD_URL]);
        assert.deepStrictEqual(calls, []);
    });

    it('reports a folder without recipes', async () => {
        const { exporter, ui } = fixture({ files: { 'README.md': '# Hi' } });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'empty' });
        assert.deepStrictEqual(ui.messages, ['info: No recipes to export in Book. []']);
    });

    it(`refuses more than ${MAX_RECIPES} recipes before rendering`, async () => {
        const paths = Array.from({ length: MAX_RECIPES + 1 }, (_, index) => `r${index}.cook`);
        const { exporter, calls } = fixture({ paths });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'tooLarge', count: MAX_RECIPES + 1 });
        assert.ok(!calls.some(call => call.command === 'cooklang.api.renderReport'));
    });

    it('renders the book, exports it with the title as file name and offers to open it', async () => {
        const { exporter, ui, exported } = fixture({
            files: { 'README.md': '---\ntitle: Family: Book\n---\nHello.', 'Soups/Tomato.cook': '', 'toast.cook': '' },
            choice: 'Open',
        });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'saved', path: '/Users/me/Book.pdf', notIncluded: 0 });
        const args = exported()!;
        assert.strictEqual(args.defaultFileName, 'Family Book.pdf');
        assert.strictEqual(args.pageSize, 'A4');
        assert.ok(args.html.includes('<h1 class="book-title">Family: Book</h1>'));
        assert.ok(args.html.includes('<p class="generated">Generated on 10 October 2026</p>'));
        assert.ok(args.html.includes('<a href="#r-2">Tomato</a>'));
        assert.ok(args.html.indexOf('id="r-1"') < args.html.indexOf('id="c-1"'));
        assert.deepStrictEqual(ui.progress, ['Rendering 0/2 recipes…', 'Rendering 1/2 recipes…', 'Rendering 2/2 recipes…', 'Creating the PDF…']);
        await tick();
        assert.deepStrictEqual(ui.messages, ['info: Cookbook saved: Book.pdf [Open]']);
        assert.deepStrictEqual(ui.opened, ['file:/Users/me/Book.pdf']);
    });

    it('lists recipes that fail to render under "Not included" and warns', async () => {
        const { exporter, ui, exported } = fixture({
            files: { 'a.cook': '', 'b.cook': '', 'c.cook': '' },
            renders: {
                'file:///ws/Book/b.cook': { ok: false, reason: 'template', message: 'syntax error: unexpected }' },
                'file:///ws/Book/c.cook': { ok: true, output: 'not json' },
            },
        });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'saved', path: '/Users/me/Book.pdf', notIncluded: 2 });
        const html = exported()!.html;
        assert.ok(html.includes('<li><code>b.cook</code>: syntax error: unexpected }</li>'));
        assert.ok(html.includes('<li><code>c.cook</code>: The report engine returned something unexpected.</li>'));
        assert.ok(ui.messages.includes('warning: 2 recipes could not be rendered. See "Not included" at the end of the book. []'));
    });

    it('adds the nutrition line only with the feature and the setting', async () => {
        const withFeature = fixture({ files: { 'a.cook': '' }, hasFeature: true });
        await withFeature.exporter.export(FOLDER);
        assert.ok(withFeature.exported()!.html.includes('<p class="nutrition">Per serving: 72 kcal · 6 g protein · 0 g carbs · 5 g fat</p>'));

        const settingOff = fixture({ files: { 'a.cook': '' }, hasFeature: true, settings: { nutrition: false } });
        await settingOff.exporter.export(FOLDER);
        assert.ok(!settingOff.exported()!.html.includes('class="nutrition"'));
        assert.ok(!settingOff.calls.some(call => call.command === 'cooklang.api.hasFeature'));

        const noFeature = fixture({ files: { 'a.cook': '' }, hasFeature: false });
        await noFeature.exporter.export(FOLDER);
        assert.ok(!noFeature.exported()!.html.includes('class="nutrition"'));
    });

    it('stops asking for nutrition after a plan error', async () => {
        const { exporter, calls } = fixture({
            files: { 'a.cook': '', 'b.cook': '', 'c.cook': '', 'd.cook': '', 'e.cook': '', 'f.cook': '' },
            hasFeature: true,
            nutrition: { ok: false, reason: 'forbidden', message: 'Subscription required' },
        });
        await exporter.export(FOLDER);
        const nutritionCalls = calls.filter(call => call.command === 'cooklang.api.renderReport' && (call.args[0] as { template: string }).template.includes('aggregate_nutrition'));
        assert.ok(nutritionCalls.length <= 4, `asked ${nutritionCalls.length} times`);
    });

    it('inlines recipe photos and README images', async () => {
        const { exporter, exported } = fixture({
            files: { 'README.md': '![Cover](img/cover.jpg)', 'a.cook': '' },
            images: { 'file:///ws/Book/a.cook': { title: 'file:///ws/Book/a.jpg', steps: { 0: { 0: 'file:///ws/Book/a.0.jpg' } } } },
        });
        await exporter.export(FOLDER);
        const html = exported()!.html;
        assert.ok(html.includes('<img class="title-image" src="data:image/jpeg;base64,AQID" alt="">'));
        assert.ok(html.includes('<img class="step-image" src="data:image/jpeg;base64,AQID" alt="">'));
        assert.ok(html.includes('<img src="data:image/jpeg;base64,AQID" alt="Cover">'));
    });

    it('stops without exporting when cancelled', async () => {
        const { exporter, exported, ui } = fixture({ files: { 'a.cook': '', 'b.cook': '', 'c.cook': '', 'd.cook': '', 'e.cook': '' }, cancelAfter: 1 });
        assert.deepStrictEqual(await exporter.export(FOLDER), { status: 'cancelled' });
        assert.strictEqual(exported(), undefined);
        assert.deepStrictEqual(ui.messages, []);
    });

    it('stays quiet when the save dialog is cancelled and reports export errors', async () => {
        const cancelled = fixture({ files: { 'a.cook': '' }, exportResult: { saved: false } });
        assert.deepStrictEqual(await cancelled.exporter.export(FOLDER), { status: 'notSaved' });
        assert.deepStrictEqual(cancelled.ui.messages, []);

        const failed = fixture({ files: { 'a.cook': '' }, exportResult: { saved: false, error: 'Disk full' } });
        assert.deepStrictEqual(await failed.exporter.export(FOLDER), { status: 'failed', error: 'Disk full' });
        assert.deepStrictEqual(failed.ui.messages, ['error: Could not export the cookbook: Disk full']);
    });

    it('passes the Letter page size through', async () => {
        const { exporter, exported } = fixture({ files: { 'a.cook': '' }, settings: { pageSize: 'Letter' } });
        await exporter.export(FOLDER);
        assert.strictEqual(exported()!.pageSize, 'Letter');
        assert.ok(exported()!.html.includes('@page { size: Letter;'));
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: FAIL, `error TS2307: Cannot find module './export-command' …`.

- [ ] **Step 3: Implement**

Create `cookbook/src/export-command.ts`:

```ts
// The "Export as Cookbook (PDF)…" flow, free of the `vscode` import so it can be
// unit-tested: extension.ts passes the workspace and UI adapters. Renders every
// recipe through the editor's Reports engine (4 at a time), assembles the book and
// hands it to `cooklang.api.exportPdf`, which shows the save dialog and writes it.
import { NotIncluded, RenderedRecipe, bookIntros, buildBookHtml, recipeIds } from './book-html';
import {
    BookTree, RecipeEntry, buildBookTree, chaptersInOrder, compareNames, isExcluded, readmePaths, recipesInOrder, resolveRelativeImage,
} from './book-tree';
import { CooklangApi, RecipeImages } from './cooklang-api';
import { ImageFiles, ImageInliner } from './images';
import { IndexedRecipe, buildIngredientIndex } from './ingredient-index';
import { markdownImageSources } from './markdown';
import { NUTRITION_TEMPLATE, nutritionLine, parseNutritionOutput, servingsFromMetadata } from './nutrition-line';
import { renderRecipeHtml } from './recipe-html';
import { RECIPE_TEMPLATE, parseRecipeOutput, recipeTitle } from './recipe-template';
import { CookbookSettings } from './settings';

/** Fail fast above this: keeps the HTML well under the editor's 100 M character export limit. */
export const MAX_RECIPES = 500;
export const RENDER_CONCURRENCY = 4;
export const EDITOR_DOWNLOAD_URL = 'https://cook.md/editor';
export const UPDATE_MESSAGE = 'Update Cook Editor to export cookbooks.';
export const UPDATE_ACTION = 'Get Cook Editor';
export const OPEN_ACTION = 'Open';

export interface BookFolder {
    /** Absolute URI of the folder. */
    uri: string;
    /** Display name: the folder's last path segment. */
    name: string;
}

export interface CookbookWorkspace {
    /** `.cook` files and READMEs under the folder, `/`-separated and relative to it. */
    listFiles(folder: BookFolder): Promise<string[]>;
    /** Absolute URI of a path relative to the folder. */
    uriOf(folder: BookFolder, relativePath: string): string;
    /** Undefined when the file can't be read. */
    readText(uri: string): Promise<string | undefined>;
    images: ImageFiles;
}

export interface CancellationFlag {
    readonly isCancellationRequested: boolean;
}

export interface CookbookUi {
    /** Runs `task` under a cancellable progress notification. */
    withProgress<T>(title: string, task: (report: (message: string) => void, token: CancellationFlag) => Promise<T>): Promise<T>;
    showInformation(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, ...actions: string[]): Promise<string | undefined>;
    showError(message: string): Promise<unknown>;
    openExternal(url: string): Promise<unknown>;
    /** Opens a saved file with the system's default app. */
    openFile(path: string): Promise<unknown>;
}

export type ExportOutcome =
    | { status: 'unsupported'; missing: string[] }
    | { status: 'empty' }
    | { status: 'tooLarge'; count: number }
    | { status: 'cancelled' }
    | { status: 'notSaved' }
    | { status: 'failed'; error: string }
    | { status: 'saved'; path?: string; notIncluded: number };

type RecipeRender = { recipe: RenderedRecipe; indexed: IndexedRecipe } | { failure: NotIncluded };

/** `<Book title>.pdf` without path separators, control or reserved characters, at most 200 characters. */
export function pdfFileName(title: string): string {
    const base = title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 196).trim();
    return `${base === '' ? 'Cookbook' : base}.pdf`;
}

/** Runs `fn` over `items` with at most `limit` in flight; stops starting new ones once `cancelled()`. */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
    cancelled: () => boolean = () => false,
): Promise<Array<R | undefined>> {
    const results = new Array<R | undefined>(items.length).fill(undefined);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (!cancelled() && next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** Folders (relative, `''` = the workspace root) that hold `.cook` files directly or below, for the command palette. */
export function folderChoices(recipePaths: readonly string[], exclude: readonly string[]): string[] {
    const folders = new Set<string>();
    for (const path of recipePaths) {
        if (isExcluded(path, exclude)) {
            continue;
        }
        const segments = path.split('/').slice(0, -1);
        for (let depth = 0; depth <= segments.length; depth++) {
            folders.add(segments.slice(0, depth).join('/'));
        }
    }
    return [...folders].sort(compareNames);
}

export class CookbookExporter {

    constructor(
        protected readonly api: CooklangApi,
        protected readonly workspace: CookbookWorkspace,
        protected readonly ui: CookbookUi,
        protected readonly settings: () => CookbookSettings,
        protected readonly today: () => string = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    ) { }

    async export(folder: BookFolder): Promise<ExportOutcome> {
        const missing = await this.api.missingCommands();
        if (missing.length > 0) {
            void this.ui.showWarning(UPDATE_MESSAGE, UPDATE_ACTION).then(choice => {
                if (choice === UPDATE_ACTION) {
                    void this.ui.openExternal(EDITOR_DOWNLOAD_URL);
                }
            });
            return { status: 'unsupported', missing };
        }
        const settings = this.settings();
        const paths = await this.workspace.listFiles(folder);
        const readmes = new Map<string, string>();
        for (const readme of readmePaths(paths, settings.exclude)) {
            const text = await this.workspace.readText(this.workspace.uriOf(folder, readme));
            if (text !== undefined) {
                readmes.set(readme, text);
            }
        }
        const tree = buildBookTree({ rootName: folder.name, paths, readmes, exclude: settings.exclude });
        const entries = recipesInOrder(tree);
        if (entries.length === 0) {
            void this.ui.showInformation(`No recipes to export in ${folder.name}.`);
            return { status: 'empty' };
        }
        if (entries.length > MAX_RECIPES) {
            void this.ui.showWarning(`${folder.name} has ${entries.length} recipes; a cookbook holds up to ${MAX_RECIPES}. Export a subfolder instead.`);
            return { status: 'tooLarge', count: entries.length };
        }
        const nutrition = { enabled: settings.nutrition && await this.api.hasFeature('nutrition_api') };
        const inliner = new ImageInliner(this.workspace.images);
        const ids = recipeIds(tree);

        let result: { saved: { saved: boolean; path?: string; error?: string }; notIncluded: number } | undefined;
        try {
            result = await this.ui.withProgress('Cookbook', async (report, token) => {
                let done = 0;
                report(`Rendering 0/${entries.length} recipes…`);
                const renders = await mapLimit(entries, RENDER_CONCURRENCY, async entry => {
                    const render = await this.renderRecipe(folder, entry, ids.get(entry.path)!, inliner, nutrition);
                    done++;
                    report(`Rendering ${done}/${entries.length} recipes…`);
                    return render;
                }, () => token.isCancellationRequested);
                if (token.isCancellationRequested) {
                    return undefined;
                }
                const recipes = new Map<string, RenderedRecipe>();
                const notIncluded: NotIncluded[] = [];
                const indexed: IndexedRecipe[] = [];
                for (const render of renders) {
                    if (render === undefined) {
                        continue;
                    }
                    if ('failure' in render) {
                        notIncluded.push(render.failure);
                    } else {
                        recipes.set(render.recipe.path, render.recipe);
                        indexed.push(render.indexed);
                    }
                }
                const images = await this.readmeImages(folder, tree, readmes, inliner);
                const html = buildBookHtml({
                    tree, recipes, notIncluded,
                    intros: bookIntros(tree, readmes, (readme, src) => images.get(`${readme}\n${src}`)),
                    index: buildIngredientIndex(indexed),
                    generatedOn: this.today(),
                    pageSize: settings.pageSize,
                });
                if (token.isCancellationRequested) {
                    return undefined;
                }
                report('Creating the PDF…');
                const saved = await this.api.exportPdf({ html, defaultFileName: pdfFileName(tree.title), pageSize: settings.pageSize });
                return { saved, notIncluded: notIncluded.length };
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void this.ui.showError(`Could not export the cookbook: ${message}`);
            return { status: 'failed', error: message };
        }
        if (result === undefined) {
            return { status: 'cancelled' };
        }
        const { saved, notIncluded } = result;
        if (!saved.saved) {
            if (saved.error !== undefined) {
                void this.ui.showError(`Could not export the cookbook: ${saved.error}`);
                return { status: 'failed', error: saved.error };
            }
            return { status: 'notSaved' };
        }
        const path = saved.path;
        const fileName = path !== undefined ? path.split(/[\\/]/).pop()! : pdfFileName(tree.title);
        void this.ui.showInformation(`Cookbook saved: ${fileName}`, ...(path !== undefined ? [OPEN_ACTION] : [])).then(choice => {
            if (choice === OPEN_ACTION && path !== undefined) {
                void this.ui.openFile(path);
            }
        });
        if (notIncluded > 0) {
            void this.ui.showWarning(`${notIncluded} recipe${notIncluded === 1 ? '' : 's'} could not be rendered. See "Not included" at the end of the book.`);
        }
        if (inliner.skipped > 0) {
            void this.ui.showWarning(`${inliner.skipped} photo${inliner.skipped === 1 ? ' was' : 's were'} left out: over 10 MB, or the book reached its size limit.`);
        }
        return { status: 'saved', ...(path !== undefined ? { path } : {}), notIncluded };
    }

    protected async renderRecipe(
        folder: BookFolder, entry: RecipeEntry, id: string, inliner: ImageInliner, nutrition: { enabled: boolean },
    ): Promise<RecipeRender> {
        const uri = this.workspace.uriOf(folder, entry.path);
        try {
            const result = await this.api.renderReport({ uri, template: RECIPE_TEMPLATE });
            if (!result.ok) {
                return { failure: { path: entry.path, reason: result.message } };
            }
            const data = parseRecipeOutput(result.output);
            if (!data) {
                return { failure: { path: entry.path, reason: 'The report engine returned something unexpected.' } };
            }
            const title = recipeTitle(data, entry.title);
            const images = await this.recipeImages(uri, inliner);
            const line = nutrition.enabled ? await this.nutritionLine(uri, data.metadata, nutrition) : undefined;
            const html = renderRecipeHtml({ id, title, data, images, ...(line !== undefined ? { nutritionLine: line } : {}) });
            return { recipe: { id, path: entry.path, title, html }, indexed: { id, title, ingredients: data.ingredients } };
        } catch (error) {
            return { failure: { path: entry.path, reason: error instanceof Error ? error.message : String(error) } };
        }
    }

    /** No photos on any error: a missing photo never drops a recipe. */
    protected async recipeImages(uri: string, inliner: ImageInliner): Promise<RecipeImages> {
        try {
            return await inliner.inlineAll(await this.api.recipeImages(uri));
        } catch {
            return { steps: {} };
        }
    }

    /** Any failure leaves the line out; an auth or plan failure turns nutrition off for the rest of the book. */
    protected async nutritionLine(uri: string, metadata: Record<string, unknown>, nutrition: { enabled: boolean }): Promise<string | undefined> {
        try {
            const result = await this.api.renderReport({ uri, template: NUTRITION_TEMPLATE });
            if (!result.ok) {
                if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                    nutrition.enabled = false;
                }
                return undefined;
            }
            const summary = parseNutritionOutput(result.output);
            return summary ? nutritionLine(summary, servingsFromMetadata(metadata)) : undefined;
        } catch {
            return undefined;
        }
    }

    /** `readme + "\n" + src` → data URI, for the READMEs the book shows. */
    protected async readmeImages(folder: BookFolder, tree: BookTree, readmes: ReadonlyMap<string, string>, inliner: ImageInliner): Promise<Map<string, string>> {
        const shown = [tree.readme, ...chaptersInOrder(tree).map(chapter => chapter.readme)].filter((readme): readme is string => readme !== undefined);
        const images = new Map<string, string>();
        for (const readme of shown) {
            for (const src of markdownImageSources(readmes.get(readme) ?? '')) {
                const path = resolveRelativeImage(readme, src);
                const dataUri = path !== undefined ? await inliner.inline(this.workspace.uriOf(folder, path)) : undefined;
                if (dataUri?.startsWith('data:')) {
                    images.set(`${readme}\n${src}`, dataUri);
                }
            }
        }
        return images;
    }
}
```

Toasts are not awaited (`void …then(…)`): a VS Code notification promise only settles when the user acts or it times out, and the command should finish as soon as the file is written. `exportPdf` runs inside the progress notification because `printToPDF` happens before the save dialog opens.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `94 passing`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/export-command.ts cookbook/src/export-command.spec.ts
git commit -m "feat(cookbook): export flow with progress, cancellation, Not included appendix and save toast"
```

---

### Task 13: Extension wiring

**Files:**
- Modify (replace): `cookbook/src/extension.ts`

`extension.ts` is a thin `vscode` adapter with no spec of its own; everything it calls is tested. It is checked by compiling here and by Task 17.

- [ ] **Step 1: Replace the activation stub**

Replace `cookbook/src/extension.ts` with:

```ts
import * as path from 'path';
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { BookFolder, CookbookExporter, CookbookUi, CookbookWorkspace, folderChoices } from './export-command';
import { readSettings } from './settings';

/** `.cook` files and READMEs (`README.md`, `readme.markdown`, any case). */
const BOOK_FILES = '**/{*.cook,[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Dd],[Rr][Ee][Aa][Dd][Mm][Ee].[Mm][Aa][Rr][Kk][Dd][Oo][Ww][Nn]}';
const SKIPPED = '**/node_modules/**';

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Cookbook');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('cookbook');
        return readSettings(key => configuration.get(key));
    };
    const workspace: CookbookWorkspace = {
        listFiles: async folder => {
            const base = vscode.Uri.parse(folder.uri);
            const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(base, BOOK_FILES), SKIPPED);
            return uris.map(uri => path.posix.relative(base.path, uri.path)).filter(relative => relative !== '' && !relative.startsWith('..'));
        },
        uriOf: (folder, relativePath) => vscode.Uri.joinPath(vscode.Uri.parse(folder.uri), ...relativePath.split('/')).toString(),
        readText: async uri => {
            try {
                return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
            } catch {
                return undefined;
            }
        },
        images: {
            size: async uri => {
                try {
                    return (await vscode.workspace.fs.stat(vscode.Uri.parse(uri))).size;
                } catch {
                    return undefined;
                }
            },
            read: async uri => vscode.workspace.fs.readFile(vscode.Uri.parse(uri)),
        },
    };
    const ui: CookbookUi = {
        withProgress: (title, task) => Promise.resolve(vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            (progress, token) => task(message => progress.report({ message }), token),
        )),
        showInformation: (message, ...actions) => Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
        showWarning: (message, ...actions) => Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
        showError: message => Promise.resolve(vscode.window.showErrorMessage(message)),
        openExternal: url => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
        openFile: file => Promise.resolve(vscode.env.openExternal(vscode.Uri.file(file))),
    };
    const exporter = new CookbookExporter(api, workspace, ui, settings);

    context.subscriptions.push(vscode.commands.registerCommand('cookbook.export', async (argument?: unknown) => {
        const uri = asUri(argument);
        const folder = uri ? toBookFolder(uri) : await pickFolder(settings().exclude);
        if (!folder) {
            return;
        }
        try {
            const outcome = await exporter.export(folder);
            output.appendLine(`Export of ${folder.uri}: ${JSON.stringify(outcome)}`);
        } catch (error) {
            output.appendLine(`Export of ${folder.uri} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            void vscode.window.showErrorMessage(`Could not export the cookbook: ${error instanceof Error ? error.message : String(error)}`);
        }
    }));
}

/** The Explorer passes the clicked folder's URI (and the selection as a second argument, ignored). */
function asUri(argument: unknown): vscode.Uri | undefined {
    if (argument instanceof vscode.Uri) {
        return argument;
    }
    if (typeof argument === 'object' && argument !== null) {
        const value = argument as { scheme?: unknown; authority?: unknown; path?: unknown };
        if (typeof value.scheme === 'string' && typeof value.path === 'string') {
            return vscode.Uri.from({ scheme: value.scheme, authority: typeof value.authority === 'string' ? value.authority : '', path: value.path });
        }
    }
    return undefined;
}

function toBookFolder(uri: vscode.Uri): BookFolder {
    const root = vscode.workspace.getWorkspaceFolder(uri);
    const name = path.posix.basename(uri.path) || root?.name || 'Cookbook';
    return { uri: uri.toString(), name };
}

/** Command palette: choose among the workspace's folders that contain recipes. */
async function pickFolder(exclude: readonly string[]): Promise<BookFolder | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
        void vscode.window.showInformationMessage('Open a recipe folder to export a cookbook.');
        return undefined;
    }
    const recipes = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.cook'), SKIPPED);
    const choices = folderChoices(recipes.map(uri => path.posix.relative(root.uri.path, uri.path)), exclude);
    if (choices.length === 0) {
        void vscode.window.showInformationMessage('No recipes to export in this workspace.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(
        choices.map(relative => ({ label: relative === '' ? root.name : relative, description: relative === '' ? 'Whole workspace' : undefined, relative })),
        { placeHolder: 'Folder to export as a cookbook' },
    );
    if (!picked) {
        return undefined;
    }
    const uri = picked.relative === '' ? root.uri : vscode.Uri.joinPath(root.uri, ...picked.relative.split('/'));
    return { uri: uri.toString(), name: picked.relative === '' ? root.name : path.posix.basename(picked.relative) };
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

Notes: the Explorer passes the clicked `Uri` (and the selection as a second argument, ignored); `asUri` also accepts a URI-shaped object in case Theia hands over a plain object. The `findFiles` glob uses character classes so `README.md`, `Readme.md` and `readme.markdown` are found on case-sensitive file systems; `book-tree.ts` filters again either way.

- [ ] **Step 2: Compile and run the tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm test`
Expected: PASS, `94 passing`, and no compile errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/src/extension.ts
git commit -m "feat(cookbook): register Export as Cookbook (PDF) on folders and in the palette"
```

---

### Task 14: Plugin README

**Files:**
- Modify (replace): `cookbook/README.md`

- [ ] **Step 1: Write the README**

Replace `cookbook/README.md` with:

````markdown
# Cookbook

Turn a folder of Cooklang recipes into a printable PDF cookbook, right from
[Cook Editor](https://cook.md/editor): a cover, a table of contents, a chapter per
subfolder, recipe photos and an index of ingredients.

Right-click a folder in the Explorer and choose **Export as Cookbook (PDF)…**, or
run **Cookbook: Export as Cookbook (PDF)…** from the command palette and pick a
folder. Cook Editor asks where to save the PDF.

Free. With a Cook Basic or Pro plan each recipe also gets a nutrition line
(`Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat`).

## How your folder becomes a book

```
Family Recipes/
├── README.md            → the cover: title and intro text
├── Quick Toast.cook     → recipes in the top folder come first
├── 01 Breakfast/
│   ├── README.md        → the chapter's intro
│   └── Pancakes.cook
├── 02 Soups/
│   └── Tomato Soup.cook
└── Drafts/              → left out (see Settings)
```

- **Chapters** are subfolders that contain recipes, nested up to three levels.
  Deeper folders are merged into their third-level chapter.
- **Order** is alphabetical and number-aware (`2 Soups` before `10 Mains`). A
  leading number like `01-` or `2 ` is used for sorting and hidden in titles.
- **README.md** (or `readme.markdown`) in a folder is that chapter's intro; in
  the exported folder it is the cover. Its YAML frontmatter can set the title and
  the position among sibling chapters:

  ```markdown
  ---
  title: Soups & Stews
  order: 1
  ---
  Cheap, warm and forgiving.
  ```

  Chapters with an `order` come first, lowest first; the rest follow
  alphabetically. Without a `title`, the cover uses the README's first `#`
  heading, then the folder name. READMEs support headings, paragraphs, bold and
  italic, inline code, lists, quotes, rules, `https` links and images next to
  the README.
- **Recipe titles** come from the recipe's `title` metadata, else the file name.
- **Photos** follow the same rules as the recipe preview: `Pancakes.jpg` under
  the title, `Pancakes.1.jpg` (or `image:` metadata) for steps. Photos over 10 MB
  are left out.
- **Menus** (`.menu`) are not included.

A recipe that can't be rendered (for example because of a syntax error) is
listed under **Not included** at the end of the book, and Cook Editor tells you
after the export.

A book holds up to 500 recipes; export a subfolder for bigger collections.

## Settings

| Setting | Default | |
|---|---|---|
| `cookbook.exclude` | `["Drafts", "config"]` | Folders to leave out. A name matches a folder with that name at any depth; a path such as `Mains/Old` matches that folder. Dot-folders and `node_modules` are always skipped. |
| `cookbook.nutrition` | `true` | Print the nutrition line (Cook Basic or Pro). |
| `cookbook.pageSize` | `A4` | `A4` or `Letter`. |

## Requirements

Cook Editor with the `cooklang.api.exportPdf` and `cooklang.api.recipeImages`
commands. On an older editor the command asks you to update.

## For plugin authors

The plugin never parses recipes itself. For each recipe it calls
`cooklang.api.renderReport` with a small Jinja template
([`src/recipe-template.ts`](src/recipe-template.ts)) that returns the recipe as
JSON through `tojson`, builds the HTML in TypeScript with everything escaped,
and hands the finished document to `cooklang.api.exportPdf`. Photos come from
`cooklang.api.recipeImages` and are inlined as `data:` URIs read with
`workspace.fs`. All of it except `src/extension.ts` is plain TypeScript with
mocha tests.

```bash
npm install
npm test
npm run deploy   # copies the plugin into ../../editor/plugins/cooklang.cookbook
```
````

- [ ] **Step 2: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add cookbook/README.md
git commit -m "docs(cookbook): README"
```

---

### Task 15: CI matrix and root README row

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` (repo root)

- [ ] **Step 1: Add the plugin to the CI matrix**

In `.github/workflows/ci.yml` replace:

```yaml
        package: [allergens, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

with:

```yaml
        package: [allergens, cookbook, corevitals, favourites, meal-journal, nutriscore, pantry, recipe-hub, shopping-list]
```

(If other plugins were added to the list meanwhile, insert `cookbook` alphabetically and keep them.)

- [ ] **Step 2: Add the table row**

In the root `README.md` plugin table, after the `corevitals` row, add:

```markdown
| [`cookbook`](./cookbook) | Turns a folder of recipes into a printable PDF cookbook: cover, contents, a chapter per subfolder, photos and an ingredient index. Free; a nutrition line with a Cook Basic or Pro plan. Install it from the Extensions view. Shows an Explorer folder menu, `cooklang.api.recipeImages` and `cooklang.api.exportPdf`. |
```

- [ ] **Step 3: Check CI's steps locally**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm ci && npm run compile && npm test && npm run package
```

Expected: `94 passing`, then `DONE  Packaged: …/cookbook/cookbook-0.1.0.vsix`.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add .github/workflows/ci.yml README.md
git commit -m "ci: run the cookbook plugin in the matrix; list it in the README"
```

---

### Task 16: Packaging and deploy

**Files:** none changed (checks only; `*.vsix` is gitignored).

- [ ] **Step 1: Check the package contents**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm run package && unzip -l cookbook-0.1.0.vsix
```

Expected: `extension/package.json`, `extension/README.md`, `extension/LICENSE.txt` (vsce renames it) and the 13 non-spec `extension/out/*.js` files (`book-html`, `book-tree`, `cooklang-api`, `export-command`, `extension`, `frontmatter`, `images`, `ingredient-index`, `markdown`, `nutrition-line`, `recipe-html`, `recipe-template`, `settings`); no `src/`, `test-fixtures/`, `*.spec.js` or `*.map`.

- [ ] **Step 2: Deploy into the editor checkout**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/cookbook && npm run deploy && ls ../../editor/plugins/cooklang.cookbook
```

Expected: `Deployed to …/editor/plugins/cooklang.cookbook` and `LICENSE README.md out package.json`. To target an editor worktree that has the new API, prefix with `COOK_EDITOR_DIR=<path>`.

---

### Task 17: Manual verification (needs an editor build with the new API)

Run this with an editor build that includes the editor plan's `cooklang.api.exportPdf` (with `pageSize`) and `cooklang.api.recipeImages`. Deploy with `COOK_EDITOR_DIR=<that checkout> npm run deploy`, start it (`npm run start:electron` in the editor), and open a workspace containing a copy of `cookbook/test-fixtures/family-book` plus a few real recipes with photos (`Pancakes.jpg`, `Pancakes.1.jpg`, and one recipe with `image:` metadata).

- [ ] **Older editor:** on an editor without the new commands, right-click a folder → **Export as Cookbook (PDF)…** shows "Update Cook Editor to export cookbooks." with **Get Cook Editor**, which opens https://cook.md/editor.
- [ ] **Explorer entry:** the item appears on folders only (not on files) and in the command palette as **Cookbook: Export as Cookbook (PDF)…**.
- [ ] **Palette flow:** the quick pick lists the workspace root and every folder with recipes (no `Drafts`, no dot-folders); picking one exports it.
- [ ] **Progress:** the notification counts "Rendering N/M recipes…", then "Creating the PDF…"; **Cancel** during rendering stops without a save dialog.
- [ ] **Save:** the dialog proposes `The Family Book.pdf` (not `.pdf.pdf`); after saving, "Cookbook saved: The Family Book.pdf" with **Open** opens it in the system viewer.
- [ ] **PDF content:** A4 pages (Document Properties); cover with title, intro and date at the bottom; contents links jump to chapters and recipes; each chapter and recipe on a new page; ingredient lists not split across pages; title photo under the recipe title; step photos after their step at ≤ 60 % width; index links jump to recipes.
- [ ] **Letter:** set `cookbook.pageSize` to `Letter`, export again, check the page size.
- [ ] **Not included:** introduce a syntax error in one recipe (e.g. an unclosed `{`) that makes the Reports engine fail; it is listed under "Not included" and a warning toast appears.
- [ ] **Nutrition:** signed in with Basic or Pro, recipes show "Per serving: …" (or "Whole recipe: …" without servings); signed out or with `cookbook.nutrition: false`, no nutrition line and no errors.
- [ ] **Excludes:** add `Mains/Old` to `cookbook.exclude`; that folder disappears from the book.
- [ ] **Large photos:** a > 10 MB photo is left out and the "photo … left out" warning appears.
- [ ] **500 limit:** a folder with more than 500 recipes shows the "holds up to 500" message without rendering.
- [ ] **Theia specifics to confirm:** `findFiles` with a `RelativePattern` on the folder and the character-class glob finds `README.md` in nested folders; the Explorer passes a `Uri` the command accepts; `onCommand:cookbook.export` activates the plugin on first use.

---

## Self-review: spec coverage

| Spec section | Covered by |
|---|---|
| Goals: right-click folder → PDF | Task 1 (menu, `explorerResourceIsFolder`), Task 13, Task 17 |
| Goals: chapters from subfolders, README intros, root README cover | Task 3 (tree), Task 4 (Markdown), Task 10 (`bookIntros`, cover) |
| Goals: photos, contents, ingredient index | Tasks 6, 7, 9, 10 |
| Goals: nutrition for Basic/Pro, silent otherwise | Task 8, Task 12 (`hasFeature('nutrition_api')`, setting, auth/plan switch-off) |
| Non-goals (no page numbers, no themes, no EPUB, no menus) | Contents and index use anchors only (Task 10); `.menu` ignored (Task 3 test) |
| Folder model: chapters with `.cook` below, nesting max 3 and flattening | Task 3 |
| Folder model: root recipes before first chapter | Task 3, Task 10 |
| Folder model: README case-insensitive, `readme.markdown` | Task 3 (`isReadme`, preference test), Task 13 glob |
| Order: case-insensitive numeric-aware, prefix stripping, frontmatter `title` / `order` | Tasks 3 (`compareNames`, `stripNumericPrefix`, ordering test) |
| Skipped: dot-folders, `node_modules`, `cookbook.exclude` default | Task 3 (`isExcluded`), Task 1 setting, Task 11 |
| Markdown: each construct, escaping, unsafe links, relative images, frontmatter stripped | Task 4; image reading in Task 12 (`readmeImages`) |
| Recipe rendering via `renderReport` + `tojson`; title/metadata/ingredients/cookware/sections | Task 5 (deviations 1–2), Task 7 |
| Images via `recipeImages`, `readFile`, > 10 MB skipped, title image, step images ≤ 60 % | Task 2, Task 6 (deviation 3, 7), Task 7, Task 10 CSS |
| Nutrition line format, servings, whole recipe label, 70 % threshold | Task 8 |
| Book HTML: A4 default / Letter, cover with date, contents links, page breaks, `break-inside: avoid` on ingredients, index (normalised, references excluded) | Task 10, Task 9, Task 11 (deviation 4) |
| Export flow: feature check + update message with link | Task 12 test "asks for an editor update" |
| Export flow: walk with `findFiles` + `RelativePattern` | Task 13 |
| Export flow: cancellable progress, "Rendering 34/120", 4 concurrent | Task 12 (`mapLimit`, progress test, cancel test) |
| Export flow: "Not included" appendix + warning toast | Task 10, Task 12 |
| Export flow: `exportPdf({ html, defaultFileName })`, save toast with **Open** (`env.openExternal`) | Task 12, Task 13 (deviations 5–6) |
| 500-recipe limit | Task 12 |
| Command palette folder pick | Task 12 (`folderChoices`), Task 13 (deviation 10) |
| Architecture module list | File structure (deviation 9) |
| Testing list (tree, markdown, recipe JSON → HTML, index, snapshot, missing API) | Tasks 3, 4, 5, 7, 9, 10, 12 |
| Repo integration: README, CI matrix, root README, packaging | Tasks 14, 15, 16 |

## Open risks

- **Editor contract:** the plugin needs `pageSize` accepted by `exportPdf` (else A4 books come out Letter, or the call is rejected if validation is strict about unknown keys) and no doubled `.pdf`. Both are for the editor plan; Task 17 checks them.
- **Theia API behaviour** not covered by unit tests: `findFiles` with a `RelativePattern` whose base is a `Uri` and a character-class glob, the Explorer's argument type, `onCommand` activation. Task 17 lists them.
- **Large books:** up to ~100 M characters of HTML cross the plugin-host RPC and load into the hidden window; `printToPDF` has no timeout in `ReportExportServiceImpl`. The 500-recipe limit and 80 M image budget keep it bounded, but a slow machine may sit on "Creating the PDF…" for a while.
- **Step text** comes from the engine already flattened, with quantities inline ("Chop 1 onion"), which differs slightly from the preview.
- **Nutrition match** is computed on the engine's raw ingredient list, where modifier prefixes (`?salt`) are part of the name; such ingredients may fail to match and lower the ratio below 70 %, hiding the line for that recipe.

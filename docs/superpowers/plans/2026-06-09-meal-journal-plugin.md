# Meal Journal Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `meal-journal`, the first first-party VS Code-style plugin for Cook Editor — a daily meal journal (`Journal/YYYY-MM-DD.journal` files in Cooklang markup) that doubles as the reference example for plugin developers.

**Architecture:** A standalone npm package at `~/Cooklang/plugins/meal-journal/` compiled with plain `tsc` (no bundler, zero runtime deps). Pure date/filename/template logic lives in `journal-files.ts` (no `vscode` import → unit-testable with mocha); all VS Code API usage lives in `extension.ts` and `recipe-picker.ts`. A deploy script copies the built folder to `editor/plugins/cooklang.meal-journal`, which the app's `copy:plugins` step picks up on start.

**Tech Stack:** TypeScript ~5.4, `@types/vscode` ^1.100 (Theia supports API 1.110.1), mocha + node:assert for unit tests.

**Repo:** All work happens in `/Users/alexeydubovskoy/Cooklang/plugins` (git repo already initialized, spec committed). Commit after every task.

**Spec:** `docs/superpowers/specs/2026-06-09-meal-journal-plugin-design.md`

---

### Task 1: Scaffold the plugin package

**Files:**
- Create: `.gitignore` (repo root)
- Create: `meal-journal/package.json`
- Create: `meal-journal/tsconfig.json`

- [ ] **Step 1: Create repo-root `.gitignore`**

```gitignore
node_modules/
out/
*.log
.DS_Store
```

- [ ] **Step 2: Create `meal-journal/package.json`**

This is the plugin manifest — Theia's `PluginVsCodeDirectoryHandler.resolveFromSources` accepts any directory whose `package.json` has `name`, `version`, and `engines.vscode`. Every `contributes` block here is part of the demo surface.

```json
{
  "name": "meal-journal",
  "displayName": "Meal Journal",
  "description": "Daily meal journal using Cooklang markup. Reference example for Cook Editor plugin developers.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
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
    "languages": [
      {
        "id": "cooklang",
        "extensions": [
          ".journal"
        ]
      }
    ],
    "commands": [
      {
        "command": "mealJournal.openToday",
        "title": "Open Today",
        "category": "Journal",
        "icon": "$(calendar)"
      },
      {
        "command": "mealJournal.openYesterday",
        "title": "Open Yesterday",
        "category": "Journal"
      },
      {
        "command": "mealJournal.openPreviousEntry",
        "title": "Open Previous Entry",
        "category": "Journal",
        "icon": "$(chevron-left)"
      },
      {
        "command": "mealJournal.openNextEntry",
        "title": "Open Next Entry",
        "category": "Journal",
        "icon": "$(chevron-right)"
      },
      {
        "command": "mealJournal.insertRecipeReference",
        "title": "Insert Recipe Reference",
        "category": "Journal",
        "icon": "$(book)"
      }
    ],
    "keybindings": [
      {
        "command": "mealJournal.openToday",
        "key": "ctrl+shift+j",
        "mac": "cmd+shift+j"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "mealJournal.openPreviousEntry",
          "when": "resourceExtname == .journal",
          "group": "navigation@1"
        },
        {
          "command": "mealJournal.openNextEntry",
          "when": "resourceExtname == .journal",
          "group": "navigation@2"
        },
        {
          "command": "mealJournal.insertRecipeReference",
          "when": "resourceExtname == .journal",
          "group": "navigation@3"
        }
      ]
    },
    "configuration": {
      "title": "Meal Journal",
      "properties": {
        "mealJournal.folder": {
          "type": "string",
          "default": "Journal",
          "description": "Folder under the workspace root where journal entries are stored."
        },
        "mealJournal.template": {
          "type": "string",
          "default": "",
          "editPresentation": "multilineText",
          "markdownDescription": "Template for new journal entries. Supports `${date}` (e.g. `2026-06-09`) and `${title}` (e.g. `Tuesday, 9 June 2026`). Leave empty to use the built-in template."
        }
      }
    },
    "snippets": [
      {
        "language": "cooklang",
        "path": "./snippets/cooklang.json"
      }
    ]
  },
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -w -p .",
    "test": "npm run compile && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "^1.100.0",
    "mocha": "^10.4.0",
    "typescript": "~5.4.5"
  }
}
```

- [ ] **Step 3: Create `meal-journal/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
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

- [ ] **Step 4: Install dependencies**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm install`
Expected: completes without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add .gitignore meal-journal/package.json meal-journal/tsconfig.json meal-journal/package-lock.json
git commit -m "feat(meal-journal): scaffold plugin package"
```

---

### Task 2: Pure logic — dates, filenames, template (TDD)

**Files:**
- Create: `meal-journal/src/journal-files.ts`
- Test: `meal-journal/src/journal-files.spec.ts`

This module MUST NOT import `vscode` — that's what makes it unit-testable in plain Node.

- [ ] **Step 1: Write the failing tests**

Create `meal-journal/src/journal-files.spec.ts`:

```ts
import * as assert from 'node:assert';
import {
    DEFAULT_TEMPLATE,
    fileNameForDate,
    humanTitle,
    isJournalFileName,
    renderTemplate
} from './journal-files';

describe('journal-files', () => {
    // Note: JS Date months are 0-based; this is 9 June 2026, a Tuesday.
    const june9 = new Date(2026, 5, 9);

    describe('fileNameForDate', () => {
        it('formats the local date as YYYY-MM-DD.journal', () => {
            assert.strictEqual(fileNameForDate(june9), '2026-06-09.journal');
        });

        it('zero-pads month and day', () => {
            assert.strictEqual(fileNameForDate(new Date(2026, 0, 1)), '2026-01-01.journal');
        });
    });

    describe('isJournalFileName', () => {
        it('accepts date-named journal files', () => {
            assert.strictEqual(isJournalFileName('2026-06-09.journal'), true);
        });

        it('rejects non-date journal files', () => {
            assert.strictEqual(isJournalFileName('notes.journal'), false);
        });

        it('rejects other extensions', () => {
            assert.strictEqual(isJournalFileName('2026-06-09.cook'), false);
        });
    });

    describe('humanTitle', () => {
        it('formats a human-readable date', () => {
            assert.strictEqual(humanTitle(june9), 'Tuesday, 9 June 2026');
        });
    });

    describe('renderTemplate', () => {
        it('replaces ${date} and ${title} placeholders', () => {
            const rendered = renderTemplate('date: ${date}\ntitle: ${title}\n${date}', june9);
            assert.strictEqual(rendered, 'date: 2026-06-09\ntitle: Tuesday, 9 June 2026\n2026-06-09');
        });

        it('renders the default template with YAML frontmatter and meal sections', () => {
            const rendered = renderTemplate(DEFAULT_TEMPLATE, june9);
            assert.ok(rendered.startsWith('---\n'), 'starts with YAML frontmatter');
            assert.ok(rendered.includes('title: Tuesday, 9 June 2026'));
            assert.ok(rendered.includes('date: 2026-06-09'));
            assert.ok(rendered.includes('= Breakfast'));
            assert.ok(rendered.includes('= Lunch'));
            assert.ok(rendered.includes('= Dinner'));
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: FAIL — tsc error: cannot find module `./journal-files`.

- [ ] **Step 3: Implement `meal-journal/src/journal-files.ts`**

```ts
/**
 * Pure journal logic: filenames, dates, templates, entry navigation.
 * This module must not import 'vscode' so it stays unit-testable in plain Node.
 */

export const JOURNAL_EXTENSION = '.journal';

export const DEFAULT_TEMPLATE = [
    '---',
    'title: ${title}',
    'date: ${date}',
    'type: journal',
    '---',
    '',
    '= Breakfast',
    '',
    '= Lunch',
    '',
    '= Dinner',
    ''
].join('\n');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** Local date as ISO `YYYY-MM-DD`. */
export function isoDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Journal file name for a date, e.g. `2026-06-09.journal`. */
export function fileNameForDate(date: Date): string {
    return `${isoDate(date)}${JOURNAL_EXTENSION}`;
}

/** True for date-named journal files like `2026-06-09.journal`. */
export function isJournalFileName(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}\.journal$/.test(name);
}

/** Human-readable date, e.g. `Tuesday, 9 June 2026`. Deliberately locale-independent. */
export function humanTitle(date: Date): string {
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Replaces `${date}` and `${title}` placeholders in a template. */
export function renderTemplate(template: string, date: Date): string {
    return template
        .replaceAll('${date}', isoDate(date))
        .replaceAll('${title}', humanTitle(date));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: PASS — 8 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/src
git commit -m "feat(meal-journal): date, filename and template logic"
```

---

### Task 3: Pure logic — prev/next entry selection and recipe references (TDD)

**Files:**
- Modify: `meal-journal/src/journal-files.ts` (append functions)
- Test: `meal-journal/src/journal-files.spec.ts` (append describe blocks)

- [ ] **Step 1: Write the failing tests**

Append to `meal-journal/src/journal-files.spec.ts` (inside the top-level `describe`); extend the import list with `adjacentEntry` and `recipeReference`:

```ts
    describe('adjacentEntry', () => {
        const entries = ['2026-06-01.journal', '2026-06-05.journal', '2026-06-09.journal', 'aisle.conf', 'notes.journal'];

        it('finds the previous entry', () => {
            assert.strictEqual(adjacentEntry(entries, '2026-06-05.journal', 'previous'), '2026-06-01.journal');
        });

        it('finds the next entry', () => {
            assert.strictEqual(adjacentEntry(entries, '2026-06-05.journal', 'next'), '2026-06-09.journal');
        });

        it('returns undefined at the start', () => {
            assert.strictEqual(adjacentEntry(entries, '2026-06-01.journal', 'previous'), undefined);
        });

        it('returns undefined at the end', () => {
            assert.strictEqual(adjacentEntry(entries, '2026-06-09.journal', 'next'), undefined);
        });

        it('works when the current file is not in the list', () => {
            assert.strictEqual(adjacentEntry(entries, '2026-06-07.journal', 'previous'), '2026-06-05.journal');
            assert.strictEqual(adjacentEntry(entries, '2026-06-07.journal', 'next'), '2026-06-09.journal');
        });

        it('ignores files that are not date-named journals', () => {
            assert.strictEqual(adjacentEntry(['aisle.conf', 'notes.journal'], '2026-06-05.journal', 'previous'), undefined);
        });
    });

    describe('recipeReference', () => {
        it('references a recipe in a sibling folder', () => {
            assert.strictEqual(
                recipeReference('Journal', 'Christmas Dinner/Turkey.cook'),
                '@../Christmas Dinner/Turkey{}'
            );
        });

        it('references a recipe in the same folder', () => {
            assert.strictEqual(recipeReference('Journal', 'Journal/leftovers.cook'), '@./leftovers{}');
        });

        it('references a recipe from the workspace root', () => {
            assert.strictEqual(recipeReference('', 'Turkey.cook'), '@./Turkey{}');
        });

        it('strips only the .cook extension', () => {
            assert.strictEqual(recipeReference('', 'soups/pho.bo.cook'), '@./soups/pho.bo{}');
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: FAIL — tsc error: `journal-files` has no exported member `adjacentEntry` / `recipeReference`.

- [ ] **Step 3: Implement — append to `meal-journal/src/journal-files.ts`**

Add the import at the top of the file:

```ts
import * as posixPath from 'node:path/posix';
```

Append the functions:

```ts
/**
 * Nearest existing entry before/after `current` by filename order
 * (ISO dates sort lexically). Non-journal files are ignored.
 */
export function adjacentEntry(entries: string[], current: string, direction: 'previous' | 'next'): string | undefined {
    const sorted = entries.filter(isJournalFileName).sort();
    if (direction === 'previous') {
        const earlier = sorted.filter(name => name < current);
        return earlier[earlier.length - 1];
    }
    return sorted.find(name => name > current);
}

/**
 * Cooklang recipe reference for a recipe, relative to the journal file's folder.
 * Both arguments are workspace-relative POSIX paths ('' = workspace root).
 * E.g. ('Journal', 'Christmas Dinner/Turkey.cook') -> '@../Christmas Dinner/Turkey{}'.
 */
export function recipeReference(journalDir: string, recipePath: string): string {
    const withoutExtension = recipePath.replace(/\.cook$/, '');
    let relative = posixPath.relative(journalDir || '.', withoutExtension);
    if (!relative.startsWith('.')) {
        relative = `./${relative}`;
    }
    return `@${relative}{}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: PASS — 18 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/src
git commit -m "feat(meal-journal): entry navigation and recipe reference logic"
```

---

### Task 4: Extension entry point — Open Today / Open Yesterday + status bar

**Files:**
- Create: `meal-journal/src/extension.ts`

No unit tests for this file — it's all `vscode` API glue; it's verified end-to-end in Task 8.

- [ ] **Step 1: Create `meal-journal/src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { adjacentEntry, DEFAULT_TEMPLATE, fileNameForDate, isJournalFileName, renderTemplate } from './journal-files';
import { pickAndInsertRecipeReference } from './recipe-picker';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mealJournal.openToday', () => openOrCreateEntry(dateWithOffset(0))),
        vscode.commands.registerCommand('mealJournal.openYesterday', () => openYesterday()),
        vscode.commands.registerCommand('mealJournal.openPreviousEntry', () => openAdjacentEntry('previous')),
        vscode.commands.registerCommand('mealJournal.openNextEntry', () => openAdjacentEntry('next')),
        vscode.commands.registerCommand('mealJournal.insertRecipeReference', () => pickAndInsertRecipeReference())
    );

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(notebook) Today';
    statusBarItem.tooltip = "Open today's meal journal";
    statusBarItem.command = 'mealJournal.openToday';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
    // nothing to clean up; subscriptions are disposed by the host
}

function dateWithOffset(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

/** Journal folder URI from settings, or undefined (with a warning) when no workspace is open. */
function journalFolderUri(): vscode.Uri | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Meal Journal: open a workspace folder first.');
        return undefined;
    }
    const folderName = vscode.workspace.getConfiguration('mealJournal').get<string>('folder', 'Journal');
    return vscode.Uri.joinPath(workspaceFolder.uri, folderName);
}

async function openOrCreateEntry(date: Date): Promise<void> {
    const folder = journalFolderUri();
    if (!folder) {
        return;
    }
    await vscode.workspace.fs.createDirectory(folder);
    const entryUri = vscode.Uri.joinPath(folder, fileNameForDate(date));
    if (!(await exists(entryUri))) {
        const configured = vscode.workspace.getConfiguration('mealJournal').get<string>('template', '');
        const template = configured || DEFAULT_TEMPLATE;
        await vscode.workspace.fs.writeFile(entryUri, new TextEncoder().encode(renderTemplate(template, date)));
    }
    await openEntry(entryUri);
}

async function openYesterday(): Promise<void> {
    const folder = journalFolderUri();
    if (!folder) {
        return;
    }
    const yesterday = dateWithOffset(-1);
    const entryUri = vscode.Uri.joinPath(folder, fileNameForDate(yesterday));
    if (await exists(entryUri)) {
        await openEntry(entryUri);
        return;
    }
    const choice = await vscode.window.showInformationMessage('No journal entry for yesterday.', 'Create it');
    if (choice === 'Create it') {
        await openOrCreateEntry(yesterday);
    }
}

async function openAdjacentEntry(direction: 'previous' | 'next'): Promise<void> {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const currentName = activeUri?.path.split('/').pop();
    if (!activeUri || !currentName || !isJournalFileName(currentName)) {
        vscode.window.showWarningMessage('Meal Journal: open a journal entry first.');
        return;
    }
    const folder = vscode.Uri.joinPath(activeUri, '..');
    const entries = (await vscode.workspace.fs.readDirectory(folder))
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => name);
    const target = adjacentEntry(entries, currentName, direction);
    if (!target) {
        vscode.window.setStatusBarMessage(direction === 'previous' ? 'No earlier entries' : 'No later entries', 3000);
        return;
    }
    await openEntry(vscode.Uri.joinPath(folder, target));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/** Opens an entry and places the cursor on the line after the first section heading. */
async function openEntry(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    for (let line = 0; line < document.lineCount; line++) {
        if (document.lineAt(line).text.startsWith('= ')) {
            const position = new vscode.Position(Math.min(line + 1, document.lineCount - 1), 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
            break;
        }
    }
}
```

- [ ] **Step 2: Create a placeholder `meal-journal/src/recipe-picker.ts`** (full implementation in Task 5; needed now so `extension.ts` compiles)

```ts
import * as vscode from 'vscode';

export async function pickAndInsertRecipeReference(): Promise<void> {
    vscode.window.showInformationMessage('Not implemented yet.');
}
```

- [ ] **Step 3: Compile and run tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: compiles cleanly, 18 tests still passing.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/src
git commit -m "feat(meal-journal): open today/yesterday, prev/next navigation, status bar"
```

---

### Task 5: Recipe reference quick-pick

**Files:**
- Modify: `meal-journal/src/recipe-picker.ts` (replace placeholder)

- [ ] **Step 1: Replace `meal-journal/src/recipe-picker.ts` with the full implementation**

```ts
import * as vscode from 'vscode';
import { recipeReference } from './journal-files';

interface RecipeQuickPickItem extends vscode.QuickPickItem {
    relativePath: string;
}

/**
 * Shows a quick-pick of all .cook recipes in the workspace and inserts a
 * Cooklang recipe reference (relative to the active file's folder) at the cursor.
 */
export async function pickAndInsertRecipeReference(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Meal Journal: open a journal entry first.');
        return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Meal Journal: the active file is not inside the workspace.');
        return;
    }
    const recipeUris = await vscode.workspace.findFiles('**/*.cook');
    if (recipeUris.length === 0) {
        vscode.window.showInformationMessage('No .cook recipes found in the workspace.');
        return;
    }
    const items: RecipeQuickPickItem[] = recipeUris
        .map(uri => vscode.workspace.asRelativePath(uri, false))
        .sort()
        .map(relativePath => {
            const segments = relativePath.split('/');
            const fileName = segments.pop()!;
            return {
                label: fileName.replace(/\.cook$/, ''),
                description: segments.join('/'),
                relativePath
            };
        });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Pick a recipe to reference' });
    if (!picked) {
        return;
    }
    const journalDir = workspaceRelativeDir(editor.document.uri);
    const reference = recipeReference(journalDir, picked.relativePath);
    await editor.edit(editBuilder => editBuilder.insert(editor.selection.active, reference));
}

/** Workspace-relative POSIX path of the file's folder; '' when the file sits at the workspace root. */
function workspaceRelativeDir(documentUri: vscode.Uri): string {
    const dirUri = vscode.Uri.joinPath(documentUri, '..');
    const relative = vscode.workspace.asRelativePath(dirUri, false);
    // asRelativePath returns the input path unchanged when given the workspace root itself
    return relative === dirUri.path || relative === dirUri.fsPath ? '' : relative;
}
```

- [ ] **Step 2: Compile and run tests**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm test`
Expected: compiles cleanly, 18 tests passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/src/recipe-picker.ts
git commit -m "feat(meal-journal): recipe reference quick-pick"
```

---

### Task 6: Snippets

**Files:**
- Create: `meal-journal/snippets/cooklang.json`

- [ ] **Step 1: Create `meal-journal/snippets/cooklang.json`**

(The manifest from Task 1 already contributes this file for the `cooklang` language.)

```json
{
  "Meal section": {
    "prefix": "section",
    "body": [
      "= ${1:Breakfast}",
      "",
      "$0"
    ],
    "description": "Insert a meal section heading"
  },
  "Recipe reference": {
    "prefix": "recipe",
    "body": [
      "@./${1:path/Recipe Name}{$2}"
    ],
    "description": "Insert a Cooklang recipe reference"
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/snippets
git commit -m "feat(meal-journal): cooklang snippets for sections and recipe references"
```

---

### Task 7: Deploy script

**Files:**
- Create: `meal-journal/scripts/deploy.js`

- [ ] **Step 1: Create `meal-journal/scripts/deploy.js`**

A plain Node script (build tooling, so Node `fs` is fine here). It copies only what the plugin host needs — manifest, compiled JS, snippets — to `editor/plugins/cooklang.meal-journal`. That directory is gitignored in the editor repo, and the app's `copy:plugins` script copies `editor/plugins` into `app/plugins` on every start.

```js
// Copies the built plugin to ../../editor/plugins/cooklang.meal-journal,
// where the Cook Editor app picks it up on start (see app's copy:plugins script).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, '../../editor/plugins/cooklang.meal-journal');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'out', 'snippets']) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
}
console.log(`Deployed to ${target}`);
```

- [ ] **Step 2: Run the deploy**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm run deploy`
Expected: prints `Deployed to /Users/alexeydubovskoy/Cooklang/editor/plugins/cooklang.meal-journal`. Verify with `ls /Users/alexeydubovskoy/Cooklang/editor/plugins/cooklang.meal-journal` → `out  package.json  snippets`.

- [ ] **Step 3: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add meal-journal/scripts
git commit -m "feat(meal-journal): deploy script targeting editor/plugins"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only). Requires the Electron app.

- [ ] **Step 1: Start the editor**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npm run start:electron`
(The `copy:plugins` step copies `editor/plugins` — including `cooklang.meal-journal` — into `app/plugins`.)
Open the `app/Christmas Dinner` folder as the workspace.

- [ ] **Step 2: Verify the checklist**

1. **Status bar**: a `Today` item (notebook icon) appears on the left; clicking it creates and opens `Journal/2026-MM-DD.journal` with the templated content (YAML frontmatter + `= Breakfast` / `= Lunch` / `= Dinner`), cursor under `= Breakfast`.
2. **Language association**: the new `.journal` file has Cooklang syntax highlighting; ingredients typed as `@eggs{2}` get LSP completion/hover. If NOT highlighted → fallback in Step 3.
3. **Keybinding**: `cmd+shift+j` runs Open Today (re-opens the existing file, no duplicate creation).
4. **Open Yesterday**: with no entry for yesterday, the info message offers "Create it"; clicking creates yesterday's file with yesterday's date in the frontmatter.
5. **Prev/Next**: with today's entry open, the editor-title chevrons (and palette commands) jump between yesterday/today; at either end a transient "No earlier/later entries" status message shows.
6. **Insert Recipe Reference**: in the journal, run the command (palette or title icon); quick-pick lists the Christmas Dinner recipes; picking `Turkey` inserts `@../Christmas Dinner/Turkey{}` at the cursor. Verify the inserted reference is parsed as a recipe reference (highlighted like an ingredient, no diagnostics error). If `..` paths are rejected by the parser, file a follow-up: compute references relative to the workspace root instead (change `recipeReference` + tests).
7. **Snippets**: in the journal file, typing `section` then accepting the suggestion expands the meal-section snippet; `recipe` expands the reference skeleton.
8. **Settings**: change `mealJournal.folder` to `Diary` in Preferences, run Open Today → creates `Diary/...journal`. Change it back.
9. **No workspace**: close the workspace (File → Close Workspace), run Open Today → warning "open a workspace folder first", no crash.

- [ ] **Step 3 (only if language association failed in Step 2.2): build-time fallback**

In `/Users/alexeydubovskoy/Cooklang/editor/packages/cooklang/src/browser/cooklang-grammar-contribution.ts`, extend the registration (currently `extensions: ['.cook', '.menu']`):

```ts
            extensions: ['.cook', '.menu', '.journal'],
```

Then remove the `languages` block from `meal-journal/package.json`, redeploy, rebuild the editor (`npx lerna run compile --scope @theia/cooklang && cd app && npm run bundle`), and re-verify. Commit the editor change on a branch in the editor repo:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git checkout -b feature/journal-file-extension
git add packages/cooklang/src/browser/cooklang-grammar-contribution.ts
git commit -m "feat(cooklang): associate .journal files with the cooklang language"
```

- [ ] **Step 4: Record results**

Note any deviations found during verification; fix small issues directly (with a commit per fix).

---

### Task 9: Documentation — plugin README and repo developer guide

**Files:**
- Create: `meal-journal/README.md`
- Create: `README.md` (repo root)

- [ ] **Step 1: Create `meal-journal/README.md`**

```markdown
# Meal Journal

A daily meal journal for [Cook Editor](https://cook.md). One file per day
(`Journal/2026-06-09.journal`), written in [Cooklang](https://cooklang.org/)
markup — sections for meals, recipe references, ingredients.

## Features

| Feature | How |
|---|---|
| Open (or create) today's entry | Status bar `Today` button, `Cmd+Shift+J`, or **Journal: Open Today** |
| Open yesterday's entry | **Journal: Open Yesterday** (offers to create it if missing) |
| Jump between entries | Chevron icons in the editor title, or **Journal: Open Previous/Next Entry** |
| Reference a recipe | **Journal: Insert Recipe Reference** — quick-pick of all `.cook` files |
| Snippets | Type `section` or `recipe` in any Cooklang file |

New entries are created from a template (YAML frontmatter + `= Breakfast` /
`= Lunch` / `= Dinner` sections). Customize it with the `mealJournal.template`
setting (`${date}` and `${title}` placeholders); change the folder with
`mealJournal.folder`.

`.journal` files are associated with the Cooklang language, so they get the
same highlighting, completion and hover as `.cook` files.

## Development

```bash
npm install
npm test          # unit tests for the pure logic (src/journal-files.ts)
npm run deploy    # compile + copy to ../../editor/plugins/cooklang.meal-journal
```

Then start the editor: `cd ../../editor && npm run start:electron`.
```

- [ ] **Step 2: Create repo-root `README.md`** (the plugin developer guide)

```markdown
# Cook Editor Plugins

First-party plugins for [Cook Editor](https://cook.md), and a reference for
writing your own. Each plugin is a standalone npm package in its own folder.

| Plugin | Description |
|---|---|
| [`meal-journal`](./meal-journal) | Daily meal journal in Cooklang markup. **Start here** — it demonstrates the most common plugin APIs. |

## How plugins work

Cook Editor is built on [Eclipse Theia](https://theia-ide.org), which runs
**VS Code-style extensions**: plugins are written against the
[VS Code Extension API](https://code.visualstudio.com/api) and declare their
UI contributions (commands, menus, keybindings, settings, snippets, languages)
in `package.json`. Cook Editor currently supports VS Code API **1.110**.

At startup the app loads every plugin found in `editor/plugins/` — an unpacked
`.vsix` layout or a plain folder with a `package.json` both work. The
`meal-journal` plugin demonstrates:

- **Commands + keybindings + menus** — `contributes.commands`, `keybindings`,
  `menus` (with `when` clauses scoping buttons to `.journal` files)
- **Settings** — `contributes.configuration`, read via
  `workspace.getConfiguration(...)`
- **Language association** — `contributes.languages` adding `.journal` to the
  built-in `cooklang` language, inheriting its grammar and language server
- **Snippets** — `contributes.snippets`
- **Status bar** — `window.createStatusBarItem(...)` in `activate()`
- **Workspace file access** — `workspace.fs` (URI-based), `workspace.findFiles`
- **Quick-pick UI** — `window.showQuickPick`

## Writing a new plugin

1. Copy the `meal-journal` folder structure: `package.json` (manifest),
   `tsconfig.json`, `src/extension.ts` with an exported `activate()`.
2. The manifest needs `name`, `version`, `publisher`, `engines.vscode`, and
   `main` pointing at the compiled entry point.
3. Keep logic that doesn't need the `vscode` API in separate modules — they
   can be unit-tested with plain mocha (see `src/journal-files.spec.ts`).
4. Build and deploy: `npm run deploy` copies the plugin into
   `../../editor/plugins/<publisher>.<name>`.
5. Start the editor: `cd ../../editor && npm run start:electron`. The app
   copies `editor/plugins` into its own plugins folder on every start.

The dev loop is: edit → `npm run deploy` → restart the editor.

## Useful references

- [VS Code Extension API docs](https://code.visualstudio.com/api)
- [Theia / VS Code API compatibility report](https://eclipse-theia.github.io/vscode-theia-comparator/status.html)
- [Cooklang specification](https://cooklang.org/docs/spec/)
```

- [ ] **Step 3: Redeploy so the shipped plugin includes the README**

Optional but tidy — `deploy.js` only copies `package.json`, `out`, `snippets`; READMEs are for the repo. No action needed.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add README.md meal-journal/README.md
git commit -m "docs: plugin README and plugin developer guide"
```

---

## Self-review notes

- **Spec coverage:** language association (Task 1 manifest + Task 8 verification + fallback), commands/keybinding/menus/settings (Task 1), Open Today (Task 4), Yesterday (Task 4), Prev/Next (Tasks 3+4), recipe reference (Tasks 3+5), snippets (Task 6), status bar (Task 4), error handling (Tasks 4+5: no-workspace warnings, exists-check treats races as already-exists), unit tests (Tasks 2+3), manual E2E (Task 8), dev workflow + READMEs (Tasks 7+9). ✔
- **Open risk, flagged in spec:** whether the cooklang parser accepts `..` in recipe reference paths — explicitly checked in Task 8 step 2.6 with a defined fallback (workspace-root-relative references).
- **Type consistency:** `adjacentEntry(entries, current, direction)` and `recipeReference(journalDir, recipePath)` signatures match across Tasks 3, 4, 5. `isJournalFileName` used in both `journal-files.ts` and `extension.ts`. ✔

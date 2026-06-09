# Meal Journal Plugin — Design

**Date:** 2026-06-09
**Status:** Approved

## Purpose

The first first-party plugin for Cook Editor, with two equal goals:

1. **Product:** a meal journal — one `.journal` file per day where the user logs meals using Cooklang markup (sections, recipe references, ingredients).
2. **Demo:** a reference example for third-party plugin developers, exercising the most common plugin APIs (commands, keybindings, menus, settings, snippets, language association, status bar, quick-pick, workspace file access) in a small, readable codebase.

## Decisions

- **Plugin type:** VS Code-style extension (`engines.vscode`), TypeScript against `@types/vscode`. No Theia-only APIs. Most familiar and copyable for third-party developers.
- **Location:** new standalone repo at `~/Cooklang/plugins/`, one subfolder per plugin. This repo holds plugin *sources*; `editor/plugins/` remains build artifacts only.
- **File layout:** one file per day, flat folder: `<workspace>/Journal/YYYY-MM-DD.journal`. Folder name configurable.
- **File extension:** `.journal` (not `.cook`), associated with the `cooklang` language so highlighting and LSP carry over.
- **Build:** plain `tsc` to `out/`, zero runtime dependencies, no bundler.

## Repo layout

```
~/Cooklang/plugins/
  README.md                          ← "How to write a plugin for Cook Editor" guide
  meal-journal/
    package.json                     ← manifest: engines.vscode + contributes
    tsconfig.json
    README.md                        ← plugin-specific docs
    src/
      extension.ts                   ← activate(): registrations, status bar item
      journal-files.ts               ← pure logic: filenames, dates, template, prev/next
      recipe-picker.ts               ← quick-pick + reference insertion
      journal-files.spec.ts          ← unit tests for pure logic
    snippets/cooklang.json
```

## Manifest contributions

- **Language association:** `contributes.languages: [{ "id": "cooklang", "extensions": [".journal"] }]`.
  The editor's grammar and LSP both bind to the `cooklang` language ID
  (`packages/cooklang/src/browser/cooklang-grammar-contribution.ts`,
  `cooklang-language-client-contribution.ts`), so associating the extension with
  the language ID is the only integration point needed.
  **Fallback** if Theia does not merge plugin language contributions into the
  monaco-registered language: add `.journal` to the `extensions` array in
  `cooklang-grammar-contribution.ts` (one line) and drop this contribution from
  the plugin.
- **Commands:**
  - `mealJournal.openToday` — "Journal: Open Today"
  - `mealJournal.openYesterday` — "Journal: Open Yesterday"
  - `mealJournal.openPreviousEntry` — "Journal: Open Previous Entry"
  - `mealJournal.openNextEntry` — "Journal: Open Next Entry"
  - `mealJournal.insertRecipeReference` — "Journal: Insert Recipe Reference"
- **Keybinding:** `cmd+shift+j` (`ctrl+shift+j` on win/linux) → `openToday`.
- **Menus:** all commands in the command palette; prev/next/insert also in the
  editor title menu with `when: resourceExtname == .journal`.
- **Settings:**
  - `mealJournal.folder` (string, default `"Journal"`) — folder under the workspace root.
  - `mealJournal.template` (multiline string) — template for new entries with
    `${date}` (ISO `YYYY-MM-DD`) and `${title}` (human-readable, e.g.
    "Monday, 9 June 2026") placeholders.
- **Snippets** (cooklang language): insert a meal section; insert a recipe reference skeleton.
- **Status bar item** (created in `activate()`): `📓 Today`, runs `openToday`.

## Feature behavior

### Open Today
1. Resolve the first workspace folder; if none, show a warning and stop.
2. Ensure the journal folder exists (create recursively).
3. Compute today's filename from the **local** date: `YYYY-MM-DD.journal`.
4. If the file doesn't exist, create it from the template. Default template
   (YAML frontmatter — never the deprecated `>>` syntax):

   ```
   ---
   title: Monday, 9 June 2026
   date: 2026-06-09
   type: journal
   ---

   = Breakfast

   = Lunch

   = Dinner
   ```
5. Open the file, cursor placed on the empty line after the first section.

### Open Yesterday
Same path computation for local date − 1 day. If the file exists, open it.
If not, show an info message with a "Create it" button that creates it from the
template (with yesterday's date) and opens it.

### Open Previous / Next Entry
Operate relative to the **active editor's** `.journal` file. List the journal
folder, sort filenames (ISO dates sort lexically), and open the nearest entry
before/after the current one. At either end, show a transient status message
("No earlier entries"). Commands do nothing (with a warning) if the active file
is not a `.journal` file — guarded both by menu `when` clause and in code.

### Insert Recipe Reference
1. `workspace.findFiles('**/*.cook')`.
2. Quick-pick: label = recipe name (basename without extension), description = relative folder.
3. On selection, insert at the cursor a cooklang recipe reference whose path is
   **relative to the journal file's directory**, e.g. `@./Christmas Dinner/Turkey{}`.
   Exact reference syntax (extension included or not) to be verified against the
   cooklang parser during implementation.

## Error handling

- No workspace folder open → `window.showWarningMessage`, command aborts.
- All file operations via `vscode.workspace.fs` (URI-based); no Node `fs`, no raw paths.
- Dates computed in the local timezone with plain `Date`; no date libraries.
- File-creation race (file appears between check and write): treat as
  already-exists and just open it.

## Testing

- **Unit (mocha):** pure functions in `journal-files.ts` —
  date → filename and back, template rendering with placeholders,
  prev/next selection over a sorted filename list, relative path computation
  for recipe references.
- **Manual end-to-end:** `npm run deploy` then `npm start` in the editor;
  verify each command, the status bar button, `.journal` highlighting/LSP,
  and snippet expansion.

## Dev workflow (also documented in README)

```
cd ~/Cooklang/plugins/meal-journal
npm install
npm run deploy        # tsc build + copy plugin folder to editor/plugins/cooklang.meal-journal
cd ~/Cooklang/editor && npm run start:electron   # copy:plugins picks it up
```

The root README walks a new plugin developer through: how Theia loads
unpacked VS Code-style plugins from `editor/plugins`, the manifest anatomy,
the dev loop, and how to add a new plugin folder to this repo.

## Out of scope (YAGNI)

- Journal sidebar/tree view (may come later; would demo TreeDataProvider).
- Weekly/monthly aggregation, stats, streaks.
- Calendar picker UI.
- Packaging as `.vsix` / publishing to a registry.

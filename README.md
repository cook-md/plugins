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

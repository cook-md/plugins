# Cook Editor Plugins

First-party plugins for [Cook Editor](https://cook.md), and a reference for
writing your own. Each plugin is a standalone npm package in its own folder.

| Plugin | Description |
|---|---|
| [`meal-journal`](./meal-journal) | Daily meal journal in Cooklang markup. **Start here** — it demonstrates the most common plugin APIs. |
| [`shopping-list`](./shopping-list) | Aisle-grouped shopping lists with pantry subtraction. Ships with Cook Editor. Shows the Cooklang API and outlets. |
| [`pantry`](./pantry) | See and edit `config/pantry.conf`: stock levels, low and out-of-stock items, expiry. Install it from the Extensions view. Shows editing a config file through the Cooklang API. |
| [`recipe-hub`](./recipe-hub) | Search recipes.cooklang.org, preview results and save them to Drafts. Install it from the Extensions view. Shows a read-only file system provider and `cooklang.api.saveDraft`. |
| [`nutriscore`](./nutriscore) | Nutri-Score badge on recipe previews, with a hover card showing how reliable it is. Needs a Cook Basic or Pro plan. Install it from the Extensions view. Shows the preview badge outlet and rendering a report template with `cooklang.api.renderReport`. |
| [`allergens`](./allergens) | Flags the allergens you choose on recipe previews: the 14 regulated allergens (Cook Basic or Pro) and your own words (free). Install it from the Extensions view. Shows a `pill` preview badge and `cooklang.api.refreshBadges`. |

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

For a step-by-step walkthrough, from an empty folder to a plugin published
on plugins.cook.md, see the
[plugin tutorial](https://cook.md/help/plugins/tutorial).

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

## Publishing to plugins.cook.md

Releases go to the [Cook plugins marketplace](https://plugins.cook.md) (an
OpenVSX-compatible registry). One-time setup:

1. Sign in at https://plugins.cook.md with GitHub and create a personal access
   token (PAT) in your dashboard.
2. Create the namespace matching the plugin's `publisher` (once per namespace):

   ```bash
   npx ovsx create-namespace cooklang -r https://plugins.cook.md -p <PAT>
   ```

To release a new version:

```bash
cd meal-journal
npm version patch        # or minor/major — updates package.json
npm run package          # builds meal-journal-<version>.vsix
OVSX_PAT=<PAT> npm run publish:marketplace
```

Verify with `curl https://plugins.cook.md/api/cooklang/meal-journal`.

## Useful references

- [VS Code Extension API docs](https://code.visualstudio.com/api)
- [Theia / VS Code API compatibility report](https://eclipse-theia.github.io/vscode-theia-comparator/status.html)
- [Cooklang specification](https://cooklang.org/docs/spec/)

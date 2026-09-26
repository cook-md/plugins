# Pantry

See and edit what's in your [Cooklang](https://cooklang.org) pantry from Cook
Editor's right sidebar. Install it from the Extensions view (needs a Cook
Editor with the pantry API; older versions ask you to update).

- Items are grouped by the sections of `config/pantry.conf`, the same file
  CookCLI and the shopping list use; pantry items are subtracted from
  shopping lists.
- Each item shows its stock status (in stock, low, out of stock, expiring,
  expired), quantity and expiry.
- Search, and filter by Low, Out of stock or Expiring (within 7 days, including expired).
- Add, edit and remove items. Edits keep your file's comments and
  formatting; emptying a field removes it.
- No pantry yet? "Create pantry" writes a starter `config/pantry.conf`.

Items written above the first `[section]` header can only have a quantity;
move them into a section to track expiry or a low-stock level.

User guide: https://cook.md/help/plugins/pantry

## For plugin authors

This plugin uses:

- the `cooklang.api.parsePantry` and `cooklang.api.editPantry` commands
  (see `src/cooklang-api.ts`), detected with `vscode.commands.getCommands`;
- a webview view in the right sidebar (`src/pantry-controller.ts`,
  `src/webview/main.ts`).

Reference: https://cook.md/help/plugins/api

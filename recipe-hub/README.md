# Recipe Hub

Search the public Cooklang recipe index at
[recipes.cooklang.org](https://recipes.cooklang.org) without leaving Cook
Editor, preview any result, and save it into your own recipes. Install it from
the Extensions view in Cook Editor; it opens in the left sidebar.

- The search box takes the full Recipe Hub query syntax: plain text
  (`pasta`), field queries (`tags:vegan`, `ingredients:garlic`, `title:soup`),
  ranges (`total_time:[0 TO 30]`), quoted phrases (`"olive oil"`) and
  exclusions (`-cilantro`).
- **Filters** narrow the same search: tags (with result counts), ingredients
  to include or exclude (up to 20 each), a max total time (15/30/60 min),
  difficulty (easy/medium/hard), a servings range, and language — which
  defaults to the editor's display language. Sort by relevance or newest.
  Click a card's feed name to filter to just that feed.
  Filters are remembered per workspace, across restarts.
- Click a card to open it in the normal, read-only recipe preview (served
  from a `cooklang-hub:` file system, so nothing is written to disk).
- Preview toolbar, on a Recipe Hub recipe:
  - **Save to Drafts** copies the recipe into `Drafts/<Title>.cook` in the
    first folder of your workspace, adding `title:` and `source:` to its YAML
    frontmatter (deprecated `>>` metadata in the source is converted to YAML,
    never written). Needs an open folder.
  - **Open Original Recipe** opens the recipe's source page in your browser.

Setting: `recipeHub.serverUrl` (default `https://recipes.cooklang.org`)
points the panel at another Recipe Hub server; a value that isn't a valid
`http(s)` URL falls back to the default.

Recipe Hub needs a Cook Editor with `cooklang.api.saveDraft` and
`cooklang.api.openPreview`. Search still works without them, but older
editors show an "Update Cook Editor" message instead of previewing or saving.

**Privacy:** search queries and filters are sent to the configured server.
Result thumbnails load directly from each recipe's own hosting (not proxied
through the server) with no referrer.

## For plugin authors

This plugin shows:

- a read-only `FileSystemProvider` (`cooklang-hub:` scheme) that lets the
  standard recipe preview show remote recipes — `src/hub-file-system.ts`,
  logic in `src/hub-file-system-core.ts`;
- `cooklang.api.openPreview` and `cooklang.api.saveDraft`, detected with
  `vscode.commands.getCommands(true)` rather than a version number, and the
  `cooklangPreviewScheme` context key for `cooklang/recipePreview/toolbar`
  outlet entries — `src/cooklang-api.ts`, `package.json` → `contributes.menus`;
- a webview view that keeps all network access in the extension host
  (`src/search-view-provider.ts`, `src/webview/main.ts`).

Reference: https://cook.md/help/plugins/api and https://cook.md/help/plugins/outlets

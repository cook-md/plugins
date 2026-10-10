# Cookbook plugin (folder → PDF) — design

**Date:** 2026-10-10
**Status:** Approved
**Scope:** New optional, free plugin `cooklang.cookbook` that turns a folder of recipes into a PDF cookbook: cover, table of contents, one chapter per subfolder with an optional intro from that subfolder's `README.md`, recipes with photos, an optional nutrition line, and an ingredient index. Needs two new editor API commands (`cooklang.api.exportPdf`, `cooklang.api.recipeImages`), specified in `editor/docs/superpowers/specs/2026-10-10-cookbook-plugin-api-design.md`.

## Goals

- Right-click a folder → **Export as Cookbook (PDF)…** → a printable, shareable book.
- Subfolders are chapters; a `README.md` in any folder supplies its intro text (root README = cover).
- Recipe photos, a table of contents and an ingredient index.
- Per-serving nutrition line for Cook Basic / Pro users; silently omitted otherwise. The rest is free.

## Non-goals

- Page numbers in the TOC / index (Chromium `printToPDF` can't resolve them; we use PDF links instead).
- Layout themes or custom CSS (v1 has one tasteful layout; a `cookbook.css` override is a possible v2).
- EPUB or other formats.
- Menus (`.menu` files are skipped).

## Folder model

Pure module `book-tree.ts`, input = list of workspace-relative paths under the chosen folder:

- **Book** = chosen folder. **Chapter** = any descendant folder that contains at least one `.cook` file (directly or below). Nested folders become nested chapters (heading level follows depth, max 3; deeper folders are flattened into their level-3 ancestor).
- **Recipes** = `.cook` files directly in a folder, in that folder's chapter (root-level recipes go before the first chapter, under no chapter heading).
- **README** = `README.md` (case-insensitive, also `readme.markdown`) in a folder. Root README → cover; chapter README → chapter intro.
- **Order:** alphabetical, case-insensitive, numeric-aware (`2 Soups` before `10 Mains`). A leading `NN-`/`NN ` prefix is stripped from displayed titles. README YAML frontmatter may set `title:` (overrides the folder name) and `order:` (number; lower first; unordered after ordered).
- Skipped: dot-folders, `node_modules`, `config/`, `Drafts/` (setting `cookbook.exclude`, default `["Drafts", "config"]`).

## Markdown

Pure module `markdown.ts`, a small converter with no dependencies, escaping all HTML in the source: headings (`#`–`###`, shifted below the chapter heading), paragraphs, `*em*`/`**strong**`, inline code, ordered/unordered lists (one level), links (`http(s)` only; others rendered as text), images (relative paths resolved against the README and inlined as data URIs, `http(s)` kept), blockquotes, horizontal rules. Anything else falls back to paragraph text. Frontmatter is stripped.

## Recipe rendering

One `renderReport` call per recipe with an HTML-producing Jinja template (`recipe-template.ts`) that emits a JSON object (`tojson`) of the parts, so the plugin controls escaping and layout:

- `title` (metadata `title` or file name), `metadata` (servings, time / prep / cook time, source, tags), `ingredients` (name, quantity, note, optional), `cookware`, `sections` → steps as text with ingredient/timer/cookware spans flattened to plain text, plus section names.
- Plugin builds HTML from that (`recipe-html.ts`), escaping everything.

**Images:** `cooklang.api.recipeImages({ uri })` → `{ title?: uri, steps: { [section]: { [step]: uri } } }`. Each image is read with `workspace.fs.readFile` (skip > 10 MB), inlined as a `data:` URI. Title image sits under the recipe title; step images after their step, max width 60 %.

**Nutrition (optional):** if `hasFeature('nutrition_api')` and setting `cookbook.nutrition` (default `true`), a second `renderReport` with `aggregate_nutrition(ingredients) | tojson`; a line `Per serving: 520 kcal · 38 g protein · 52 g carbs · 14 g fat` using frontmatter servings (whole recipe when absent, labelled). Skipped silently on error or below 70 % ingredient match.

## Book HTML

`book-html.ts` assembles one HTML document with print CSS (A4 default, setting `cookbook.pageSize`: `A4` | `Letter`):

1. **Cover:** root README title (first `#` heading or frontmatter `title`, else folder name) and body; else folder name only. Generated date at the bottom.
2. **Contents:** chapters and recipes as `<a href="#id">` links (internal PDF links).
3. **Chapters:** `page-break-before: always`; heading, intro (README), then each recipe (`page-break-before: always` per recipe, `break-inside: avoid` on the ingredient list).
4. **Index of ingredients:** alphabetical, normalised names (lowercase, simple plural stripped), each listing recipe titles as links. Recipe references excluded.

## Export flow

Command `cookbook.export` on Explorer folder context menu (`explorer/context`, `when: explorerResourceIsFolder`) and command palette (asks for a folder via quick pick of workspace folders containing `.cook` files).

1. Check `cooklang.api.exportPdf` and `cooklang.api.recipeImages` are registered; if not: "Update Cook Editor to export cookbooks" with a link to cook.md/editor.
2. Walk the folder (`workspace.findFiles` with a `RelativePattern`), build the tree.
3. `window.withProgress` (notification, cancellable): "Rendering 34/120 recipes…", 4 concurrent renders.
4. Recipes that fail to render are listed in an appendix "Not included" and a warning toast after export.
5. `cooklang.api.exportPdf({ html, defaultFileName: '<Book title>.pdf' })` → editor shows the save dialog and writes the file; on success, toast "Cookbook saved" with **Open** (`env.openExternal`).

Limit: 500 recipes per book (fail fast with a message; keeps the HTML well under the editor's export limit).

## Architecture

`cooklang-api.ts`, `book-tree.ts`, `markdown.ts`, `recipe-template.ts`, `recipe-html.ts`, `images.ts`, `nutrition-line.ts`, `book-html.ts`, `export-command.ts`, `extension.ts`.

## Testing

Tree building (ordering, prefixes, frontmatter `order`/`title`, nesting depth, excludes, empty folders); markdown converter (each construct, HTML escaping, unsafe links); recipe JSON → HTML (escaping, optional ingredients, sections); index normalisation; full book HTML snapshot from a fixture folder; missing-API path.

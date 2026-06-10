# Marketplace Publishing for meal-journal — Design

**Date:** 2026-06-10
**Status:** Approved

## Purpose

Publish `meal-journal@0.1.0` to the self-hosted, OpenVSX-compatible marketplace at
`https://plugins.cook.md` (source: `~/Cooklang/plugin-marketplace`), and point Cook
Editor's Extensions view at that registry so the plugin can be browsed and installed
in-app. Make future releases a one-command affair for any maintainer.

## Context

- The marketplace speaks the OpenVSX API: publishing uses the `ovsx` CLI with a
  personal access token (PAT) created in the web UI (GitHub login); namespaces are
  created via `ovsx create-namespace`.
- The editor's registry URL comes from the `VSX_REGISTRY_URL` env var, read in
  `packages/vsx-registry/src/node/vsx-environment-impl.ts:27` (default
  `https://open-vsx.org`). Nothing in the editor repo currently references
  plugins.cook.md.
- `vsce` will not package non-interactively without a `LICENSE` file and warns
  without a `repository` field; without a `.vscodeignore` the `.vsix` would include
  sources, tests, and maps.

## Part A — Packaging prep (cook-md/plugins repo, `meal-journal/`)

1. **`LICENSE`** — MIT license text, copyright "2026 Alexey Dubovskoy".
2. **`package.json` additions:**
   - `"repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "meal-journal" }`
   - `"keywords": ["cooklang", "journal", "recipes", "meal-planning"]`
   - Scripts:
     - `"vscode:prepublish": "npm run compile"` (run automatically by vsce)
     - `"package": "vsce package --no-dependencies"` → `meal-journal-0.1.0.vsix`
     - `"publish:marketplace": "ovsx publish --packagePath meal-journal-0.1.0.vsix -r https://plugins.cook.md"`
       (PAT read from the standard `OVSX_PAT` env var; version in the filename is
       maintained alongside the `version` field on each release)
   - devDependencies: `@vscode/vsce`, `ovsx`.
3. **`.vscodeignore`:**
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
   Shipped vsix contents: `package.json`, `README.md`, `LICENSE`, `out/*.js`
   (runtime only), `snippets/`.
4. **`.gitignore`** (repo root): add `*.vsix`.
5. **Docs:** "Publishing" section in the repo-root README: create a PAT at
   plugins.cook.md, one-time `npx ovsx create-namespace cooklang -r https://plugins.cook.md`,
   then `npm run package && OVSX_PAT=<token> npm run publish:marketplace`.

Decision: explicit `vsce package` + `ovsx publish` of the artifact (rather than
`ovsx publish` from the folder) — the `.vsix` is inspectable and attachable to
GitHub releases later.

## Part B — Editor registry config (cook-md/editor repo)

In the existing `packages/cooklang-branding/src/electron-main/cooklang-branding-electron-main-module.ts`,
set at module load (before the backend process is forked; the backend inherits env):

```ts
process.env.VSX_REGISTRY_URL ??= 'https://plugins.cook.md';
```

An explicitly set env var still wins, preserving dev overrides. This follows the
project pattern of customizing via `cooklang-branding` instead of editing upstream
files. Editor work lands on a feature branch in the editor repo.

Rejected alternatives: DI-rebind of `VSXEnvironment` (more wiring, same effect);
changing the upstream default (conflicts with the upstream-merge strategy).

## Part C — Publish + verification

1. User creates a PAT in the plugins.cook.md web UI. To keep the token out of the
   conversation transcript, the user runs namespace creation and publish themselves
   (`!`-prefixed commands), or provides the PAT explicitly.
   - One-time: `npx ovsx create-namespace cooklang -r https://plugins.cook.md -p <PAT>`
   - Publish: `npm run package && OVSX_PAT=<PAT> npm run publish:marketplace`
2. **Server-side verification:** `curl https://plugins.cook.md/api/cooklang/meal-journal`
   returns the extension metadata; the search API lists it.
3. **In-app verification:** rebuild the editor with Part B; the Extensions view
   browses plugins.cook.md, shows meal-journal, and installs it successfully.
   (For the install test, remove/ignore the locally deployed copy in
   `editor/plugins/cooklang.meal-journal` if it shadows the marketplace install.)

## Error handling

- `vsce package` failures (missing LICENSE/repository) are prevented by Part A.
- `ovsx` failures surface CLI errors directly (wrong PAT → 401, missing namespace
  → explicit error); the README documents the one-time namespace step.
- Part B uses `??=` so misconfiguration is recoverable by env var without rebuild.

## Testing

- Package check: `unzip -l meal-journal-0.1.0.vsix` (or `vsce ls`) shows no `src/`,
  no `*.spec.js`, no `*.map`; includes LICENSE, README, snippets, runtime JS.
- Part B: in-app Extensions view check above. No new unit tests (config/tooling only).

## Out of scope (YAGNI)

- GitHub Actions release workflow (revisit when releases become frequent).
- Marketplace icon/gallery banner for the plugin.
- Publishing any other plugin or backfilling the vscode builtin extensions.

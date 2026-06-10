# Marketplace Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `meal-journal@0.1.0` to the OpenVSX-compatible marketplace at https://plugins.cook.md and point Cook Editor's Extensions view at that registry.

**Architecture:** Two repos. In `cook-md/plugins`: packaging metadata (LICENSE, repository field, .vscodeignore) plus `package`/`publish:marketplace` npm scripts using `@vscode/vsce` + `ovsx` devDependencies; the `.vsix` is built explicitly and published as an artifact. In `cook-md/editor`: one line in the existing `cooklang-branding` electron-main module sets `VSX_REGISTRY_URL` (backend inherits env; explicit env still wins). The actual publish is an operational step requiring the user's PAT.

**Tech Stack:** vsce 3.x, ovsx CLI, npm scripts (`$npm_package_version`), Theia `vsx-registry` env config.

**Repos/branches:** `~/Cooklang/plugins` → branch `feature/marketplace-publishing`; `~/Cooklang/editor` → branch `feature/marketplace-registry`.

**Spec:** `docs/superpowers/specs/2026-06-10-marketplace-publishing-design.md`

---

### Task 1: Packaging metadata (plugins repo)

**Files:**
- Create: `meal-journal/LICENSE`
- Create: `meal-journal/.vscodeignore`
- Modify: `meal-journal/package.json`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create branch**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git checkout main && git pull --ff-only
git checkout -b feature/marketplace-publishing
```

- [ ] **Step 2: Create `meal-journal/LICENSE`**

```
MIT License

Copyright (c) 2026 Alexey Dubovskoy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Create `meal-journal/.vscodeignore`**

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

- [ ] **Step 4: Edit `meal-journal/package.json`**

Add `repository` and `keywords` after the `"license": "MIT",` line:

```json
  "repository": {
    "type": "git",
    "url": "https://github.com/cook-md/plugins.git",
    "directory": "meal-journal"
  },
  "keywords": [
    "cooklang",
    "journal",
    "recipes",
    "meal-planning"
  ],
```

Replace the `scripts` block with (adds `vscode:prepublish`, `package`, `publish:marketplace`; existing entries unchanged):

```json
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -w -p .",
    "test": "npm run compile && mocha \"out/**/*.spec.js\"",
    "deploy": "npm run compile && node ./scripts/deploy.js",
    "vscode:prepublish": "npm run compile",
    "package": "vsce package --no-dependencies",
    "publish:marketplace": "ovsx publish --packagePath meal-journal-$npm_package_version.vsix -r https://plugins.cook.md"
  },
```

Replace the `devDependencies` block with (pins `@types/vscode` to `~1.100.0` — vsce refuses to package when the installed @types/vscode version exceeds `engines.vscode`, and the previous `^1.100.0` resolved to 1.120.0; adds vsce and ovsx):

```json
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^3.3.0",
    "mocha": "^10.4.0",
    "ovsx": "^1.0.0",
    "typescript": "~5.4.5"
  }
```

- [ ] **Step 5: Add `*.vsix` to the repo-root `.gitignore`**

Append to `/Users/alexeydubovskoy/Cooklang/plugins/.gitignore`:

```
*.vsix
```

- [ ] **Step 6: Install and verify tests still pass**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm install && npm test`
Expected: install succeeds; `18 passing`.

- [ ] **Step 7: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add .gitignore meal-journal/LICENSE meal-journal/.vscodeignore meal-journal/package.json meal-journal/package-lock.json
git commit -m "feat(meal-journal): packaging metadata and marketplace publish scripts"
```

---

### Task 2: Build the .vsix and verify its contents

**Files:** none committed (the `.vsix` is gitignored). Verification task.

- [ ] **Step 1: Package**

Run: `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm run package`
Expected: ends with `Packaged: .../meal-journal-0.1.0.vsix` (warnings about a missing icon are fine; there must be NO license or repository warnings and no errors).

- [ ] **Step 2: Inspect the archive**

Run: `unzip -l /Users/alexeydubovskoy/Cooklang/plugins/meal-journal/meal-journal-0.1.0.vsix`
Expected entries (under `extension/`): `package.json`, `README.md`, `LICENSE.txt` or `LICENSE`, `out/extension.js`, `out/journal-files.js`, `out/recipe-picker.js`, `snippets/cooklang.json`, plus vsix manifest files (`extension.vsixmanifest`, `[Content_Types].xml`).
Must NOT contain: anything under `src/`, `*.spec.js`, `*.map`, `scripts/`, `tsconfig.json`, `node_modules/`.

If forbidden files appear, fix `.vscodeignore`, re-run, and amend the Task 1 commit.

---

### Task 3: Publishing docs (plugins repo)

**Files:**
- Modify: `README.md` (repo root)

- [ ] **Step 1: Append a Publishing section to the repo-root README**

Insert before the `## Useful references` section:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git add README.md
git commit -m "docs: publishing guide for plugins.cook.md"
```

---

### Task 4: Point Cook Editor at the marketplace (editor repo)

**Files:**
- Modify: `packages/cooklang-branding/src/electron-main/cooklang-branding-electron-main-module.ts`

- [ ] **Step 1: Create branch in the editor repo**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git checkout main && git pull --ff-only
git checkout -b feature/marketplace-registry
```

- [ ] **Step 2: Edit the electron-main module**

In `packages/cooklang-branding/src/electron-main/cooklang-branding-electron-main-module.ts`, after the import block (currently ends at line 17 with the `CooklangBrandingElectronMainContribution` import) and before `export default new ContainerModule(...)`, insert:

```ts
// Cook Editor installs plugins from the self-hosted marketplace. The backend
// process inherits this env var (read by @theia/vsx-registry's VSXEnvironment);
// an explicitly set VSX_REGISTRY_URL still wins for dev overrides.
process.env.VSX_REGISTRY_URL ??= 'https://plugins.cook.md';
```

- [ ] **Step 3: Compile the package**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor && npx lerna run compile --scope @theia/cooklang-branding`
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add packages/cooklang-branding/src/electron-main/cooklang-branding-electron-main-module.ts
git commit -m "feat(branding): default VSX registry to plugins.cook.md"
```

---

### Task 5: Publish to plugins.cook.md (operational — requires the user's PAT)

**Files:** none. The PAT must NOT be committed or echoed into files.

- [ ] **Step 1: User creates a PAT**

Ask the user to sign in at https://plugins.cook.md (GitHub) and create a personal access token in the dashboard.

- [ ] **Step 2: Create the `cooklang` namespace and publish**

Preferred (keeps the PAT out of the transcript): the user runs, via `!`-prefixed commands:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal
npx ovsx create-namespace cooklang -r https://plugins.cook.md -p <PAT>
OVSX_PAT=<PAT> npm run publish:marketplace
```

(If the namespace already exists, `create-namespace` fails with an explicit error — that's fine, continue.)
Expected publish output: `Published cooklang.meal-journal v0.1.0`.

- [ ] **Step 3: Server-side verification**

```bash
curl -s https://plugins.cook.md/api/cooklang/meal-journal | head -c 400
curl -s "https://plugins.cook.md/api/-/search?query=journal" | head -c 400
```

Expected: JSON metadata for `cooklang.meal-journal` version `0.1.0`; the search result lists the extension.

---

### Task 6: In-app verification (editor)

**Files:** none. Requires Task 4 + Task 5 done and the user available (GUI).

- [ ] **Step 1: Rebuild the app bundle**

Run: `cd /Users/alexeydubovskoy/Cooklang/editor/app && npm run bundle`
Expected: webpack build completes.

- [ ] **Step 2: Hide the locally deployed copy so the marketplace install is observable**

```bash
rm -rf /Users/alexeydubovskoy/Cooklang/editor/plugins/cooklang.meal-journal
```

(It can be restored anytime with `cd /Users/alexeydubovskoy/Cooklang/plugins/meal-journal && npm run deploy`.)

- [ ] **Step 3: Verify in the running app**

Quit any running Cook Editor instance (single-instance lock), then `cd /Users/alexeydubovskoy/Cooklang/editor && npm run start:electron`. In the Extensions view:
1. Search for "meal" → `Meal Journal` appears, sourced from plugins.cook.md.
2. Install it → status bar `Today` button appears and works.

(Automatable check: with `--remote-debugging-port=9222`, the backend log shows API calls to plugins.cook.md instead of open-vsx.org; the Extensions search returns the plugin.)

- [ ] **Step 4: Record results; fix-or-file anything that fails**

---

### Task 7: Push branches and open PRs

- [ ] **Step 1: Plugins repo PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins
git push -u origin feature/marketplace-publishing
gh pr create --base main --title "feat: marketplace packaging and publish scripts" --body "Packaging metadata (LICENSE, repository, .vscodeignore), vsce/ovsx publish scripts, and a publishing guide for plugins.cook.md. meal-journal 0.1.0 published and verified."
```

- [ ] **Step 2: Editor repo PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git push -u origin feature/marketplace-registry
gh pr create --base main --title "feat(branding): default VSX registry to plugins.cook.md" --body "Sets VSX_REGISTRY_URL (if unset) in the cooklang-branding electron-main module so the Extensions view browses/installs from the self-hosted marketplace. Explicit env var still wins. Verified by installing cooklang.meal-journal from plugins.cook.md in-app."
```

---

## Self-review notes

- **Spec coverage:** LICENSE/repository/keywords/scripts/devDeps (Task 1), .vscodeignore + vsix content check (Tasks 1–2), `*.vsix` gitignore (Task 1), README publishing guide (Task 3), editor env default (Task 4), namespace + publish + curl verification (Task 5), in-app verification incl. removing the shadowing local deploy (Task 6). PRs (Task 7). ✔
- **Deviation from spec, intentional:** publish script uses `$npm_package_version` instead of a hardcoded `0.1.0` filename so `npm version` keeps everything in sync; spec's "maintained alongside the version field" is thus automatic.
- **Discovered constraint folded in:** vsce errors when installed `@types/vscode` (1.120.0 via `^1.100.0`) exceeds `engines.vscode` — pinned to `~1.100.0` in Task 1.
- **Placeholder scan:** `<PAT>` placeholders are deliberate (secret supplied by the user at run time). No TBDs. ✔
- **Consistency:** script names (`package`, `publish:marketplace`) match between Tasks 1, 3, 5; branch names consistent between Tasks 1/4/7. ✔

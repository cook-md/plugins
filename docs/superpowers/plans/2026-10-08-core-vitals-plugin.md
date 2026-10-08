# Core Vitals Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `cooklang.corevitals` plugin that badges meal plans and recipes with how many nutrient targets they meet (`Vitals 14/17`), with a hover summary and a toolbar icon that opens a full HTML report with charts.

**Architecture:** One Jinja template, built in TypeScript from the user's settings, is rendered by the editor's Reports engine in two modes: `json` for the badge (parsed and judged in TypeScript) and `html` for the report tab (opened through `cooklang.api.openReport`). Everything that does not need the `vscode` API lives in small pure modules with mocha specs; `extension.ts` only wires them. The plugin mirrors `nutriscore/` and `allergens/`.

**Tech Stack:** TypeScript 5.4, VS Code extension API 1.100 (via Theia), minijinja 2 templates rendered by the editor, mocha + node `assert`.

**Spec:** `docs/superpowers/specs/2026-10-08-core-vitals-plugin-design.md`

**Depends on:** the editor branch from `~/Cooklang/editor/docs/superpowers/plans/2026-10-08-core-vitals-editor.md` (menu badge outlet + `cooklang.api.openReport`), built and bundled in the editor checkout that `npm run deploy` targets.

---

## Conventions for every task

- Repo: `/Users/alexeydubovskoy/Cooklang/plugins`. Create branch `feature/core-vitals` from `main` in Task 1. Plugin folder: `corevitals/`.
- Tests: `cd corevitals && npm test` (compiles with `tsc -p .` then runs `mocha "out/**/*.spec.js"`). Run a single spec after `npm run compile` with `npx mocha out/<name>.spec.js`. Node 20 is fine here (no Theia).
- Specs use `import * as assert from 'assert'` and `describe/it`, like `nutriscore/src/nutriscore.spec.ts`.
- Code style: 4 spaces, single quotes, `undefined` not `null`, explicit return types, no `vscode` import outside `extension.ts`.
- Commit messages: conventional commits scoped `corevitals`, e.g. `feat(corevitals): …`.
- Never use the deprecated `>>` metadata syntax in any `.cook`/`.menu` fixture; use YAML frontmatter.

## File map (`corevitals/`)

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `LICENSE`, `scripts/deploy.js`, `media/vitals-light.svg`, `media/vitals-dark.svg` | scaffolding, manifest, icon |
| `src/cooklang-api.ts` | typed wrapper over `cooklang.api.*` (copied from allergens + `openReport`) |
| `src/support-check.ts` | copied from nutriscore |
| `src/markdown.ts` | copied from allergens (escape, truncate, list formatting) |
| `src/settings.ts` | read + normalise `coreVitals.*` |
| `src/nutrient-labels.ts` | label table, key prettifier, unit from suffix |
| `src/check-spec.ts` | settings → check spec (the JSON the template consumes) |
| `src/vitals-template.ts` | spec → Jinja template (`json` / `html` mode), output types + validation |
| `src/servings.ts` | frontmatter `servings:` parser |
| `src/verdict.ts` | validated output → verdict (met/counted, below/over, withheld reason) |
| `src/badge.ts` | verdict → pill |
| `src/hover.ts` | verdict → hover markdown |
| `src/provider.ts` | the badge command |
| `src/report-command.ts` | the toolbar command + URI resolution from command arguments |
| `src/extension.ts` | wiring |
| `README.md` | user docs; root `README.md` gets a table row |

---

### Task 1: Scaffold the plugin

**Files:**
- Create: `corevitals/package.json`, `corevitals/tsconfig.json`, `corevitals/LICENSE`, `corevitals/scripts/deploy.js`, `corevitals/media/vitals-light.svg`, `corevitals/media/vitals-dark.svg`, `corevitals/src/cooklang-api.ts`, `corevitals/src/support-check.ts`, `corevitals/src/markdown.ts`, `corevitals/src/extension.ts` (stub)

- [ ] **Step 1: Branch and folder**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins && git checkout main && git pull --ff-only && git checkout -b feature/core-vitals
mkdir -p corevitals/src corevitals/scripts corevitals/media
cp nutriscore/LICENSE corevitals/LICENSE
cp nutriscore/tsconfig.json corevitals/tsconfig.json
cp nutriscore/src/support-check.ts corevitals/src/support-check.ts
cp allergens/src/markdown.ts corevitals/src/markdown.ts
cp allergens/src/cooklang-api.ts corevitals/src/cooklang-api.ts
sed 's/cooklang\.nutriscore/cooklang.corevitals/; s/^for (const entry of \[.*$/for (const entry of ['"'"'package.json'"'"', '"'"'out'"'"', '"'"'media'"'"', '"'"'README.md'"'"', '"'"'LICENSE'"'"']) {/' nutriscore/scripts/deploy.js > corevitals/scripts/deploy.js
grep -n "corevitals\|media" corevitals/scripts/deploy.js
```

Expected: the grep shows `plugins/cooklang.corevitals` and the `for` line containing `'media'`.

- [ ] **Step 2: Manifest**

Create `corevitals/package.json`:

```json
{
  "name": "corevitals",
  "displayName": "Core Vitals",
  "description": "Checks a meal plan or recipe against daily nutrient targets: a Vitals badge on previews and a full report with charts. Needs a Basic or Pro plan.",
  "version": "0.1.0",
  "publisher": "cooklang",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/cook-md/plugins.git", "directory": "corevitals" },
  "keywords": ["cooklang", "nutrition", "meal plan", "macros", "micronutrients", "recipes"],
  "engines": { "vscode": "^1.100.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "cooklang.corevitals.provideBadge", "title": "Core Vitals", "category": "Core Vitals" },
      {
        "command": "cooklang.corevitals.openReport",
        "title": "Core Vitals Report",
        "category": "Core Vitals",
        "icon": { "light": "media/vitals-light.svg", "dark": "media/vitals-dark.svg" }
      }
    ],
    "menus": {
      "commandPalette": [
        { "command": "cooklang.corevitals.provideBadge", "when": "false" },
        { "command": "cooklang.corevitals.openReport", "when": "resourceExtname =~ /^\\.(cook|menu)$/i" }
      ],
      "cooklang/recipePreview/badge": [
        { "command": "cooklang.corevitals.provideBadge" }
      ],
      "cooklang/menuPreview/badge": [
        { "command": "cooklang.corevitals.provideBadge" }
      ],
      "cooklang/recipePreview/toolbar": [
        { "command": "cooklang.corevitals.openReport", "group": "navigation@20" }
      ],
      "cooklang/menuPreview/toolbar": [
        { "command": "cooklang.corevitals.openReport", "group": "navigation@20" }
      ],
      "editor/title": [
        { "command": "cooklang.corevitals.openReport", "when": "resourceExtname =~ /^\\.(cook|menu)$/i", "group": "navigation@20" }
      ]
    },
    "configuration": {
      "title": "Core Vitals",
      "properties": {
        "coreVitals.standard": {
          "type": "string",
          "enum": ["fda", "eu", "uk"],
          "enumDescriptions": ["US FDA daily values", "EU reference intakes", "UK reference intakes"],
          "default": "fda",
          "order": 1,
          "description": "Daily-value table the targets come from."
        },
        "coreVitals.energyKcal": {
          "type": "number",
          "default": 0,
          "minimum": 0,
          "order": 2,
          "description": "Daily energy target in kcal. 0 uses the standard's value (2000 kcal for FDA)."
        },
        "coreVitals.proteinPercent": {
          "type": "number",
          "default": 0,
          "minimum": 0,
          "maximum": 100,
          "order": 3,
          "description": "Protein as % of energy. 0 uses the 10–35 % range."
        },
        "coreVitals.carbPercent": {
          "type": "number",
          "default": 0,
          "minimum": 0,
          "maximum": 100,
          "order": 4,
          "description": "Carbohydrate as % of energy. 0 uses the 45–65 % range."
        },
        "coreVitals.fatPercent": {
          "type": "number",
          "default": 0,
          "minimum": 0,
          "maximum": 100,
          "order": 5,
          "description": "Fat as % of energy. 0 uses the 20–35 % range."
        },
        "coreVitals.micronutrients": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["calcium_mg", "iron_mg", "potassium_mg", "magnesium_mg", "zinc_mg", "vit_a_rae_ug", "vit_c_mg", "vit_d_ug", "vit_b12_ug", "folate_ug"],
          "order": 6,
          "description": "Nutrient keys checked against their daily value (e.g. iron_mg, vit_c_mg, selenium_ug). Energy, macros, fiber, saturated fat and sodium are always checked."
        },
        "coreVitals.tolerancePercent": {
          "type": "number",
          "default": 20,
          "minimum": 0,
          "maximum": 100,
          "order": 7,
          "description": "How far from a target still counts as met: minimums pass at 100 − tolerance %, limits at 100 + tolerance %, energy within ± tolerance %."
        },
        "coreVitals.mealsPerDay": {
          "type": "number",
          "default": 3,
          "minimum": 1,
          "maximum": 10,
          "order": 8,
          "description": "A recipe serving is judged against one meal, i.e. a day's targets divided by this."
        },
        "coreVitals.showWhenLocked": {
          "type": "boolean",
          "default": true,
          "order": 9,
          "description": "Show a greyed Vitals badge with an upgrade hint when your plan doesn't include nutrition data."
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
    "publish:marketplace": "ovsx publish --packagePath corevitals-$npm_package_version.vsix -r https://plugins.cook.md"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.0",
    "@types/vscode": "~1.100.0",
    "@vscode/vsce": "^3.3.0",
    "mocha": "^10.4.0",
    "ovsx": "^1.0.0",
    "typescript": "~5.4.5"
  }
}
```

- [ ] **Step 3: Icons**

Create `corevitals/media/vitals-light.svg` (a heartbeat line, same stroke colour as the cart icon):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#424242" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 4 12 2.5-6h7"/></svg>
```

Create `corevitals/media/vitals-dark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C5C5C5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 4 12 2.5-6h7"/></svg>
```

- [ ] **Step 4: Extend the API wrapper**

In `corevitals/src/cooklang-api.ts` (the copy of allergens'), add after the `REFRESH_BADGES_COMMAND` constant:

```ts
/** Added with the Core Vitals work; older editors cannot open plugin reports. */
export const OPEN_REPORT_COMMAND = 'cooklang.api.openReport';

export type ReportOutputFormat = 'markdown' | 'html' | 'text';

export interface OpenReportArgs {
    uri: string;
    template: string;
    label: string;
    outputFormat?: ReportOutputFormat;
    scale?: number;
}
```

and add to the `CooklangApi` class, after `refreshBadges()`:

```ts
    /** Opens a report tab for a plugin template. False when the editor predates the command. */
    async openReport(args: OpenReportArgs): Promise<boolean> {
        if (!(await this.listCommands()).includes(OPEN_REPORT_COMMAND)) {
            return false;
        }
        await this.call(OPEN_REPORT_COMMAND, args);
        return true;
    }
```

- [ ] **Step 5: Stub extension and install**

Create `corevitals/src/extension.ts`:

```ts
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Core Vitals');
    context.subscriptions.push(output);
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

Run: `cd corevitals && npm install && npm run compile && cd ..`
Expected: `out/extension.js` exists, no errors.

- [ ] **Step 6: Commit**

```bash
git add corevitals
git commit -m "feat(corevitals): scaffold the Core Vitals plugin"
```

---

### Task 2: Settings

**Files:**
- Create: `corevitals/src/settings.ts`, `corevitals/src/settings.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/settings.spec.ts`:

```ts
import * as assert from 'assert';
import { DEFAULT_MICRONUTRIENTS, MAX_MICRONUTRIENTS, readSettings } from './settings';

function read(values: Record<string, unknown>): (key: string) => unknown {
    return key => values[key];
}

describe('readSettings', () => {
    it('uses the defaults when nothing is set', () => {
        const settings = readSettings(read({}));
        assert.deepStrictEqual(settings, {
            standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
            micronutrients: [...DEFAULT_MICRONUTRIENTS], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
        });
    });

    it('accepts the three standards and falls back to fda otherwise', () => {
        assert.strictEqual(readSettings(read({ standard: 'eu' })).standard, 'eu');
        assert.strictEqual(readSettings(read({ standard: 'uk' })).standard, 'uk');
        assert.strictEqual(readSettings(read({ standard: 'who' })).standard, 'fda');
    });

    it('drops negative, non-finite and non-numeric numbers', () => {
        const settings = readSettings(read({ energyKcal: -5, tolerancePercent: Number.NaN, mealsPerDay: '4' }));
        assert.strictEqual(settings.energyKcal, 0);
        assert.strictEqual(settings.tolerancePercent, 20);
        assert.strictEqual(settings.mealsPerDay, 3);
    });

    it('treats macro overrides outside 1–100 as unset', () => {
        const settings = readSettings(read({ proteinPercent: 0.5, carbPercent: 101, fatPercent: 30 }));
        assert.strictEqual(settings.proteinPercent, 0);
        assert.strictEqual(settings.carbPercent, 0);
        assert.strictEqual(settings.fatPercent, 30);
    });

    it('clamps tolerance to 0–100 and meals per day to 1–10, rounding meals', () => {
        assert.strictEqual(readSettings(read({ tolerancePercent: 250 })).tolerancePercent, 100);
        assert.strictEqual(readSettings(read({ mealsPerDay: 0 })).mealsPerDay, 1);
        assert.strictEqual(readSettings(read({ mealsPerDay: 2.6 })).mealsPerDay, 3);
        assert.strictEqual(readSettings(read({ mealsPerDay: 40 })).mealsPerDay, 10);
    });

    it('normalises micronutrient keys: trims, lower-cases, validates, de-duplicates, drops always-checked keys', () => {
        const settings = readSettings(read({ micronutrients: [' Iron_mg ', 'iron_mg', 'vit_c_mg', 'Bad Key', 42, 'sodium_mg', 'kcal', ''] }));
        assert.deepStrictEqual(settings.micronutrients, ['iron_mg', 'vit_c_mg']);
    });

    it('keeps an explicitly empty list empty and caps the list', () => {
        assert.deepStrictEqual(readSettings(read({ micronutrients: [] })).micronutrients, []);
        const many = Array.from({ length: 40 }, (_, i) => `n${i}_mg`);
        assert.strictEqual(readSettings(read({ micronutrients: many })).micronutrients.length, MAX_MICRONUTRIENTS);
    });

    it('reads showWhenLocked as false only when explicitly false', () => {
        assert.strictEqual(readSettings(read({ showWhenLocked: false })).showWhenLocked, false);
        assert.strictEqual(readSettings(read({ showWhenLocked: 'no' })).showWhenLocked, true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './settings'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/settings.ts`:

```ts
export const STANDARDS = ['fda', 'eu', 'uk'] as const;
export type Standard = typeof STANDARDS[number];

/** Keys the plugin always checks; they are dropped from the micronutrient list. */
export const ALWAYS_CHECKED_KEYS: readonly string[] = ['kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'sat_fat_g', 'sodium_mg'];
export const DEFAULT_MICRONUTRIENTS: readonly string[] = [
    'calcium_mg', 'iron_mg', 'potassium_mg', 'magnesium_mg', 'zinc_mg',
    'vit_a_rae_ug', 'vit_c_mg', 'vit_d_ug', 'vit_b12_ug', 'folate_ug',
];
export const MAX_MICRONUTRIENTS = 30;
/** Nutrient keys are embedded in the template, so they must be plain slugs. */
export const NUTRIENT_KEY = /^[a-z0-9_]{1,40}$/;
export const DEFAULT_TOLERANCE_PERCENT = 20;
export const DEFAULT_MEALS_PER_DAY = 3;

export interface CoreVitalsSettings {
    standard: Standard;
    /** Daily energy target; 0 means "use the standard's value". */
    energyKcal: number;
    /** Macro shares of energy; 0 means "use the AMDR band". */
    proteinPercent: number;
    carbPercent: number;
    fatPercent: number;
    micronutrients: readonly string[];
    tolerancePercent: number;
    mealsPerDay: number;
    showWhenLocked: boolean;
}

/** Reads one setting under `coreVitals.`; extension.ts passes `getConfiguration('coreVitals').get`. */
export type ReadSetting = (key: string) => unknown;

function finiteNonNegative(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A macro override is a share of energy in 1–100; anything else means "not set". */
function percentOverride(value: unknown): number {
    const percent = finiteNonNegative(value, 0);
    return percent >= 1 && percent <= 100 ? percent : 0;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

export function readSettings(read: ReadSetting): CoreVitalsSettings {
    const rawStandard = read('standard');
    const standard = (STANDARDS as readonly unknown[]).includes(rawStandard) ? rawStandard as Standard : 'fda';
    const rawMicronutrients = read('micronutrients');
    const seen = new Set<string>(ALWAYS_CHECKED_KEYS);
    const micronutrients: string[] = [];
    for (const entry of Array.isArray(rawMicronutrients) ? rawMicronutrients : DEFAULT_MICRONUTRIENTS) {
        if (typeof entry !== 'string') {
            continue;
        }
        const key = entry.trim().toLowerCase();
        if (!NUTRIENT_KEY.test(key) || seen.has(key)) {
            continue;
        }
        seen.add(key);
        micronutrients.push(key);
        if (micronutrients.length === MAX_MICRONUTRIENTS) {
            break;
        }
    }
    return {
        standard,
        energyKcal: finiteNonNegative(read('energyKcal'), 0),
        proteinPercent: percentOverride(read('proteinPercent')),
        carbPercent: percentOverride(read('carbPercent')),
        fatPercent: percentOverride(read('fatPercent')),
        micronutrients,
        tolerancePercent: clamp(finiteNonNegative(read('tolerancePercent'), DEFAULT_TOLERANCE_PERCENT), 0, 100),
        mealsPerDay: clamp(Math.round(finiteNonNegative(read('mealsPerDay'), DEFAULT_MEALS_PER_DAY)), 1, 10),
        showWhenLocked: read('showWhenLocked') !== false,
    };
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: `8 passing`.

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/settings.ts corevitals/src/settings.spec.ts
git commit -m "feat(corevitals): read and normalise coreVitals settings"
```

---

### Task 3: Nutrient labels and units

**Files:**
- Create: `corevitals/src/nutrient-labels.ts`, `corevitals/src/nutrient-labels.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/nutrient-labels.spec.ts`:

```ts
import * as assert from 'assert';
import { labelFor, prettify, unitFor } from './nutrient-labels';

describe('labelFor', () => {
    it('uses the table for known keys', () => {
        assert.strictEqual(labelFor('kcal'), 'Energy');
        assert.strictEqual(labelFor('sat_fat_g'), 'Saturated fat');
        assert.strictEqual(labelFor('vit_b12_ug'), 'Vitamin B12');
        assert.strictEqual(labelFor('vit_a_rae_ug'), 'Vitamin A');
    });

    it('prettifies unknown keys', () => {
        assert.strictEqual(labelFor('boron_ug'), 'Boron');
        assert.strictEqual(labelFor('pantothenic_acid_mg'), 'Pantothenic acid');
        assert.strictEqual(labelFor('vit_k_mk4_ug'), 'Vitamin K MK4');
    });
});

describe('prettify', () => {
    it('returns the key itself when it has no words', () => {
        assert.strictEqual(prettify('_g'), '_g');
    });
});

describe('unitFor', () => {
    it('derives the unit from the key suffix', () => {
        assert.strictEqual(unitFor('kcal'), 'kcal');
        assert.strictEqual(unitFor('fiber_g'), 'g');
        assert.strictEqual(unitFor('iron_mg'), 'mg');
        assert.strictEqual(unitFor('folate_ug'), 'µg');
        assert.strictEqual(unitFor('vit_d_iu'), 'IU');
        assert.strictEqual(unitFor('mystery'), '');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './nutrient-labels'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/nutrient-labels.ts`:

```ts
/** Display labels for the keys the plugin checks by default or commonly; everything else is prettified. */
const LABELS: Readonly<Record<string, string>> = {
    kcal: 'Energy',
    protein_g: 'Protein',
    carb_g: 'Carbohydrate',
    fat_g: 'Fat',
    fiber_g: 'Fiber',
    sat_fat_g: 'Saturated fat',
    sugar_g: 'Sugar',
    sodium_mg: 'Sodium',
    cholesterol_mg: 'Cholesterol',
    calcium_mg: 'Calcium',
    iron_mg: 'Iron',
    potassium_mg: 'Potassium',
    magnesium_mg: 'Magnesium',
    zinc_mg: 'Zinc',
    phosphorus_mg: 'Phosphorus',
    copper_mg: 'Copper',
    manganese_mg: 'Manganese',
    selenium_ug: 'Selenium',
    iodine_ug: 'Iodine',
    vit_a_rae_ug: 'Vitamin A',
    vit_c_mg: 'Vitamin C',
    vit_d_ug: 'Vitamin D',
    vit_e_mg: 'Vitamin E',
    vit_k_ug: 'Vitamin K',
    vit_b6_mg: 'Vitamin B6',
    vit_b12_ug: 'Vitamin B12',
    thiamin_mg: 'Thiamin',
    riboflavin_mg: 'Riboflavin',
    niacin_mg: 'Niacin',
    folate_ug: 'Folate',
    choline_mg: 'Choline',
};

const UNIT_SUFFIX = /_(g|mg|ug|iu)$/;

export function labelFor(key: string): string {
    return LABELS[key] ?? prettify(key);
}

/** `pantothenic_acid_mg` → "Pantothenic acid", `vit_k_mk4_ug` → "Vitamin K MK4". */
export function prettify(key: string): string {
    const words = key.replace(UNIT_SUFFIX, '').split('_').filter(word => word !== '');
    if (words.length === 0) {
        return key;
    }
    if (words[0] === 'vit' && words.length > 1) {
        return `Vitamin ${words.slice(1).map(word => word.toUpperCase()).join(' ')}`;
    }
    const [first, ...rest] = words;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

export function unitFor(key: string): string {
    if (key === 'kcal') {
        return 'kcal';
    }
    switch (UNIT_SUFFIX.exec(key)?.[1]) {
        case 'g': return 'g';
        case 'mg': return 'mg';
        case 'ug': return 'µg';
        case 'iu': return 'IU';
        default: return '';
    }
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`12 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/nutrient-labels.ts corevitals/src/nutrient-labels.spec.ts
git commit -m "feat(corevitals): nutrient labels and units"
```

---

### Task 4: Check spec

**Files:**
- Create: `corevitals/src/check-spec.ts`, `corevitals/src/check-spec.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/check-spec.spec.ts`:

```ts
import * as assert from 'assert';
import { buildCheckSpec } from './check-spec';
import { CoreVitalsSettings } from './settings';

const DEFAULTS: CoreVitalsSettings = {
    standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg', 'vit_c_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

describe('buildCheckSpec', () => {
    it('lists energy, the three macros, fiber, the two limits, then the micronutrients', () => {
        const spec = buildCheckSpec(DEFAULTS, 4);
        assert.deepStrictEqual(spec.checks.map(check => `${check.key}:${check.kind}`), [
            'kcal:energy', 'protein_g:macroPercent', 'carb_g:macroPercent', 'fat_g:macroPercent',
            'fiber_g:min', 'sat_fat_g:max', 'sodium_mg:max', 'iron_mg:min', 'vit_c_mg:min',
        ]);
        assert.deepStrictEqual({ standard: spec.standard, tol: spec.tol, mealsPerDay: spec.mealsPerDay, servings: spec.servings },
            { standard: 'fda', tol: 20, mealsPerDay: 3, servings: 4 });
    });

    it('uses AMDR bands and kcal-per-gram factors for macros without overrides', () => {
        const [, protein, carb, fat] = buildCheckSpec(DEFAULTS, 1).checks;
        assert.deepStrictEqual(protein, { key: 'protein_g', label: 'Protein', kind: 'macroPercent', unit: '% energy', factor: 4, band: [10, 35] });
        assert.deepStrictEqual(carb.band, [45, 65]);
        assert.strictEqual(carb.factor, 4);
        assert.deepStrictEqual(fat.band, [20, 35]);
        assert.strictEqual(fat.factor, 9);
    });

    it('turns overrides into fixed targets and omits the band', () => {
        const spec = buildCheckSpec({ ...DEFAULTS, energyKcal: 2500, fatPercent: 30 }, 1);
        assert.deepStrictEqual(spec.checks[0], { key: 'kcal', label: 'Energy', kind: 'energy', unit: 'kcal', target: 2500 });
        assert.strictEqual(spec.checks[3].target, 30);
        assert.strictEqual(spec.checks[3].band, undefined);
    });

    it('labels and units micronutrients and never passes servings below 1', () => {
        const spec = buildCheckSpec(DEFAULTS, 0);
        assert.deepStrictEqual(spec.checks[8], { key: 'vit_c_mg', label: 'Vitamin C', kind: 'min', unit: 'mg' });
        assert.strictEqual(spec.servings, 1);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './check-spec'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/check-spec.ts`:

```ts
import { labelFor, unitFor } from './nutrient-labels';
import { CoreVitalsSettings, Standard } from './settings';

export type CheckKind = 'energy' | 'macroPercent' | 'min' | 'max';

/** One check the template evaluates. Plain JSON: it is embedded in the template. */
export interface Check {
    key: string;
    label: string;
    kind: CheckKind;
    unit: string;
    /** Fixed daily target (energy) or share of energy (macro); unset means "look up the daily value" / "use the band". */
    target?: number;
    /** Acceptable share of energy, macros only. */
    band?: readonly [number, number];
    /** kcal per gram, macros only. */
    factor?: number;
}

export interface CheckSpec {
    standard: Standard;
    tol: number;
    mealsPerDay: number;
    /** Recipe servings (ignored for plans, which carry their own). */
    servings: number;
    checks: Check[];
}

type MacroKey = 'protein_g' | 'carb_g' | 'fat_g';

/** Acceptable macronutrient distribution ranges, % of energy. */
export const AMDR: Readonly<Record<MacroKey, readonly [number, number]>> = {
    protein_g: [10, 35],
    carb_g: [45, 65],
    fat_g: [20, 35],
};

const KCAL_PER_GRAM: Readonly<Record<MacroKey, number>> = { protein_g: 4, carb_g: 4, fat_g: 9 };

function macroCheck(key: MacroKey, override: number): Check {
    const check: Check = { key, label: labelFor(key), kind: 'macroPercent', unit: '% energy', factor: KCAL_PER_GRAM[key] };
    if (override > 0) {
        check.target = override;
    } else {
        check.band = AMDR[key];
    }
    return check;
}

export function buildCheckSpec(settings: CoreVitalsSettings, servings: number): CheckSpec {
    const energy: Check = { key: 'kcal', label: labelFor('kcal'), kind: 'energy', unit: 'kcal' };
    if (settings.energyKcal > 0) {
        energy.target = settings.energyKcal;
    }
    const checks: Check[] = [
        energy,
        macroCheck('protein_g', settings.proteinPercent),
        macroCheck('carb_g', settings.carbPercent),
        macroCheck('fat_g', settings.fatPercent),
        { key: 'fiber_g', label: labelFor('fiber_g'), kind: 'min', unit: 'g' },
        { key: 'sat_fat_g', label: labelFor('sat_fat_g'), kind: 'max', unit: 'g' },
        { key: 'sodium_mg', label: labelFor('sodium_mg'), kind: 'max', unit: 'mg' },
        ...settings.micronutrients.map((key): Check => ({ key, label: labelFor(key), kind: 'min', unit: unitFor(key) })),
    ];
    return {
        standard: settings.standard,
        tol: settings.tolerancePercent,
        mealsPerDay: settings.mealsPerDay,
        servings: Number.isFinite(servings) && servings >= 1 ? servings : 1,
        checks,
    };
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`16 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/check-spec.ts corevitals/src/check-spec.spec.ts
git commit -m "feat(corevitals): build the check spec from settings"
```

---

### Task 5: The template and its output types

**Files:**
- Create: `corevitals/src/vitals-template.ts`, `corevitals/src/vitals-template.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/vitals-template.spec.ts`:

```ts
import * as assert from 'assert';
import { buildCheckSpec } from './check-spec';
import { CoreVitalsSettings } from './settings';
import { MAX_TEMPLATE_LENGTH, VitalsOutput, buildTemplate, parseVitalsOutput } from './vitals-template';

const SETTINGS: CoreVitalsSettings = {
    standard: 'eu', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

const ROW = { key: 'iron_mg', label: 'Iron', kind: 'min', unit: 'mg', actual: 9.7, target: 18, lo: 0, hi: 0, percent: 54, ok: false, skipped: false };
const OUTPUT: VitalsOutput = {
    kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20, rows: [ROW as VitalsOutput['rows'][number]],
    matched: 18, total: 20, unmatched: ['saffron', 'ghee'], missingRecipes: [], confidence: 'partial',
};

describe('buildTemplate', () => {
    it('starts with the mode line and embeds the spec as a dict literal', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 4), 'json');
        assert.ok(template.startsWith('{%- set mode = "json" -%}\n{%- set spec = {\n'), template.slice(0, 80));
        assert.ok(template.includes('"standard": "eu"'));
        assert.ok(template.includes('"servings": 4'));
        assert.ok(template.includes('aggregate_nutrition(ings)'));
        assert.ok(template.includes('| tojson'));
    });

    it('never puts two closing braces next to each other inside the spec block', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        const specBlock = template.slice(template.indexOf('{%- set spec ='), template.indexOf('-%}', template.indexOf('{%- set spec =')));
        assert.ok(!specBlock.includes('}}'), specBlock);
    });

    it('builds the html mode with the mode line and the report markup', () => {
        const template = buildTemplate(buildCheckSpec(SETTINGS, 1), 'html');
        assert.ok(template.startsWith('{%- set mode = "html" -%}'));
        assert.ok(template.includes('class="corevitals"'));
        assert.ok(template.length < MAX_TEMPLATE_LENGTH, `${template.length}`);
    });

    it('refuses labels or keys that could break out of the template', () => {
        const spec = buildCheckSpec(SETTINGS, 1);
        spec.checks[0].label = 'Energy" %}{{ 1 }}';
        assert.throws(() => buildTemplate(spec, 'json'), /label/);
        const spec2 = buildCheckSpec(SETTINGS, 1);
        spec2.checks[0].key = 'kcal %}';
        assert.throws(() => buildTemplate(spec2, 'json'), /key/);
    });
});

describe('parseVitalsOutput', () => {
    it('accepts a well-formed payload and ignores extra fields', () => {
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, extra: true }));
        assert.deepStrictEqual(parsed, OUTPUT);
    });

    it('rejects non-JSON, wrong kinds and bad rows', () => {
        assert.strictEqual(parseVitalsOutput('not json'), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, kind: 'week' })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, percent: 'NaN' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, ok: 'yes' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [{ ...ROW, kind: 'avg' }] })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, matched: -1 })), undefined);
        assert.strictEqual(parseVitalsOutput(JSON.stringify({ ...OUTPUT, unmatched: 'saffron' })), undefined);
    });

    it('tolerates a skipped row with zeroed numbers and a non-string confidence', () => {
        const skipped = { ...ROW, key: 'boron_ug', target: 0, percent: 0, skipped: true };
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, rows: [skipped], confidence: 7 }));
        assert.ok(parsed);
        assert.strictEqual(parsed.rows[0].skipped, true);
        assert.strictEqual(parsed.confidence, '');
    });

    it('drops non-string names from unmatched and missingRecipes', () => {
        const parsed = parseVitalsOutput(JSON.stringify({ ...OUTPUT, unmatched: ['a', 1], missingRecipes: [{ name: 'x' }, 'Pesto'] }));
        assert.ok(parsed);
        assert.deepStrictEqual(parsed.unmatched, ['a']);
        assert.deepStrictEqual(parsed.missingRecipes, ['Pesto']);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './vitals-template'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/vitals-template.ts`. The Jinja is minijinja 2 (the editor's Reports engine): `namespace()` for loop accumulators, bracket access for `agg["items"]` (`.items` resolves to the dict method), `reference_intake(key, standard)` returns undefined for unknown keys, `plan` is only defined for `.menu` sources.

```ts
import { Check, CheckKind, CheckSpec } from './check-spec';
import { NUTRIENT_KEY } from './settings';

export type TemplateMode = 'json' | 'html';

/** The editor rejects longer templates (`cooklang.api.renderReport` / `openReport`). */
export const MAX_TEMPLATE_LENGTH = 64 * 1024;

const LABEL = /^[A-Za-z0-9 %-]{1,40}$/;
const KINDS: readonly CheckKind[] = ['energy', 'macroPercent', 'min', 'max'];

/** One evaluated check, as the template's `json` mode emits it. */
export interface VitalsRow {
    key: string;
    label: string;
    kind: CheckKind;
    unit: string;
    /** Per person for the period (plans) or per serving (recipes); for macros the share of energy in %. */
    actual: number;
    /** Period target in `unit`; 0 for macros and skipped rows. */
    target: number;
    /** Macro band bounds (% of energy); 0 otherwise. */
    lo: number;
    hi: number;
    /** `actual / target × 100`, or the share itself for macros. */
    percent: number;
    ok: boolean;
    /** No daily value for this key in the chosen standard. */
    skipped: boolean;
}

export interface VitalsOutput {
    kind: 'plan' | 'recipe';
    days: number;
    people: number;
    standard: string;
    tol: number;
    rows: VitalsRow[];
    matched: number;
    total: number;
    unmatched: string[];
    missingRecipes: string[];
    /** The service's `confidence_weighted` (`confirmed` / `partial` / `estimated`), or `''`. */
    confidence: string;
}

/** Everything both modes share: period, per-check rows, match counts. */
const COMPUTE = `
{%- set is_plan = plan is defined -%}
{%- set ings = plan.all_ingredients if is_plan else ingredients -%}
{%- set agg = aggregate_nutrition(ings) -%}
{%- set totals = agg.totals -%}
{%- set vitamins = totals.vitamins if totals.vitamins is defined else {} -%}
{%- if is_plan -%}
{%- set days = (plan.days | length) if (plan.days | length) > 0 else 1 -%}
{%- set people = plan.servings if (plan.servings is defined and plan.servings is not none and plan.servings >= 1) else 1 -%}
{%- set day_factor = days -%}
{%- else -%}
{%- set days = 1 -%}
{%- set people = spec.servings -%}
{%- set day_factor = 1 / spec.mealsPerDay -%}
{%- endif -%}
{%- set energy_from_macros = totals.macros.protein_g * 4 + totals.macros.carb_g * 4 + totals.macros.fat_g * 9 -%}
{%- set ns = namespace(rows=[], met=0, counted=0, energy_daily=0) -%}
{%- for check in spec.checks -%}
{%- if check.kind == "macroPercent" -%}
{%- set share = (totals.macros[check.key] * check.factor / energy_from_macros * 100) if energy_from_macros > 0 else 0 -%}
{%- if check.target is defined -%}
{%- set lo = check.target - spec.tol / 2 -%}
{%- set hi = check.target + spec.tol / 2 -%}
{%- else -%}
{%- set lo = check.band[0] -%}
{%- set hi = check.band[1] -%}
{%- endif -%}
{%- set ok = share >= lo and share <= hi -%}
{%- set ns.rows = ns.rows + [{"key": check.key, "label": check.label, "kind": check.kind, "unit": check.unit, "actual": share, "target": 0, "lo": lo, "hi": hi, "percent": share, "ok": ok, "skipped": false}] -%}
{%- set ns.counted = ns.counted + 1 -%}
{%- if ok -%}{%- set ns.met = ns.met + 1 -%}{%- endif -%}
{%- else -%}
{%- if check.key == "kcal" -%}
{%- set raw = totals.macros.kcal -%}
{%- elif check.key in ["protein_g", "carb_g", "fat_g", "fiber_g", "sugar_g", "sat_fat_g"] -%}
{%- set raw = totals.macros[check.key] -%}
{%- else -%}
{%- set raw = totals.micros[check.key] -%}
{%- if raw is undefined -%}{%- set raw = vitamins[check.key] -%}{%- endif -%}
{%- if raw is undefined -%}{%- set raw = 0 -%}{%- endif -%}
{%- endif -%}
{%- set daily = check.target if check.target is defined else reference_intake(check.key, spec.standard) -%}
{%- if daily is undefined or daily is none or daily <= 0 -%}
{%- set ns.rows = ns.rows + [{"key": check.key, "label": check.label, "kind": check.kind, "unit": check.unit, "actual": raw / people, "target": 0, "lo": 0, "hi": 0, "percent": 0, "ok": false, "skipped": true}] -%}
{%- else -%}
{%- if check.kind == "energy" -%}{%- set ns.energy_daily = daily -%}{%- endif -%}
{%- set actual = raw / people -%}
{%- set target = daily * day_factor -%}
{%- set percent = actual / target * 100 -%}
{%- if check.kind == "energy" -%}
{%- set ok = percent >= 100 - spec.tol and percent <= 100 + spec.tol -%}
{%- elif check.kind == "max" -%}
{%- set ok = percent <= 100 + spec.tol -%}
{%- else -%}
{%- set ok = percent >= 100 - spec.tol -%}
{%- endif -%}
{%- set ns.rows = ns.rows + [{"key": check.key, "label": check.label, "kind": check.kind, "unit": check.unit, "actual": actual, "target": target, "lo": 0, "hi": 0, "percent": percent, "ok": ok, "skipped": false}] -%}
{%- set ns.counted = ns.counted + 1 -%}
{%- if ok -%}{%- set ns.met = ns.met + 1 -%}{%- endif -%}
{%- endif -%}
{%- endif -%}
{%- endfor -%}
{%- set ph = namespace(names=[]) -%}
{%- for item in agg["items"] -%}
{%- set hit = namespace(value=false) -%}
{%- if item.warnings is defined and item.warnings -%}
{%- for warning in item.warnings -%}
{%- if (warning is string and warning == "nutrition_placeholder") or (warning is mapping and warning.code == "nutrition_placeholder") -%}{%- set hit.value = true -%}{%- endif -%}
{%- endfor -%}
{%- endif -%}
{%- if hit.value -%}{%- set ph.names = ph.names + [item.ingredient] -%}{%- endif -%}
{%- endfor -%}
{%- set failed_names = agg.failures | map(attribute="ingredient") | list -%}
{%- set unmatched = failed_names + ph.names -%}
{%- set matched = (agg["items"] | length) - (ph.names | length) -%}
{%- set total = matched + (unmatched | length) -%}
{%- set missing = (plan.missing_recipes | map(attribute="name") | list) if is_plan else [] -%}
{%- set withheld = total == 0 or (matched / total) < 0.7 or (missing | length) > 0 -%}
`;

const JSON_OUTPUT = `
{{ {"kind": "plan" if is_plan else "recipe", "days": days, "people": people, "standard": spec.standard, "tol": spec.tol, "rows": ns.rows, "matched": matched, "total": total, "unmatched": unmatched, "missingRecipes": missing, "confidence": totals.confidence_weighted} | tojson }}
`;

/** The report. Colours come from the editor theme; charts are inline SVG (the editor strips scripts). */
const HTML_OUTPUT = `
<style>
.corevitals{color:var(--theia-foreground);max-width:920px;line-height:1.45}
.corevitals h1{font-size:1.5em;margin:0 0 .2em}
.corevitals h2{font-size:1.15em;margin:1.4em 0 .5em}
.corevitals .period,.corevitals .muted{color:var(--theia-descriptionForeground)}
.corevitals .notice{border-left:4px solid var(--theia-charts-yellow);padding:6px 10px;margin:1em 0;background:var(--theia-editorWidget-background)}
.corevitals .tiles{display:flex;gap:12px;flex-wrap:wrap;margin:1em 0}
.corevitals .tile{border:1px solid var(--theia-editorWidget-border);border-radius:8px;padding:10px 14px;min-width:160px}
.corevitals .tile .big{font-size:1.6em;font-weight:600}
.corevitals .ok{color:var(--theia-charts-green)}
.corevitals .bad{color:var(--theia-charts-red)}
.corevitals table{border-collapse:collapse;width:100%}
.corevitals th,.corevitals td{padding:4px 8px;text-align:left;border-bottom:1px solid var(--theia-editorWidget-border);vertical-align:middle}
.corevitals td.num{text-align:right;white-space:nowrap}
.corevitals .legend span{display:inline-block;margin-right:14px}
.corevitals .swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}
.corevitals ul{margin:.3em 0 0 1.2em}
</style>
<section class="corevitals">
<h1>Core Vitals · {{ (metadata.title if (metadata is defined and metadata.title is defined and metadata.title) else "Report") | escape }}</h1>
<p class="period">
{%- if is_plan -%}
{{ days }} day{{ "s" if days != 1 else "" }} · {{ people }} {{ "person" if people == 1 else "people" }}
{%- else -%}
Per serving ({{ people }} serving{{ "s" if people != 1 else "" }}) · one meal = 1/{{ spec.mealsPerDay }} of a day
{%- endif -%}
 · {{ spec.standard | upper }} daily values · tolerance ±{{ spec.tol }} %</p>
{%- if withheld %}
<div class="notice"><strong>Verdict withheld.</strong>
{%- if total == 0 %} No ingredients could be evaluated.
{%- elif (missing | length) > 0 %} {{ missing | length }} referenced recipe{{ "s" if (missing | length) != 1 else "" }} could not be found, so the totals undercount.
{%- else %} Only {{ matched }} of {{ total }} ingredients matched the nutrition database.{% endif %}
 The figures below are shown for reference.</div>
{%- endif %}
<div class="tiles">
<div class="tile"><div class="muted">Targets met</div><div class="big">{{ ns.met }} / {{ ns.counted }}</div></div>
{%- for row in ns.rows %}{% if row.key == "kcal" and not row.skipped %}
<div class="tile"><div class="muted">Energy</div><div class="big {{ "ok" if row.ok else "bad" }}">{{ row.percent | round | int }} %</div><div class="muted">{{ row.actual | round | int }} / {{ row.target | round | int }} kcal</div></div>
{%- endif %}{% endfor %}
<div class="tile"><div class="muted">Data</div><div class="big">{{ matched }} / {{ total }}</div><div class="muted">ingredients matched · {{ totals.confidence_weighted | default("unknown") }}</div></div>
</div>

<h2>Macro split</h2>
{%- set sb = namespace(x=0) %}
<svg width="600" height="18" viewBox="0 0 600 18" role="img" aria-label="Share of energy from protein, carbohydrate and fat">
{%- for row in ns.rows %}{% if row.kind == "macroPercent" %}
{%- set w = row.percent / 100 * 600 %}
<rect x="{{ sb.x }}" y="0" width="{{ w | round(1) }}" height="18" fill="{{ "var(--theia-charts-blue)" if row.key == "protein_g" else ("var(--theia-charts-orange)" if row.key == "carb_g" else "var(--theia-charts-purple)") }}"></rect>
{%- set sb.x = sb.x + w %}
{%- endif %}{% endfor %}
</svg>
<p class="legend">
{%- for row in ns.rows %}{% if row.kind == "macroPercent" %}
<span><i class="swatch" style="background:{{ "var(--theia-charts-blue)" if row.key == "protein_g" else ("var(--theia-charts-orange)" if row.key == "carb_g" else "var(--theia-charts-purple)") }}"></i>{{ row.label }} {{ row.percent | round | int }} % <span class="muted">({{ row.lo | round | int }}–{{ row.hi | round | int }})</span> <span class="{{ "ok" if row.ok else "bad" }}">{{ "✓" if row.ok else "✗" }}</span></span>
{%- endif %}{% endfor %}
</p>

<h2>Nutrients</h2>
<table>
<thead><tr><th>Nutrient</th><th class="num">Actual</th><th class="num">Target</th><th>% of target</th><th class="num"></th></tr></thead>
<tbody>
{%- for row in ns.rows %}{% if row.kind != "macroPercent" %}
<tr>
<td>{{ row.label }}{% if row.kind == "max" %} <span class="muted">(limit)</span>{% endif %}</td>
<td class="num">{{ row.actual | round(1) }} {{ row.unit }}</td>
{%- if row.skipped %}
<td class="num muted">no daily value</td><td></td><td></td>
{%- else %}
<td class="num">{{ row.target | round(1) }} {{ row.unit }}</td>
<td><svg width="220" height="12" viewBox="0 0 220 12"><rect width="220" height="12" rx="3" fill="var(--theia-editorWidget-border)"></rect><rect width="{{ (([row.percent, 150] | min) / 150 * 220) | round(1) }}" height="12" rx="3" fill="{{ "var(--theia-charts-green)" if row.ok else "var(--theia-charts-red)" }}"></rect><line x1="146.7" y1="0" x2="146.7" y2="12" stroke="var(--theia-foreground)" stroke-dasharray="2 2"></line></svg></td>
<td class="num {{ "ok" if row.ok else "bad" }}">{{ row.percent | round | int }} %</td>
{%- endif %}
</tr>
{%- endif %}{% endfor %}
</tbody>
</table>

{%- if is_plan and days >= 2 %}
{%- set dayrows = namespace(list=[], max=ns.energy_daily) %}
{%- for day in plan.days %}
{%- set m = macros(day.ingredients) %}
{%- set kcal = m.kcal / people %}
{%- if kcal > dayrows.max %}{% set dayrows.max = kcal %}{% endif %}
{%- set dayrows.list = dayrows.list + [{"label": (day.date if (day.date is defined and day.date) else (day.name if (day.name is defined and day.name) else ("Day " ~ loop.index))), "kcal": kcal, "protein_g": m.protein_g / people, "carb_g": m.carb_g / people, "fat_g": m.fat_g / people}] %}
{%- endfor %}
{%- set chart_w = 40 + (dayrows.list | length) * 56 %}
{%- set scale = (140 / dayrows.max) if dayrows.max > 0 else 0 %}
<h2>Energy per day</h2>
<svg width="{{ chart_w }}" height="190" viewBox="0 0 {{ chart_w }} 190" role="img" aria-label="Energy per person per day">
{%- if ns.energy_daily > 0 %}
<line x1="30" y1="{{ (160 - ns.energy_daily * scale) | round(1) }}" x2="{{ chart_w }}" y2="{{ (160 - ns.energy_daily * scale) | round(1) }}" stroke="var(--theia-foreground)" stroke-dasharray="4 3"></line>
<text x="0" y="{{ (164 - ns.energy_daily * scale) | round(1) }}" font-size="10" fill="var(--theia-descriptionForeground)">{{ ns.energy_daily | round | int }}</text>
{%- endif %}
{%- for d in dayrows.list %}
{%- set h = d.kcal * scale %}
<rect x="{{ 40 + (loop.index0 * 56) }}" y="{{ (160 - h) | round(1) }}" width="36" height="{{ h | round(1) }}" rx="3" fill="var(--theia-charts-blue)"></rect>
<text x="{{ 58 + (loop.index0 * 56) }}" y="{{ (154 - h) | round(1) }}" font-size="10" text-anchor="middle" fill="var(--theia-foreground)">{{ d.kcal | round | int }}</text>
<text x="{{ 58 + (loop.index0 * 56) }}" y="178" font-size="10" text-anchor="middle" fill="var(--theia-descriptionForeground)">{{ d.label | escape }}</text>
{%- endfor %}
</svg>
<table>
<thead><tr><th>Day</th><th class="num">kcal</th><th class="num">Protein</th><th class="num">Carbohydrate</th><th class="num">Fat</th></tr></thead>
<tbody>
{%- for d in dayrows.list %}
<tr><td>{{ d.label | escape }}</td><td class="num">{{ d.kcal | round | int }}</td><td class="num">{{ d.protein_g | round | int }} g</td><td class="num">{{ d.carb_g | round | int }} g</td><td class="num">{{ d.fat_g | round | int }} g</td></tr>
{%- endfor %}
</tbody>
</table>
{%- endif %}

<h2>Could not check</h2>
{%- if (unmatched | length) == 0 and (missing | length) == 0 %}
<p class="muted">Everything was matched.</p>
{%- else %}
{%- if (unmatched | length) > 0 %}
<p>Ingredients the nutrition service could not match:</p>
<ul>{% for name in unmatched %}<li>{{ name | escape }}</li>{% endfor %}</ul>
{%- endif %}
{%- if (missing | length) > 0 %}
<p>Recipes referenced by the plan but not found:</p>
<ul>{% for name in missing %}<li>{{ name | escape }}</li>{% endfor %}</ul>
{%- endif %}
{%- endif %}
{%- for row in ns.rows %}{% if row.skipped %}
<p class="muted">No daily value for {{ row.label }} ({{ row.key }}) in the {{ spec.standard | upper }} table.</p>
{%- endif %}{% endfor %}

<p class="muted">Estimates from the cook.md nutrition service. Generic adult daily values, not personal medical advice.</p>
</section>
`;

function validate(check: Check): void {
    if (!NUTRIENT_KEY.test(check.key)) {
        throw new Error(`Check key "${check.key}" must be a plain slug.`);
    }
    if (!LABEL.test(check.label)) {
        throw new Error(`Check label "${check.label}" must be plain text.`);
    }
    if (!KINDS.includes(check.kind)) {
        throw new Error(`Check kind "${check.kind}" is unknown.`);
    }
}

/**
 * The spec is embedded as a dict literal. `JSON.stringify` with indentation puts
 * every closing brace on its own line, so `}}` never appears inside the
 * `{%- set spec = … -%}` statement.
 */
export function buildTemplate(spec: CheckSpec, mode: TemplateMode): string {
    spec.checks.forEach(validate);
    const embedded = JSON.stringify(spec, undefined, 1);
    const template = [
        `{%- set mode = "${mode}" -%}`,
        `{%- set spec = ${embedded} -%}`,
        COMPUTE.trim(),
        mode === 'json' ? JSON_OUTPUT.trim() : HTML_OUTPUT.trim(),
    ].join('\n');
    if (template.length > MAX_TEMPLATE_LENGTH) {
        throw new Error('Template exceeds the editor limit.');
    }
    return template;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function toRow(value: unknown): VitalsRow | undefined {
    if (!isPlainObject(value) || typeof value.key !== 'string' || typeof value.label !== 'string' || typeof value.unit !== 'string'
        || !KINDS.includes(value.kind as CheckKind) || typeof value.ok !== 'boolean' || typeof value.skipped !== 'boolean'
        || !isFiniteNumber(value.actual) || !isFiniteNumber(value.target) || !isFiniteNumber(value.lo) || !isFiniteNumber(value.hi)
        || !isFiniteNumber(value.percent)) {
        return undefined;
    }
    return {
        key: value.key, label: value.label, kind: value.kind as CheckKind, unit: value.unit,
        actual: value.actual, target: value.target, lo: value.lo, hi: value.hi, percent: value.percent,
        ok: value.ok, skipped: value.skipped,
    };
}

function stringList(value: unknown): string[] | undefined {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

/** Validates the untrusted `json`-mode output; undefined when it is not a Core Vitals payload. */
export function parseVitalsOutput(output: string): VitalsOutput | undefined {
    let data: unknown;
    try {
        data = JSON.parse(output);
    } catch {
        return undefined;
    }
    if (!isPlainObject(data) || (data.kind !== 'plan' && data.kind !== 'recipe') || !Array.isArray(data.rows)
        || !isFiniteNumber(data.days) || !isFiniteNumber(data.people) || typeof data.standard !== 'string' || !isFiniteNumber(data.tol)
        || !isCount(data.matched) || !isCount(data.total)) {
        return undefined;
    }
    const rows: VitalsRow[] = [];
    for (const entry of data.rows) {
        const row = toRow(entry);
        if (!row) {
            return undefined;
        }
        rows.push(row);
    }
    const unmatched = stringList(data.unmatched);
    const missingRecipes = stringList(data.missingRecipes);
    if (!unmatched || !missingRecipes) {
        return undefined;
    }
    return {
        kind: data.kind, days: data.days, people: data.people, standard: data.standard, tol: data.tol, rows,
        matched: data.matched, total: data.total, unmatched, missingRecipes,
        confidence: typeof data.confidence === 'string' ? data.confidence : '',
    };
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`24 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/vitals-template.ts corevitals/src/vitals-template.spec.ts
git commit -m "feat(corevitals): the vitals template (json and html modes) and output validation"
```

---

### Task 6: Servings parser

**Files:**
- Create: `corevitals/src/servings.ts`, `corevitals/src/servings.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/servings.spec.ts`:

```ts
import * as assert from 'assert';
import { parseServings } from './servings';

describe('parseServings', () => {
    it('reads the leading integer of servings: in the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: Pancakes\nservings: 4\n---\nMix @eggs{2}.'), 4);
        assert.strictEqual(parseServings('---\nservings: 6 people\n---\n'), 6);
        assert.strictEqual(parseServings('---\r\nServings:   2\r\n---\r\n'), 2);
    });

    it('returns undefined without a frontmatter block or a numeric servings', () => {
        assert.strictEqual(parseServings('Mix @eggs{2}.'), undefined);
        assert.strictEqual(parseServings('---\nservings: a few\n---\n'), undefined);
        assert.strictEqual(parseServings('---\nservings: 0\n---\n'), undefined);
        assert.strictEqual(parseServings(''), undefined);
    });

    it('ignores a servings line outside the frontmatter', () => {
        assert.strictEqual(parseServings('---\ntitle: x\n---\nservings: 4\n'), undefined);
        assert.strictEqual(parseServings('intro\n---\nservings: 4\n---\n'), undefined);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './servings'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/servings.ts`:

```ts
/**
 * The recipe's `servings:` from its YAML frontmatter (the block between a
 * `---` first line and the next `---` line), as a positive integer: `4` and
 * `4 people` both give 4. Undefined when absent or non-numeric. Only the
 * frontmatter is read; the plugin never parses the recipe body.
 */
export function parseServings(text: string): number | undefined {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return undefined;
    }
    for (const line of lines.slice(1)) {
        if (line.trim() === '---') {
            return undefined;
        }
        const match = /^servings\s*:\s*(\d+)/i.exec(line);
        if (match) {
            const servings = Number.parseInt(match[1], 10);
            return servings >= 1 ? servings : undefined;
        }
    }
    return undefined;
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`27 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/servings.ts corevitals/src/servings.spec.ts
git commit -m "feat(corevitals): frontmatter servings parser"
```

---

### Task 7: Verdict

**Files:**
- Create: `corevitals/src/verdict.ts`, `corevitals/src/verdict.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/verdict.spec.ts`:

```ts
import * as assert from 'assert';
import { evaluate } from './verdict';
import { VitalsOutput, VitalsRow } from './vitals-template';

function row(overrides: Partial<VitalsRow>): VitalsRow {
    return { key: 'iron_mg', label: 'Iron', kind: 'min', unit: 'mg', actual: 9, target: 18, lo: 0, hi: 0, percent: 50, ok: false, skipped: false, ...overrides };
}

function output(overrides: Partial<VitalsOutput>): VitalsOutput {
    return { kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20, rows: [], matched: 18, total: 20, unmatched: ['saffron'], missingRecipes: [], confidence: 'partial', ...overrides };
}

describe('evaluate', () => {
    it('counts met checks and sorts shortfalls into below and over', () => {
        const verdict = evaluate(output({
            rows: [
                row({ key: 'kcal', label: 'Energy', kind: 'energy', percent: 95, ok: true }),
                row({ key: 'protein_g', label: 'Protein', kind: 'macroPercent', actual: 8, lo: 10, hi: 35, percent: 8, ok: false }),
                row({ key: 'fat_g', label: 'Fat', kind: 'macroPercent', actual: 40, lo: 20, hi: 35, percent: 40, ok: false }),
                row({ key: 'sodium_mg', label: 'Sodium', kind: 'max', percent: 132, ok: false }),
                row({ percent: 54, ok: false }),
                row({ key: 'kcal2', label: 'Energy high', kind: 'energy', percent: 130, ok: false }),
                row({ key: 'boron_ug', label: 'Boron', skipped: true }),
            ],
        }));
        assert.strictEqual(verdict.withheld, undefined);
        assert.strictEqual(verdict.met, 1);
        assert.strictEqual(verdict.counted, 6);
        assert.deepStrictEqual(verdict.below.map(entry => entry.label), ['Protein', 'Iron']);
        assert.deepStrictEqual(verdict.over.map(entry => entry.label), ['Fat', 'Sodium', 'Energy high']);
        assert.deepStrictEqual(verdict.skipped, ['Boron']);
        assert.strictEqual(verdict.confidence, 'Medium');
    });

    it('withholds the verdict when fewer than 70 % of ingredients matched, at the edge', () => {
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 7, total: 10 })).withheld, undefined);
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 6, total: 10 })).withheld, 'unmatched');
    });

    it('withholds for missing recipes, no data and no counted checks', () => {
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], missingRecipes: ['Pesto'] })).withheld, 'missingRecipes');
        assert.strictEqual(evaluate(output({ rows: [row({ ok: true })], matched: 0, total: 0 })).withheld, 'noData');
        assert.strictEqual(evaluate(output({ rows: [row({ skipped: true })] })).withheld, 'noChecks');
    });

    it('maps the service confidence to High / Medium / Low', () => {
        assert.strictEqual(evaluate(output({ confidence: 'confirmed' })).confidence, 'High');
        assert.strictEqual(evaluate(output({ confidence: 'partial' })).confidence, 'Medium');
        assert.strictEqual(evaluate(output({ confidence: 'estimated' })).confidence, 'Low');
        assert.strictEqual(evaluate(output({ confidence: '' })).confidence, 'Low');
    });

    it('carries the period through', () => {
        const verdict = evaluate(output({ kind: 'recipe', days: 1, people: 4, standard: 'eu' }));
        assert.deepStrictEqual({ kind: verdict.kind, days: verdict.days, people: verdict.people, standard: verdict.standard }, { kind: 'recipe', days: 1, people: 4, standard: 'eu' });
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './verdict'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/verdict.ts`:

```ts
import { CheckKind } from './check-spec';
import { VitalsOutput, VitalsRow } from './vitals-template';

export type WithheldReason = 'noData' | 'unmatched' | 'missingRecipes' | 'noChecks';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

/** A check that was not met. */
export interface Shortfall {
    label: string;
    kind: CheckKind;
    /** % of target, or the share of energy for macros. */
    percent: number;
    /** Macro band, % of energy. */
    lo: number;
    hi: number;
}

export interface Verdict {
    kind: 'plan' | 'recipe';
    days: number;
    people: number;
    standard: string;
    /** Set when the data does not support a verdict; the counts are still filled in. */
    withheld?: WithheldReason;
    met: number;
    counted: number;
    below: Shortfall[];
    over: Shortfall[];
    /** Labels of checks without a daily value. */
    skipped: string[];
    matched: number;
    total: number;
    unmatched: string[];
    missingRecipes: string[];
    confidence: ConfidenceLevel;
}

/** At least 70 % of the ingredients must have matched the nutrition database. */
export const MIN_MATCHED_SHARE = 0.7;

function confidenceLevel(confidence: string): ConfidenceLevel {
    switch (confidence) {
        case 'confirmed': return 'High';
        case 'partial': return 'Medium';
        default: return 'Low';
    }
}

/** Whether an unmet check fell short (below) or overshot (over). */
function isBelow(row: VitalsRow): boolean {
    switch (row.kind) {
        case 'min': return true;
        case 'max': return false;
        case 'energy': return row.percent < 100;
        case 'macroPercent': return row.actual < row.lo;
    }
}

function shortfall(row: VitalsRow): Shortfall {
    return { label: row.label, kind: row.kind, percent: row.percent, lo: row.lo, hi: row.hi };
}

export function evaluate(output: VitalsOutput): Verdict {
    const counted = output.rows.filter(row => !row.skipped);
    const unmet = counted.filter(row => !row.ok);
    let withheld: WithheldReason | undefined;
    if (output.total === 0) {
        withheld = 'noData';
    } else if (output.missingRecipes.length > 0) {
        withheld = 'missingRecipes';
    } else if (output.matched / output.total < MIN_MATCHED_SHARE) {
        withheld = 'unmatched';
    } else if (counted.length === 0) {
        withheld = 'noChecks';
    }
    return {
        kind: output.kind,
        days: output.days,
        people: output.people,
        standard: output.standard,
        withheld,
        met: counted.filter(row => row.ok).length,
        counted: counted.length,
        below: unmet.filter(isBelow).map(shortfall),
        over: unmet.filter(row => !isBelow(row)).map(shortfall),
        skipped: output.rows.filter(row => row.skipped).map(row => row.label),
        matched: output.matched,
        total: output.total,
        unmatched: output.unmatched,
        missingRecipes: output.missingRecipes,
        confidence: confidenceLevel(output.confidence),
    };
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`32 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/verdict.ts corevitals/src/verdict.spec.ts
git commit -m "feat(corevitals): verdict from the evaluated checks"
```

---

### Task 8: Badge and hover

**Files:**
- Create: `corevitals/src/hover.ts`, `corevitals/src/badge.ts`, `corevitals/src/badge.spec.ts`, `corevitals/src/hover.spec.ts`

- [ ] **Step 1: Write the failing specs**

Create `corevitals/src/hover.spec.ts`:

```ts
import * as assert from 'assert';
import { LOCKED_TOOLTIP, MAX_HOVER_LENGTH, UNAVAILABLE_TOOLTIP, hoverMarkdown } from './hover';
import { Verdict } from './verdict';

function verdict(overrides: Partial<Verdict>): Verdict {
    return {
        kind: 'plan', days: 2, people: 2, standard: 'fda', met: 14, counted: 17,
        below: [{ label: 'Iron', kind: 'min', percent: 54.4, lo: 0, hi: 0 }, { label: 'Fiber', kind: 'min', percent: 71, lo: 0, hi: 0 }],
        over: [{ label: 'Sodium', kind: 'max', percent: 132, lo: 0, hi: 0 }],
        skipped: [], matched: 18, total: 20, unmatched: ['saffron', 'ghee'], missingRecipes: [], confidence: 'High',
        ...overrides,
    };
}

describe('hoverMarkdown', () => {
    it('renders the plan summary', () => {
        assert.strictEqual(hoverMarkdown(verdict({})), [
            '**Core Vitals** · 14 of 17 targets met',
            '2 days · 2 people · FDA daily values',
            'Below target: Iron 54 %, Fiber 71 %',
            'Over limit: Sodium 132 %',
            '18 of 20 ingredients matched (High confidence). Open the Core Vitals report for the full breakdown.',
        ].join('\n\n'));
    });

    it('renders the recipe period line with and without servings', () => {
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 4 })).includes('Per serving (4 servings) · one meal = ⅓ of a day · FDA daily values'));
        assert.ok(hoverMarkdown(verdict({ kind: 'recipe', days: 1, people: 1 })).includes('Whole recipe (no servings in frontmatter) · one meal = ⅓ of a day · FDA daily values'));
    });

    it('shows macro shortfalls as a share of energy with the band', () => {
        const markdown = hoverMarkdown(verdict({ below: [{ label: 'Protein', kind: 'macroPercent', percent: 8.2, lo: 10, hi: 35 }], over: [] }));
        assert.ok(markdown.includes('Below target: Protein 8 % of energy (10–35)'), markdown);
        assert.ok(!markdown.includes('Over limit'));
    });

    it('lists skipped keys', () => {
        assert.ok(hoverMarkdown(verdict({ skipped: ['Boron'] })).includes('No daily value for: Boron'));
    });

    it('explains a withheld verdict instead of counting', () => {
        const unmatched = hoverMarkdown(verdict({ withheld: 'unmatched', matched: 9 }));
        assert.ok(unmatched.startsWith('**Core Vitals** · not enough data\n\n2 days · 2 people · FDA daily values\n\nOnly 9 of 20 ingredients matched'), unmatched);
        assert.ok(!unmatched.includes('Below target'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'missingRecipes', missingRecipes: ['Pesto', 'Rice bowl'] })).includes('Missing recipes: Pesto, Rice bowl'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noData' })).includes('This plan has no recipes'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noData', kind: 'recipe' })).includes('This recipe has no ingredients'));
        assert.ok(hoverMarkdown(verdict({ withheld: 'noChecks' })).includes('No daily values for the chosen checks'));
    });

    it('escapes names and stays under the hover limit', () => {
        const markdown = hoverMarkdown(verdict({ withheld: 'missingRecipes', missingRecipes: ['[x](http://evil)'] }));
        assert.ok(markdown.includes('\\[x\\]\\(http\\://evil\\)'), markdown);
        const long = hoverMarkdown(verdict({ below: Array.from({ length: 200 }, (_, i) => ({ label: `Nutrient ${i}`, kind: 'min' as const, percent: 10, lo: 0, hi: 0 })) }));
        assert.ok(long.length <= MAX_HOVER_LENGTH);
    });

    it('exposes the locked and unavailable tooltips', () => {
        assert.ok(LOCKED_TOOLTIP.includes('[See plans](https://cook.md/pricing)'));
        assert.ok(UNAVAILABLE_TOOLTIP.startsWith('**Core Vitals** · unavailable'));
    });
});
```

Create `corevitals/src/badge.spec.ts`:

```ts
import * as assert from 'assert';
import { UNAVAILABLE_BADGE, badgeFor, lockedBadge, toneFor } from './badge';
import { LOCKED_TOOLTIP, UNAVAILABLE_TOOLTIP } from './hover';
import { Verdict } from './verdict';

function verdict(overrides: Partial<Verdict>): Verdict {
    return {
        kind: 'plan', days: 2, people: 2, standard: 'fda', met: 14, counted: 17, below: [], over: [], skipped: [],
        matched: 18, total: 20, unmatched: [], missingRecipes: [], confidence: 'High', ...overrides,
    };
}

describe('toneFor', () => {
    it('is good from 90 %, warning from 60 %, bad below', () => {
        assert.strictEqual(toneFor(9, 10), 'good');
        assert.strictEqual(toneFor(8, 10), 'warning');
        assert.strictEqual(toneFor(6, 10), 'warning');
        assert.strictEqual(toneFor(5, 10), 'bad');
        assert.strictEqual(toneFor(0, 0), 'neutral');
    });
});

describe('badgeFor', () => {
    it('shows met over counted with the tone and the hover', () => {
        const badge = badgeFor(verdict({}));
        assert.strictEqual(badge.kind, 'pill');
        assert.strictEqual(badge.text, 'Vitals 14/17');
        assert.strictEqual(badge.tone, 'good');
        assert.ok(badge.tooltipMarkdown.startsWith('**Core Vitals** · 14 of 17 targets met'));
    });

    it('shows a neutral question mark when withheld', () => {
        const badge = badgeFor(verdict({ withheld: 'unmatched', matched: 5 }));
        assert.deepStrictEqual({ text: badge.text, tone: badge.tone }, { text: 'Vitals ?', tone: 'neutral' });
        assert.ok(badge.tooltipMarkdown.includes('Only 5 of 20 ingredients matched'));
    });

    it('keeps the pill within 24 characters even with large counts', () => {
        assert.ok(badgeFor(verdict({ met: 100, counted: 100 })).text.length <= 24);
    });
});

describe('lockedBadge and UNAVAILABLE_BADGE', () => {
    it('returns the greyed badge unless hidden by the setting', () => {
        assert.deepStrictEqual(lockedBadge(true), { kind: 'pill', text: '🔒 Vitals', tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP });
        assert.strictEqual(lockedBadge(false), undefined);
        assert.deepStrictEqual(UNAVAILABLE_BADGE, { kind: 'pill', text: 'Vitals ?', tone: 'neutral', tooltipMarkdown: UNAVAILABLE_TOOLTIP });
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd corevitals && npm test; cd ..`
Expected: compile errors `Cannot find module './hover'` / `'./badge'`.

- [ ] **Step 3: Implement the hover**

Create `corevitals/src/hover.ts`:

```ts
import { escapeMarkdown, formatNames, truncateName } from './markdown';
import { Shortfall, Verdict } from './verdict';

/** The editor truncates `tooltipMarkdown` at 4000 characters; stay clear of it. */
export const MAX_HOVER_LENGTH = 3900;

/** Tooltip of the greyed "🔒 Vitals" pill. */
export const LOCKED_TOOLTIP = `**Core Vitals** · with Cook Basic and Pro

Sign in to cook.md with a Cook Basic or Pro plan to check your plans and recipes against daily nutrient targets.

[See plans](https://cook.md/pricing)`;

/** Tooltip when the template answered with something the plugin could not read. */
export const UNAVAILABLE_TOOLTIP = `**Core Vitals** · unavailable

The nutrition report could not be read. See the Core Vitals output channel for details.`;

const MEAL_FRACTIONS: Readonly<Record<number, string>> = { 1: '1', 2: '½', 3: '⅓', 4: '¼', 5: '⅕', 6: '⅙', 7: '1/7', 8: '⅛', 9: '1/9', 10: '1/10' };

function periodLine(verdict: Verdict, mealsPerDay: number): string {
    const standard = `${verdict.standard.toUpperCase()} daily values`;
    if (verdict.kind === 'plan') {
        const days = `${verdict.days} day${verdict.days === 1 ? '' : 's'}`;
        const people = `${verdict.people} ${verdict.people === 1 ? 'person' : 'people'}`;
        return `${days} · ${people} · ${standard}`;
    }
    const serving = verdict.people > 1
        ? `Per serving (${verdict.people} servings)`
        : 'Whole recipe (no servings in frontmatter)';
    return `${serving} · one meal = ${MEAL_FRACTIONS[mealsPerDay] ?? `1/${mealsPerDay}`} of a day · ${standard}`;
}

function formatShortfall(entry: Shortfall): string {
    const percent = Math.round(entry.percent);
    if (entry.kind === 'macroPercent') {
        return `${escapeMarkdown(truncateName(entry.label))} ${percent} % of energy (${Math.round(entry.lo)}–${Math.round(entry.hi)})`;
    }
    return `${escapeMarkdown(truncateName(entry.label))} ${percent} %`;
}

function formatShortfalls(entries: Shortfall[]): string {
    const shown = entries.slice(0, 8).map(formatShortfall);
    if (entries.length > 8) {
        shown.push(`and ${entries.length - 8} more`);
    }
    return shown.join(', ');
}

function withheldLine(verdict: Verdict): string {
    switch (verdict.withheld) {
        case 'unmatched': return `Only ${verdict.matched} of ${verdict.total} ingredients matched the nutrition database.`;
        case 'missingRecipes': return `Missing recipes: ${formatNames(verdict.missingRecipes)}`;
        case 'noData': return verdict.kind === 'plan' ? 'This plan has no recipes that could be evaluated.' : 'This recipe has no ingredients that could be evaluated.';
        default: return 'No daily values for the chosen checks in this standard.';
    }
}

/**
 * Title, period, shortfalls (or why the verdict was withheld), skipped keys,
 * data line. `mealsPerDay` only matters for recipes.
 */
export function hoverMarkdown(verdict: Verdict, mealsPerDay: number = 3): string {
    const blocks: string[] = [];
    if (verdict.withheld) {
        blocks.push('**Core Vitals** · not enough data', periodLine(verdict, mealsPerDay), withheldLine(verdict));
    } else {
        blocks.push(`**Core Vitals** · ${verdict.met} of ${verdict.counted} targets met`, periodLine(verdict, mealsPerDay));
        if (verdict.below.length > 0) {
            blocks.push(`Below target: ${formatShortfalls(verdict.below)}`);
        }
        if (verdict.over.length > 0) {
            blocks.push(`Over limit: ${formatShortfalls(verdict.over)}`);
        }
    }
    if (verdict.skipped.length > 0) {
        blocks.push(`No daily value for: ${formatNames(verdict.skipped)}`);
    }
    blocks.push(`${verdict.matched} of ${verdict.total} ingredients matched (${verdict.confidence} confidence). Open the Core Vitals report for the full breakdown.`);
    const markdown = blocks.join('\n\n');
    return markdown.length <= MAX_HOVER_LENGTH ? markdown : `${markdown.slice(0, MAX_HOVER_LENGTH - 1)}…`;
}
```

- [ ] **Step 4: Implement the badge**

Create `corevitals/src/badge.ts`:

```ts
import { PillBadge } from './cooklang-api';
import { LOCKED_TOOLTIP, UNAVAILABLE_TOOLTIP, hoverMarkdown } from './hover';
import { Verdict } from './verdict';

export const GOOD_SHARE = 0.9;
export const WARNING_SHARE = 0.6;
export const LOCKED_TEXT = '🔒 Vitals';
export const UNKNOWN_TEXT = 'Vitals ?';

/** Shown when the template output could not be read. */
export const UNAVAILABLE_BADGE: PillBadge = { kind: 'pill', text: UNKNOWN_TEXT, tone: 'neutral', tooltipMarkdown: UNAVAILABLE_TOOLTIP };

export function toneFor(met: number, counted: number): PillBadge['tone'] {
    if (counted === 0) {
        return 'neutral';
    }
    const share = met / counted;
    return share >= GOOD_SHARE ? 'good' : share >= WARNING_SHARE ? 'warning' : 'bad';
}

export function badgeFor(verdict: Verdict, mealsPerDay: number = 3): PillBadge {
    const tooltipMarkdown = hoverMarkdown(verdict, mealsPerDay);
    if (verdict.withheld) {
        return { kind: 'pill', text: UNKNOWN_TEXT, tone: 'neutral', tooltipMarkdown };
    }
    // "Vitals " is 7 characters; two 3-digit counts and the slash fit in 24.
    return { kind: 'pill', text: `Vitals ${verdict.met}/${verdict.counted}`, tone: toneFor(verdict.met, verdict.counted), tooltipMarkdown };
}

/** Greyed badge with an upgrade hint, or undefined if the user disabled it via `coreVitals.showWhenLocked`. */
export function lockedBadge(showWhenLocked: boolean): PillBadge | undefined {
    return showWhenLocked ? { kind: 'pill', text: LOCKED_TEXT, tone: 'neutral', tooltipMarkdown: LOCKED_TOOLTIP } : undefined;
}
```

- [ ] **Step 5: Run the specs**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`44 passing`).

- [ ] **Step 6: Commit**

```bash
git add corevitals/src/hover.ts corevitals/src/badge.ts corevitals/src/hover.spec.ts corevitals/src/badge.spec.ts
git commit -m "feat(corevitals): badge and hover from the verdict"
```

---

### Task 9: Badge provider

**Files:**
- Create: `corevitals/src/provider.ts`, `corevitals/src/provider.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/provider.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, PluginReportResult } from './cooklang-api';
import { CoreVitalsBadgeProvider, isMenuUri } from './provider';
import { CoreVitalsSettings } from './settings';
import { VitalsOutput } from './vitals-template';

const SETTINGS: CoreVitalsSettings = {
    standard: 'fda', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: ['iron_mg'], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

const OUTPUT: VitalsOutput = {
    kind: 'plan', days: 2, people: 2, standard: 'fda', tol: 20,
    rows: [{ key: 'kcal', label: 'Energy', kind: 'energy', unit: 'kcal', actual: 3800, target: 4000, lo: 0, hi: 0, percent: 95, ok: true, skipped: false }],
    matched: 18, total: 20, unmatched: [], missingRecipes: [], confidence: 'confirmed',
};

class Fixture {
    features = new Set<string>(['nutrition_api']);
    result: PluginReportResult = { ok: true, output: JSON.stringify(OUTPUT) };
    renders: Array<{ uri: string; template: string; scale: number }> = [];
    logs: string[] = [];
    texts = new Map<string, string>();
    settings: CoreVitalsSettings = SETTINGS;

    provider(): CoreVitalsBadgeProvider {
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.hasFeature') {
                return this.features.has((args[0] as { name: string }).name);
            }
            if (command === 'cooklang.api.renderReport') {
                this.renders.push(args[0] as { uri: string; template: string; scale: number });
                return this.result;
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => ['cooklang.api.hasFeature', 'cooklang.api.renderReport']);
        return new CoreVitalsBadgeProvider(api, message => this.logs.push(message), () => this.settings, async uri => this.texts.get(uri));
    }
}

const PLAN_CONTEXT = { version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 2 };
const RECIPE_CONTEXT = { version: 1, uri: 'file:///ws/Pancakes.cook', path: 'Pancakes.cook', scale: 1 };

describe('isMenuUri', () => {
    it('matches .menu case-insensitively, ignoring query and fragment', () => {
        assert.strictEqual(isMenuUri('file:///ws/week.menu'), true);
        assert.strictEqual(isMenuUri('file:///ws/WEEK.MENU?x=1#top'), true);
        assert.strictEqual(isMenuUri('file:///ws/Pancakes.cook'), false);
    });
});

describe('CoreVitalsBadgeProvider', () => {
    it('ignores arguments that are not a preview context', async () => {
        assert.strictEqual(await new Fixture().provider().provide({ nope: true }), undefined);
    });

    it('renders the json template at scale 1 for a plan and returns the verdict pill', async () => {
        const fixture = new Fixture();
        const badge = await fixture.provider().provide(PLAN_CONTEXT);
        assert.deepStrictEqual({ text: badge?.text, tone: badge?.tone }, { text: 'Vitals 1/1', tone: 'good' });
        assert.strictEqual(fixture.renders.length, 1);
        assert.strictEqual(fixture.renders[0].uri, 'file:///ws/week.menu');
        assert.strictEqual(fixture.renders[0].scale, 1);
        assert.ok(fixture.renders[0].template.startsWith('{%- set mode = "json" -%}'));
        assert.ok(fixture.renders[0].template.includes('"servings": 1'));
    });

    it('reads the recipe servings from the document text', async () => {
        const fixture = new Fixture();
        fixture.texts.set('file:///ws/Pancakes.cook', '---\nservings: 4\n---\nMix @eggs{2}.');
        await fixture.provider().provide(RECIPE_CONTEXT);
        assert.ok(fixture.renders[0].template.includes('"servings": 4'), fixture.renders[0].template.slice(0, 400));
    });

    it('returns the locked badge without the plan feature, honouring showWhenLocked', async () => {
        const fixture = new Fixture();
        fixture.features.clear();
        assert.strictEqual((await fixture.provider().provide(PLAN_CONTEXT))?.text, '🔒 Vitals');
        assert.strictEqual(fixture.renders.length, 0);
        fixture.settings = { ...SETTINGS, showWhenLocked: false };
        assert.strictEqual(await fixture.provider().provide(PLAN_CONTEXT), undefined);
    });

    it('treats unauthenticated and forbidden renders as locked', async () => {
        const fixture = new Fixture();
        fixture.result = { ok: false, reason: 'forbidden', message: 'plan lapsed' };
        assert.strictEqual((await fixture.provider().provide(PLAN_CONTEXT))?.text, '🔒 Vitals');
    });

    it('returns no badge on network, server and template failures, logging once per reason', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        fixture.result = { ok: false, reason: 'network', message: 'offline' };
        assert.strictEqual(await provider.provide(PLAN_CONTEXT), undefined);
        assert.strictEqual(await provider.provide(PLAN_CONTEXT), undefined);
        assert.deepStrictEqual(fixture.logs, ['Core Vitals unavailable (network): offline']);
        fixture.result = { ok: false, reason: 'template', message: 'syntax' };
        await provider.provide(PLAN_CONTEXT);
        assert.strictEqual(fixture.logs.length, 2);
    });

    it('returns the unavailable pill when the output cannot be read, and logs again after a success', async () => {
        const fixture = new Fixture();
        const provider = fixture.provider();
        fixture.result = { ok: true, output: 'garbage' };
        assert.strictEqual((await provider.provide(PLAN_CONTEXT))?.text, 'Vitals ?');
        assert.deepStrictEqual(fixture.logs, ['Core Vitals unavailable (output): unexpected template output']);
        fixture.result = { ok: true, output: JSON.stringify(OUTPUT) };
        await provider.provide(PLAN_CONTEXT);
        fixture.result = { ok: true, output: 'garbage' };
        await provider.provide(PLAN_CONTEXT);
        assert.strictEqual(fixture.logs.length, 2);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './provider'`.

- [ ] **Step 3: Implement**

Create `corevitals/src/provider.ts`:

```ts
import { UNAVAILABLE_BADGE, badgeFor, lockedBadge } from './badge';
import { buildCheckSpec } from './check-spec';
import { CooklangApi, PillBadge, PreviewOutletContext } from './cooklang-api';
import { parseServings } from './servings';
import { CoreVitalsSettings } from './settings';
import { evaluate } from './verdict';
import { buildTemplate, parseVitalsOutput } from './vitals-template';

/** Reads a document's current text (unsaved edits included); undefined when it cannot be read. */
export type ReadText = (uri: string) => Promise<string | undefined>;

export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

/** Whether a URI string names a `.menu` plan (the badge outlets pass no other hint). */
export function isMenuUri(uri: string): boolean {
    return /\.menu$/i.test(uri.replace(/[?#].*$/, ''));
}

/** Backs `cooklang.corevitals.provideBadge` (outlets `cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`). */
export class CoreVitalsBadgeProvider {

    protected readonly logged = new Set<string>();

    constructor(
        protected readonly api: CooklangApi,
        protected readonly log: (message: string) => void,
        protected readonly settings: () => CoreVitalsSettings,
        protected readonly readText: ReadText,
    ) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context)) {
            return undefined;
        }
        const settings = this.settings();
        // cook.md plan feature granting nutrition data (Cook Basic and Pro), the same
        // one the nutrition service itself enforces.
        if (!await this.api.hasFeature('nutrition_api')) {
            return lockedBadge(settings.showWhenLocked);
        }
        const servings = isMenuUri(context.uri) ? 1 : parseServings(await this.readText(context.uri) ?? '') ?? 1;
        const template = buildTemplate(buildCheckSpec(settings, servings), 'json');
        // Per-person results do not depend on the preview scale, so scale 1 keeps the cache warm.
        const result = await this.api.renderReport({ uri: context.uri, template, scale: 1 });
        if (!result.ok) {
            this.logOnce(result.reason, result.message);
            // The cached subscription said yes but the service disagreed (expired sign-in, lapsed plan).
            if (result.reason === 'unauthenticated' || result.reason === 'forbidden') {
                return lockedBadge(settings.showWhenLocked);
            }
            return undefined;
        }
        const output = parseVitalsOutput(result.output);
        if (!output) {
            this.logOnce('output', 'unexpected template output');
            return UNAVAILABLE_BADGE;
        }
        // A badge is about to be shown: any earlier failure has been superseded.
        this.logged.clear();
        return badgeFor(evaluate(output), settings.mealsPerDay);
    }

    protected logOnce(reason: string, message: string): void {
        if (!this.logged.has(reason)) {
            this.logged.add(reason);
            this.log(`Core Vitals unavailable (${reason}): ${message}`);
        }
    }
}
```

- [ ] **Step 4: Run the spec**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`52 passing`).

- [ ] **Step 5: Commit**

```bash
git add corevitals/src/provider.ts corevitals/src/provider.spec.ts
git commit -m "feat(corevitals): badge provider"
```

---

### Task 10: Report command and extension wiring

**Files:**
- Create: `corevitals/src/report-command.ts`, `corevitals/src/report-command.spec.ts`
- Modify: `corevitals/src/extension.ts`

- [ ] **Step 1: Write the failing spec**

Create `corevitals/src/report-command.spec.ts`:

```ts
import * as assert from 'assert';
import { CooklangApi, OpenReportArgs } from './cooklang-api';
import { OpenReportCommand, uriFromArgument } from './report-command';
import { CoreVitalsSettings } from './settings';

const SETTINGS: CoreVitalsSettings = {
    standard: 'uk', energyKcal: 0, proteinPercent: 0, carbPercent: 0, fatPercent: 0,
    micronutrients: [], tolerancePercent: 20, mealsPerDay: 3, showWhenLocked: true,
};

describe('uriFromArgument', () => {
    it('takes the uri from a preview outlet context', () => {
        assert.strictEqual(uriFromArgument({ version: 1, uri: 'file:///ws/week.menu', path: 'week.menu', scale: 1 }, undefined), 'file:///ws/week.menu');
    });

    it('stringifies a URI-like object (editor/title passes the resource)', () => {
        assert.strictEqual(uriFromArgument({ scheme: 'file', path: '/ws/a.cook', toString: () => 'file:///ws/a.cook' }, undefined), 'file:///ws/a.cook');
    });

    it('falls back to the active editor, and only for .cook/.menu', () => {
        assert.strictEqual(uriFromArgument(undefined, 'file:///ws/a.cook'), 'file:///ws/a.cook');
        assert.strictEqual(uriFromArgument(undefined, 'file:///ws/notes.md'), undefined);
        assert.strictEqual(uriFromArgument(undefined, undefined), undefined);
    });
});

describe('OpenReportCommand', () => {
    function fixture(commands: string[]): { command: OpenReportCommand; opened: OpenReportArgs[]; texts: Map<string, string> } {
        const opened: OpenReportArgs[] = [];
        const texts = new Map<string, string>();
        const api = new CooklangApi(async (command, ...args) => {
            if (command === 'cooklang.api.openReport') {
                opened.push(args[0] as OpenReportArgs);
                return undefined;
            }
            throw new Error(`unexpected command ${command}`);
        }, async () => commands);
        return { command: new OpenReportCommand(api, () => SETTINGS, async uri => texts.get(uri)), opened, texts };
    }

    it('opens the html template for a plan with the Core Vitals label', async () => {
        const { command, opened } = fixture(['cooklang.api.openReport']);
        assert.strictEqual(await command.open('file:///ws/week.menu'), true);
        assert.strictEqual(opened.length, 1);
        assert.deepStrictEqual({ uri: opened[0].uri, label: opened[0].label, outputFormat: opened[0].outputFormat, scale: opened[0].scale },
            { uri: 'file:///ws/week.menu', label: 'Core Vitals', outputFormat: 'html', scale: 1 });
        assert.ok(opened[0].template.startsWith('{%- set mode = "html" -%}'));
        assert.ok(opened[0].template.includes('"standard": "uk"'));
    });

    it('uses the recipe servings', async () => {
        const { command, opened, texts } = fixture(['cooklang.api.openReport']);
        texts.set('file:///ws/a.cook', '---\nservings: 2\n---\n');
        await command.open('file:///ws/a.cook');
        assert.ok(opened[0].template.includes('"servings": 2'));
    });

    it('reports an older editor', async () => {
        const { command, opened } = fixture([]);
        assert.strictEqual(await command.open('file:///ws/week.menu'), false);
        assert.strictEqual(opened.length, 0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd corevitals && npm test; cd ..`
Expected: compile error `Cannot find module './report-command'`.

- [ ] **Step 3: Implement the command**

Create `corevitals/src/report-command.ts`:

```ts
import { buildCheckSpec } from './check-spec';
import { CooklangApi } from './cooklang-api';
import { ReadText, isMenuUri, isPreviewContext } from './provider';
import { parseServings } from './servings';
import { CoreVitalsSettings } from './settings';
import { buildTemplate } from './vitals-template';

export const REPORT_LABEL = 'Core Vitals';

function isCooklangUri(uri: string): boolean {
    return /\.(cook|menu)$/i.test(uri.replace(/[?#].*$/, ''));
}

/**
 * The recipe or menu URI a `cooklang.corevitals.openReport` invocation refers to:
 * the preview toolbars pass a `PreviewOutletContext`, `editor/title` passes the
 * resource `Uri`, the palette passes nothing (use the active editor).
 */
export function uriFromArgument(argument: unknown, activeEditorUri: string | undefined): string | undefined {
    if (isPreviewContext(argument)) {
        return argument.uri;
    }
    if (typeof argument === 'object' && argument !== null) {
        const candidate = argument as { scheme?: unknown; toString?: unknown };
        if (typeof candidate.scheme === 'string' && typeof candidate.toString === 'function') {
            const uri = String(candidate.toString());
            return isCooklangUri(uri) ? uri : undefined;
        }
    }
    return activeEditorUri !== undefined && isCooklangUri(activeEditorUri) ? activeEditorUri : undefined;
}

/** Backs `cooklang.corevitals.openReport`. */
export class OpenReportCommand {

    constructor(
        protected readonly api: CooklangApi,
        protected readonly settings: () => CoreVitalsSettings,
        protected readonly readText: ReadText,
    ) { }

    /** Opens the report tab; false when the editor lacks `cooklang.api.openReport`. */
    async open(uri: string): Promise<boolean> {
        const servings = isMenuUri(uri) ? 1 : parseServings(await this.readText(uri) ?? '') ?? 1;
        const template = buildTemplate(buildCheckSpec(this.settings(), servings), 'html');
        return this.api.openReport({ uri, template, label: REPORT_LABEL, outputFormat: 'html', scale: 1 });
    }
}
```

- [ ] **Step 4: Wire the extension**

Replace `corevitals/src/extension.ts` with:

```ts
import * as vscode from 'vscode';
import { CooklangApi } from './cooklang-api';
import { CoreVitalsBadgeProvider, ReadText } from './provider';
import { OpenReportCommand, uriFromArgument } from './report-command';
import { readSettings } from './settings';
import { SupportCheck } from './support-check';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel('Core Vitals');
    context.subscriptions.push(output);
    const api = new CooklangApi(
        (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
        () => Promise.resolve(vscode.commands.getCommands(true)),
    );
    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('coreVitals');
        return readSettings(key => configuration.get(key));
    };
    // The open document when there is one (unsaved edits included), else the file.
    const readText: ReadText = async uri => {
        try {
            return (await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))).getText();
        } catch (error) {
            output.appendLine(`Could not read ${uri}: ${error}`);
            return undefined;
        }
    };
    const supportCheck = new SupportCheck(api);
    const provider = new CoreVitalsBadgeProvider(api, message => output.appendLine(message), settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.corevitals.provideBadge', async (outletContext: unknown) => {
        const supported = await supportCheck.isSupported();
        if (!supported && supportCheck.consumeFirstUnsupportedWarning()) {
            output.appendLine('Core Vitals needs a newer Cook Editor (cooklang.api.renderReport is missing).');
        }
        return supported ? provider.provide(outletContext) : undefined;
    }));
    const report = new OpenReportCommand(api, settings, readText);
    context.subscriptions.push(vscode.commands.registerCommand('cooklang.corevitals.openReport', async (argument: unknown) => {
        const uri = uriFromArgument(argument, vscode.window.activeTextEditor?.document.uri.toString());
        if (!uri) {
            vscode.window.showInformationMessage('Open a recipe (.cook) or meal plan (.menu) to see its Core Vitals report.');
            return;
        }
        if (!await report.open(uri)) {
            vscode.window.showWarningMessage('The Core Vitals report needs a newer Cook Editor (cooklang.api.openReport is missing).');
        }
    }));
    // Changing a target should update open previews without an edit.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('coreVitals')) {
            api.refreshBadges().catch(() => undefined);
        }
    }));
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
```

- [ ] **Step 5: Run all specs**

Run: `cd corevitals && npm test; cd ..`
Expected: all passing (`58 passing`).

- [ ] **Step 6: Commit**

```bash
git add corevitals/src/report-command.ts corevitals/src/report-command.spec.ts corevitals/src/extension.ts
git commit -m "feat(corevitals): report command and extension wiring"
```

---

### Task 11: End-to-end check in the editor

The template is the one piece no unit test exercises. This task runs it for real.

- [ ] **Step 1: Deploy into the editor checkout**

The editor checkout must have the `feature/core-vitals-editor-api` branch built and bundled (see the editor plan, Task 7). Then:

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins/corevitals && npm run deploy && cd ..
ls ../editor/plugins/cooklang.corevitals
```

Expected: `LICENSE  README.md  media  out  package.json` (README is created in Task 12; if it is missing now, the deploy still copies the rest — re-run deploy after Task 12).

- [ ] **Step 2: Prepare a fixture workspace**

```bash
rm -rf /tmp/corevitals-ws && mkdir -p /tmp/corevitals-ws
cp /Users/alexeydubovskoy/Cooklang/cooklang-reports-nutrition/examples-bin/cook-nutrition-demo/fixtures/*.cook /Users/alexeydubovskoy/Cooklang/cooklang-reports-nutrition/examples-bin/cook-nutrition-demo/fixtures/*.menu /tmp/corevitals-ws/
ls /tmp/corevitals-ws
```

Expected: `pancakes.cook rice-bowl.cook salmon-dinner.cook week.menu` (names may differ slightly; the menu must reference recipes that exist beside it, because plan expansion resolves `@./name` against the workspace root).

- [ ] **Step 3: Run the editor and check the badge**

Run `cd /Users/alexeydubovskoy/Cooklang/editor && npm run start:electron`, open `/tmp/corevitals-ws` as the workspace, sign in with a Basic/Pro account, open `week.menu` and its preview.

Check, and fix the template in `vitals-template.ts` (re-deploy and restart after each change) until all hold:
1. The menu preview header shows a `Vitals n/m` pill after a moment. If instead the Core Vitals output channel (View → Output → Core Vitals) shows `Core Vitals unavailable (template): …`, the message names the Jinja line that failed; fix it.
2. Hovering the pill shows `2 days · 1 person · FDA daily values` and below/over lines.
3. Open a recipe preview (`pancakes.cook`): the pill shows per-serving figures; the hover's second line starts with `Per serving` or `Whole recipe`.
4. Settings → Extensions → Core Vitals → change Standard to `eu`: the pill updates without editing the menu.

- [ ] **Step 4: Check the report**

Click the heartbeat icon next to the cart in the menu preview toolbar. A "Core Vitals" tab opens. Check:
1. Header, period line, three tiles.
2. The macro split bar and legend with ✓/✗.
3. The nutrient table with coloured bars and a dashed 100 % line.
4. "Energy per day" with two columns (the fixture has two days) and the per-day table.
5. "Could not check" lists any unmatched ingredient, or "Everything was matched".
6. Edit `week.menu` (remove a recipe reference) and save: the tab re-renders.
7. The same icon on a recipe preview opens a per-serving report without the per-day section.

If any `<style>` rules are missing in the rendered page (everything unstyled), the sanitizer stripped the block: move the rules into `style="…"` attributes on the elements and re-check.

- [ ] **Step 5: Commit any template fixes**

```bash
cd /Users/alexeydubovskoy/Cooklang/plugins && npm --prefix corevitals test && git add corevitals/src/vitals-template.ts && git commit -m "fix(corevitals): template adjustments from the editor run" || echo "nothing to commit"
```

---

### Task 12: Docs and packaging

**Files:**
- Create: `corevitals/README.md`
- Modify: `README.md` (root table)

- [ ] **Step 1: Plugin README**

Create `corevitals/README.md`:

```markdown
# Core Vitals

Checks a meal plan or a recipe against daily nutrient targets in Cook Editor.

## What you see

A `Vitals 14/17` pill in the preview header: how many targets the plan meets for the days and people it covers (a recipe is judged per serving against one meal). Green from 90 % of targets met, amber from 60 %, red below. Hover it for what is below target or over a limit.

The heartbeat icon next to the shopping-list cart opens the full report: targets met, energy, the macro split against the recommended ranges, every nutrient as a % of its daily value, energy per day for multi-day plans, and what could not be checked.

`Vitals ?` means the data does not support a verdict: fewer than 70 % of the ingredients matched the nutrition database, a referenced recipe was not found, or nothing could be evaluated. The hover says which.

## Targets

Daily values come from the cook.md nutrition service (**Settings → Extensions → Core Vitals**):

- **Standard**: FDA (default), EU or UK tables.
- **Energy**: override the daily kcal target.
- **Protein / Carbohydrate / Fat %**: fixed shares of energy; leave at 0 for the 10–35 / 45–65 / 20–35 % ranges.
- **Micronutrients**: nutrient keys checked as minimums (`iron_mg`, `vit_c_mg`, `selenium_ug`…). Energy, the macros, fiber, saturated fat (limit) and sodium (limit) are always checked.
- **Tolerance**: minimums pass at 100 − tolerance %, limits at 100 + tolerance %, energy within ± tolerance %.
- **Meals per day**: a recipe serving is judged against a day divided by this.

Plans use the menu's `servings:` frontmatter as the number of people and count a day per `= Day … =` section. Recipes use their `servings:` frontmatter.

## Plans

Needs a Cook Basic or Pro plan (nutrition data comes from the cook.md nutrition service). Without it a greyed `🔒 Vitals` pill is shown; turn it off with **Show When Locked**.

Daily values are generic adult figures, not personal medical advice.

## For plugin authors

Shows both badge outlets (`cooklang/recipePreview/badge`, `cooklang/menuPreview/badge`), a toolbar command on both preview toolbars, one Jinja template rendered in two modes through `cooklang.api.renderReport` (`tojson` for the badge) and `cooklang.api.openReport` (HTML with inline SVG for the report), and `cooklang.api.refreshBadges` after a settings change.
```

- [ ] **Step 2: Root README row**

In `README.md`, after the `allergens` row of the plugin table, add:

```markdown
| [`corevitals`](./corevitals) | `Vitals 14/17` badge on meal plans and recipes: targets met against FDA/EU/UK daily values, with a full report with charts. Needs a Cook Basic or Pro plan. Install it from the Extensions view. Shows the menu badge outlet and opening a report tab with `cooklang.api.openReport`. |
```

- [ ] **Step 3: Package**

```bash
cd corevitals && npm run package && ls *.vsix && cd ..
```

Expected: `corevitals-0.1.0.vsix`.

- [ ] **Step 4: Commit**

```bash
git add corevitals/README.md README.md
git commit -m "docs(corevitals): README and root table row"
```

- [ ] **Step 5: Hand off**

Use `superpowers:finishing-a-development-branch` for a PR titled `feat: Core Vitals plugin — nutrient targets for meal plans and recipes`. Publishing to plugins.cook.md follows the root README's "Publishing" section once the editor release that ships the menu badge outlet and `cooklang.api.openReport` is out.

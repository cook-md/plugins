import { Check, CheckKind, CheckSpec } from './check-spec';
import { NUTRIENT_KEY } from './settings';

export type TemplateMode = 'json' | 'html';

/** The editor rejects longer templates (`cooklang.api.renderReport` / `openReport`). */
export const MAX_TEMPLATE_LENGTH = 64 * 1024;

const LABEL = /^[A-Za-z0-9 %-]{1,48}$/;
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

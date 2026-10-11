// One recipe as an <article>, built from the validated template output. Every
// value from the recipe is escaped; image sources must be data URIs or http(s).
import { RecipeImages } from './cooklang-api';
import { lookupStepImage } from './images';
import { escapeHtml } from './markdown';
import { RecipeData, RecipeIngredient } from './recipe-template';

export interface RecipeHtmlInput {
    /** Anchor id used by the contents and the index, e.g. `r-12`. */
    id: string;
    title: string;
    data: RecipeData;
    /** Already inlined (see `ImageInliner.inlineAll`). */
    images: RecipeImages;
    nutritionLine?: string;
}

const SAFE_IMAGE_SRC = /^(data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+|https?:\/\/\S+)$/i;

function imageTag(src: string | undefined, className: string): string {
    return src !== undefined && SAFE_IMAGE_SRC.test(src) ? `<img class="${className}" src="${escapeHtml(src)}" alt="">` : '';
}

function scalar(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
    }
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

/** First metadata value among `keys`, matched case-insensitively and with `_` or `-` as spaces. */
function field(metadata: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const [key, value] of Object.entries(metadata)) {
        if (keys.includes(key.toLowerCase().replace(/[_-]/g, ' '))) {
            return value;
        }
    }
    return undefined;
}

function minutes(value: unknown): string | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? `${value} min` : scalar(value);
}

function metaLine(metadata: Record<string, unknown>): string[] {
    const parts: string[] = [];
    const servings = scalar(field(metadata, ['servings', 'serves', 'yield']));
    if (servings !== undefined) {
        parts.push(`Serves ${servings}`);
    }
    for (const [label, keys] of [
        ['Prep', ['prep time', 'prep']],
        ['Cook', ['cook time', 'cook']],
        ['Total', ['time', 'total time', 'duration']],
    ] as const) {
        const value = minutes(field(metadata, keys));
        if (value !== undefined) {
            parts.push(`${label} ${value}`);
        }
    }
    return parts;
}

function sourceHtml(metadata: Record<string, unknown>): string {
    const source = field(metadata, ['source']);
    let name: string | undefined;
    let url: string | undefined;
    if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
        const record = source as Record<string, unknown>;
        name = scalar(record.name);
        url = scalar(record.url);
    } else {
        name = scalar(source);
    }
    if (name === undefined && url === undefined) {
        return '';
    }
    if (url === undefined && name !== undefined && /^https?:\/\/\S+$/i.test(name)) {
        url = name;
    }
    const label = escapeHtml(name ?? url!);
    const linked = url !== undefined && /^https?:\/\/\S+$/i.test(url) ? `<a href="${escapeHtml(url)}">${label}</a>` : label;
    return `<p class="source">Source: ${linked}</p>`;
}

function tags(metadata: Record<string, unknown>): string[] {
    const value = field(metadata, ['tags']);
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return list.map(scalar).filter((tag): tag is string => tag !== undefined);
}

/** A reference's display name: `./Sauces/Pesto` → `Pesto`. */
export function ingredientName(ingredient: RecipeIngredient): string {
    return ingredient.reference ? ingredient.name.split('/').pop()!.replace(/\.cook$/i, '') : ingredient.name;
}

function ingredientHtml(ingredient: RecipeIngredient): string {
    const quantity = ingredient.quantity !== '' ? `<span class="qty">${escapeHtml(ingredient.quantity)}</span> ` : '';
    const note = ingredient.note !== '' ? ` <span class="note">(${escapeHtml(ingredient.note)})</span>` : '';
    const optional = ingredient.optional ? ' <span class="optional">optional</span>' : '';
    return `<li>${quantity}${escapeHtml(ingredientName(ingredient))}${note}${optional}</li>`;
}

export function renderRecipeHtml(input: RecipeHtmlInput): string {
    const { data } = input;
    const out: string[] = [`<article class="recipe" id="${escapeHtml(input.id)}">`, `<h2 class="recipe-title">${escapeHtml(input.title)}</h2>`];
    out.push(imageTag(input.images.title, 'title-image'));
    const meta = metaLine(data.metadata);
    if (meta.length > 0) {
        out.push(`<p class="meta">${meta.map(escapeHtml).join(' · ')}</p>`);
    }
    out.push(sourceHtml(data.metadata));
    const tagList = tags(data.metadata);
    if (tagList.length > 0) {
        out.push(`<p class="tags">${tagList.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</p>`);
    }
    if (input.nutritionLine !== undefined) {
        out.push(`<p class="nutrition">${escapeHtml(input.nutritionLine)}</p>`);
    }
    if (data.ingredients.length > 0) {
        out.push(`<section class="ingredients"><h3>Ingredients</h3><ul>${data.ingredients.map(ingredientHtml).join('')}</ul></section>`);
    }
    if (data.cookware.length > 0) {
        const items = data.cookware.map(item => {
            const quantity = item.quantity !== '' ? `<span class="qty">${escapeHtml(item.quantity)}</span> ` : '';
            const note = item.note !== '' ? ` <span class="note">(${escapeHtml(item.note)})</span>` : '';
            return `<li>${quantity}${escapeHtml(item.name)}${note}</li>`;
        });
        out.push(`<section class="cookware"><h3>Cookware</h3><ul>${items.join('')}</ul></section>`);
    }
    out.push('<section class="method"><h3>Method</h3>');
    let globalStep = 0;
    data.sections.forEach((section, sectionIndex) => {
        if (section.name !== '') {
            out.push(`<h4 class="section-name">${escapeHtml(section.name)}</h4>`);
        }
        let stepInSection = 0;
        for (const block of section.blocks) {
            if (block.kind === 'text') {
                out.push(`<p class="text">${escapeHtml(block.text)}</p>`);
                continue;
            }
            const image = imageTag(lookupStepImage(input.images, sectionIndex, stepInSection, globalStep), 'step-image');
            out.push(`<div class="step"><span class="step-number">${block.number}</span><p>${escapeHtml(block.text)}</p>${image}</div>`);
            stepInSection++;
            globalStep++;
        }
    });
    out.push('</section>', '</article>');
    return out.filter(part => part !== '').join('\n');
}

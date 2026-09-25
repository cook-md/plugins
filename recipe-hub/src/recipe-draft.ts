// Arguments for the editor's `cooklang.api.saveDraft`. No `vscode` import.
// Metadata is always YAML frontmatter; the deprecated `>>` syntax is converted, never written.

import type { RecipeDetail } from './hub-client';
import { originalRecipeUrl } from './hub-urls';

/** Argument of `cooklang.api.saveDraft`. The editor writes YAML only and never overwrites an existing frontmatter key. */
export interface SaveDraftArgs {
    version: 1;
    /** Cooklang text. */
    content: string;
    /** Used when the content has no title. */
    title?: string;
    /** Added to the draft's YAML frontmatter, only for keys not already present. */
    frontmatter?: Record<string, string>;
}

export interface DraftSource {
    id: number;
    /** Title from the hub URI's file name, used when the recipe details are unavailable. */
    fileTitle: string;
    content: string;
    detail?: Pick<RecipeDetail, 'title' | 'sourceUrl'>;
    serverUrl: string;
}

export function buildSaveDraftArgs(source: DraftSource): SaveDraftArgs {
    const title = source.detail?.title.trim() || source.fileTitle;
    return {
        version: 1,
        content: legacyMetadataToFrontmatter(source.content),
        title,
        frontmatter: { source: originalRecipeUrl(source.detail?.sourceUrl, source.serverUrl, source.id) },
    };
}

const LEGACY_METADATA = /^>>\s*([^:]+?)\s*:\s*(.*?)\s*$/;

/**
 * Moves deprecated `>> key: value` metadata lines into a YAML frontmatter
 * block. Recipes that already have YAML frontmatter, or have no metadata
 * lines, are returned unchanged. A repeated key keeps its first position but
 * the last value, matching cooklang-rs (`event_consumer.rs`: each `>>` line
 * is a plain map insert, so a later value for the same key overwrites the
 * earlier one).
 */
export function legacyMetadataToFrontmatter(content: string): string {
    const stripped = content.replace(/^﻿/, '');
    const lines = stripped.split(/\r?\n/);
    if (hasFrontmatter(lines)) {
        return content;
    }
    const entries = new Map<string, string>();
    const body: string[] = [];
    for (const line of lines) {
        const match = LEGACY_METADATA.exec(line);
        if (match) {
            entries.set(match[1], match[2]);
        } else {
            body.push(line);
        }
    }
    if (entries.size === 0) {
        return content;
    }
    while (body.length > 0 && body[0].trim() === '') {
        body.shift();
    }
    const yaml = [...entries].map(([key, value]) => `${yamlScalar(key)}: ${yamlScalar(value)}`);
    return ['---', ...yaml, '---', ...body].join('\n');
}

/**
 * Whether `lines` has a YAML frontmatter block the way cooklang-rs
 * (`cooklang` 0.17 `src/parser/frontmatter.rs`) locates it: a fence is any
 * line whose trailing whitespace is stripped and equals `---`, wherever it
 * falls, even after leading blank lines. The opening fence is the first such
 * line; a second one after it closes the block. Both are required — a
 * document with only one `---` line (a lone divider) has no frontmatter.
 */
function hasFrontmatter(lines: readonly string[]): boolean {
    const start = lines.findIndex(line => line.trimEnd() === '---');
    if (start === -1) {
        return false;
    }
    return lines.findIndex((line, index) => index > start && line.trimEnd() === '---') !== -1;
}

const PLAIN_SCALAR = /^[\p{L}\p{N}][\p{L}\p{N} _.()/-]*$/u;
const YAML_KEYWORDS = /^(true|false|yes|no|on|off|null|~)$/i;

/** `value` as a YAML scalar: plain when unambiguous, otherwise double-quoted (JSON strings are valid YAML). */
export function yamlScalar(value: string): string {
    return PLAIN_SCALAR.test(value) && !YAML_KEYWORDS.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value);
}

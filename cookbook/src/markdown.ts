// A small Markdown → HTML converter for README intros. No dependencies; every
// piece of source text is HTML-escaped, so a README can't inject markup. Supports
// `#`–`###` headings, paragraphs, `*em*` / `**strong**`, inline code, one-level
// lists, `http(s)` links, images, blockquotes and horizontal rules; anything else
// is paragraph text.
import { parseFrontmatter } from './frontmatter';

export interface MarkdownOptions {
    /** Added to each heading level: with 1, `#` becomes `<h2>`. Capped at `<h6>`. */
    headingShift: number;
    /** Skip the first `#` heading (it is already the cover title). */
    dropFirstHeading?: boolean;
    /** A relative image `src` → a `data:image/…` URI, or undefined to show the alt text instead. */
    resolveImage?: (src: string) => string | undefined;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INLINE = /(`+)([^`]+?)\1|!\[([^\]]*)\]\(([^()\s]+)\)|\[([^\]]+)\]\(([^()\s]+)\)|\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*/g;
const IMAGE = /!\[([^\]]*)\]\(([^()\s]+)\)/g;

function isHttp(url: string): boolean {
    return /^https?:\/\/[^\s]+$/i.test(url);
}

function isRelative(url: string): boolean {
    return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
}

function image(alt: string, src: string, options: MarkdownOptions): string {
    if (isHttp(src)) {
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
    }
    const resolved = isRelative(src) ? options.resolveImage?.(src) : undefined;
    if (resolved !== undefined && /^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(resolved)) {
        return `<img src="${resolved}" alt="${escapeHtml(alt)}">`;
    }
    return escapeHtml(alt);
}

export function inlineMarkdown(text: string, options: MarkdownOptions): string {
    let html = '';
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
        html += escapeHtml(text.slice(last, match.index));
        if (match[1] !== undefined) {
            html += `<code>${escapeHtml(match[2])}</code>`;
        } else if (match[4] !== undefined) {
            html += image(match[3], match[4], options);
        } else if (match[6] !== undefined) {
            const label = inlineMarkdown(match[5], options);
            html += isHttp(match[6]) ? `<a href="${escapeHtml(match[6])}">${label}</a>` : label;
        } else if (match[7] !== undefined) {
            html += `<strong>${inlineMarkdown(match[7], options)}</strong>`;
        } else {
            html += `<em>${inlineMarkdown(match[8], options)}</em>`;
        }
        last = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(last));
}

/** Relative image sources in a README body, to read and inline before {@link markdownToHtml}. */
export function markdownImageSources(source: string): string[] {
    const sources = new Set<string>();
    for (const match of parseFrontmatter(source).body.matchAll(IMAGE)) {
        if (isRelative(match[2])) {
            sources.add(match[2]);
        }
    }
    return [...sources];
}

export function markdownToHtml(source: string, options: MarkdownOptions): string {
    const out: string[] = [];
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | undefined;
    let quote: string[] | undefined;
    let dropHeading = options.dropFirstHeading === true;

    const flushParagraph = (): void => {
        if (paragraph.length > 0) {
            out.push(`<p>${inlineMarkdown(paragraph.join(' '), options)}</p>`);
            paragraph = [];
        }
    };
    const flushList = (): void => {
        if (list) {
            const tag = list.ordered ? 'ol' : 'ul';
            out.push(`<${tag}>${list.items.map(item => `<li>${inlineMarkdown(item, options)}</li>`).join('')}</${tag}>`);
            list = undefined;
        }
    };
    const flushQuote = (): void => {
        if (quote) {
            out.push(`<blockquote><p>${inlineMarkdown(quote.join(' '), options)}</p></blockquote>`);
            quote = undefined;
        }
    };
    const flushAll = (): void => {
        flushParagraph();
        flushList();
        flushQuote();
    };

    for (const raw of parseFrontmatter(source).body.split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (line.trim() === '') {
            flushAll();
            continue;
        }
        const heading = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
        if (heading) {
            flushAll();
            if (dropHeading && heading[1].length === 1) {
                dropHeading = false;
                continue;
            }
            const level = Math.min(heading[1].length + options.headingShift, 6);
            out.push(`<h${level}>${inlineMarkdown(heading[2], options)}</h${level}>`);
            continue;
        }
        if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
            flushAll();
            out.push('<hr>');
            continue;
        }
        const quoted = /^ {0,3}> ?(.*)$/.exec(line);
        if (quoted) {
            flushParagraph();
            flushList();
            (quote ??= []).push(quoted[1].trim());
            continue;
        }
        const bullet = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
        const numbered = /^ {0,3}\d{1,9}[.)]\s+(.*)$/.exec(line);
        const item = bullet ?? numbered;
        if (item) {
            flushParagraph();
            flushQuote();
            if (list && list.ordered !== (bullet === null)) {
                flushList();
            }
            (list ??= { ordered: bullet === null, items: [] }).items.push(item[1].trim());
            continue;
        }
        if (list && /^\s/.test(raw)) {
            list.items[list.items.length - 1] += ` ${line.trim()}`;
            continue;
        }
        if (quote) {
            quote.push(line.trim());
            continue;
        }
        flushList();
        paragraph.push(line.trim());
    }
    flushAll();
    return out.join('\n');
}

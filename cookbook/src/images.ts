// Recipe and README photos, inlined into the book as `data:` URIs so the PDF
// window needs no file access. `http(s)` URLs (from recipe metadata) are kept.
import { RecipeImages } from './cooklang-api';

/** Bigger files are skipped. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * All inlined images together, in data-URI characters. The editor rejects export
 * HTML over 100 M characters; this leaves room for the text. Images past the budget
 * are left out and counted in {@link ImageInliner.skipped}.
 */
export const MAX_TOTAL_IMAGE_CHARS = 80 * 1024 * 1024;

/** The extensions the editor's preview understands (`common/recipe-images.ts`). */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

export function mimeType(uri: string): string | undefined {
    const path = uri.split(/[?#]/)[0];
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot < 0 ? undefined : IMAGE_MIME_TYPES[name.slice(dot + 1).toLowerCase()];
}

export function toDataUri(bytes: Uint8Array, mime: string): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * The image for one step, with the preview's rules (`lookupStepImage` in the editor):
 * the section-specific `Recipe.S.N.jpg` wins, the linear `Recipe.N.jpg` (section 0,
 * counted across sections) is the fallback. All indices are zero-based and count steps only.
 */
export function lookupStepImage(images: RecipeImages, sectionIndex: number, stepInSection: number, globalStepIndex: number): string | undefined {
    return images.steps[String(sectionIndex)]?.[String(stepInSection)] ?? images.steps['0']?.[String(globalStepIndex)];
}

export interface ImageFiles {
    /** Size in bytes, or undefined when the file can't be read. */
    size(uri: string): Promise<number | undefined>;
    read(uri: string): Promise<Uint8Array>;
}

export class ImageInliner {

    /** Images left out because they were too big or over the book's budget. */
    skipped = 0;
    protected used = 0;
    protected readonly cache = new Map<string, Promise<string | undefined>>();

    constructor(
        protected readonly files: ImageFiles,
        protected readonly maxBytes = MAX_IMAGE_BYTES,
        protected readonly budget = MAX_TOTAL_IMAGE_CHARS,
    ) { }

    /** `http(s)` URLs as they are; readable image files as data URIs; anything else undefined. Each URI is read once. */
    inline(uri: string): Promise<string | undefined> {
        if (/^https?:\/\/\S+$/i.test(uri)) {
            return Promise.resolve(uri);
        }
        let pending = this.cache.get(uri);
        if (!pending) {
            pending = this.load(uri);
            this.cache.set(uri, pending);
        }
        return pending;
    }

    async inlineAll(images: RecipeImages): Promise<RecipeImages> {
        const result: RecipeImages = { steps: {} };
        if (images.title !== undefined) {
            const title = await this.inline(images.title);
            if (title !== undefined) {
                result.title = title;
            }
        }
        for (const [section, steps] of Object.entries(images.steps)) {
            for (const [step, uri] of Object.entries(steps)) {
                const src = await this.inline(uri);
                if (src !== undefined) {
                    (result.steps[section] ??= {})[step] = src;
                }
            }
        }
        return result;
    }

    protected async load(uri: string): Promise<string | undefined> {
        const mime = mimeType(uri);
        if (!mime || !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
            return undefined;
        }
        try {
            const size = await this.files.size(uri);
            if (size === undefined) {
                return undefined;
            }
            // Base64 is 4 characters per 3 bytes, plus the `data:<mime>;base64,` prefix. The budget
            // is checked and reserved in one synchronous step, so concurrent loads can't all pass.
            const reserved = Math.ceil(size / 3) * 4 + `data:${mime};base64,`.length;
            if (size > this.maxBytes || this.used + reserved > this.budget) {
                this.skipped++;
                return undefined;
            }
            this.used += reserved;
            try {
                const dataUri = toDataUri(await this.files.read(uri), mime);
                this.used += dataUri.length - reserved;
                return dataUri;
            } catch (error) {
                this.used -= reserved;
                throw error;
            }
        } catch {
            return undefined;
        }
    }
}

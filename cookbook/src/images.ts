// Recipe and README photos, inlined into the book as `data:` URIs so the PDF
// window needs no file access. `http(s)` URLs (from recipe metadata) are kept.
import { RecipeImages } from './cooklang-api';

/** Bigger files are skipped. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * All inlined images together, in data-URI characters. The editor rejects export
 * HTML over 100 M characters, and the plugin → backend → frontend → Electron path has
 * only been tested up to about 60 MB, so the images get 50 MiB and the text the rest.
 * Every use of a photo counts, shared ones included, because each is embedded again.
 * Images past the budget are left out and counted in {@link ImageInliner.skipped}.
 */
export const MAX_TOTAL_IMAGE_CHARS = 50 * 1024 * 1024;

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
    protected readonly cache = new Map<string, Promise<Loaded>>();

    constructor(
        protected readonly files: ImageFiles,
        protected readonly maxBytes = MAX_IMAGE_BYTES,
        protected readonly budget = MAX_TOTAL_IMAGE_CHARS,
    ) { }

    /**
     * `http(s)` URLs as they are; readable image files as data URIs; anything else undefined.
     * Each file is read once, but every use is charged to the budget.
     */
    async inline(uri: string): Promise<string | undefined> {
        if (/^https?:\/\/\S+$/i.test(uri)) {
            return uri;
        }
        let pending = this.cache.get(uri);
        if (pending) {
            const loaded = await pending;
            if (loaded.dataUri !== undefined) {
                if (this.used + loaded.dataUri.length > this.budget) {
                    this.skipped++;
                    return undefined;
                }
                this.used += loaded.dataUri.length;
            } else if (loaded.skipped) {
                this.skipped++;
            }
            return loaded.dataUri;
        }
        pending = this.load(uri);
        this.cache.set(uri, pending);
        return (await pending).dataUri;
    }

    /** Forget the cached data URIs (they are large) once the book is assembled. */
    clear(): void {
        this.cache.clear();
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

    protected async load(uri: string): Promise<Loaded> {
        const mime = mimeType(uri);
        if (!mime || !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
            return { skipped: false };
        }
        try {
            const size = await this.files.size(uri);
            if (size === undefined) {
                return { skipped: false };
            }
            // Base64 is 4 characters per 3 bytes, plus the `data:<mime>;base64,` prefix. The budget
            // is checked and reserved in one synchronous step, so concurrent loads can't all pass.
            const reserved = Math.ceil(size / 3) * 4 + `data:${mime};base64,`.length;
            if (size > this.maxBytes || this.used + reserved > this.budget) {
                this.skipped++;
                return { skipped: true };
            }
            this.used += reserved;
            try {
                const bytes = await this.files.read(uri);
                if (bytes.length > this.maxBytes) {
                    this.used -= reserved;
                    this.skipped++;
                    return { skipped: true };
                }
                const dataUri = toDataUri(bytes, mime);
                this.used += dataUri.length - reserved;
                return { dataUri, skipped: false };
            } catch (error) {
                this.used -= reserved;
                throw error;
            }
        } catch {
            return { skipped: false };
        }
    }
}

interface Loaded {
    dataUri?: string;
    /** Left out for size or budget, as opposed to missing or unreadable. */
    skipped: boolean;
}

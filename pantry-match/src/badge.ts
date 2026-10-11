// `Have 9/11` pill on the recipe preview (outlet `cooklang/recipePreview/badge`).
import { PillBadge, PreviewOutletContext } from './cooklang-api';
import { formatNames } from './markdown';
import { matchIngredients, PantryLookup, RecipeMatch } from './match';
import { IngredientName, RecipeNames, RenderedNames } from './names-template';

export function isPreviewContext(value: unknown): value is PreviewOutletContext {
    const context = value as PreviewOutletContext;
    return typeof value === 'object' && value !== null
        && context.version === 1 && typeof context.uri === 'string' && typeof context.path === 'string'
        && typeof context.scale === 'number';
}

export function badgeFor(match: RecipeMatch): PillBadge | undefined {
    if (match.total === 0) {
        return undefined;
    }
    const complete = match.covered === match.total;
    return {
        kind: 'pill',
        text: `Have ${match.covered}/${match.total}`,
        tone: complete ? 'good' : 'neutral',
        tooltipMarkdown: complete
            ? `**You have all ${match.total} ingredients** in your pantry.`
            : `**Have ${match.covered} of ${match.total} ingredients.**\n\nMissing: ${formatNames(match.missing)}`,
    };
}

export interface BadgeDeps {
    showBadge(): boolean;
    /** Undefined while there is no usable pantry (none, malformed, or not loaded yet). */
    lookup(): PantryLookup | undefined;
    render(uri: string): Promise<RenderedNames>;
    /** Merges linked recipes' names; `path` is `''` outside the workspace. */
    expand(path: string, own: RecipeNames): Promise<IngredientName[]>;
    log(message: string): void;
}

export class PantryBadgeProvider {

    constructor(protected readonly deps: BadgeDeps) { }

    async provide(context: unknown): Promise<PillBadge | undefined> {
        if (!isPreviewContext(context) || !this.deps.showBadge()) {
            return undefined;
        }
        const lookup = this.deps.lookup();
        if (!lookup) {
            return undefined;
        }
        const rendered = await this.deps.render(context.uri);
        if (!rendered.ok) {
            this.deps.log(`Pantry Match: could not read ${context.path || context.uri}: ${rendered.message}`);
            return undefined;
        }
        const ingredients = await this.deps.expand(context.path, rendered.names);
        return badgeFor(matchIngredients(ingredients, lookup));
    }
}

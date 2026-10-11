// Linked recipes (`@./Sauces/Pesto{}`): the editor's `resolveRecipeReferences` returns
// the whole (cycle-safe) tree; this module flattens it to MAX_REFERENCE_DEPTH levels and
// merges the referenced recipes' ingredient names into the parent's.
import { ResolvedRecipeReference } from './cooklang-api';
import { IngredientName, RecipeNames } from './names-template';

export const MAX_REFERENCE_DEPTH = 3;

/** A resolver path (`Sauces/Pesto`, maybe `./`-prefixed or with backslashes) as a workspace-relative `.cook` path. */
export function referencePath(path: string): string {
    const portable = path.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    return /\.cook$/i.test(portable) ? portable : `${portable}.cook`;
}

/** Depth-first, de-duplicated, never revisiting `selfPath` or any recipe already listed. */
export function flattenReferencePaths(
    tree: readonly ResolvedRecipeReference[],
    selfPath: string,
    maxDepth = MAX_REFERENCE_DEPTH,
): string[] {
    const seen = new Set<string>([referencePath(selfPath).toLowerCase()]);
    const out: string[] = [];
    const walk = (refs: readonly ResolvedRecipeReference[], depth: number): void => {
        if (depth > maxDepth) {
            return;
        }
        for (const ref of refs) {
            if (typeof ref?.path !== 'string' || ref.path.trim() === '') {
                continue;
            }
            const path = referencePath(ref.path);
            const key = path.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(path);
            walk(Array.isArray(ref.children) ? ref.children : [], depth + 1);
        }
    };
    walk(tree, 1);
    return out;
}

export interface ExpanderDeps {
    /** `cooklang.api.resolveRecipeReferences`; may reject. */
    resolve(path: string): Promise<ResolvedRecipeReference[]>;
    /** Names of a workspace-relative `.cook` path; undefined when unreadable. */
    names(path: string): Promise<RecipeNames | undefined>;
}

export class ReferenceExpander {

    protected readonly trees = new Map<string, { tree: Promise<ResolvedRecipeReference[]>; paths?: Set<string> }>();

    constructor(protected readonly deps: ExpanderDeps, protected readonly maxDepth = MAX_REFERENCE_DEPTH) { }

    /** The recipe's own names plus those of every recipe it links to (up to three levels). */
    async ingredientsFor(path: string, own: RecipeNames): Promise<IngredientName[]> {
        if (own.refs.length === 0 || path === '') {
            return own.names;
        }
        const merged = [...own.names];
        for (const refPath of flattenReferencePaths(await this.tree(path), path, this.maxDepth)) {
            const names = await this.deps.names(refPath);
            if (names) {
                merged.push(...names.names);
            }
        }
        return merged;
    }

    /** Drops cached trees; call when any recipe changes. */
    clear(): void {
        this.trees.clear();
    }

    /**
     * A recipe at `path` changed: drops the cached trees that start at it or contain it.
     * Trees still being resolved are dropped too, since they may predate the change.
     */
    invalidate(path: string): void {
        const changed = referencePath(path).toLowerCase();
        for (const [key, entry] of [...this.trees]) {
            if (!entry.paths || entry.paths.has(changed) || referencePath(key).toLowerCase() === changed) {
                this.trees.delete(key);
            }
        }
    }

    protected tree(path: string): Promise<ResolvedRecipeReference[]> {
        let entry = this.trees.get(path);
        if (!entry) {
            const created: { tree: Promise<ResolvedRecipeReference[]>; paths?: Set<string> } = {
                tree: this.deps.resolve(path)
                    .then(result => Array.isArray(result) ? result : [], () => [])
                    .then(tree => {
                        created.paths = new Set(flattenReferencePaths(tree, path, this.maxDepth).map(ref => ref.toLowerCase()));
                        return tree;
                    }),
            };
            entry = created;
            this.trees.set(path, entry);
        }
        return entry.tree;
    }
}

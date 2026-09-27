/** One of the 14 EU-regulated allergen classes the cook.md nutrition service tags. */
export interface AllergenClass {
    /** The service's class slug, e.g. `tree_nuts`. */
    slug: string;
    /** The setting name under `allergens.`, e.g. `treeNuts`. */
    key: string;
    /** Shown in the pill, e.g. `Tree nuts`. */
    label: string;
}

/** EU-14, in the order settings and pill labels appear. */
export const ALLERGEN_CLASSES: readonly AllergenClass[] = [
    { slug: 'gluten', key: 'gluten', label: 'Gluten' },
    { slug: 'crustaceans', key: 'crustaceans', label: 'Crustaceans' },
    { slug: 'eggs', key: 'eggs', label: 'Eggs' },
    { slug: 'fish', key: 'fish', label: 'Fish' },
    { slug: 'peanuts', key: 'peanuts', label: 'Peanuts' },
    { slug: 'soybeans', key: 'soybeans', label: 'Soy' },
    { slug: 'milk', key: 'milk', label: 'Milk' },
    { slug: 'tree_nuts', key: 'treeNuts', label: 'Tree nuts' },
    { slug: 'celery', key: 'celery', label: 'Celery' },
    { slug: 'mustard', key: 'mustard', label: 'Mustard' },
    { slug: 'sesame', key: 'sesame', label: 'Sesame' },
    { slug: 'sulphites', key: 'sulphites', label: 'Sulphites' },
    { slug: 'lupin', key: 'lupin', label: 'Lupin' },
    { slug: 'molluscs', key: 'molluscs', label: 'Molluscs' },
];

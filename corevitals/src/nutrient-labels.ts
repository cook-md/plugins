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

/** What a check label may contain; the report template embeds labels verbatim. */
export const LABEL_TEXT = /^[A-Za-z0-9 %-]{1,48}$/;

const UNIT_SUFFIX = /_(g|mg|ug|iu)$/;

/** Display label for an already-normalised (lower-case) nutrient key. */
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

/** Unit from the key suffix (`_g`, `_mg`, `_ug`, `_iu`) or `kcal`; empty when unknown. */
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

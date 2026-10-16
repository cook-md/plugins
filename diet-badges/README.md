# Diet Badges

Shows which diets a recipe or meal plan fits on Cook Editor's recipe and menu previews: **Vegan**, **Vegetarian**, **Pescatarian** and **Dairy-free**.

![Pescatarian badge on a recipe preview with its hover explaining which diets fit and why](https://raw.githubusercontent.com/cook-md/plugins/main/diet-badges/media/screenshots/diet-badges.png)

## What you see

| Badge | Meaning |
|---|---|
| green `Vegan` | every ingredient was checked and none of them is an animal product |
| green `Vegetarian · Dairy-free` | the strictest diet that fits, plus Dairy-free when Vegan doesn't fit (Vegan already implies it) |
| amber `Vegan?` | nothing breaks the diet, but some ingredients couldn't be checked: ingredients the nutrition service doesn't know yet, linked recipes, or recipes a meal plan points to that can't be found |
| amber `Diet ?` | the cook.md nutrition service couldn't be reached, or the diet check failed (hover says which) |
| no badge | every diet you've switched on is broken (a steak won't get a "not vegan" badge) |
| grey `🔒 Diet` | your plan doesn't include nutrition data |

A badge is only green when every ingredient was checked. If anything couldn't be checked, the diet gets a `?`.

Hover the badge to see what was checked, which ingredients couldn't be, and why the next stricter diet doesn't fit (for example *Not vegan: butter (dairy), eggs*).

## How diets are decided

| Diet | Doesn't fit when an ingredient is |
|---|---|
| Pescatarian | meat, poultry or animal fat, or a meat word such as bacon, ham, pancetta, chorizo, prosciutto, salami, lard, suet, tallow, dripping, schmaltz or gelatine |
| Vegetarian | anything above, or fish, shellfish, crustaceans or molluscs, or fish sauce, anchovies, Worcestershire sauce, oyster sauce, shrimp paste or bonito |
| Vegan | anything above, or dairy or eggs, or honey, whey, casein or ghee, or one of your **Extra Non Vegan** words |
| Dairy-free | milk, cheese, yogurt or butter |

Each word applies to the diet it breaks and every stricter one, so lard fails Pescatarian, Vegetarian and Vegan, anchovies fail Vegetarian and Vegan, and honey fails Vegan only. Extra Non Vegan words affect Vegan only.

Ingredient categories and allergen data come from the cook.md nutrition service. Word matching is on whole words, and plurals match both ways.

**What counts as checked.** An ingredient's allergens being audited does not say whether it is meat, and the service's categories come from food-group data that not every ingredient has (branded and some regional items have none). For Pescatarian, Vegetarian and Vegan, an ingredient therefore counts as checked only when it matched an animal category or sits in a plant-only group (vegetables, fruits, grains, legumes, nuts and seeds, herbs and spices, vegetable oil, sugar, beverages). Anything else is "couldn't be checked" unless a word above already rules it out. `beverages` counts as plant-based for Vegetarian and Pescatarian but not for Vegan, because wine and beer can be fined with animal products. Dairy-free relies on the audited allergens.

Classification uses an ingredient's main food group, so composite items (for example canned beans with pork) can slip through. Diet Badges is informational only.

**Look-alikes.** Names such as `beef tomatoes`, `lamb's lettuce` and `chicken of the woods` are not treated as meat. A meat or fish word next to a substitute marker (vegan, vegetarian, plant-based, meat-free, mock, faux, imitation, `-style`, tofu, tempeh, seitan, soy, coconut, mushroom, jackfruit) such as `vegan sausage` or `coconut bacon` counts as "couldn't be checked", never as a pass. Categories and allergens still decide first.

## Recipes and meal plans

On a recipe, linked recipes (`@./Sauces/Pesto{}`) aren't looked into. They always count as "couldn't be checked", so open the linked recipe to see its own badge.

On a meal plan (`.menu`), every recipe the plan references is expanded and checked, so a week is vegan only if every recipe in it is. A recipe the plan points to that can't be found counts as "couldn't be checked".

## Settings

Open **Settings → Extensions → Diet Badges**:

- switch any of **Vegan**, **Vegetarian**, **Pescatarian**, **Dairy Free** off to stop checking it (all are on by default),
- add words under **Extra Non Vegan** (for example `bone broth`) to catch ingredients the built-in list misses; these affect **Vegan only**,
- turn off **Show When Locked** to hide the grey `🔒 Diet` badge.

Changes apply to the open preview straight away.

## Plans

Diet Badges uses the cook.md nutrition service, so it needs a Cook Basic or Pro plan. There is no offline mode.

**This is informational only.** It is not a certification or medical advice: ingredient data can be incomplete, and it knows nothing about how packaged products are made. Always check product labels.

## For plugin authors

Shows one command serving two badge outlets (`cooklang/recipePreview/badge` and `cooklang/menuPreview/badge`) with a `pill` badge. The report template uses `plan.all_ingredients` on menus, `aggregate_nutrition(ings, "eu")` for per-ingredient allergen data, and the tree-aware `is_in_category` for taxonomy checks. It stops at the first animal category and skips unresolved ingredients to keep the number of requests down. Items don't expose their categories, so they are looked up one slug at a time. Settings changes call `cooklang.api.refreshBadges`.

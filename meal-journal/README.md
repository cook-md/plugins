# Meal Journal

A daily meal journal for [Cook Editor](https://cook.md). One file per day
(`Journal/2026-06-09.journal`), written in [Cooklang](https://cooklang.org/)
markup — sections for meals, recipe references, ingredients.

## Features

| Feature | How |
|---|---|
| Open (or create) today's entry | Status bar `Today` button, `Cmd+Shift+J`, or **Journal: Open Today** |
| Open yesterday's entry | **Journal: Open Yesterday** (offers to create it if missing) |
| Jump between entries | Chevron icons in the editor title, or **Journal: Open Previous/Next Entry** |
| Reference a recipe | **Journal: Insert Recipe Reference** — quick-pick of all `.cook` files |
| Snippets | Type `section` or `recipe` in any Cooklang file |

New entries are created from a template (YAML frontmatter + `= Breakfast` /
`= Lunch` / `= Dinner` sections). Customize it with the `mealJournal.template`
setting (`${date}` and `${title}` placeholders); change the folder with
`mealJournal.folder`.

`.journal` files are associated with the Cooklang language, so they get the
same highlighting, completion and hover as `.cook` files.

## Development

```bash
npm install
npm test          # unit tests for the pure logic (src/journal-files.ts)
npm run deploy    # compile + copy to ../../editor/plugins/cooklang.meal-journal
```

Then start the editor: `cd ../../editor && npm run start:electron`.

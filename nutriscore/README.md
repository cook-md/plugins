# Nutri-Score for Cook Editor

Shows a Nutri-Score (A–E) in the header of every recipe preview. Hover the
badge to see how reliable the score is: how many ingredients were matched,
which were estimated, the data sources and the estimated fruit/vegetable
share.

Requires signing in to cook.md with a Basic or Pro plan (nutrition data comes
from the cook.md nutrition service). Without it, a greyed "locked" badge is
shown instead, with a hover card pointing at the plans that unlock it. Turn
this off with the `nutriscore.showWhenLocked` setting.

The score is an estimate from the recipe's ingredients using the 2023
Nutri-Score algorithm for general foods. It is not a certified label.

Install it from the Extensions view (plugins.cook.md).

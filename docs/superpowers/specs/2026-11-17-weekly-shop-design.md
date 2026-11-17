# Weekly shop — design (test feature)

Asked for by the owner in November 2026: "create and or compare a food shop and give me a shopping
list that I can go ahead and buy on a Sunday that gets me to the macros it's suggesting for me".
Settled in a grilling session (rounds 1–4) and a concept the owner approved. A test feature: it may
come out again, so it touches as little as it can.

## What it is

The **weekly shop** (CONTEXT.md) is the food to buy for the coming week, in packs, worked out from
what the owner already eats, read against the week's targets. One screen, two tabs:

- **Plan**: the week's targets and what the list reaches, said as a serif sentence and drawn as two
  bars (calories, protein), the gap, and each food with what will be eaten this week and the packs
  to buy, with − and +. Editing the list is the comparison.
- **In the shop**: the same list by aisle, a big tick per line; what is in already sits at the
  bottom.

## Decisions

1. **One screen, build and check in one** (Q1). No separate "compare" mode.
2. **The owner's own foods only** (Q2, Q9): every food logged in the last 28 days whose figures came
   from a label, a barcode, the UK table, the owner, or a remembered food that did. Claude's
   estimates are left out (a takeaway cannot be bought). A recipe share counts as its ingredients,
   in proportion to the share's calories.
3. **A list, not a meal plan** (Q3): what to buy, in packs.
4. **The week's target is the daily target × 7** (Q7): the calorie target of each of the seven days
   summed, and the plain daily protein target × 7 (the lower-body-day protein is left out).
5. **Amounts start from real eating, unscaled** (Q8): each food's amount over the window ÷ logged
   days × 7. Never over calendar days: an unlogged day is not a day of eating nothing. The gap is
   shown as it is. **More of the same** adds one pack at a time of the line with the most protein
   per calorie until the protein target is met (at most 20 packs).
6. **Packs** (Q10): a remembered pack weight where there is one; else the food's count unit (an egg,
   a slice) one at a time; else 100 g. The owner fixes a pack once (− and + step it) and the app
   remembers it per food. Before any tap the line's week amount is what was eaten and the packs are
   that amount rounded up; once − or + is tapped the week amount is the packs bought.
7. **Aisles** (Q11): from the UK table's food group where the food's name is in it, else Other until
   the owner picks one; remembered per food.
8. **No stock tracking** (Q12): "In already" is a tap per week. In-already lines still count in the
   totals (they are eaten); they are not bought.
9. **Saving** (Q13): the week being planned, with its edits and ticks, is kept in the Settings row
   (so it is in the backup); pack and aisle fixes are kept per food. A new week starts fresh.
10. **Where it lives** (Q5): a row on Food, at the top on Sundays and at the foot otherwise; the
    screen is `/food/shop`. The week planned is the Monday after the coming Sunday:
    `mondayOf(today + 7)` (on a Sunday, tomorrow's week).
11. **A Settings switch** (Q6): Settings → Food → "Weekly shop (test)", on by default; off hides it
    and touches no data.

## Later (the owner's build order, Q22)

- **Prices** (Q14–Q21): Price my shop, on a tap only, through Claude with web search: Sainsbury's
  with Nectar prices (the owner's shop and card) against Tesco (Clubcard), Asda, Aldi, Lidl and
  Morrisons, own-brand like for like at the nearest pack, per kg; each price ≈ and dated with its
  sources; a total says how many lines it priced ("9 of 10 priced"); the three biggest savings; in a
  third tab, Prices. It never changes the list. Settings → About says the list goes to Claude when
  Price my shop is tapped (Q23). Within the spend cap (Q19).
- **Ask Claude ≈** (Q24): Claude suggests foods to close the gap; each added line is ≈ and can be
  removed.

# Weekly shop and week planner — parked

November 2026. Two things were tried and neither is in the app.

1. **A shopping list from the owner's own food history** (built, shipped in build 163, removed the
   same week). The owner's words: "useless units and digits". It scaled what they already eat to
   the week's targets and listed packs by aisle. Do not rebuild it.
2. **A week planner** (concept only, parked by the owner): Claude finds a week of recipes online to
   the daily targets, the ingredients become a Sainsbury's list with prices and a total for the
   card (the owner shops there and has a Nectar card), and each planned meal is one tap to log.
   Parked because the owner does not cook to a plan: "I kind of just wing it on a daily basis".
   If it comes back: Sainsbury's has no public price feed and refuses a direct request from a
   server (tested, HTTP 403), so prices would be the phone asking sainsburys.co.uk itself with
   Claude's web search as the fallback, each price dated and marked ≈ when it is not live.

What the owner asked for instead is the diet check (docs/superpowers/specs/2026-11-18-diet-check-design.md).

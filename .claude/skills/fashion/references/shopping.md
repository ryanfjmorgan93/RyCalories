# Shopping Suggestions

When recommending a new item to buy, **always include a tested shopping link.**

## How to generate links (do this every time, not just when explicitly asked to search)

**If Chrome is available (Claude Code desktop or Cowork with Chrome extension):**
Use Chrome MCP to get a live, working URL:
1. Navigate to `https://www.zalando.de/search/?q=[search+term]` (replace spaces with `+`)
2. Wait for results to load — check at least 3 results are visible
3. If results look relevant → return the URL from the browser's address bar (this is the real, tested URL)
4. If results are sparse or off-target → refine the search term and try again
5. Return the URL you landed on, not a constructed one

For Amazon.de: same approach — navigate to `https://www.amazon.de/s?k=[search+term]`, verify results, return real URL.

**If Chrome is not available:**
Construct the URL as a best-effort fallback:
- Zalando: `https://www.zalando.de/search/?q=[search+term]`
- Amazon: `https://www.amazon.de/s?k=[search+term]`
- Add a note: *"⚠️ Link not verified — check it works"*

Never silently give a constructed URL and present it as tested. Be honest about which it is.

## Shopping suggestion format
```
🛍️ [Item name]
Brand: [Brand]
Why it works for you: [1-2 sentences specific to their body/style]
Size to look for: [check brand_sizes in profile first; if known → state it; if unknown → give general size + note "verify in-store"]
Price range: ~€[X]
→ Zalando: [tested link]
→ Amazon: [tested link if relevant]
```

Always give 2-3 alternatives at different price points when possible.

**Brand sizing:** Always check `brand_sizes` in profile.json before stating a size. If the brand isn't listed, use general measurements to estimate and add: *"You might want to check sizing in-store for this brand — add your size to your profile once you know it."* Update `brand_sizes` when the user confirms a fit.

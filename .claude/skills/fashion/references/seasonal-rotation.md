# Seasonal Rotation Alerts

Proactively prompt wardrobe rotation at season transitions — so the right items are at the front when the weather changes.

## When to trigger

At session start, check two things:
1. The current date against the city's season calendar (see `references/trends.md` for city-calibrated seasons)
2. `last_rotation_check` in profile.json

**Trigger a rotation prompt if:**
- The current season differs from the season recorded in `last_rotation_check`, AND
- `last_rotation_check` is either absent or more than 14 days old (prevents repeated nagging mid-season)

## Rotation prompt

Surface it naturally at session start, after any inbox check but before the user's main request:

*"Season check — it's [season] now in [city]. Want to do a quick wardrobe rotation? Takes 5 minutes: move [season] items to the front, store [outgoing season] items, and flag what's missing."*

If the user says yes → run the full rotation flow below.
If the user says no → update `last_rotation_check` to today so you don't ask again this season.

## Rotation flow

### Step 1: Front-of-wardrobe items (current season)
Read inventory.json. Filter items tagged with `"seasons"` containing the current season.

*"Your [season] pieces (move these to the front):"*
List them grouped by category: tops, bottoms, outerwear, shoes, accessories.

### Step 2: Store items (outgoing season)
Filter items whose `seasons` array contains the outgoing season but NOT the current season.

*"These can go into storage for now:"*
List them. Note: if any are multi-season (e.g. `["autumn", "winter"]`), keep them accessible.

### Step 3: Flag condition issues
For items going into storage: *"Before you store these — anything need dry cleaning, repairs, or refolding? Now's the time."*

For items coming out of storage: *"Anything from last [season] that needs attention — pilling, wear, repairs — before you start wearing it again?"*

### Step 4: Season gaps
Compare current-season items against typical occasion needs from profile.json:

For each key occasion the user has (from `occasions` in profile):
- What does [season] dressing for this occasion require?
- What do they have?
- What's missing?

Surface the top 3 gaps with Zalando links:
*"Biggest gaps for [city] [season]: [item] → [link]"*

### Step 5: Wishlist cross-check
Check `wishlist` for items tagged for the current season. Surface any high-priority ones:
*"You had [item] on your wishlist for [season] — still want it? [Zalando link]"*

### Step 6: Update state
After completing rotation:
- Update `last_rotation_check` in profile.json: `{"date": "[today]", "season": "[current season]"}`
- Update `seasons` tags on any items the user corrects during the review

## profile.json schema

```json
"last_rotation_check": {
  "date": "2026-03-02",
  "season": "spring"
}
```

## Season calendar quick reference (Berlin)
- Spring: March 1
- Summer: June 1  
- Autumn: September 1
- Winter: December 1

Adjust transition dates ±2 weeks based on actual weather if the user mentions it.

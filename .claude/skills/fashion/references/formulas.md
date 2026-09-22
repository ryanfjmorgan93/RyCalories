# Outfit Formula Auto-Detection

Outfit formulas are named, repeating item combinations the user has worn successfully. They capture what *actually works* — not theory, but history.

Detect them automatically from feedback.json. Surface them in outfit recommendations and the visual outfit builder sidebar.

## What counts as a formula

A formula forms when the same core item combination appears **3 or more times** in feedback.json with `sentiment` of `"confident"` or `"comfortable"`. Core combination = the 2–3 dominant items (usually: top + bottom, or jacket + top + shoe type). Accessories can vary.

## Auto-detection algorithm

Run this when:
- An outfit session starts (load feedback.json anyway → scan for free)
- A new feedback entry is logged (check if it crosses the 3× threshold)

```
For each feedback entry with sentiment in ["confident", "comfortable"]:
  - Extract core_items = items_worn sorted alphabetically
  - key = core_items joined by "||"
  - Increment counter[key]
  - Append compliments to compliments_map[key]
  - Append sentiment_scores (confident=1, comfortable=0.5) to scores_map[key]

For each key where counter[key] >= 3:
  - Compute wear_count, compliment_count, confidence_rate
  - Check if formula already exists in profile.json formulas array
  - If new: auto-name it (see naming below), add to profile.json
  - If existing: update stats
```

Store detected formulas in profile.json under `formulas`:
```json
"formulas": [
  {
    "id": "formula_001",
    "name": "Dark Office",
    "items": ["top_002", "bot_001", "sho_003"],
    "wear_count": 6,
    "compliment_count": 3,
    "confidence_rate": 0.83,
    "last_worn": "2026-05-10",
    "auto_named": true
  }
]
```

## Auto-naming rules

Name based on the dominant colors and occasion type from the associated feedback entries:

| Pattern | Formula name |
|---------|-------------|
| All dark items + professional occasions | "Dark Office" |
| All dark items + casual occasions | "Dark Casual" |
| Neutral/earth tones + professional | "Quiet Sharp" |
| Neutral/earth tones + casual | "Earth Easy" |
| One statement color item + professional | "Sharp [Color]" |
| All-black | "All Black" |
| Monochromatic any color | "[Color] Mono" |
| Blazer/jacket always present | "Jacket Formula" |

If no pattern matches clearly: name it "Formula [N]" (e.g. "Formula 1"). The user can rename at any time: *"Call this formula [name]"* → update `name` and set `auto_named: false`.

## Surfacing formulas

**In outfit recommendations:** When suggesting outfits, check if any recommended combination matches a stored formula. If it does:
- Lead with the formula name: *"This is your 'Dark Office' formula — you've worn it 6 times, all confident."*
- Show compliment count and confidence rate briefly

**In the visual outfit builder:** The sidebar "Formula" card (see `references/outfit-builder.md`) shows the formula name, stats, and a 1–2 sentence rationale. If no formula matches: show "One-off" and skip the stats row.

**When the user asks:** "What are my formulas?", "show my go-to outfits", "what always works?" → list all detected formulas with stats:

```
Your outfit formulas:

★ Dark Office — 6 wears, 3 compliments, 83% confident
  Items: Black turtleneck + Charcoal trousers + Derby shoes

★ Earth Easy — 4 wears, 1 compliment, 75% confident
  Items: Camel knit + Dark jeans + White sneakers
```

## When to tell the user

Don't announce every new formula silently. Mention it when:
- A formula just hit the 3× threshold: *"Interesting — you've worn [combination] 3 times now, always confident. I'm calling this your '[name]' formula."*
- They ask for outfit recommendations and the suggested outfit matches one
- They explicitly ask about their formulas

## Renaming and deleting

- *"Rename [formula] to [new name]"* → update `name`, set `auto_named: false`
- *"Delete [formula]"* → remove from `formulas` array in profile.json (the underlying feedback history remains)

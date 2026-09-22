# New Arrivals Alerts & Inbox

## New Arrivals Alerts

Monitor any brand's website for new drops. Works for Adidas, On, Suitsupply, Zalando, or any site — using a pre-filtered URL the user provides.

**Key design:** Runs as a local scheduled task (not remote CCR). This gives it access to the local data dir, so it can persist what it's already seen and only alert on genuinely new items. No more weekly noise when nothing changed.

### When to offer
- After onboarding Block 4 (trusted brands collected): *"You've got [Brand A], [Brand B] in your trusted brands. Want a weekly alert when they drop something new in your size?"*
- Or when user says "let me know when [brand] has new stuff", "watch [brand] for me", "new arrivals alert", "alert me for new [shoes/jackets/etc]"

### Setup flow

Ask these questions one at a time:

**1. Which brand and category?**
*"Which brand — and is there a specific category? E.g. Adidas shoes, On running gear, Suitsupply blazers."*

**2. Frequency?**
*"How often — weekly (Monday) or twice a week (Mon + Thu)?"*

**3. The filtered URL — this is the key step:**
*"Now the important part. Go to [brand]'s website, apply your filters — category, size, sort by Newest — then copy the URL and paste it here."*

Wait for the URL, then give this tip:

*"One more thing — if the site has a 'New this week' or 'Added in last 7 days' filter, apply that too before copying the URL. Sites like Zalando have it under Filters → New Arrivals. With that set, the page will only ever show recent drops, which means even faster scanning."*

After they paste the URL, store a `custom_alerts` entry in profile.json and set up the local task.

### How it works — local task with diff tracking

The alert runs as a local scheduled Claude task. On each run it:

1. Reads `monitoring_state.json` from the Fashion data dir — finds the `seen_ids` list for this alert (item name + price fingerprints seen on previous runs)
2. Opens the user-provided URL in Chrome
3. Reads all visible product names, prices, and URLs on page 1
4. Computes the diff: **new items = items not in `seen_ids`**
5. If new items found → sends a digest (iMessage or email) with only the new ones
6. If nothing new → sends nothing. Silence = no change
7. Updates `monitoring_state.json` with the current full item list

**First run:** No `seen_ids` exist yet. Send nothing — just capture the baseline and write it to state. Tell the user: *"Baseline captured for [brand]. I'll alert you when new items appear."*

### Task prompt template

When creating the scheduled task via `mcp__scheduled-tasks__create_scheduled_task`, use this prompt:

```
You are a new arrivals monitoring agent.

Alert config:
- Alert ID: [alert_id from profile.json]
- Brand/category: [brand + category label]
- URL: [exact URL user provided]
- State file: [FASHION_DATA_DIR]/monitoring_state.json
- Notify via: [iMessage to CONTACT / email to ADDRESS]

Run this exact sequence:

1. Read [FASHION_DATA_DIR]/monitoring_state.json
   - Find the entry for alert ID [alert_id]
   - Extract its `seen_ids` array (list of "name||price" strings)
   - If the file or entry doesn't exist: seen_ids = [] (first run)

2. Open [URL] in Chrome. Wait for products to fully load.
   Read all visible product cards on page 1: name, price, product URL.
   Build current_items as a list of {name, price, url} objects.
   Build current_ids as ["name||price", ...] for each item.

3. Compute new_items = items in current_items whose "name||price" is NOT in seen_ids.

4. If seen_ids was empty (first run):
   - Do NOT send any notification
   - Update monitoring_state.json (step 5)
   - Stop here

5. If new_items is not empty:

   a) Write new items to profile.json inbox:
      Read profile.json. Find or create the `new_arrivals_inbox` array.
      For each new item, append an entry:
      {
        "id": "inbox_[alert_id]_[YYYYMMDD]_[index]",
        "alert_id": "[alert_id]",
        "brand": "[brand label]",
        "category": "[category label]",
        "name": "[item name]",
        "price": [price as number],
        "url": "[item url]",
        "found_date": "[today ISO date]",
        "status": "new"
      }
      Write profile.json back.

   b) Send notification to [CONTACT/ADDRESS]:

      "🆕 New at [Brand] ([category]) — [today's date]

      [for each new item: • [name] — €[price] → [url]]

      [if more than 8 new items: show first 8 then '+ N more → [base url]']

      Saved to your fashion inbox for next session."

   If new_items is empty: send nothing.

6. Update monitoring_state.json:
   Read the file again, find or create the entry for [alert_id],
   set its `seen_ids` to current_ids, set `last_run` to today's ISO date,
   set `last_new_count` to the number of new items found (0 if none).
   Write the file back.
```

### Creating the scheduled task

Use `mcp__scheduled-tasks__create_scheduled_task` with:
- **name**: `fashion-alert-[alert_id]` (e.g. `fashion-alert-alert_001`)
- **schedule**: 
  - Weekly Monday: `0 9 * * 1` (9am local time)
  - Twice weekly: `0 9 * * 1,4`
- **prompt**: the filled-in template above

After creating the task, save the task ID to the `custom_alerts` entry in profile.json as `task_id`.

### monitoring_state.json schema

Lives at `[FASHION_DATA_DIR]/monitoring_state.json`. Created automatically on first run.

```json
{
  "alerts": {
    "alert_001": {
      "seen_ids": [
        "Ultraboost 25||180",
        "Samba OG||100",
        "Forum Low||90"
      ],
      "last_run": "2026-04-28",
      "last_new_count": 2
    }
  }
}
```

### profile.json schema for custom alerts

```json
"custom_alerts": [
  {
    "id": "alert_001",
    "brand": "Adidas",
    "category": "shoes size 49",
    "url": "https://www.adidas.de/schuhe?sz=49&sortBy=newest",
    "frequency": "weekly",
    "contact": "[user contact or email]",
    "task_id": "[scheduled task ID once created]",
    "created_date": "2026-04-29",
    "enabled": true
  }
]
```

### Managing alerts
- *"Show my alerts"* → list all `custom_alerts` entries with brand, frequency, last run, last new count (from monitoring_state.json)
- *"Pause [brand] alert"* → set `enabled: false` in profile.json, disable the task via `mcp__scheduled-tasks__update_scheduled_task`
- *"Add another alert"* → run setup flow again, append new entry to `custom_alerts`, create new task
- *"Change [brand] URL"* → update `url` in profile.json, recreate the scheduled task with the new URL
- *"Reset [brand] baseline"* → delete the alert's entry from `monitoring_state.json` — next run re-baselines

---

## New Arrivals Inbox

The inbox (`new_arrivals_inbox` in profile.json) is the staging area between monitoring alerts and the wishlist. Items land here when the monitoring agent finds something new. The user reviews them in the next session and decides what to do with each.

### Inbox review flow

Triggered at session start when `status: "new"` items exist, or when user says "show my inbox", "what's new", "any new drops".

Present items grouped by brand, one at a time:

```
🆕 New drop from Adidas (shoes) — found Mon 28 Apr

Ultraboost 25 · €180
→ https://adidas.de/...

Wishlist it, buy it, or skip?
```

For each item, wait for the user's response:

| User says | Action |
|-----------|--------|
| "wishlist" / "save it" / "maybe" | Add to wishlist array in profile.json (see Wishlist section). Set inbox status → `"wishlisted"` |
| "buy it" / "I want this" | Add to wishlist with `priority: "buy_now"`. Set inbox status → `"wishlisted"`. Offer to do a pre-purchase check. |
| "skip" / "no" / "not for me" | Set inbox status → `"dismissed"` |
| "show me more" / "tell me about it" | Pull any detail you know about the item (model info, how it fits the user's profile, wardrobe pairings), then ask again |

After going through all items: *"All done — [N] wishlisted, [N] skipped."*

### profile.json inbox schema

```json
"new_arrivals_inbox": [
  {
    "id": "inbox_alert_001_20260428_0",
    "alert_id": "alert_001",
    "brand": "Adidas",
    "category": "shoes size 49",
    "name": "Ultraboost 25",
    "price": 180,
    "url": "https://www.adidas.de/ultraboost-25/...",
    "found_date": "2026-04-28",
    "status": "new"
  }
]
```

`status` values: `"new"` → `"wishlisted"` | `"dismissed"`

### Inbox commands
- *"Show my inbox"* / *"what's new"* → run inbox review flow for all `status: "new"` items
- *"Clear inbox"* → set all items to `"dismissed"`, confirm count first
- *"What did I skip from Adidas?"* → list `status: "dismissed"` items filtered by brand

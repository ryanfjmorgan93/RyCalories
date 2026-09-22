# Zalando Wishlist Price Monitoring

Monitor wishlist items for price drops. Runs as a **local scheduled task** with diff tracking — same pattern as new arrivals alerts.

## When to offer
When a high-priority item is added to the wishlist, ask once:
*"Want me to set up a price alert for this on Zalando? I'll check weekly and message you if the price drops."*

- **Yes** → follow setup below
- **No / later** → skip, store `price_alert: false` on that wishlist item

## Setup

Ask for the direct Zalando product URL (not a search URL — the actual product page). If they don't have it:
- Navigate to Zalando in Chrome, find the item, copy the URL

Store on the wishlist item:
```json
{
  "price_alert": true,
  "price_alert_target": "€[X]",
  "price_alert_url": "https://www.zalando.de/...",
  "price_alert_task_id": "[task ID once created]"
}
```

## How it works — local task with diff tracking

The alert runs as a local scheduled Claude task. On each run it:

1. Reads `monitoring_state.json` — finds the `last_price` for this wishlist item ID
2. Opens the Zalando product URL in Chrome
3. Reads the current price shown on the page
4. Compares to `last_price`:
   - If price dropped more than 15%: send notification
   - If price unchanged or up: send nothing
5. Updates `monitoring_state.json` with the current price and run date

### monitoring_state.json schema (price alerts)

```json
{
  "price_alerts": {
    "wish_001": {
      "last_price": 129,
      "target_price": 100,
      "last_run": "2026-05-05",
      "last_notified": null
    }
  }
}
```

## Task prompt template

Use `mcp__scheduled-tasks__create_scheduled_task` with:
- **name**: `fashion-price-[wish_id]` (e.g. `fashion-price-wish_001`)
- **schedule**: `0 10 * * 1` (Monday 10am)
- **prompt**:

```
You are a Zalando price monitoring agent.

Config:
- Wishlist item ID: [wish_id]
- Item: [item name]
- URL: [product URL]
- Target price: €[target]
- State file: [FASHION_DATA_DIR]/monitoring_state.json
- Notify via: [iMessage to CONTACT / email to ADDRESS]

Run this sequence:

1. Read monitoring_state.json → find price_alerts.[wish_id] → get last_price and last_notified.

2. Open [URL] in Chrome. Read the current price displayed.

3. If last_price is null (first run):
   - Save current price as last_price in monitoring_state.json. Stop — no notification.

4. If current_price <= target_price AND last_notified is not today's date:
   - Send notification:
     "💰 Price drop: [item name] is now €[current_price] on Zalando (target: €[target]).
     → [URL]"
   - Update monitoring_state.json: set last_price = current_price, last_notified = today.

5. Otherwise: update last_price silently, no notification.
```

## Disabling an alert
User says "stop the alert for [item]" → set `price_alert: false` on that wishlist item and disable the task via `mcp__scheduled-tasks__update_scheduled_task`.

## Managing price alerts
- *"Show my price alerts"* → list all wishlist items where `price_alert: true`, with last known price from monitoring_state.json
- *"Add price alert for [item]"* → run setup flow for that wishlist item
- *"Stop all price alerts"* → disable all price alert tasks, set `price_alert: false` on all wishlist items

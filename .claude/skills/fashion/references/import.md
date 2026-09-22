# Purchase Import via Chrome

When the user says "import my purchases", "sync my Zalando orders", "I just ordered a bunch of stuff", or similar — use Chrome to pull their order history and walk through items one by one.

**Requires:** Claude Code desktop app or Claude Cowork with Chrome access. If Chrome tools are unavailable, tell the user and offer to add items manually instead.

## Step 1: Identify the store
Ask which store(s) to import from if not specified. Primary targets:
- **Zalando.de** — order history at `https://www.zalando.de/myaccount/orders`
- **Amazon.de** — order history at `https://www.amazon.de/gp/css/order-history`
- Other stores the user mentions

## Step 2: Navigate to order history
Use Chrome to open the order history page. The user must already be logged in — do not attempt to log in on their behalf.

If not logged in: *"I can see you're not logged into Zalando — can you log in and I'll wait here? Then I'll import your orders."*

## Step 3: Extract orders
Read the page content and extract:
- Item name / title
- Brand (if shown)
- Color / variant
- Order date
- Price paid
- Thumbnail image (if accessible)

Navigate to additional pages if there are multiple pages of orders. Ask the user how far back to go: *"I can see orders going back to [date]. How far back should I import — last 3 months? Last year? Everything?"*

## Step 4: Walk through items for confirmation
Present each item one at a time — do NOT bulk-add without confirmation. For each:

```
📦 Found: [Item name]
Brand: [Brand if known]
Color: [Color]
Ordered: [Date]
Price paid: €[X]

Is this still in your wardrobe?
→ Yes — add to inventory
→ No — skip (returned or donated)
→ Not sure — skip for now
```

After the user responds, immediately write confirmed items to inventory.json using the Photo Identification Protocol (attempt to identify exact model from the name, ask to confirm if uncertain). Skipped items are not logged.

## Step 5: Summary
After going through all items, summarize: *"Done — I added [N] items to your wardrobe. Skipped [N]. Want me to do a quick assessment of what you now have and what's missing?"*

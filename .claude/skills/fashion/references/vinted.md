# Sell / Resell on Vinted

When the wardrobe audit flags items as low-rotation or unworn, or when the user says "I want to sell this" / "list this on Vinted":

**Use the vinted-client CLI** at https://github.com/googlarz/vinted-client to post listings directly — no manual copy-pasting. Check if it's installed first: `vinted-client --version`. If missing, tell the user: *"Install it with: `pip install git+https://github.com/googlarz/vinted-client`"*

## Listing flow

1. Generate the listing data from the inventory entry (see format below)
2. Post via CLI: `vinted-client post --title "..." --description "..." --price X --category "..." --size "..." --brand "..." --condition "..."`
3. Confirm success, then remove the item from inventory.json

If the CLI isn't available or the user prefers manual: fall back to producing the ready-to-paste text and linking to https://www.vinted.de/sell.

## Listing data format
From the inventory entry:

```
Title:       [Brand] [Item name] [Color] [Size] — [1-word condition]
Description: [Brand] [specific model if known]. [Color]. Size [X].
             Condition: [Excellent / Good / Used]
             [1 sentence: fabric, fit, notable detail]
             [Honest note if relevant: "minor pilling on cuffs", "worn ~5×, no damage"]
Category:    [Vinted category]
Size:        [EU/DE size]
Brand:       [Brand]
Condition:   [Vinted condition tier]
Price:       ~€[X]
```

## Pricing guidance
Base on original price, condition, and brand tier:
- **Premium brands** (Arc'teryx, Stone Island, etc.): 50–70% of original if good condition
- **Mid-range** (Uniqlo, COS, Arket): 25–40% of original
- **High street** (Zara, H&M): 10–20% of original — only worth listing if nearly new
- Reduce 10–15% for each condition tier below "excellent"

## Batch sell session
When audit surfaces multiple items: *"You have [N] items flagged for potential sale. Want me to generate and post Vinted listings for all of them in one go?"*
Go through each, confirm listing data with user, post via CLI, then move to next.

After posting: remove items from inventory.json once confirmed listed (not when they sell — the item is gone from active wardrobe when listed).

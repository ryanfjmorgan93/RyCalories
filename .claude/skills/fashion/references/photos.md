# Photo Workflow

Photos of actual clothing items make the visual outfit builder real — replacing SVG placeholders with genuine images. This file documents the full capture → store → render loop.

## Storing photos

When the user shares a photo of an item:
1. Run the Photo Identification Protocol (confirm item, log to inventory)
2. Ask: *"Want me to save this photo to your wardrobe? I'll link it to [item name] so it shows in the outfit builder."*
3. If yes → save the image file to `FASHION_DATA_DIR/photos/[item_id].[ext]` and add `"photo_path": "photos/[item_id].[ext]"` to the inventory entry

The path stored in inventory.json is relative to FASHION_DATA_DIR so it stays portable.

```json
{
  "id": "top_001",
  "name": "Merino Turtleneck",
  "brand": "Uniqlo",
  "color": "black",
  "photo_path": "photos/top_001.jpg"
}
```

## Batch photo session

When the user wants to photograph multiple items at once:

*"Go through your wardrobe and send photos one by one. I'll match each to an inventory item, confirm it, and link the photo. No need to describe them — just send."*

For each photo:
1. Identify → match to existing inventory item OR create new entry
2. *"This is [item name] — linking photo. Next."*
3. Save and move on immediately

End with: *"Done — [N] photos linked. [M] items still without photos."*

## Rendering in the outfit builder

In the outfit builder HTML (see `references/outfit-builder.md`), for each garment slot:
- If `photo_path` exists in inventory for that item: render `<img src="[FASHION_DATA_DIR/photo_path]" alt="[item name]">` instead of the SVG
- If no photo: show SVG placeholder with "tap to add photo" hint

The `garment-img` div already has `overflow: hidden` and `object-fit: cover` on the img — photos will fill the slot cleanly without distortion.

## "Tap to add photo" — future interaction

The "tap to add photo" hint in the outfit builder is forward-looking UI. When the user clicks a slot and says they want to add a photo:
1. Ask them to send the photo in the chat
2. Confirm the item match
3. Save to `photos/` dir, update inventory.json
4. Regenerate the outfit builder artifact with the photo now rendered

## Photo naming convention

```
photos/[item_id].[ext]
```

Examples: `photos/top_001.jpg`, `photos/sho_003.png`, `photos/acc_002.webp`

If an item gets multiple photos (e.g. front and detail shot), use: `photos/[item_id]_[n].[ext]` — store the primary one in `photo_path` and add `photo_paths: ["photos/top_001.jpg", "photos/top_001_detail.jpg"]` for extras.

## What to do if FASHION_DATA_DIR is cloud-synced

ProtonDrive and iCloud paths work fine — photos save locally and sync automatically. No special handling needed. Just make sure the path in inventory.json matches wherever the files actually land.

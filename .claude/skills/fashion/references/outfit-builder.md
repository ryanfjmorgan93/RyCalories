# Visual Outfit Builder

When the user says "show me this outfit", "build this outfit", "visualize outfit", "outfit builder", "flat lay", or "show me what it looks like" — generate an HTML artifact showing a flat-lay outfit visualization.

This is most useful after recommending an outfit: instead of just listing items, render them visually so the user can see the full look at a glance.

## When to offer it

After delivering an outfit recommendation (especially high-stakes ones: client meeting, date, travel), add at the end:
*"Want me to render a visual flat lay so you can see the full look?"*

If the user says yes, or directly asks for a visual, generate the artifact below.

## What to populate from data

- **Occasion**: from the user's request or calendar event
- **Formula / stats**: check feedback.json for previous wears of this item combination (see `references/formulas.md` for named formula detection)
- **Body reasoning** (sidebar "Why it works"): derive 3–4 notes from profile.json — body proportions, color system, collar type, shoulder width. Each note is specific to them, not generic styling advice
- **Compliments**: pull any matching entries from feedback.json
- **Gaps**: items in the recommended outfit that aren't in inventory.json, or items flagged with known issues (e.g., "needs tailor")
- **Match %**: rough score based on: color system alignment, occasion appropriateness, body proportions — state what it's based on in the label
- **Photos**: if an inventory item has a `photo_path` field, render it as an `<img>` tag inside the garment slot; otherwise show the SVG placeholder with "tap to add photo" hint. See `references/photos.md` for the photo capture workflow.

## HTML structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Outfit Visual Builder</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f5f4f1; color: #1a1a1a; min-height: 100vh; padding: 32px 24px; }
  .header { margin-bottom: 28px; }
  .label { font-size: 10px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: #aaa; margin-bottom: 6px; }
  .occasion { font-size: 28px; font-weight: 300; color: #111; margin-bottom: 10px; }
  .meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .badge { font-size: 11px; padding: 4px 11px; border-radius: 20px; font-weight: 500; }
  .badge-formula { background: #e8f0e8; color: #2d6e2d; border: 1px solid #c0dcc0; }
  .badge-weather { background: #e8eef8; color: #2a4a8a; border: 1px solid #b8ccee; }
  .badge-worn    { background: #f0f0ee; color: #888; border: 1px solid #ddd; }
  .layout { display: grid; grid-template-columns: 1fr 320px; gap: 20px; align-items: start; }
  .flatlay { background: #fff; border-radius: 16px; padding: 28px; border: 1px solid #e8e8e4; min-height: 480px; display: flex; flex-direction: column; }
  .flatlay-title { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #bbb; margin-bottom: 24px; }
  .garment-row { display: flex; gap: 14px; justify-content: center; margin-bottom: 12px; }
  .garment { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; max-width: 150px; }
  .garment-img { width: 100%; aspect-ratio: 3/4; border-radius: 10px; border: 1.5px dashed #ddd; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 5px; cursor: pointer; transition: border-color 0.2s, background 0.2s; background: #fafafa; }
  .garment-img:hover { border-color: #aaa; background: #f5f5f5; }
  .garment-img img { width: 100%; height: 100%; object-fit: cover; border-radius: 9px; }
  .photo-hint { font-size: 9px; color: #ccc; text-align: center; letter-spacing: 0.06em; }
  .garment-img svg { opacity: 0.18; }
  .garment-name  { font-size: 12px; color: #333; text-align: center; font-weight: 500; line-height: 1.3; }
  .garment-brand { font-size: 10px; color: #bbb; text-align: center; }
  .connector { display: flex; justify-content: center; height: 14px; margin-bottom: 2px; }
  .connector::before { content: ''; width: 1px; height: 100%; background: #e8e8e8; }
  .match-bar { height: 3px; background: #f0f0ee; border-radius: 2px; margin-top: auto; padding-top: 20px; }
  .match-bar-inner { height: 3px; background: linear-gradient(90deg, #8bcf8b, #2d9e2d); border-radius: 2px; }
  .match-label { font-size: 10px; color: #ccc; margin-top: 6px; text-align: right; }
  .sidebar { display: flex; flex-direction: column; gap: 12px; }
  .card { background: #fff; border: 1px solid #e8e8e4; border-radius: 12px; padding: 16px 18px; }
  .card-title { font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #bbb; margin-bottom: 12px; }
  .formula-name { font-size: 15px; font-weight: 600; color: #111; margin-bottom: 4px; }
  .formula-sub  { font-size: 12px; color: #999; margin-bottom: 14px; line-height: 1.5; }
  .stats-row { display: flex; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
  .stat { flex: 1; padding: 10px 6px; text-align: center; border-right: 1px solid #eee; }
  .stat:last-child { border-right: none; }
  .stat-n { font-size: 18px; font-weight: 300; color: #222; }
  .stat-l { font-size: 9px; color: #bbb; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 2px; }
  .note { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f4f4f2; align-items: flex-start; }
  .note:last-child { border-bottom: none; padding-bottom: 0; }
  .note-icon { font-size: 12px; flex-shrink: 0; margin-top: 2px; color: #999; }
  .note-text { font-size: 12px; color: #777; line-height: 1.5; }
  .note-text strong { color: #333; font-weight: 500; }
  .compliment { font-size: 12px; color: #888; padding: 7px 0; border-bottom: 1px solid #f4f4f2; line-height: 1.5; }
  .compliment:last-child { border-bottom: none; }
  .compliment-what { color: #333; font-weight: 500; }
  .gap-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #f4f4f2; }
  .gap-item:last-child { border-bottom: none; }
  .gap-text { font-size: 12px; color: #999; }
  .gap-link { font-size: 11px; color: #2a5aaa; text-decoration: none; border: 1px solid #c0d0ee; padding: 2px 9px; border-radius: 6px; background: #f0f4fc; }
  .actions { display: flex; gap: 8px; }
  .btn { flex: 1; padding: 11px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: center; border: none; }
  .btn-primary   { background: #2d6e2d; color: #fff; }
  .btn-secondary { background: #f0f0ee; color: #666; border: 1px solid #e0e0dc; }
  @media (max-width: 680px) { .layout { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<div class="header">
  <div class="label">Outfit Visual Builder</div>
  <div class="occasion">[Occasion name]</div>
  <div class="meta">
    <span class="badge badge-formula">★ [Formula name or "One-off"]</span>
    <span class="badge badge-weather">☁ [temp]°C · [City]</span>
    <span class="badge badge-worn">Worn [N]× · Last: [timeframe or "never"]</span>
  </div>
</div>

<div class="layout">

  <div class="flatlay">
    <div class="flatlay-title">Flat lay · all items from wardrobe</div>

    <!-- ROW 1: top layer (blazer/jacket + shirt side by side) -->
    <div class="garment-row">
      <div class="garment">
        <div class="garment-img">
          <!-- If item has photo_path: <img src="[photo_path]" alt="[item name]"> -->
          <!-- Otherwise: SVG placeholder -->
          <svg width="40" height="40" viewBox="0 0 44 44" fill="none"><path d="M8 6 L16 4 L22 10 L28 4 L36 6 L40 38 L4 38 Z" stroke="#888" stroke-width="1.5" fill="none"/><path d="M16 4 L22 22 L28 4" stroke="#888" stroke-width="1.5" fill="none"/></svg>
          <span class="photo-hint">tap to add photo</span>
        </div>
        <div class="garment-name">[Item name]</div>
        <div class="garment-brand">[Color] · [ID or note]</div>
      </div>
      <div class="garment">
        <div class="garment-img">
          <svg width="40" height="40" viewBox="0 0 44 44" fill="none"><path d="M10 6 L18 4 L22 9 L26 4 L34 6 L38 16 L30 16 L30 40 L14 40 L14 16 L6 16 Z" stroke="#888" stroke-width="1.5" fill="none"/></svg>
          <span class="photo-hint">tap to add photo</span>
        </div>
        <div class="garment-name">[Item name]</div>
        <div class="garment-brand">[Color] · [note]</div>
      </div>
    </div>

    <div class="connector"></div>

    <!-- ROW 2: trousers (centered) -->
    <div class="garment-row">
      <div class="garment" style="max-width:110px">
        <div class="garment-img" style="aspect-ratio:2/4">
          <svg width="30" height="40" viewBox="0 0 32 44" fill="none"><path d="M4 4 L28 4 L26 26 L20 44 L12 44 L6 26 Z" stroke="#888" stroke-width="1.5" fill="none"/><line x1="16" y1="4" x2="16" y2="28" stroke="#888" stroke-width="1.5"/></svg>
          <span class="photo-hint">tap to add photo</span>
        </div>
        <div class="garment-name">[Item name]</div>
        <div class="garment-brand">[Color] · [ID]</div>
      </div>
    </div>

    <div class="connector"></div>

    <!-- ROW 3: shoes + watch (or other accessories) -->
    <div class="garment-row">
      <div class="garment">
        <div class="garment-img" style="aspect-ratio:5/3">
          <svg width="52" height="26" viewBox="0 0 56 28" fill="none"><path d="M4 22 C4 22 6 8 16 6 L38 6 C46 6 52 12 52 18 L52 22 L28 24 Z" stroke="#888" stroke-width="1.5" fill="none"/><path d="M16 6 L14 24" stroke="#888" stroke-width="1"/></svg>
          <span class="photo-hint">tap to add photo</span>
        </div>
        <div class="garment-name">[Shoe name]</div>
        <div class="garment-brand">[Color] · size [N]</div>
      </div>
      <div class="garment">
        <div class="garment-img" style="aspect-ratio:1/1; max-height:80px">
          <svg width="34" height="34" viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="12" stroke="#888" stroke-width="1.5"/><circle cx="18" cy="18" r="8" stroke="#ccc" stroke-width="1"/><line x1="18" y1="12" x2="18" y2="18" stroke="#999" stroke-width="1.5" stroke-linecap="round"/><line x1="18" y1="18" x2="23" y2="18" stroke="#aaa" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="photo-hint">tap to add photo</span>
        </div>
        <div class="garment-name">[Watch name]</div>
        <div class="garment-brand">[Strap/bracelet] · [wrist]</div>
      </div>
    </div>

    <div class="match-bar"><div class="match-bar-inner" style="width:[N]%"></div></div>
    <div class="match-label">[N]% match · [what factors: body + color system + occasion]</div>
  </div>

  <div class="sidebar">

    <!-- Formula card: only if this outfit has been worn before or matches a named formula -->
    <div class="card">
      <div class="card-title">Formula</div>
      <div class="formula-name">[Formula name or occasion type]</div>
      <div class="formula-sub">[1–2 sentences: why this works for them specifically]</div>
      <div class="stats-row">
        <div class="stat"><div class="stat-n">[N]×</div><div class="stat-l">Worn</div></div>
        <div class="stat"><div class="stat-n">[N]</div><div class="stat-l">Compliments</div></div>
        <div class="stat"><div class="stat-n">[N]%</div><div class="stat-l">Confident</div></div>
      </div>
    </div>

    <!-- Body reasoning card: always include -->
    <div class="card">
      <div class="card-title">Why it works · your body</div>
      <!-- 3-4 notes derived from profile: vertical line, shoulders, color system, neck/collar, etc. -->
      <div class="note">
        <span class="note-icon">↕</span>
        <div class="note-text"><strong>[Principle]:</strong> [Explanation tied to their body specifically]</div>
      </div>
    </div>

    <!-- Compliments: only if feedback.json has entries for this outfit -->
    <div class="card">
      <div class="card-title">Feedback · compliments</div>
      <div class="compliment"><span class="compliment-what">[Item or overall]</span> — "[quote]" — [who], [date]</div>
    </div>

    <!-- Gaps: items in outfit not yet in inventory, or with known issues -->
    <div class="card">
      <div class="card-title">Gaps in this outfit</div>
      <div class="gap-item">
        <div class="gap-text">⚠ [gap description]</div>
        <a href="[action url or #]" class="gap-link">[action label]</a>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary">✓ Log I wore this</button>
      <button class="btn btn-secondary">↺ Variation</button>
    </div>

  </div>
</div>

</body>
</html>
```

## SVG silhouettes reference

Use these inline SVGs for garment placeholders. Scale/adjust `aspect-ratio` per garment type:
- Blazer/jacket: `aspect-ratio:3/4`
- Shirt/t-shirt: `aspect-ratio:3/4`
- Trousers: `aspect-ratio:2/4`, `max-width:110px`
- Shoes: `aspect-ratio:5/3`
- Watch/accessory: `aspect-ratio:1/1`, `max-height:80px`

Omit garment rows that don't apply. Add extra rows for coats, bags, or other accessories as needed.

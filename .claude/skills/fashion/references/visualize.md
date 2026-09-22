# Wardrobe Visualization

When the user says "show my wardrobe", "visualize my wardrobe", "wardrobe view", or "what do I have":

Generate an HTML artifact showing the full inventory as a visual grid. Use Claude's artifact system to render it inline.

## HTML structure
```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e8e8e8; padding: 24px; }
  h1 { font-size: 14px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin-bottom: 24px; }
  .category { margin-bottom: 32px; }
  .category-title { font-size: 11px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: #555; margin-bottom: 12px; border-bottom: 1px solid #222; padding-bottom: 6px; }
  .items { display: flex; flex-wrap: wrap; gap: 10px; }
  .item { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px 14px; min-width: 160px; max-width: 200px; cursor: default; transition: border-color 0.15s; }
  .item:hover { border-color: #444; }
  .item-name { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
  .item-brand { font-size: 11px; color: #666; margin-bottom: 8px; }
  .item-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .color-dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid #333; flex-shrink: 0; }
  .tag { font-size: 10px; background: #222; color: #888; padding: 2px 7px; border-radius: 10px; }
  .tag.gap { background: #1a0f0f; color: #c44; border: 1px solid #3a1a1a; }
  .stats { display: flex; gap: 24px; margin-bottom: 32px; }
  .stat { }
  .stat-num { font-size: 28px; font-weight: 300; }
  .stat-label { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.1em; }
</style>
</head>
<body>
<h1>Wardrobe</h1>
<div class="stats">
  <div class="stat"><div class="stat-num">[TOTAL]</div><div class="stat-label">Items</div></div>
  <div class="stat"><div class="stat-num">[CATEGORIES]</div><div class="stat-label">Categories</div></div>
  <div class="stat"><div class="stat-num">[GAPS]</div><div class="stat-label">Key gaps</div></div>
</div>
<!-- repeat per category: -->
<div class="category">
  <div class="category-title">[Category name] · [N]</div>
  <div class="items">
    <!-- repeat per item: -->
    <div class="item">
      <div class="item-name">[Item name]</div>
      <div class="item-brand">[Brand] · [Size]</div>
      <div class="item-meta">
        <div class="color-dot" style="background:[CSS color for item color]"></div>
        <span class="tag">[season]</span>
        <span class="tag">[occasion]</span>
      </div>
    </div>
  </div>
</div>
</body>
</html>
```

## Color mapping
Convert inventory color names to CSS hex:
`black → #111`, `white → #f5f5f5`, `navy → #1a2744`, `grey → #888`, `charcoal → #333`, `brown → #6b4226`, `beige → #d4b896`, `olive → #6b7c3f`, `burgundy → #7c1f2e`, `camel → #c19a6b`

Polish color names: `czarny/czarna → #111`, `granatowy → #1a2744`, `szary → #888`, `beżowy → #d4b896`, `brązowy → #6b4226`

## After rendering
Below the artifact, surface the top 3 gaps: *"Biggest missing pieces: [item] → [Zalando link]"*

If wishlist has items, ask: *"Want me to add your wishlist items as ghost cards too?"* — render them with a dashed border and slightly dimmed.

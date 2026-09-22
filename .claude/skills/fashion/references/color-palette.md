# Color Palette Visual

When the user says "show my color palette", "what colors work for me", "my color system", or "palette":

Generate an HTML artifact showing their personal color system derived from profile.json (`color_system` field — e.g. Cool Winter, Warm Autumn, True Summer, etc.).

## HTML structure

```html
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e8e8e8; padding: 32px; max-width: 680px; }
  h1 { font-size: 13px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: #555; margin-bottom: 4px; }
  h2 { font-size: 22px; font-weight: 300; margin: 0 0 8px; }
  .subtitle { font-size: 13px; color: #666; margin-bottom: 32px; line-height: 1.5; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #444; margin-bottom: 12px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
  .swatch { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .swatch-color { width: 56px; height: 56px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.08); }
  .swatch-name { font-size: 10px; color: #555; text-align: center; max-width: 64px; line-height: 1.3; }
  .avoid { opacity: 0.4; position: relative; }
  .avoid .swatch-color { filter: grayscale(0.3); }
  .avoid::after { content: "✕"; position: absolute; top: 16px; font-size: 18px; color: #c44; }
  .rule { font-size: 13px; color: #888; padding: 8px 0; border-bottom: 1px solid #1e1e1e; line-height: 1.5; }
  .rule:last-child { border: none; }
  .rule strong { color: #ccc; }
</style>
</head>
<body>
<h1>Color System</h1>
<h2>[Color System Name]</h2>
<p class="subtitle">[2-sentence description of what this color system means — undertones, contrast level, seasonal character]</p>

<div class="section">
  <div class="section-title">Your best colors</div>
  <div class="swatches">
    <!-- 8-10 swatches: name + hex for this color system's core palette -->
    <div class="swatch"><div class="swatch-color" style="background:#[hex]"></div><div class="swatch-name">[name]</div></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Accent & statement</div>
  <div class="swatches">
    <!-- 3-4 swatches: bolder colors that work as accent for this system -->
  </div>
</div>

<div class="section">
  <div class="section-title">Avoid</div>
  <div class="swatches">
    <!-- 3-4 swatches: colors that clash with this system, shown dimmed with ✕ -->
    <div class="swatch avoid"><div class="swatch-color" style="background:#[hex]"></div><div class="swatch-name">[name]</div></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Rules for you</div>
  <div class="rule"><strong>Contrast:</strong> [high/medium/low contrast — what it means for outfit combinations]</div>
  <div class="rule"><strong>Metals:</strong> [silver vs gold — which works]</div>
  <div class="rule"><strong>Prints:</strong> [what print styles work — geometric, graphic, none, etc.]</div>
  <div class="rule"><strong>Denim:</strong> [which wash — dark, medium, avoid raw, etc.]</div>
  <div class="rule"><strong>White vs cream:</strong> [which version works better against their skin]</div>
</div>
</body>
</html>
```

## Color system palettes

Use these as your base — adapt hex values to the specific variant the user has:

**Cool Winter:** Navy `#1a2744`, black `#111`, pure white `#f5f5f5`, charcoal `#333`, burgundy `#7c1f2e`, royal blue `#2346a0`, forest `#1a3a2a`, cool grey `#8a9aaa`, icy pink `#d4b8c4`. Avoid: orange, warm brown, mustard, olive.

**Warm Autumn:** Camel `#c19a6b`, burnt orange `#b85c2a`, olive `#6b7c3f`, rust `#a0472a`, chocolate `#4a2a1a`, gold `#c8a84b`, cream `#f0e8d0`, forest `#2a3a1a`, terracotta `#c4613a`. Avoid: black, icy pastels, cool grey, silver.

**True Summer:** Dusty rose `#c4929a`, soft lavender `#9a8ab4`, soft blue `#6a8ab4`, mauve `#a47a8a`, grey-blue `#6a7a8a`, powder pink `#d4aab4`, off-white `#f0ece8`. Avoid: black, orange, bright yellow, rust.

**Bright Spring:** Coral `#e86040`, warm turquoise `#2ab4a0`, golden yellow `#e8c030`, bright white `#ffffff`, warm green `#4ab040`, peach `#f09070`. Avoid: dusty/muted tones, black, brown.

**True Autumn:** Rust `#b84820`, camel `#c09050`, warm brown `#7a4a20`, olive `#788040`, gold `#c8a040`, cream `#f0e4c0`, brick `#b04030`. Avoid: black, icy tones, silver, cool grey.

Fill in other systems from your training knowledge. Always derive the palette from the user's profile — never invent a system they weren't assigned.

## After rendering
Below the artifact: *"This is your palette. Every item in your wardrobe that falls outside it is a potential friction point — want me to flag which ones?"*

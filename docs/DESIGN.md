# Iron — visual system (Phase 3B)

Handoff for the owner's Claude Design pass. Every value below lives in `src/index.css` as a
custom property, dark on `:root` and light on `[data-theme='light']`, re-exported through
`@theme inline` where a Tailwind utility class is useful. Retune a value in one of the two theme
blocks and every screen picks it up — nothing below is hard-coded in a component. The one
exception is `--timer-h`, owned by the rest-timer work landing alongside this phase.

The source of truth for the actual numbers is `src/index.css` itself; treat the tables below as a
map of what exists and why, not a copy to trust over the file if the two ever disagree.

## 1. Token contract

### Colour — page and text

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--c-bg` | `#0b0b0d` | `#f5f5f7` | Page background (`bg-bg`) |
| `--c-surface` | `#151518` | `#ffffff` | Opaque surfaces: Sheet body, `NumberField`'s outer wrap on some screens (`bg-surface`) |
| `--c-surface-2` | `#1f1f24` | `#ececf0` | Inputs, chips, inset rows (`bg-surface-2`) |
| `--c-line` | `#2b2b33` | `#d8d8de` | Hairline borders, dividers (`border-line`) |
| `--c-fg` | `#f4f4f5` | `#131316` | Primary text (`text-fg`) |
| `--c-muted` | `#9a9aa4` | `#5d5d68` | Secondary text (`text-muted`) |
| `--c-dim` | `#8a8a94` | `#6a6a73` | Tertiary text/placeholders (`text-dim`). Tuned so it never drops below 4.5:1 against bg, surface or a glass tile — see §7 |

### Colour — state

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--c-accent` / `--c-accent-fg` | `#ff8a2a` / `#140a02` | `#b84508` / `#ffffff` | Primary actions, the live/ember identity |
| `--c-ok` / `--c-ok-fg` | `#4ade80` / `#03210e` | `#15803d` / `#ffffff` | Success, increases |
| `--c-warn` | `#fbbf24` | `#b45309` | Stalls, warm-ups |
| `--c-danger` | `#f87171` | `#b81d1d` | Destructive, failures |
| `--c-info` | `#7dd3fc` | `#0369a1` | Calibrating, informational |
| `--c-done` | = `--c-ok` | = `--c-ok` | Semantic alias: "this set/exercise is complete" |
| `--c-record` / `--c-record-fg` | `#f5c542` / `#140a02` | `#8a6a00` / `#ffffff` | A personal record (gold) |
| `--c-rest` | = `--c-info` | = `--c-info` | Semantic alias: "a rest timer is running" |
| `--c-knob` | `#ffffff` | `#ffffff` | A `Toggle`'s knob — deliberately the same in both themes (the usual switch convention), tokenised so the component never carries a bare `bg-white` |

`--c-accent` (light) and `--c-danger` (light) were retuned this phase: the previous values read
3.12–3.40:1 and 4.44:1 against the page background, all short of WCAG's 4.5:1 text floor. §7 is
what caught it and what keeps it caught.

### Glass

Two families, because they cost differently on an Android WebView:

- **Fake glass** (`--glass-1/2/3`, `--glass-border`, `--glass-highlight`) — a translucent tint, a
  1px luminous border and a 1px inset top highlight, **no `backdrop-filter`**. This is `Card`
  (`.glass-card` + `bg-glass-{1,2,3}` + `border-glass-border`). It scrolls with the page, so a real
  blur here would repaint every frame.
- **Real glass** (`--glass-fixed-bg`, `--glass-fixed-border`, `--blur-glass: 16px`) — an actual
  `backdrop-filter: blur() saturate()`, spent only on layers pinned to the viewport: `TopBar`,
  `BottomNav`, the session dock (`App.tsx`), `Sheet`, `Toast`. Composited once by the browser
  instead of on every scroll frame. `.glass-fixed-accent` / `-ok` / `-danger` are `color-mix()`
  tints of the same fixed glass, for the session dock's "live" identity and a toast's tone —
  derived from existing tokens, never a second raw colour.

| Token | Dark | Light |
|---|---|---|
| `--glass-1` (most emphasis) | `rgba(255,255,255,.07)` | `rgba(255,255,255,.75)` |
| `--glass-2` (default card) | `rgba(255,255,255,.055)` | `rgba(255,255,255,.62)` |
| `--glass-3` (nested / low emphasis) | `rgba(255,255,255,.04)` | `rgba(255,255,255,.5)` |
| `--glass-border` | `rgba(255,255,255,.12)` | `rgba(20,20,30,.1)` |
| `--glass-highlight` | `rgba(255,255,255,.08)` | `rgba(255,255,255,.9)` |
| `--glass-fixed-bg` | `rgba(20,20,25,.6)` | `rgba(255,255,255,.72)` |
| `--glass-fixed-border` | `rgba(255,255,255,.1)` | `rgba(20,20,30,.08)` |

Light glass tints toward **white**, never black: on a near-white page that is the only direction
that stays visible at all, and it is also the direction that can only ever raise a piece of text's
contrast, never lower it (proved for real in §7, not just asserted here).

### Radii, elevation, motion

| Token | Value | Tailwind | Used for |
|---|---|---|---|
| `--r-card` | `1.5rem` (24px) | `rounded-card` | `Card`, `Sheet`'s top corners |
| `--r-control` | `0.875rem` (14px) | `rounded-control` | `Button`, `NumberField`, inputs |
| `--r-pill` | `1.25rem` (20px) | `rounded-pill` | `BottomNav`, the session dock, `Toast` |
| `--shadow-card` | soft, dark bg | — | `.glass-card`'s drop shadow |
| `--shadow-float` | stronger, dark bg | — | `.glass-fixed`'s drop shadow |
| `--ease-out-expo` | `cubic-bezier(.16,1,.3,1)` | — | The one easing curve for anything that "settles" (a sheet arriving, a ring drawing in) |
| `--dur-fast` / `--dur-base` / `--dur-slow` | `180ms` / `320ms` / `560ms` | — | Micro-interactions (a border colour, a tick) / most transitions / a deliberate reveal |
| `--content-max` | `36rem` | `content-max` (max-width) | The one place every screen's centred width lives — replaces five repeated `max-w-xl`s |

### `<Ambient/>` fields

`--amb-ember`, `--amb-base`, `--amb-cool`, `--amb-done`, `--amb-record`, `--amb-grain-opacity` —
see §3. Purely decorative colour fields; nothing renders text on top of them, so they sit outside
the contrast contract in §7 on purpose.

## 2. Type

`@fontsource-variable/archivo`, bundled locally (offline, like every other asset) — only the
`wdth.css` entry, imported once from `src/index.css`. That entry carries both axes the app uses,
weight (100–900) and width (62–125%), in one family; importing the default (weight-only) entry
alongside it would duplicate every glyph for nothing. `src/boot/recovery.ts` — the last-resort
screen when boot itself fails — deliberately keeps the plain system stack: it must still render if
this stylesheet, or anything else in the normal boot path, is what failed.

`--font-sans` is `'Archivo Variable'` then the previous system stack, so a screen that somehow
renders before the font is ready still reads correctly.

`.num` (tabular figures, used everywhere a number is the point) pulls the `wdth` axis down to 75%
— the mockup's figure — so more digits fit the same tap target without shrinking the type size.

## 3. Component anatomy

- **`Card`** (`src/ui/components/Card.tsx`) — fake glass, three tiers via an optional `tier`
  prop (`1 | 2 | 3`, default `2`). Tier 1 for the one hero card on a screen (a plan preview, a
  completion state); tier 3 for a card nested inside another. No prop means the existing default,
  so every current call site is unaffected.
- **`TopBar`** — real glass, sticky, a hairline bottom border in `--glass-fixed-border`.
- **`BottomNav`** — real glass, now a floating rounded pill inset from the side edges
  (`rounded-pill`) rather than an edge-to-edge strip, matching the approved mockup. Its total
  height contract (`--nav-h` + the safe-area inset) is unchanged, so every `pb-safe-nav*` padding
  utility and `RestTimerBar`'s stacking still line up exactly as before.
- **The session dock** (`App.tsx`, `data-testid="live-banner"`) — real glass tinted toward accent
  (`.glass-fixed-accent`), a small `pulse-ring` dot, a solid accent "Resume" pill inside it.
- **`Sheet`** — real glass, `rounded-t-card` top corners.
- **`Toast`** — real glass; `ok`/`danger` tones tint it (`.glass-fixed-ok` / `-danger`) instead of
  filling it solid, so a toast reads as the same floating glass family as everything else fixed to
  the viewport.
- **`Button`** — `primary` and `ok` variants get `.fill-highlight` (the same inset top highlight
  glass uses, on a solid fill) so a CTA reads as one glossy surface. Every size is `rounded-control`
  and at least 44px tall (`sm` moved from 40px to 44px this phase — it was under the floor this app
  holds itself to everywhere).
- **`Chip` / `Segmented` / `Toggle`** — already token-driven; the one fix was `Toggle`'s knob,
  previously a bare `bg-white`, now `bg-knob`.
- **`NumberField` / `NumberInput` / `TextInput`** — radius moved to `rounded-control`; colours were
  already tokens.

## 4. `<Ambient/>`

`src/ui/Ambient.tsx` + `src/state/ambient.ts`. A single fixed, `pointer-events-none` layer mounted
once in `App.tsx`, behind every route: a near-black base plus soft radial colour fields that report
live state —

- **ember** (`--amb-ember`) while a session is active (`useActiveSession`, any screen — not just
  the session screens);
- **cool** (`--amb-cool`) while a rest timer is running (`useTimer`'s `endsAt`);
- a brief **green bloom** (`--amb-done`) on `flashAmbient('done')`;
- a brief **gold bloom** (`--amb-record`) on `flashAmbient('record')` — both exported for Phase 3C's
  session screen to call;
- a static `feTurbulence` grain overlay at `--amb-grain-opacity`, `mix-blend-mode: overlay`.

It sits above the plain `<html>` background and below ordinary page content via a negative z-index
in the root stacking context — no screen has to opt in with `position: relative; z-index: 1`. Only
`opacity` ever transitions; nothing here is a layout property, there is no `backdrop-filter`, and
the layer itself is `position: fixed`, so scrolling any screen costs nothing extra.

## 5. Motion rules

- One easing curve, `--ease-out-expo`, for anything settling into place.
- Three durations: `--dur-fast` for a colour/border flick, `--dur-base` for most transitions,
  `--dur-slow` for a deliberate reveal.
- `Ambient`'s own field fades use explicit millisecond durations close to `--dur-slow` (1400ms for
  the steady ember/cool fields, 700ms for a bloom) rather than the token directly, because they are
  substantially slower than any UI transition — a colour field reporting "a session is running"
  should drift, not snap.

## 6. Reduced motion

One global rule in `src/index.css`, deliberately a `*` selector rather than a list of known
animation class names:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
}
```

Collapsing duration and delay to near-zero — rather than `animation: none` — matters because a
`forwards`-filled keyframe (a completion ring drawing in, a sheet sliding up) still plays through
to its end state almost instantly instead of sitting frozen on its `from` frame. Forcing a single
iteration stops an infinite pulse (`.pulse-ring`, the session dock's live dot) from flashing once
at full speed forever. Being global rather than a per-class list means a keyframe added in Phase 3C
or later — the completion ring, the confetti, whatever the session-screen rebuild introduces — is
covered automatically, with no second place to remember.

`<Ambient/>` needs no special-casing under this rule: its fades are ordinary CSS transitions, so
the same block already covers them — the fields still change state, just without the crossfade.

## 7. The contrast test

`src/ui/tokens.test.ts` reads `src/index.css` itself (not a hand-copied table) and checks, for both
themes: `--c-fg` / `--c-muted` / `--c-dim` against `--c-bg`, `--c-surface`, and each glass tier
alpha-composited over `--c-bg`; every state colour used as text against `--c-bg` and `--c-surface`;
and `--c-accent-fg` on `--c-accent`, `--c-ok-fg` on `--c-ok`, `--c-record-fg` on `--c-record`. All
≥ 4.5:1. It reuses `contrastRatio` from `src/domain/plateDiagram.ts` — the same WCAG maths that
already picks readable ink for a plate — rather than a second implementation.

If a future design pass retunes a token past this floor, this test is what catches it, the same day
it happens, at the value that actually ships — not a screenshot someone has to notice by eye.

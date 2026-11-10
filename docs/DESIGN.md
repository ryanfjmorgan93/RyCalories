# Iron — visual system (the trophy room, robot renders)

Picked by the owner in November 2026 for the game (levels, today's hand, badges): out of three
concept rounds they took the "Trophy Room" style, the "Deck"'s hand of cards and the "HUD"'s
level-up, then chose the typeface themselves. It replaced look A (a black stage, ember, IBM Plex
Sans) of October 2026. The accent is still **theirs to pick** on a colour wheel, brass by default.
Dark only. One typeface: Space Grotesk.

Every value below lives in `src/index.css` as a custom property on `:root`, re-exported through
`@theme inline` where a Tailwind utility is useful. Retune a value there and every screen follows.
The file is the source of truth; the tables are a map of what exists and why.

## 1. The look in one paragraph

A warm black stage and cream ink. Panels are quiet: a cream tint of 2–5.5 %, a 1px hairline, no
shadows, no rings. One accent (brass `#C9A45C` unless the owner picks another, white included) for
the game's marks, section rules, the rims of quiet buttons, the rest timer, the active tab's bar and
anything "live". The primary pill is solid cream. Headlines are Space Grotesk
light (300), sentence case, tight leading and tracking; numbers are
tabular; small labels are 11px uppercase with open tracking. Exercise pictures are robot renders on black with the
accent glow rising from beneath (G2), or the glow alone where there is no render. Never a photo of
a person outside the "How to" sheet.

## 2. Tokens

### Colour

| Token | Value | Used for |
|---|---|---|
| `--c-bg` | `#0a0907` | The stage (`bg-bg`) |
| `--c-surface` | `#14120e` | Opaque panels: Sheet body, the composer pill |
| `--c-surface-2` | `#1b1813` | Inputs, chips, inset rows |
| `--c-line` | `#2a2620` | Hairlines |
| `--c-fg` | `#f3efe6` | Primary text (cream), and the fill of the primary pill |
| `--c-muted` | `#a39d90` | Secondary text and labels |
| `--c-dim` | `#8a8478` | Placeholders, inactive tabs |
| `--c-accent` / `--c-accent-fg` | `#c9a45c` / `#000000` | The accent and the ink on it. Overridden at runtime by the colour wheel (§5) |
| `--c-ok`, `--c-warn`, `--c-danger`, `--c-info`, `--c-record` | unchanged | State colours; `--c-done` = ok, `--c-rest` = info |

### Glass

| Token | Value | Used for |
|---|---|---|
| `--glass-1/2/3` | cream at 5.5 / 3.5 / 2 % | `Card` tiers: hero, default, nested |
| `--glass-border` / `--glass-highlight` | cream at 10 % / 7 % | The hairline and the inset top edge |
| `--glass-over` + `--blur-over` | cream at 3.5 %, 10px | `.glass-over`: a card that sits over a render, frosted so the robot shows through |
| `--glass-fixed-bg` + `--blur-glass` | `rgba(10,9,7,.72)`, 14px | `.glass-fixed`: layers pinned to the viewport (TopBar, BottomNav, the session dock, Sheet, Toast) |

Glass needs something behind it to read as glass. <Ambient/> keeps a faint accent glow from two
corners (`--amb-glow`, mixed from the accent), every `.glass-card` adds a sheen across its top
(`--glass-sheen`) and a lit top edge, and Home's Calories and Protein tiles sit as frosted
`.glass-over` panels over the bottom of the cover routine's robot render.

A `backdrop-filter` that scrolls repaints every frame on an Android WebView, so scrolling cards are
tint only. The two exceptions are fixed layers (composited once) and `.glass-over`, used only where a
card overlaps a render, a handful at most on screen.

### Shape and type

| Token / class | Value | Used for |
|---|---|---|
| `--r-card` | 1rem | Cards, sheets |
| Buttons | `rounded-full` | Every `Button` is a pill, at least 44px tall |
| `--font-sans` | `'Space Grotesk Variable'` | Everything. `@fontsource-variable/space-grotesk`, bundled: weights 300–700 in one file |
| `.disp` | 300, sentence case, leading 1, tracking −.03em | Headlines: TopBar titles, the exercise and routine heroes |
| `.num` | tabular, tracking −.02em | Every number that is the point |
| `.label` | 11px, 500, uppercase, tracking .16em, `--c-muted` | Tile and section labels (`SectionTitle`, `Stat`) |

`src/boot/recovery.ts` keeps the system font stack and its own hard-coded colours on purpose: it
must render when this stylesheet is what failed.

## 3. Pictures: robot renders and the glow

- **`ExerciseHero`** (`src/ui/ExerciseHero.tsx`): black box, the render (`object-cover`) if the
  exercise has one, `.ember-glow` over it, children on top. `data-render` says which it drew
  (`robot` or `glow`). Used by the live session's open exercise card, Home's cover routine, and, as
  `RobotThumb`, Home's other routine rows. `DemoThumb` draws one too whenever a render exists.
- **`.ember-glow`** (G2) is a radial gradient mixed from `--c-accent`, plus a dark fade top and
  bottom for the text. The renders are lit **white** on purpose: the colour lives in CSS, so a new
  accent recolours every glow with no new image.
- **The renders** are `public/robots/<diagram-slug>.webp` and `public/robots/cat/<catalogue-slug>.webp`,
  keyed by `Exercise.demo`, listed in `src/data/robotRenders.ts` (generated by
  `scripts/robot-renders.mjs`, run by hand; `src/data/robotRenders.test.ts` holds list and folder in
  step and each file under 48 KB). They are committed and bundled; nothing is fetched at runtime, so
  nothing new leaves the device. 640px wide, about 11 KB each.
- **How they were made** (once, off the device): each free-exercise-db photograph (Unlicense) was
  sent to an image model (`fal-ai/nano-banana/edit`) with one fixed prompt: a faceless satin-titanium
  robot with visible joints, same pose and equipment, black studio, white key and rim light, no
  coloured light. Every result was looked at; any with skin, a face, clothing, a gym background,
  a halo or a wrong pose was retried once with a stricter prompt and dropped if it failed again.
  Lying presses fail most (the model keeps the shorts). An exercise without a render shows the glow
  and its name, which is the designed fallback, not a gap.
- **Technique frames** (the line diagrams and the catalogue photographs) stay behind the "How to"
  tap and in the library, unchanged.

## 4. Components

- **`Card`**: glass tier (`tier` 1–3, default 2), border, inset highlight, no shadow.
- **`Button`**: pills. `primary` is solid cream (`--c-fg`) with stage-coloured ink; `secondary` and
  `outline` are clear with an accent rim.
- **`BottomNav`**: an edge-to-edge strip of fixed glass under a hairline; uppercase labels; a 3px
  accent bar over the active tab. Still `--nav-h` tall, so every `pb-safe-nav*` utility holds.
- **`TopBar`**: fixed glass; the title in `.disp`.
- **`RestTimerBar`**: the running timer is one solid accent block with ink-coloured text, ring and
  pill buttons (`bg-black/12`, which keeps ink on them at 4.5:1 for every wheel colour). "Rest over"
  switches back to fixed glass with the done tint.
- **`CoachFab`** (`src/ui/CoachFab.tsx`): the way to the coach from every screen, a floating
  glass button bottom-right holding `CoachMark`: the satin robot's shoulders with the Iron icon as
  its head, drawn in SVG so the dumbbell glows in the accent. It stacks above the tab bar, the
  session dock and a running rest timer from the same height variables, and opens the coach sheet.
  In the live session it replaces the header's Coach button (`data-testid="session-coach"`).
- **`CoachComposer`**: inside the coach sheet, one pill: the text field ("Talk to me…"), the mic
  in the accent, Send.
- **The exercise page** (`ExerciseDetailScreen`): with a robot render, the render leads, full
  width (3:2), and the line-drawing frames, steps and Video link wait behind "How to". Without one,
  the frames and steps show as before.
- **The session** (`ExerciseCard`): the open card leads with an `ExerciseHero`, the exercise name
  in `.disp` over the render, collapse and menu buttons on the image. Collapsed cards are plain glass
  rows.
- **Home** (`RoutineCard`): the first, most rested routine is the cover, an `ExerciseHero` of its
  first exercise that has a render, with the rest label as a tag and Start as the accent pill. The
  others are rows with a `RobotThumb`. Over the bottom of the cover sit frosted tiles
  (`.glass-over`): Calories and Protein side by side, and under them the Steps strip, today's count
  against the goal with an accent bar that stops at full while the number does not. The strip opens
  a sheet with the week as bars against a dashed goal line (accent at or over the goal), the average
  over recorded days, the total and the days the goal was hit, and the goal itself.
- **Supplements** (`SupplementsCard`) and **Weigh-in** (`WeighInCard`) sit under the routines and
  Short session, kept small: supplements are one row of pills that scrolls sideways, in time-of-day
  order (a ticked pill fills with the accent and its ink; the dose sits after the name), and the
  weigh-in is one row of last reading, field and Log.
- **Settings → Health Connect**: one switch, weight into the bodyweight log; a reading read in is
  marked "From Health Connect" on the bodyweight list and "Health Connect" under Home's latest.
- **Settings → Problem reports**: how many are on the phone, the latest five, Share (Copy in a
  browser) and Clear behind a confirm.
- **Descriptors** (muscle group, compound or isolation, kind, equipment) are stored lower case and
  shown with every word capitalised, units aside (`muscleLabel`, `labelLine`): "Lower Back ·
  Isolation · Bodyweight +kg". Filter chips, list rows, the picker, the library preview, the exercise
  header, the weekly sets rows and the body map readout all go through them.
- **The Fold**: two panes from 840px (`.fold-shell`, `.fold-list`), unchanged by this pass.

## 5. The colour wheel (Settings → Look)

Brass is the default and the reset; ember (the old default) is still hue 17 on the ring.

`src/ui/AccentWheel.tsx`. A conic ring painted with the colours the wheel actually produces, a
swatch, the hex, a "Brass" reset, a "White" button (white has no hue, so it is not on the ring;
the owner asked for it in November 2026), and a range slider that does the same for keys and screen
readers. Dragging previews live; letting go (or the slider resting for 400 ms) saves.

- **The maths** is `src/domain/accent.ts`, pure and tested: the wheel picks a **hue**; saturation is
  fixed at 100 %, and lightness starts at 56 % and is raised until the accent reads at 4.5:1 on the
  black stage, the plain panel and the lightest panel (`#262626`). Ink on the accent is whichever of
  black and white measures better. `accent.test.ts` checks all 360 hues. So a navy is lifted to a
  readable blue rather than shipped at 3:1.
- **Storage**: `Settings.accentHue` (0–359, or -1 for white). Absent means brass, which `src/index.css` carries as
  its default (`tokens.test.ts` checks the two agree). It is in the Settings row, so it is in
  backups.
- **Applying**: `src/ui/accentTheme.ts` writes `--c-accent` and `--c-accent-fg` on `<html>`
  (`AccentSync` in `App.tsx` follows the row, a restore included). A copy of the hue in
  `localStorage` is applied before the first paint; it is a convenience, and the app is correct
  without it.
- Everything accent-coloured reads those two variables or `color-mix()`es them: the glow, the
  ambient ember field, the dock tint, the pulse ring. Nothing else needs to know.

## 6. `<Ambient/>`, motion, reduced motion

Unchanged in mechanism (`src/ui/Ambient.tsx`): a fixed layer of soft colour fields reporting live
state. The ember field is now mixed from the accent, and the base and rest fields are a faint
white, so the stage stays black. One easing curve (`--ease-out-expo`), three durations, and the
global `prefers-reduced-motion` rule in `src/index.css` that collapses every animation to its end
state.

## 7. The contrast test

`src/ui/tokens.test.ts` reads `src/index.css` itself and checks: `--c-fg`, `--c-muted`, `--c-dim`
on `--c-bg`, `--c-surface`, `--c-surface-2` and every glass tier (including `--glass-over`)
composited over the stage; every state colour as text on those surfaces; the ink on every solid
fill; and that the stylesheet's brass is the wheel's brass. All ≥ 4.5:1. `src/domain/accent.test.ts`
covers every colour the wheel can produce. Text on a render sits on the glow's dark bottom fade
with a soft shadow; that pairing is checked by eye in the screenshots, not by this test.

## 6. The game's marks

`src/ui/GameMarks.tsx`, all in the accent so they follow the wheel:

- **`Hex`**: a level in a hexagon. Outlined and large for Home's total level; solid and small in a
  Level up panel (`LevelUpPanel` in `src/ui/LevelLine.tsx`: the session card for the rest of the
  session that earned the level, and the summary).
- **`Segments`**: ten blocks, some lit, from one mark to the next (a lift's level, the next
  total-level badge). It is a `progressbar`; the percentage is what a screen reader hears.
- **`Medallion`**: a ringed disc for a badge's mark or a lift's level; dashed for one not yet held.
- **`HexPanel`**: a moment the game marks, as a solid hexagon, a title and what did it: Level up
  (above), and Protein hit on the Food day, with the blocks to the next protein badge.
- **Home** (`src/ui/LevelsCard.tsx`): `LevelHeader` (the hexagon, badges held, sessions, tonnes
  lifted, blocks to the next total-level badge) above the routines; `TodaysHand` under the routine
  that leads, so Start stays in reach: the three lifts nearest their next level as cards, fanned
  with the nearest in front; `Cabinet`, each ladder's highest badge and the nearest next one, which
  opens every ladder in a sheet.

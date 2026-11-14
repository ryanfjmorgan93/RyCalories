# Iron — visual system (the trophy room, robot renders)

Picked by the owner in November 2026 for the game (levels, today's hand, badges): out of three
concept rounds they took the "Trophy Room" style, the "Deck"'s hand of cards and the "HUD"'s
level-up, then chose the typeface themselves. It replaced look A (a black stage, ember, IBM Plex
Sans) of October 2026. The accent is still **theirs to pick** on a colour wheel, brass by default.
Dark only. One typeface: Space Grotesk.

The first build of it recoloured the old boxed layout. The whole app was then recomposed to the
mock-ups the owner had approved (November 2026, asked for as a redesign of the whole UI): the
open ledger described in §1 and §4. The rules there are the system; a new screen follows them.

Every value below lives in `src/index.css` as a custom property on `:root`, re-exported through
`@theme inline` where a Tailwind utility is useful. Retune a value there and every screen follows.
The file is the source of truth; the tables are a map of what exists and why.

**v5, the Third Space layer (November 2026).** After four concept rounds the owner asked for the
register of their gym (Third Space) laid over this system and said "build it all". What changed:

- **A serif for the big lines only**: Newsreader Variable (OFL, `@fontsource-variable/newsreader`,
  bundled, optical size 72), weight 300, `.serif`. Home's welcome, a screen's sentence (Food's
  "351 kcal left.", Progress's "80.9 kg, up 0.58 a week."), a routine's, a lift's or a boss's name,
  a session's title. Never a label, a button or a figure read mid-set: those stay Space Grotesk.
- **Two-tone sentences**: the fact in cream, then the next clause in `.serif-quiet` (cream at 55%).
  Facts only, never advice (the coach is the one voice that speaks).
- **Caps for sections and tabs**: `.cap` and `SectionTitle`, 11px, 500, uppercase, tracking .2em,
  cream. `.label` (a figure's or column's name) is now sentence case, 13px, muted.
- **Underlined tabs** for anything that switches a view (`Segmented tabs`: Home's This week /
  Badges, Progress's range, the body map, the exercise chart, the library scope, the short
  session's mode). A choice that sets a value stays the pill segment.
- **Soft plates**: `--r-card` 1.5rem, no border, a 5% inset highlight on top.
- **The primary pill carries its icon in a dark well** flush right (`Button icon`): Start (arrow),
  Add food (plus), Fight (swords, in boss red), Save session (tick).
- **The tab bar is a floating glass island** with uppercase 9px labels; the coach disc sits beside
  it in the same row. Home, Food and Progress open straight on the stage with no top bar (a strip
  of the stage colour covers the status bar).
- **The arena**: Home's lead routine and the open exercise in a session stand under a ring of
  ceiling lights (`ExerciseHero arena`), whole on the floor. The boss's arena is lit and toned red
  (`.boss-stage`, `--c-boss` `#c9533f`, the boss's colour only).
- **Home** opens on the total level in a small hexagon, the welcome and the date, the quote, then
  This week (a Monday-to-Sunday strip of rings, brass for a day trained) or Badges.
- **A boss beaten** is the summary's moment: the medal in a solid hexagon in a pool of brass, then
  "Boss beaten." in the serif and the sets that did it.
- **The rest timer** is a glass island with a brass ring.

## 1. The look in one paragraph

A warm black stage and cream ink, and the content sits straight on the stage: an **open ledger**,
no boxes inside boxes. A section is headed by a small uppercase label in the accent with a hairline
running out to the edge; rows are parted by hairlines; what belongs together is held by space.
Only an **object** is framed, something you pick up or act on: the lift in play, the routine that
leads Home, a field, a sheet, a plaque for a level or a record.

One accent (brass `#C9A45C` unless the owner picks another, white included) for the game's marks,
section labels, the rest timer, the dot over the current tab and anything live. It is not for
decoration: quiet buttons have a cream hairline rim, a status line is cream or muted, and a record
is the accent (one metal on screen). The primary pill is solid cream, and so is whatever is chosen
(a chip, a segment, today on the calendar). Headlines and the figures that are the point of a
screen are Space Grotesk light (300), tight and tabular; text is 400 or 500; 600 is the ceiling.
Small labels are 11px uppercase with open tracking, for sections, columns and figures only.
Nothing is written over a robot render: the picture is the picture, the name goes under it. Exercise pictures are robot renders on black with the
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
| `--c-ok`, `--c-warn`, `--c-danger`, `--c-info` | unchanged | State colours; `--c-done` = ok, `--c-rest` = info |
| `--c-record` / `--c-record-fg` | the accent and its ink | A record is the game's metal, so it follows the wheel |
| `--c-boss` | `#c9533f` | The weekly boss only: its health, its best set, its arena, the swords on Fight |

### Glass

| Token | Value | Used for |
|---|---|---|
| `--glass-fixed-bg` + `--blur-glass` | `rgba(10,9,7,.72)`, 14px | `.glass-fixed`: layers pinned to the viewport (TopBar, BottomNav, the session dock, Sheet, Toast) |
| `--glass-1/2/3`, `--glass-over`, `--glass-sheen` | cream tints | Kept for the contrast test and the few old uses; nothing new should reach for them |

Glass is for one job only: a layer pinned to the viewport that content scrolls under, where the
blur is what keeps the bar readable. Nothing that scrolls is glass. A `backdrop-filter` that
scrolls repaints every frame on an Android WebView, and a tinted box on a page of tinted boxes is
decoration. <Ambient/> still keeps a faint accent glow from two corners (`--amb-glow`).

### Shape and type

| Token / class | Value | Used for |
|---|---|---|
| `--r-card` | 1.5rem | Framed objects, sheets. A plaque (level up, record, badge) is square |
| Buttons | `rounded-full` | Every `Button` is a pill, at least 44px tall |
| `--font-sans` | `'Space Grotesk Variable'` | Everything. `@fontsource-variable/space-grotesk`, bundled: weights 300–700 in one file |
| `.disp` | 300, sentence case, leading 1.15, tracking −.03em | Headlines: TopBar and sheet titles, the name of a lift or routine |
| `.fig` | 300, leading 1, tracking −.035em, tabular | A figure that is the point of its screen: calories left, a bodyweight, a session's total, the weight being lifted. Size from a text utility |
| `.num` | tabular, tracking −.02em | Every other number |
| `.label` | 13px, 400, sentence case, `--c-muted` | Column and figure labels |
| `.cap` | 11px, 500, uppercase, tracking .2em, cream | Section heads (`SectionTitle`) and tabs (v5) |
| `--font-serif`, `.serif` | Newsreader Variable 300, opsz 72, tracking −.015em, leading 1.12, balanced | The big lines only (v5, above) |
| Weights | 300 / 400 / 500 / 600 | `font-semibold` is mapped to 500 and `font-bold`, `font-extrabold` to 600 in `@theme`, so no screen can go heavier |
| `.plate` | `margin-inline: -1rem`; a hairline between two in a row | The open `Card` (§4) |

The parts the browser draws take the palette too: text selection and the caret are the accent,
`:focus-visible` is a 2px accent outline, the scrollbar is thin and hairline-coloured.

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

- **`Card`**: open by default (`.plate`): no fill, no border, no radius. It is pulled out by the
  page's 1rem gutter, so the padding its content already carries (`p-4`, a `Row`'s own) lands on
  the same left edge as the section label above it; two in a row are parted by a hairline. Every
  page and sheet body therefore keeps a gutter of at least 1rem. `framed` is the object: a solid
  `--c-surface` panel with a hairline edge and `--r-card` corners (the session's cards, where the
  gutter is narrower, are all framed).
- **`SectionTitle`**: the section's name as an accent `.label`, a hairline to the edge, and an
  optional thing at the end of it (a count, Edit). More space above it than below.
- **`EmptyState`**: one muted line where the content would be. No dashed box.
- **`Stat`**: a `.label` over a `.fig`.
- **`Button`**: pills. `primary` is solid cream (`--c-fg`) with stage-coloured ink; `secondary` and
  `outline` are clear with a cream hairline rim; `ghost` is words only.
- **`Chip`, `Segmented`**: pills; the chosen one is a cream fill.
- **`TargetBar`, `MacroSplit`, Home's figures and Steps**: a 2px line on a hairline track, never a
  fat rounded bar. Over the target the line turns to the warning colour and the number keeps
  counting.
- **`BottomNav`**: an edge-to-edge strip of fixed glass under a hairline; each tab a line icon over
  its name (one family drawn for the bar: 24-unit grid, 1.5 strokes, round ends), the current tab's
  icon in the accent and its name in cream. Still `--nav-h` tall, so every `pb-safe-nav*`
  utility holds.
- **The calendar** (`CalendarHeatmap`): plain numerals; a trained day is ringed in the accent like
  a badge, two sessions fill it, today is the cream disc.
- **`TopBar`**: fixed glass; the title in `.disp`.
- **`RestTimerBar`**: the running timer is one solid accent block with ink-coloured text, ring and
  pill buttons (`bg-black/12`, which keeps ink on them at 4.5:1 for every wheel colour). "Rest over"
  switches back to fixed glass with the done tint.
- **`CoachFab`** (`src/ui/CoachFab.tsx`): the way to the coach from every screen, a quiet dark
  disc bottom-right holding `CoachMark`, which is the owner's pick in Settings → Look
  (`Settings.coachMark`, November 2026): the seal (a hexagon, the game's shape, with an engraved I;
  the default) or the robot drawn flat in fine lines with the dumbbell for its face. Both are line
  drawings in the accent and the text colour. The same mark heads every coach line (`CoachLine`: the
  mark, COACH in the accent, the words on a fine accent rule, no box) and every coach reply in the
  thread; the owner's own messages are quiet bubbles on the right. It stacks above the tab bar, the
  session dock and a running rest timer from the same height variables, and opens the coach sheet.
  In the live session it replaces the header's Coach button (`data-testid="session-coach"`).
- **`CoachComposer`**: inside the coach sheet, one pill: the text field ("Talk to me…"), the mic
  in the accent, Send.
- **The exercise page** (`ExerciseDetailScreen`): with a robot render, the render leads, full
  width (3:2), and the line-drawing frames, steps and Video link wait behind "How to". Without one,
  the frames and steps show as before.
- **The session** (`ExerciseCard`): the lift in play is a framed object: its `ExerciseHero` with
  only the collapse and menu buttons on it, then the name in `.disp`, what is prescribed, and the
  level line. The cue is a line with a hairline of the accent down its left. The set table
  (`SetTable`) is a ledger: logged and later rows on hairlines, the row being logged as two `.fig`
  fields on underlines with a round cream tick. Collapsed and done cards are framed rows.
- **Home** (`RoutineCard`): the first, most rested routine is the cover, a framed object: the
  `ExerciseHero` of its first exercise that has a render with the rest label as a tag, then the
  name, what it holds and Start as the cream pill. Under it, open on the stage, the day's two food
  figures (eaten, large, against the target, each over its line) and Steps on a hairline, today's
  count against the goal with a line that stops at full while the number does not. The strip opens
  a sheet with the week as bars against a dashed goal line (accent at or over the goal), the average
  over recorded days, the total and the days the goal was hit, and the goal itself. The other
  routines are ledger rows with a `RobotThumb`.
- **Food**: the day leads with the two figures left, each over its own line and what was eaten
  against the target; the meals are an open ledger, each with its foods beneath it.
- **Summary**: three `.fig` figures on a hairline; records, level ups and new badges as plaques.
- **Supplements** (`SupplementsCard`) and **Weigh-in** (`WeighInCard`) sit under the routines and
  Short session, kept small: supplements are a grid of tiles in time-of-day order (a ticked one
  fills with the accent and its ink; the dose sits under the name), and the weigh-in is one row of
  last reading, field and Log.
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
swatch, the hex, and under it the named presets as swatch pills: Brass (the reset), White, Jade,
Cobalt and Coral (`PRESETS` in `src/domain/accent.ts`, none of them on the ring; the owner asked
for white, then for nice colours with names, each plainly unlike the others, November 2026), and a range slider that does the same for keys and screen
readers. Dragging previews live; letting go (or the slider resting for 400 ms) saves.

- **The maths** is `src/domain/accent.ts`, pure and tested: the wheel picks a **hue**; saturation is
  fixed at 100 %, and lightness starts at 56 % and is raised until the accent reads at 4.5:1 on the
  black stage, the plain panel and the lightest panel (`#262626`). Ink on the accent is whichever of
  black and white measures better. `accent.test.ts` checks all 360 hues. So a navy is lifted to a
  readable blue rather than shipped at 3:1.
- **Storage**: `Settings.accentHue` (0–359, or a preset's negative value: -1 white, -2 jade, -3 cobalt, -4 coral). Absent means brass, which `src/index.css` carries as
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
  (above), and Protein hit on the Food day, with the blocks to the next protein badge. A boss
  beaten is bigger on the summary (v5, above).
- **Home** (`src/ui/LevelsCard.tsx`): `LevelMark` (the total level in a small hexagon) at the head;
  under the tabs, This week (`WeekStrip`) or Badges: `LevelHeader` (badges held, sessions, tonnes
  lifted, blocks to the next total-level badge) and `Cabinet`, each ladder's highest badge and the
  nearest next one, which opens every ladder in a sheet. The weekly boss (`src/ui/BossCard.tsx`,
  November 2026, in place of today's hand and the strength figure) stands under the routine that
  leads, so Start stays in reach: the days it has left, its render in the red arena (a hexagon with
  the boss weight when it has none), its name in the serif, health in ten red blocks (`Segments`
  rounded up), your attack against its best set, and Fight with the swords; then "Bosses beaten" as
  a row of medallions.

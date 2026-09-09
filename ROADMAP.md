# RyCalories → all-in-one fitness app: Roadmap

Companion to `HANDOVER.md`. That document says what exists and why. This one
says what to build next, in what order, and what to deliberately not build.

Produced by four parallel analysis passes (product vision, technical
architecture, nutrition accuracy, design/UX), reconciled into one sequence.
Where those passes disagreed, the disagreement and the call made are recorded
in §7 so a future session can revisit the decision rather than rediscover it.

**One caveat on provenance:** the design pass intended to use the
`ui-ux-pro-max` skill's searchable datasets (palettes, font pairings, chart
types). Only the skill's `SKILL.md` was present in the environment — the CSV
data and search script were missing — so its colour, font and chart
recommendations are reasoned judgement, not database matches. Treat them as
strong opinions to sanity-check, not as looked-up answers.

---

## 0. The thesis

Everything below serves one idea, and features that don't serve it should be
cut:

> **Food is the input. Training is the stimulus. Body weight and strength are
> the output. No commercial app can see that whole loop, because the loop
> spans two vendors.**

MyFitnessPal must be right about a hundred million people, so it ships a
population-average formula and never revises it. Hevy must be a great training
log for everyone, so it can't assume you track food. Neither can afford to be
*specifically, empirically correct about one person*.

This app has exactly one user, so it can do nothing else. That is the entire
justification for the merge, and the differentiator no commercial product can
match.

---

## 1. Bugs to fix now (found during this analysis, all in shipped code)

These are in the APK currently on the phone. Ordered by severity.

### 1.1 Wrong manufacturer's nutrition applied with a "LABEL" badge

`ProductLookup.byName` gates matches on `overlap >= 0.5` of query tokens with
**no requirement that the brand matches** (`ProductLookup.kt:157`). Query
`"Trek Protein Flapjack"` reduces to `{trek, protein, flapjack}` after
stop-word removal. A different manufacturer's "Protein Flapjack" scores 0.67,
passes, and its nutrition is written onto the item — with the green LABEL pill
asserting the numbers are real. **Confidently wrong is worse than the model's
guess**, because the UI signals it's trustworthy.

```kotlin
if (item.brand.isNotBlank()) {
    val brandTokens = tokens(item.brand)
    if (brandTokens.isNotEmpty() && brandTokens.none { it in tokens(label.brand) }) continue
}
```

### 1.2 A barcode anywhere in frame can overwrite the wrong item

`ProductLookup.enrich` route 1 (`ProductLookup.kt:61–63`) falls back to
`items.indexOfFirst { it.source != "label" }` when the barcode's product
matches no item name. Photograph chicken, rice and broccoli with a sauce
bottle in the background and "Grilled chicken breast" silently becomes the
sauce. Restrict the blind fallback to `items.size == 1`; otherwise skip.

### 1.3 Can't log to a past day

`saveAnalyzedMeal` hardcodes `System.currentTimeMillis()`
(`MainViewModel.kt:286`) then calls `goToToday()`. The week strip lets you
select yesterday, and then the app refuses to log to it. Small fix, real
annoyance.

### 1.4 Calories are never checked against macros

`NutritionJson.parse` clamps each field independently
(`NutritionJson.kt:35`) but never cross-checks. A reply of 250 kcal with 30 g
fat (270 kcal from fat alone) passes silently. Add an Atwater check to a
single shared validator used by both engines:

```kotlin
val atwater = 4*proteinG + 4*carbsG + 9*fatG
if (calories > 0 && abs(calories - atwater) / calories > 0.25) {
    // macros are individually more grounded than the kcal leap
    calories = atwater; confidence = "low"
}
```

Best hour of work available. Catches a whole class of silent error.

### 1.5 The schema asks for calories before grams

`NanoFoodItem` declares `calories` at line 18 and `grams` at line 26. Under
constrained decoding, fields emit in declaration order, so **the model commits
to a calorie number before deciding how heavy the food is**, then rationalises
backwards. Worse, the plain-JSON contract in `NutritionJson.FORMAT_INSTRUCTIONS`
already orders grams first — so the two engines are not equivalent, despite
sharing a parser. Correct order:

```
name → brand → product → portion → grams → calories → protein → carbs → fat
```

Also: `grams` has `minimum = 1.0` and is non-optional, so the model is
*structurally forbidden* from saying "I don't know how heavy this is." Allow
0 = unknown, and treat that as the cue to ask for a weight.

### 1.6 Photo paths are absolute

`ImageUtils.saveJpeg(...).absolutePath` embeds the package name and the
Android user profile in stored data. Any app-ID change, profile change or
device transfer silently breaks every photo. Store paths relative to
`filesDir` and resolve at read time. Fix during the Room migration (§4.3).

### 1.7 Output token budget can truncate the reply

`maxOutputTokens = 1024` against a schema permitting `maxItems = 10`. Ten
populated items truncate mid-JSON. Drop `maxItems` to 6 or raise the budget.

### 1.8 Smaller correctness items

- `apply()` sanity-checks `packGrams` to 10–300 g but applies **no window to
  `servingGrams`**, which comes from Open Food Facts' notoriously unreliable
  `serving_size` field, and is checked first (`ProductLookup.kt:87–90`). The
  final `?: 100.0` fabricates a portion with no signal to the user.
- `isPackaged` fires on `brand = "homemade"` / `"generic"`, triggering
  pointless network lookups. Add a blocklist.
- `bestItemFor` uses one-directional token coverage, so a single-token target
  matches any superset at 1.0. Use a symmetric harmonic mean and raise the
  threshold to ~0.5.
- Negative lookups aren't cached, so an unrecognised food re-hits the network
  and re-eats the 6 s + 8 s timeouts on every retry.
- `ConfidencePill` computes mint/lemon/rose colours then only uses them under
  `if (onDark)`, which is `false` at its only call site. The colour coding has
  never rendered. Dead code that looks like a feature.
- `Palette.InkSoft` (60% ink) on Lavender is **4.30:1**, below the 4.5:1
  accessibility floor, used at 11sp. Raising to 70% gives 5.85:1 and looks
  near-identical. One character.
- The system prompt says "USDA-style values" for a UK user reading UK/EU
  labels, which differ in how carbohydrate and fibre are counted.

---

## 2. Cross-cutting decisions (settled — don't relitigate without reason)

| Decision | Call | Reasoning |
|---|---|---|
| One database or two | **One Room DB, both domains** | The whole point is cross-domain queries. Two DBs means no joins, two migration schemes, two transaction scopes. Packages are the boundary, not databases. |
| Module structure | **Stay single-module** | Multi-module speeds up *warm incremental* builds. This feedback loop is push → CI → APK → phone, which is always a **cold** build where nothing is cached. It also adds config-phase time and a class of build error with no IDE to catch it. Revisit only if `assembleRelease` exceeds ~6 min *and* profiling shows Kotlin compilation, not R8, dominating. |
| Dependency injection | **Manual `AppContainer`, no Hilt** | Hilt adds an annotation-processing round to every build and fails at a distance in generated code — painful without an IDE, worse in a CI-only loop. Its payoff needs many scopes, modules, developers, and instrumented tests. This has one of each and no emulator. ~70 explicit lines instead. |
| Charts | **Hand-roll with Compose Canvas** | Every library ships Material-derived styling that would have to be fought forever. Four of five needed charts are 30–60 lines. `ArcGauge` already proves the pattern. Revisit only for pinch-zoom-and-pan over years of data, and then only for that one screen. |
| Photos | **Filesystem, relative paths** | Blobs bloat every query and slow export. But fix §1.6. |
| Calories burned from a workout | **Never display it** | It's a MET table times bodyweight — an error bar wider than the value. It double-counts against measured maintenance (§5), which already includes training by construction. And "earned calories" turns training into currency for eating at a fake exchange rate. |
| Model-only estimates in food memory | **May never override a future estimate** | Otherwise a hallucination gets entrenched and the app's memory lends it false authority. Only user corrections and real label data get override rights. |
| Light theme | **Never** | Already an explicit non-goal. Halves the design surface. |
| App identity | **Keep `applicationId` and the keystore; change only the label and icon** | Changing the app ID makes Android treat it as a different app: fresh install, empty data directory, history gone. Renaming the Kotlin package also risks a release-only R8 crash via the ProGuard rules that reference it. Pure churn. |

---

## 3. What NOT to build

Saying no here is worth as much as the roadmap.

**Social, sharing, friends, leaderboards.** One user. The absence is a feature.

**Streaks, badges, XP.** Extrinsic motivation aimed at an audience of one who
wrote the code and knows the badge is a boolean. Worse, streaks corrupt data:
the night a fake 1,500 kcal gets logged at 11:58pm to protect a 40-day streak,
the maintenance calculation is poisoned. The only counter allowed is an honest
logging-completeness gauge, framed as *data quality*, never achievement.

**Generic AI coaching.** The hardest-won lesson in `HANDOVER.md` §3.1 is that
small on-device models *recognise* things but don't reliably *know* facts.
That's far worse for training advice than for nutrition labels, because
there's no Open Food Facts to correct against. **Rule: on-device AI is for
perception, never for judgment.** Photo → food items, yes. "Should I deload?",
never.

**AI form checking from video.** Pose estimation plus biomechanical judgment,
on-device, where being wrong means injury. Absolute no.

**Meal plan generation.** Your own last 90 days are a better meal plan than any
model will generate, and they're already in the database. The valuable 5% is
"repeat Tuesday's lunch", which is a `SELECT`.

**Health Connect / wearables.** The most plausible-sounding item here and the
most dangerous. Importing active calories is *actively harmful* — it
reintroduces the fiction §2 eliminates and double-counts against measured
maintenance. Importing steps changes no decision. Writing workouts out feeds
no other app. The one legitimate case is reading body weight from a smart
scale, which saves five seconds a day and only matters if such a scale is
bought. Meanwhile the cost is real: permission-heavy surface, awkward data
model, and Google has churned it twice. Skip entirely.

**GPS run tracking with maps.** Background location, battery, wake locks, and
map tiles that cost money or need network — violating zero-cost, zero-cloud.
Log a run as a name and a duration.

**Micronutrients and water tracking.** Open Food Facts micronutrient coverage
is thin, so the numbers would be blanks pretending to be data.

**A searchable food database UI.** Tempting, but the premise is photographing
food instead of searching for it, and "log again from history" beats search
for the repeat case. Building search is quietly abandoning the differentiator.

**Accounts, cloud sync, multi-device.** Out, forever. A backup file is not
sync and must not grow into one.

**Exercise demo GIFs.** Licensing, tens of megabytes, and he knows how to bench.

**Tablet layouts, Wear OS, iOS, table-top hinge mode.** One phone.

**Notifications beyond one optional morning weigh-in.** Every extra
notification is a step toward uninstalling your own app.

---

## 4. The sequence

Each stage ends with an installable APK. This is a daily-use app; it must
never be broken for days. Stages 0–5 need **zero** knowledge of the workout
app's code.

### Stage 0 — Safety net, bug fixes, quick wins · **S** · do this first

No architecture change. All of it is felt immediately.

1. **Export / import all data** to Downloads via `ACTION_CREATE_DOCUMENT`.
   This is the only backup story and must exist before anything touches
   persistence. One phone, no cloud means a dropped phone is years of
   irreplaceable data. **The compounding asset here is the data, not the code.**
2. **Fix §1.1–§1.5, §1.7, §1.8.** Half a day, immediate accuracy return.
3. **Delete Gemma.** Never executed a single inference; costs ~35 MB of native
   libs, three broad ProGuard keep rules and meaningful R8 time. Tag the commit
   (`git tag gemma-fallback-removed`) so restoring it is one command. Biggest
   single build-time win available, 30 minutes.
4. **The cheap UI wins:** provide `LocalContentColor` in `PastelCard` /
   `DarkCard` (fixes the invisible white ripple on every pastel surface *and*
   lets ~60 explicit `color =` arguments be deleted); `InkSoft` alpha to 70%;
   `rememberSaveable` for `pendingCaptureUri` (currently a fold during capture
   silently discards the photo) and the Settings goal field; week-strip
   chevrons from 30dp to 44dp; `fontFeatureSettings = "tnum"` so the animating
   calorie number stops jittering as digit widths change; a `pressScale`
   modifier and haptics.

**Risk: none.** Verify: export a file, confirm the numbers stopped being wrong.

### Stage 1 — Structure · **M** · invisible, unblocks everything

1. **Split `App.kt`** (1,100 lines) into `core/designsystem/component/*` and
   `feature/nutrition/*`. Promote every `private` composable to `internal`.
   Add `Shapes.kt` and `Spacing.kt` (retire the stray 14dp and 22dp).
   **Keep this a pure move** — no renames, no signature changes, no behaviour
   changes in the same commits. Success criterion: the APK looks pixel-identical.
   Done wrong, this is the phase most likely to become a multi-session slog.
2. **Navigation-Compose with type-safe `@Serializable` routes.** Four bottom
   tabs: **Today · Food · Train · Progress**. Settings stays a gear icon in the
   Today header, not a fifth tab. Train and Progress ship as honest
   placeholders — the shell is the deliverable. Multi-back-stack so switching
   tabs preserves position; back from a tab root goes to Today, then exits.
   Register `ryfit://` deep links and long-press launcher shortcuts (high value,
   nearly free once routes exist).
3. **`AppContainer` + ViewModel split.** `MainViewModel` dies. `AiEngineManager`
   becomes an app-scoped singleton (probing is expensive and must not re-run per
   screen). `CaptureViewModel` scopes to the capture graph's back-stack entry,
   not the Activity — get this wrong and draft state leaks between meals.
4. **Foldable Tier 0:** a `widthIn(max = 560.dp)` cap on each screen root.
   One hour, ~90% of the visible benefit on the inner display. Turns "stretched
   phone app" into "deliberate centred column". Decide on two-pane layouts only
   after seeing this on the actual device.

**Rework flag:** `navigationBarsPadding()` is applied ad hoc at six call sites
and all six become wrong the moment a bottom nav exists. Centralise in the same
change.

### Stage 2 — Room · **L** · ⚠️ the one stage that can lose data

Ship as **two separate releases, days apart.**

**2a — shadow write.** Add Room, entities, DAOs, and the JSON importer. On
launch, import into Room but keep the app **reading from JSON**. Add a Settings
diagnostics row: *"Database: 412 meals, 1,187 items, checksum OK ✓"*. If this
release crashed, no data is at risk because nothing writes to or deletes the
JSON.

**2b — flip reads.** Only after the diagnostics row is confirmed good.
Repositories switch to DAOs, day queries become `WHERE dayKey = ?`, photos
relocate to relative paths, `meals.json` is renamed to `.imported-<timestamp>`
and **kept forever**.

De-risking, all of it non-negotiable:
- Existing meal UUIDs become primary keys, so import is idempotent and
  re-runnable.
- Count and calorie-sum checksum gates the flip; mismatch aborts loudly.
- `exportSchema = true`, schemas committed, and
  **`fallbackToDestructiveMigration` never appears in the codebase.**
- One Robolectric test over a copy of the real `meals.json` — the single
  highest-value test in the project, guarding the one irreversible operation.

Also fixes two scaling problems: the home screen currently loads the entire
meal history into memory and filters in the UI, and the repository rewrites the
whole file on every save. Both are O(history) forever; a `dayKey` index makes
them O(1).

**Do Room before adding any more features that store data.** Food memory, meal
templates and body weight would otherwise become three more hand-rolled JSON
files, and the migration becomes five files instead of two.

### Stage 3 — Body weight · **S** · the keystone

Body weight is **the only output variable in the system**. Calories are an
input you estimate; sets and reps are a stimulus you choose; weight is what
your body actually did about it. Without it, calorie logging has no ground
truth, the goal stays a number typed in once that no evidence will ever revise,
and strength progress has no context.

It's also the cheapest thing on the roadmap — one `Double` per day, a table,
an entry sheet and a chart, maybe 300 lines — and three of the four headline
features are downstream of it.

- **Input:** one number, one decimal, keypad pre-seeded with the last value.
  Two seconds. One optional 7am reminder, dismissible forever. Backfill by
  tapping any day in the week strip. No body fat %, no measurements, no photos
  until asked.
- **Smoothing: EWMA, α = 0.10** (≈7-day half-life), not a 7-day moving average.
  EWMA updates on every entry, never lurches when an old value leaves a window,
  degrades gracefully with missed days, needs one stored value, and is the
  algorithm behind TrendWeight and The Hacker's Diet. Don't make α configurable.
- **Rate of change:** ordinary least-squares regression over the last 21 days
  of raw weights, reported as kg/week with an honest confidence note
  ("14 of 21 days logged"). Not "trend today minus trend 7 days ago", which is
  noisy at the endpoints.
- **Add the `Phase` object here too** (`CUT | MAINTAIN | BULK`, start date,
  target rate). It's a form and a table, and it's what makes the two halves one
  app structurally rather than cosmetically: nutrition reads it to derive
  targets, training reads it to annotate history, charts read it as bands.
- **The chart:** raw weights as dim dots, EWMA as a bold line, a faint corridor
  showing where the trend would be at the phase's target rate. Range selector
  30d / 90d / 1y / this phase.

### Stage 4 — Food memory · **M** · the accuracy strategy

The strategic point: **you eat a small number of foods repeatedly, so the
model's job should shrink from "estimate the calories" to "tell me which of my
known foods this is."** Right now every photo starts from zero and a small
model re-guesses your porridge for the 200th time, wrong differently each time.
The information it lacks — how big *your* bowl is, how much oats *you* use —
isn't in its weights and isn't reliably in the pixels. It's in your own history,
which the app currently discards.

1. **Edit any number, before and after saving.** Unblocks everything else: no
   corrections means no memory and no learning. Also the top wanted feature in
   the handover.
2. **Make grams the primary editable number**, with calories recomputing live.
   "That's not 180 g of rice, it's 250 g" is a judgement a human can make;
   "that's not 1×" is not. The existing multiplier chips then adjust grams.
   This also makes kitchen-scale entry the promoted path for home-cooked
   staples — typed grams beat every model on earth, and with memory you type it
   once per food, ever.
3. **Personal food memory.** Store per-100 g (never per-portion), so any
   portion is derivable. Match a new photo's items by barcode, then brand +
   product, then fuzzy name using a symmetric harmonic-mean token score, with
   recency and frequency as tiebreaks. **The trust rule is the safety
   mechanism:**

   | Trust | Created by | May override a fresh estimate? |
   |---|---|---|
   | `USER_EDITED` | you corrected a number | **Yes, silently** |
   | `LABEL` | Open Food Facts / OCR | **Yes** for numbers, **no** for portion |
   | `MODEL_ONLY` | saved unedited | **Never** |

   Nutrition facts get replaced silently and tagged REMEMBERED. Portions are a
   *suggestion* ("you usually have 320 g") because they genuinely vary. Every
   row should show why its number is what it is: MODEL / LABEL / REMEMBERED /
   WEIGHED. That's what makes it trustworthy rather than spooky.
4. **Quick-add from memory**, search-as-you-type. Kills the camera and the model
   entirely for the ~70% of meals that repeat. Two taps, zero inference, zero
   error. Ship in the same release as the memory store — the store is useless
   without the UI that consumes it.
5. **Barcode-only scan mode**, **repeat a past meal**, **meal type** labelling.
   All machinery already exists; barcode reading currently only happens as a
   side-effect of analysing a meal photo.
6. **Learn the systematic bias.** Once ~10 items have corrected grams, compute
   `median(correctedGrams / modelGrams)`, clamp to 0.6–1.6, and pre-multiply.
   One scalar, ~20 lines, fit to observed behaviour rather than the model's
   self-report. Surface it in Settings so it never feels like a silent fudge.

### Stage 5 — Adaptive TDEE · **S** · the payoff

By now Stage 3 has been collecting for weeks, so this lights up on real data.

```
TDEE = mean_daily_intake(28d) + (Δtrend_weight_kg × 7700) / days
```

**The argument that makes this work despite bad estimates:** calorie logging is
systematically under-reported by everyone, and photo estimates will be no
better. That normally poisons calorie tracking. It does *not* poison this,
because the same bias appears on both sides of the equation. Log 15% light
consistently and the measured TDEE comes out 15% low too, and a target derived
from it is still exactly right.

**Consistency matters more than accuracy** — which inverts the app's
relationship to its own estimation error. The photo estimates don't need to be
accurate, only consistently biased. That is a far easier engineering target,
and it's only reachable because weight closes the loop.

Guards: require ≥80% of days logged in the window before showing a number;
never adapt on fewer than 14 days; cap weekly target changes at ±150 kcal;
exclude the first 10 days after a phase change (glycogen and water swamp fat
change). Cold start blends a formula estimate, cross-fading to fully measured
over 4–6 weeks.

Never show a bare number — show the working, including the formula estimate
alongside for comparison. The gap between them is the app justifying its own
existence.

`AppSettings.dailyGoal` stops being a hardcoded `Int` and becomes derived. The
weekly check-in becomes the most valuable 15 seconds in the app:

> *Week 4 of cut. Trend −0.38 kg/wk (target −0.50). Measured maintenance 2,880.
> Suggested target 2,350 (−100). [Accept] [Keep 2,450]*

Also add the **logging-completeness gauge** here, next to the TDEE figure as
its confidence indicator — not on the home screen as a badge. Its purpose is
telling you when to distrust the number, because everything above collapses if
logging is patchy.

### Stage 6 — Workout tables, then the merge · **M**, then **XL**

**6a — schema and shell, before the workout code arrives.** Add all workout and
body entities at DB version 2 with a real migration while the tables are empty
and the risk is zero. Seed an exercise library from a bundled asset. Add pure
`domain/workout/` functions (Epley 1RM, volume, PR rebuild) **with unit tests**
— this is where JUnit genuinely pays, since no emulator exists to eyeball the
maths. Build `InlineNumberField` and `SetRow` first and get them on the phone:
**if set entry isn't fast, the workout side fails regardless of how good
everything else looks.**

Design note: PRs are stored but as a *derived cache that can be fully rebuilt*
from `workout_sets` in one transaction. A PR bug is then always a one-tap fix,
never data loss.

**6b — merge the workout app.** Unknown until the code is in hand.
1. Read it end to end, write a handover-equivalent for it.
2. Map its model onto the 6a schema, one-shot importer, same non-destructive
   pattern as Stage 2a.
3. Port screens one at a time onto the shared design system, each its own
   shippable commit.

**Three things to check the moment the repo is available:**
1. **Exercise identity** — stable IDs or free-text names? If it's free text,
   "Bench Press" / "Barbell Bench" / "bench press" fragment the series and
   Stage 7 silently dies. Normalise first.
2. **Set granularity and timestamps** — per-set weight and reps with a session
   timestamp is the minimum for 1RM estimation.
3. **Is it even Compose?** If it's XML/Views, 6b becomes "reimplement using
   their code as spec." This is the only assumption that could break the plan.

### Stage 7 — The Loop · **M** · the flagship

**"Is my cut costing me strength?"** — the question every lifter who also diets
actually has, and structurally impossible to answer with MyFitnessPal + Hevy
because neither vendor has the other half.

One chart: estimated 1RM for a chosen lift over time, body-weight trend
overlaid, background shaded by rolling energy balance. Then a year of history
answers:

- Strength flat, weight down, deficit shaded → **the cut is working perfectly.**
  This is the win condition, and it's invisible in either app alone — in Hevy it
  looks like a stall, which is demoralising and makes people abandon successful
  cuts.
- Strength down, weight down fast → cutting too hard, raise the target.
- Strength flat, weight up, surplus shaded → the bulk is just fat.

Also here: **training-day vs rest-day intake**, one line, high value, nearly
free. Many people accidentally eat *less* on gym days because the session eats
the evening. Real, common, invisible, and one query joining two tables.

### Stage 8 — Ongoing, a weekend at a time

Weekly review screen (pure assembly, every number already exists), home-screen
widget, nutrition-label OCR via ML Kit Text Recognition (mature and stable,
unlike the GenAI beta stack — OCR the panel, hand the text to Nano to extract
per-100 g values, then **validate with the Atwater check** before accepting),
scheduled automatic backups, plate-fraction portion decomposition with crockery
calibration.

---

## 5. The Today screen

The reason this is one app. Design rules first, because they're what stop it
becoming a wall:

1. **One hero number.** Calories remaining. Everything else subordinate.
2. **One primary action**, contextual: "Snap a meal" by default, "Start workout"
   if today has a planned session that hasn't happened.
3. **At most one nag.** Weigh-in *or* protein-short, never both.
4. **The screen changes shape through the day.** Cards appear and retire — the
   cheapest way to make one screen serve two very different moments.
5. **No calories-burned figure. Ever.**

**7am:** weigh-in prompt (only possible now, gone by 8am), today's target with
phase progress, today's session and its first lift. Nothing else.

**9pm:** calories remaining, protein-short warning *only if* actually short
after 7pm, the completed session as a trophy with any PR, then the meal list
for corrections. The weigh-in card is gone; the session card has flipped from
prompt to reward.

Same skeleton, different job. All buildable from the existing component set
plus one line chart.

---

## 6. Design system notes

**Preserve:** pastels as card *fills* on near-black is a real point of view and
why this doesn't look like a Material template. The type scale has genuine
intent (negative tracking at large sizes is correct and rare). `ArcGauge` is
the best thing in the codebase. `WeekStrip` is the most transferable component.
The copy voice is good and consistent — don't let a workout module write in a
different register.

**The colour problem to solve before adding screens.** Five pastels currently do
nine jobs: Mint means protein, high confidence, label-verified *and* ready.
Survivable at five screens, arbitrary at twenty-five. Split by role and enforce
with shape:

- **State colours** — Mint (good), Rose (bad), Lemon (caution), Orange (primary
  action / now). **Only ever pills, dots, borders, small bars. Never a card fill.**
- **Domain colours** — Lavender (nutrition), **Sky `#8FD6FF`** (training, the one
  addition), Peach (body/progress), Paper (chrome). **Only ever large card fills
  and single-series chart colours. Never a status pill.**

**Hue tells you what, shape tells you which register.** They never collide
because they never take the same form. The macro colours are the one documented
exception; write that down in a comment so a future session doesn't "fix" it.

**Don't invent muscle-group colours.** Volume per muscle group is a sorted
horizontal bar chart in one colour with value labels. Inventing eight more
pastels is where design systems die.

**Highest-value single upgrade:** give `WeekStrip` a `markers` parameter
rendering up to three 4dp dots under each date — lavender for meals logged, sky
for a workout. Turns a date picker into an at-a-glance week summary.

**Chart rules:** on `DarkCard` never on pastel; no vertical gridlines ever, max
three horizontal ones and only where a value must be read off; label first, last
and extremes only; one colour per chart from the owning domain; rounded bar
caps matching the pill vocabulary; animate on first appearance only; and
interaction is a **drag scrubber updating a fixed readout above the chart**, not
floating tooltips, which are a touch-hostile pattern borrowed from the web.

**Also worth doing:** replace functional emoji (the macro icons, the plate
fallback) with vector glyphs or bold C/P/F monograms — emoji can't be tinted,
render differently per Android version, and TalkBack reads "avocado" mid-macro.
Keep the decorative ones; they're charm, not information. Add a real font family
(Inter, ~350KB, genuine tabular figures) since there's currently none specified
at all and the platform default varies across Samsung firmware.

---

## 7. Where the analyses disagreed

Recorded so a future session revisits the decision rather than rediscovers the
argument.

**Navigation library.** The architecture pass wanted Navigation-Compose with
type-safe routes. The design pass wanted to keep the hand-rolled sealed class,
promoting it to a stack-per-tab in ~50 lines, preserving the zero-dependency
ethos.

*Call: Navigation-Compose.* The deciding factor is that deep links and launcher
shortcuts are wanted (a notification tapping through to a live workout, a
"Snap a meal" long-press shortcut, a future widget), and those are effectively
free once real routes exist and awkward to retrofit onto a hand-rolled stack.
Type-safe routes also mean a bad route is a compile error rather than a runtime
one, which matters disproportionately when there's no emulator and every
mistake costs a full CI round-trip. If the dependency ever feels wrong, the
stack-per-tab design is a documented fallback.

**When to build body weight.** The product pass wanted it in the first phase,
before Room. The nutrition pass warned that every new feature built before the
migration means another hand-rolled JSON file to migrate later.

*Call: Room first (Stage 2), body weight immediately after (Stage 3).* It lands
directly in the database and no throwaway persistence gets written. The cost is
that the keystone arrives one stage later, mitigated by Stage 0 delivering
visible wins immediately so the early work isn't all invisible plumbing.

**How much to trust portion decomposition.** The nutrition pass proposed asking
the model for plate fraction plus a depth bucket and computing grams in code,
but ranked it ninth and was explicit that the depth term degrades badly (a
mounded versus medium bowl differs by ~60%).

*Call: park it until Stage 8.* Food memory and one-tap correction close the same
gap more reliably. Build it only for genuinely novel meals, after the
corrections pipeline exists to catch its errors rather than silently log them.

**Self-consistency sampling** (running inference twice and using the spread as
real confidence, since a small model's verbalised confidence is barely
calibrated) is a good idea that roughly doubles latency. *Call: build it
together with the malformed-JSON retry, since the retry needs a second sample
anyway, and gate it to items with no label and no memory match.*

---

## 8. The one-year picture

Fifty-odd weekend commits. The app opens on Today in under a second, offline,
on a plane, with no account, no ads and no sync spinner.

The Progress tab holds something that doesn't exist anywhere else: **a year of
one body, fully instrumented.** Three hundred weigh-ins under a smooth trend
line. Five phases annotated. Four hundred meals with photos. A hundred and fifty
sessions. And laid over all of it, 1RM curves for the big lifts, so scrolling
back through the year reads as a story: *this is the block where bench went up
12 kg, and here's exactly what I was eating and weighing while it happened.*

Maintenance isn't a formula's guess any more. It's a measured number with a
year of evidence, revised eleven times, each time for an inspectable reason.

The sentence that makes it worth having built:

> *"It's the only thing that can tell me whether my cut is costing me strength."*

And the quieter differentiator: **it never has to lie.** No "you burned 612
calories!" to make a session feel worthwhile. No streak to protect. No premium
tier withholding the trend line. When the data says the plateau is real, it says
so. An app with no business model can afford to be honest, and over a year that
honesty is the only reason the numbers stay worth trusting.

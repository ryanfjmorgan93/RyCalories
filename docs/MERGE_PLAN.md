# Merge plan — Iron + RyCalories → one fitness app

Written for the owner and for any future session picking this up. It supersedes the
sequencing and architecture sections of `ROADMAP.md` on the
`claude/meal-calorie-tracker-apk-4g67r7` branch. That document's product thinking
(§0 thesis, §3 what-not-to-build, the food-memory and adaptive-TDEE strategies, §5
Today screen, §6 design analysis) remains excellent and is carried forward here.

Derived from nine parallel analysis agents reading both real codebases, plus three
adversarial verification passes. Where a verification pass overturned a research
conclusion, the corrected version is what appears below, and the trap is recorded in
§6 so nobody re-derives it.

---

## 1. Decisions already made (locked — do not relitigate)

| Decision | Choice |
|---|---|
| Foundation | **Iron's web stack.** TypeScript, React, Dexie, Capacitor. RyCalories' Compose UI is rewritten in React; its ML Kit code becomes a Capacitor plugin. |
| Scope for v1 | **Merge both feature sets + fix the known gaps.** Not the cross-domain intelligence tier. |
| Data | **Training history is preserved in place. There is no meal history to migrate** — the Kotlin app never left beta, so nutrition starts empty. |
| AI | **Keep Gemini Nano + Open Food Facts. Drop Gemma/MediaPipe entirely.** |

The decisive argument for the foundation was testability. Iron runs 120 unit tests, 17
end-to-end tests and full screenshot capture inside a sandbox in seconds. The Kotlin app
cannot be run, screenshotted or tested there at all — every change costs a manual APK
install. That asymmetry compounds over a project measured in years of weekends.

A second argument emerged from the analysis and is worth recording: **the workout app is
the larger and better-tested of the two** (10,072 lines with 137 tests, versus 2,732 lines
with none). Porting the smaller, untested half onto the larger, tested half is the correct
direction regardless of language preference.

---

## 2. Before anything else

### 2.1 There is nothing to rescue

The original plan opened with a data-rescue phase. It does not apply: the Kotlin app never
left beta and holds no meal history worth keeping. Nutrition in the merged app starts
empty, and the Kotlin app can simply be uninstalled.

Two facts from that analysis are still worth keeping, because both would be expensive to
rediscover:

- `MealRepository.load()` returns an empty list on **any** parse failure
  (`MealRepository.kt:27-31`), and every mutation then rewrites `meals.json` from that empty
  in-memory list via an atomic temp-file rename (`:53-61`). There is no `.bak`. One
  unparseable meal would have permanently destroyed the whole history on the next write.
  **The TypeScript rewrite must not reproduce this shape**: never let a read failure
  silently become an empty collection that a later write then persists.
- App-private data cannot cross a package boundary. `com.rycalories.app` and the merged
  `com.rycalories.iron` are different Android packages, `file_paths.xml` exposes only
  `captures/` and `photos/`, and `adb backup` is unavailable on Android 12+. If anything in
  the old app ever *does* turn out to be worth keeping, that is the constraint to plan
  around.

### 2.2 An unflagged privacy breach

Both apps ship `android:allowBackup="true"` with no `dataExtractionRules`
(`app/src/main/AndroidManifest.xml:11`). Google Auto Backup has therefore probably been
copying `meals.json` and your photos to Google Drive. That contradicts the zero-cloud
principle the whole project is built on. The merged app should set explicit extraction
rules, and the old app should be uninstalled rather than left dormant.

### 2.3 The bar

> "I'm not using this thing as my daily driver until it works seamlessly."

That is the acceptance criterion for the whole plan, and it is why P3 (manual nutrition
entry, no AI) outranks P4 (the AI plugin). A logger that needs a working model to record
what you ate is not seamless. The AI is an accelerator on top of something that already
works without it.

---

## 3. What the merge actually is

### 3.1 The line between native and web

Verified by reading the code, not inferred: `Generation.getClient()` takes **no Android
Context at all** (`OnDeviceMealAnalyzer.kt:70-77`). The Context it needs internally arrives
via `com.google.mlkit:common`'s `MlKitInitProvider`, a ContentProvider that auto-initialises
ML Kit and merges into a Capacitor APK exactly as it does into a Compose one. Nothing in
the AI pipeline needs Compose, an Activity, or a Service.

**Stays Kotlin (~550–700 lines):**

- `OnDeviceMealAnalyzer` in full — Nano probing across all four model variants, inference,
  and the structured-output-to-plain-text fallback.
- `NanoSchema` — unportable by nature. It is a compile-time KSP artifact, not runtime data.
- `ProductLookup.scanBarcodes` — about 15 lines, the only part touching ML Kit.
- `ImageUtils` decoders — needed at two resolutions, see below.

**Moves to TypeScript:**

- **All of `ProductLookup` except barcode scanning.** It is 260 lines of HTTP, JSON and
  token scoring. Every tunable in it (the 0.5 overlap threshold at `:157`, the 0.3 at
  `:225`, plural stemming at `:180`) becomes a Vitest test against recorded fixtures. In
  Kotlin each tweak costs an APK install.
- **`NutritionJson.parse`**, `toAnalysis`, and every prompt string. Prompts cross the
  bridge **as data, not as compiled-in constants** — that is what makes prompt iteration
  and the malformed-JSON auto-retry sandbox-testable.

### 3.2 Three bridge facts that shape the plugin

1. **Capacitor runs every plugin method on one shared background thread**
   (`Bridge.java:138`, `:216-217`, `:863`). A synchronous multi-second inference would
   block your rest timer's notifications, Filesystem and Share for its whole duration. The
   plugin must own a `CoroutineScope(SupervisorJob() + Dispatchers.IO)`, launch, and return
   immediately. Compose got this free from `viewModelScope`; here it is hand-rolled and
   **not optional**.
2. **Everything crossing the bridge is a JSON string** (`native-bridge.js:843`). Pass
   photos as a **file path, never base64.** This is settled independently by the pipeline
   needing the same source decoded twice — 1024px for the model
   (`MainViewModel.kt:227`), 2048px for barcode reading (`:262`).
3. **The error channel is richer than it looks.** `reject()` carries a string code *and* an
   arbitrary data object, and every key lands on the JS Error (`PluginCall.java:74-92`,
   `native-bridge.js:945-951`). So `STRUCTURED_OUTPUT_REQUEST_ERROR` can ride across
   intact as `err.data.genAiErrorCode === -104`, with no stringify-and-reparse.

### 3.3 Why the schema migration cannot lose your training history

Verified in the shipped Dexie source (`node_modules/dexie/dist/dexie.js:4098-4107`):
`version().stores()` **accumulates** across versions rather than redeclaring. Tables omitted
from `version(2)` survive by construction; only an explicit `null` drops one. So a purely
additive `version(2)` physically cannot reach the eight workout tables.

The real data-loss surface is not the schema. It is **three identifiers**, any of which a
rebrand could plausibly change:

- the Dexie database name `'iron'` (`src/db/db.ts:27`)
- the Capacitor `appId` `com.rycalories.iron` (`capacitor.config.ts:4`)
- the WebView origin (`server.androidScheme` / `hostname`, currently unset)

Changing any one orphans months of history. All three need a load-bearing comment saying so.

---

## 4. The sequence

Every phase ends with an installable APK you can use daily. The app must never be broken
for days. P0 (rescue the meal data) is deleted — see §2.1.

### P1 — Make Iron safe to migrate · **S** · ✅ shipped (`fd0b542`)

None of it visible, all of it load-bearing.

1. ✅ **Boot error boundary and recovery screen.** `main.tsx` was a bare `void boot()` with
   no error boundary anywhere in `src/` and an empty `#root`, so a failed Dexie upgrade
   meant a permanent, undiagnosable white screen on the app holding the training history,
   fixable only by a new APK. `src/boot/recovery.ts` now renders a plain-DOM screen naming
   the error and the version attempted, with a raw-export button that opens IndexedDB
   directly. It imports nothing from the rest of the app, so it cannot fail for the same
   reason the app failed. Four tests in `recovery.test.ts`.
2. ✅ **`versionCode` from the CI run number** (`GITHUB_RUN_NUMBER + 100`, else 9000).
   The honest reason is diagnosability and rollback ordering, not installability: **no Iron
   update problem is ever solved by uninstalling Iron.**
3. ✅ **Published as a release, not a prerelease.** `prerelease: true` is exactly what makes
   `/releases/latest/download/` return 404 forever.
4. ✅ **`minSdk` 23 → 31 only.** `compileSdk` deliberately untouched: CI provisions only
   `platforms;android-35` (`build-apk.yml:29`) and AGP is pinned at 8.7.2. Moving to 36
   would break the very install loop this phase exists to repair, and if the spike later
   proves 36 is needed that is one atomic commit changing `variables.gradle`, the CI package
   list and AGP together.
5. ⬜ **The additive route table** (§5.1) — an engineering decision, not a mockup decision.
   Lands with P3, which is blocked without it.
6. ⬜ **Playwright in CI**, or stop describing end-to-end tests as a gate. The workflow's
   only test step is `npm test` (`build-apk.yml:34`); the e2e suite runs on manual
   discipline alone.

### P2 — Schema v2 and the backup fix · **M** · ✅ shipped (`14425b3`)

Originally three things; the importer is gone with the meal history, so it shipped as two —
still one commit, because they could not safely be separated.

- ✅ Additive Dexie `version(2)`: `meals`, `mealItems`, `foods`, `productCache`, `phases`.
  `stores()` accumulates across versions rather than redeclaring, so the workout tables are
  inherited untouched and only an explicit `null` would drop one. `mealPhotos` and `imports`
  were dropped from the original list: photos are a path on a `Meal`, and with no import
  there is nothing for `imports` to record.
- ✅ **No `crypto.subtle` inside `.upgrade()`** — in fact no upgrade callback at all.
  `stableUuid` is async, and a foreign await inside a Dexie transaction raises
  `TransactionInactiveError` on a real WebView while **passing under fake-indexeddb**: a
  sandbox test going green on a pattern that bricks the phone. The rule is recorded in a
  comment at the version declaration for whoever writes the next migration.
- ✅ Backup fixed in the same commit. Replace-mode cleared every table and repopulated only
  the ones it knew, so adding nutrition tables without this would mean **every backup from
  here on silently omitted nutrition data while the restore sheet reported success**.
  Replace now clears only what the file can put back, `isBackup` reads the version field it
  previously ignored, and a file from a newer build is refused rather than stripped.
  Nine tests in `backup.test.ts`, one of them the exact old-file data-loss case.
- ✅ `foods` is declared but **populated by nothing and consumed by nothing** in v1. It
  exists only to avoid a later migration. Not a half-built feature.

**Still to verify on the phone, not in the sandbox.** The fake-indexeddb tests prove the
schema delta and the row counts; they do **not** prove the upgrade completes on-device.
`version(2)` should reach the phone as a release that does nothing else, with a Settings
diagnostics line showing live session and set counts plus the Dexie version — confirm that
line before a single nutrition screen is written.

### P2b — The Nano spike · **S** · concurrent with P2, not before it

High uncertainty, low optionality: if Nano turned out to be impossible, P1 through P3 would
be unchanged. So it runs early but it is **not** the first thing.

A throwaway APK containing `probe()`, one `analyzeMeal(filePath)`, and a debug button that
schedules a rest notification **while an analysis is in flight** — that last part is what
proves the threading fix in §3.2.

**The one question only a phone can answer:** does AICore report Gemini Nano available
under `com.rycalories.iron` rather than `com.rycalories.app`? Nothing in the ML Kit
artifacts suggests package-name gating, but the rollout is per-install, and you have already
seen a Fold 8 report `UNAVAILABLE` for hours before spontaneously working. Budget for that
possibility rather than treating it as a failure.

Also measure, because nobody has a number: wall-clock latency of inference, and separately
of `@capacitor/camera`'s own full-resolution decode-and-re-encode, which runs on that same
shared thread inside third-party code you cannot move.

### P3 — Nutrition UI, manual entry first · **M** · ✅ core shipped (`a1c53b9`)

**The phase that makes the merged app usable.** Deliberately **no AI**: Food tab, manual add
and edit, day navigation.

Manual entry early is not a consolation prize, and with no meal history to import it is the
*only* route by which a single calorie reaches the database. It is also the honest floor of
§2.3: a food logger that needs a working on-device model to record what you ate is not
seamless. Everything in P4 is an accelerator on top of this.

Shipped:

- ✅ Food tab: day navigation (capped at today), calories and protein against target, macro
  split, meal list. Home shows eaten against target and links through.
- ✅ Meal composer and editor. A new meal is held in local state until Save, so a half-typed
  meal is never written; a saved meal edits in place. **Editing any number, before and after
  saving** — the top-wanted feature in both handovers — needs no recalculation step, because
  totals are derived rather than stored.
- ✅ Food entry in either form the world supplies: a weight against per-100g label values, or
  macros for a whole portion. The Atwater check surfaces as one tappable line offering the
  implied calorie figure.
- ✅ Logging to a past day, and copying a meal to today.
- ✅ Settings reports the live schema version and the meal count — **the line to check on the
  phone** after the version 2 bump, which the sandbox cannot verify.

Also shipped, pulled forward from P6 and P5 because they are what "seamless" actually
means for daily use:

- ✅ **Food memory** (`5088e24`). Anything eaten before is offered before a number is typed,
  at the weight last eaten. Stored per 100 g, never as a portion — portions vary, per-100g
  figures do not — which is why an unweighed "1 bowl" is deliberately not remembered at all.
  Merging respects the trust hierarchy: a label may correct a remembered guess, a guess may
  never overwrite a correction.
- ✅ **Open Food Facts label lookup** (`f5b0c8f`, `1ff9c34`). Name a packaged food, give the
  brand, and its per-100g figures and serving weight fill in. Every failure path returns "no
  answer" rather than throwing; offline it does not ask but still answers from cache. Hits are
  cached indefinitely, misses for thirty days, network failures never. A Settings toggle turns
  it off, and off means no request is made.

Still open in this phase:

- ⬜ The additive route table of §5.1 in full. Food was added alongside every existing path,
  and Exercises moved from the bottom bar to the Routines screen to make room; `Today` and
  `Train` as distinct hubs are not built.
- ✅ **Weekly and trend views**, pulled forward from P5: a Progress tab showing bodyweight,
  eating and training over a two-, four- or eight-week window. This is the second cross-domain
  query and the one that answers what the merged app exists for.
- ✅ Barcode scanning. Done without a native plugin: the WebView's own camera stream
  (`getUserMedia`) decoded by the `barcode-detector` ponyfill over a bundled zxing-wasm binary,
  feeding the `lookupBarcode` that had been waiting. Proven in CI with Chromium's fake camera fed
  a hand-encoded EAN-13, on the full Chromium build — the headless shell never paints a frame.

**Verification findings from this phase, all worth keeping:**

1. The end-to-end helper cleared IndexedDB but not the service worker or its precache. Since
   the app registers a service worker with `immediate: true`, the first navigation after a
   rebuild could be served the *previous* build's bundle — a green run against code no longer
   in the repository. `e2e/fresh.ts` now unregisters and clears caches, and is shared by every
   spec.
2. A Playwright `click()` resolves when the DOM event dispatches, not when the handler's write
   commits. Navigating immediately afterwards aborts the IndexedDB transaction and the record
   is silently lost. Two tests failed about one run in three until every save waited for the
   navigation the save performs; three latent instances of the same pattern in the existing
   suite were given explicit waits too.
3. `locator.isVisible()` does not wait, and its `timeout` option is ignored. Used as a guard
   for an optional step it silently answers "no" for anything not yet rendered, so the click is
   skipped and the test walks past a step that never happened — which is how the Hevy
   re-import test came to leave a modal sheet open mid-test while passing. Replaced with a
   helper that waits.
4. An 87-agent adversarial review of the nutrition code raised 27 findings, of which 12
   survived independent verification and were fixed in `e742c08`. The pattern earns its cost:
   the worst finding was a midnight roll-over that was an unconditional no-op, writing a 00:20
   snack to the previous day. Reviews of this shape should precede any release the owner is
   not going to verify by hand.

### P4 — On-device assistant and the progressive-overload build · **L** · ✅ shipped

What actually landed differs from the plan above in two ways worth recording.

- **The Nano plugin is Java, not Kotlin, and it answers questions rather than photos.**
  `genai-prompt:1.0.0-beta4` ships a Java facade (`GenerativeModelFutures`, ListenableFuture +
  `DownloadCallback`), so `NanoPlugin.java` needs no Kotlin toolchain and `compileSdk` stays 35 —
  verified by inspecting every transitive AAR for `minCompileSdk`. The bridge-thread rule of §3.2
  holds: every future resolves on the plugin's own single-thread executor. The meal-photo pipeline
  was not ported; the owner chose a small assistant box (exercise questions, "or anything else"),
  fed a compact context from the training and nutrition data (`src/db/assistantQueries.ts`, under
  Nano's ~4,000-token input limit), with a Claude backend left as a second `AssistantBackend` for
  later. Inference is verified only on the phone: Settings → Assistant shows AICore's own status,
  offers the download, and a Test button asks a fixed question.
- **Barcode scanning needs no ML Kit** (see P3).

The rest of P4 is the progressive-overload work: failure and drop sets, RPE/RIR, e1RM and personal
records, weekly sets per muscle with a body map, supersets, plate maths, warm-up ramps, deloads
that break a stall streak, a next-session plan on Home with last time's numbers, a training
calendar with a streak, animated exercise diagrams for 302 exercises (`@bryllim/workout-guide`,
CC BY-SA, converted to 4-colour palette PNGs at build time: 4 MB for 906 frames, where lossy
WebP came to 13 MB), and strength standards on the two barbell lifts the seed has a standard for.
None of it added a Dexie table: every new field is optional, and the seed rows are patched by
`migrateSeed()` (keyed on `Settings.seedVersion`, run after boot and after every restore, never
inside a Dexie upgrade).

**Review findings from this phase, all fixed before release.** A five-lens Sonnet review with three
refuters per finding confirmed nine defects and refuted none: a heaviest-first plate walk that told
a user with only 25s and 20s that 100 kg was "30 kg short" (now an exact search, which deload and
warm-up loads inherit); extending a superset to a third exercise orphaning the first; undoing one
of two swaps to the same substitute deleting the other swap's sets; the superset rest timer never
firing once the later member was skipped; swapping to an exercise already in the session producing
two cards; edit-sheet chips under the 44 px tap floor; Settings drafts wiped by any instant-save on
the screen; a strength change labelled "in 4 weeks" over two days of data; and the assistant's
download state never reading as downloading. The pattern earns its cost again: none of these was
caught by the 590 unit tests or 62 end-to-end tests that were green at the time.

### P5 — The known gaps and the design pass · **M**

ROADMAP §1's bug list (§6.2 below), the design token split (§5.2), and implementation of
whatever the commissioned mockups return. The weekly and trend views are done (see P3).

**The rule the trend view is built on, worth carrying to anything else that summarises.** A day
with no food logged is not a day of eating nothing, and averaging it in as zero produces a figure
that is not imprecise but false — three logged days and four blank ones would report an intake
less than half the real one, and that number would then be read as evidence for eating more. So
unlogged days are excluded from every average, the count of days each average stands on is shown
beside it, and below half coverage the screen says outright that the averages describe the logged
days rather than the window.

**Findable actions, sheets that pull down, and the back gesture (September 2026).** The owner
spent a while hunting for New meal's three header icons (book, triangle, plus — no words). Every
header action now shows a word; icons remain only for Back, the Food day arrows and row-level ⋯
menus, and New meal carries the same labelled Add food / From a recipe / Estimate row the saved
meal already had. Sheets close on a pull down (`src/ui/components/sheetGesture.ts` decides,
`Sheet.tsx` wires native touch listeners). The Android back gesture used to leave the app
outright, past any open sheet or unsaved meal; with `@capacitor/app` it now closes the top sheet,
else does what the screen's back arrow does, else minimises (`src/state/overlays.ts`). Escape
drives the same stack — it used to close every stacked sheet at once. Because back now navigates
instead of leaving, an unsaved meal or recipe asks "Discard?" first, from the arrow and the
gesture alike.

### P5b — Cooked meals · **M** · ✅ shipped

Photo or type a home-cooked meal, answer "how many eggs?", save it as a recipe, log your share.

- **Numbers never come from the AI.** Gemini Nano (on the phone, `NanoPlugin.analyzeMeal`, an
  `ImagePart` through the same `genai-prompt` 1.0.0-beta4) only names ingredients. Amounts are the
  user's; per-100 g figures come from a scanned pack, FoodMemory, or the bundled UK table (CoFID
  2021, OGL v3.0, 2,854 foods plus ~94 curated aliases).
- **Manual entry is the floor.** "Type it" parses "3 eggs, 30g cheddar, 2 rashers bacon" with no
  AI; "Add ingredients" searches memory and the table. Take a photo is only enabled when the
  assistant reports ready.
- **One ingredient at a time**, as the owner described: "Eggs — how many?", with Scan pack,
  Change food and Not in it on every card. New cards start with no amount; Save stays off until
  every ingredient has an amount and figures.
- **A share is one portion-basis meal item**, scaled from the totals the review shows, so eating
  the whole dish logs the total on screen. Portions by default; weigh the dish and the plate for
  batch cooking.
- **The photo is never kept.** It is downscaled in JS, written to `Directory.Cache/meal-photos`,
  handed to Nano by path, and deleted in `finally`; the folder is swept whenever the builder opens.
  This answers §8 Q1 for this feature: no meal photos are stored.
- Schema v3 adds `recipes` (ingredients embedded in the row, so one `put` is atomic).
- **Estimate a meal out** (offline, no web lookup — declined on cost): type "Five Guys double
  bacon cheeseburger" and Nano breaks it into named parts with rough weights
  (`MEAL_ESTIMATE_SYSTEM`/`parseMealEstimate`), matched against the same UK table/FoodMemory and
  sent straight to Review — no one-at-a-time walk, since the amounts already arrived. Every
  estimated amount is marked (`RecipeIngredient.amountEstimated`) and shown "≈ … · est."; editing
  an amount clears its own marker. `recipeSource` logs and remembers the whole share as `'model'`
  — the lowest trust there is — while any amount is still a guess, whatever the ingredients'
  figures sources. Entry points: a fourth start option gated on Nano `ready`, and an `estimate-meal`
  button on `MealEditScreen` (new and existing meals) that opens the builder on `?start=estimate`.

### P5c — Talking to Claude: copy out, paste back · **S** · ✅ shipped

Option 1 of the coach choices (option 3, a bigger model on the phone, is next). The app never
calls Claude; the owner carries text both ways in their own Claude app.

- **Copy for Claude** (Progress → Claude): `buildClaudeSummary` (`src/domain/claudeSummary.ts`)
  writes plain dated lines — sessions and top sets, food averaged over logged days only (the
  count of logged days sits beside every average), weigh-ins, and routines if switched on
  (off by default). It ends with the one line format a reply should use so it pastes back.
  Copy or Share hands the text to the OS; nothing is sent by the app, so Settings → About's list
  of three is unchanged.
- **Paste a routine** (Routines → New routine): `parseRoutineText` reads the reply,
  `matchExercise` matches each name against the library (exact on name or alias, else token F1
  above 0.5 with gym abbreviations expanded), and every unmatched row waits for Choose or Add new
  before Save. `saveParsedRoutines` writes every routine of one paste in one transaction, learns a
  chosen name as an alias, and adds an unknown name once even when two days use it.
- A weight in the reply starts the exercise in normal mode at that weight; no weight starts it
  calibrating. A seconds line only sets seconds on a timed exercise.

### P6 — Explicitly deferred to v1.1

Adaptive TDEE and the strength-versus-cut "Loop" chart — the cross-domain tier not chosen for
v1. Recorded here so they are deferred deliberately rather than forgotten.

Food memory was on this list and has been pulled forward into P3: it turned out to be the
difference between a logger that is used daily and one that is abandoned, which puts it under
§2.3 rather than in the intelligence tier.

---

## 5. Design and structure decisions

### 5.1 Navigation — additive, not a re-path

Adopt `Today / Food / Train / Progress` with Settings on a gear icon, **but keep every
existing Iron path exactly as it is** and add `/food`, `/train`, `/progress` alongside.

Re-pathing to a nested structure (`/train/routines`) would break all 17 end-to-end tests
and, worse, silently misplace the rest timer: `src/ui/RestTimerBar.tsx:16` positions itself
by testing for the literal `/session/` prefix.

Under that scheme ten of Iron's thirteen screens survive untouched or with a one-line edit.
Only `HomeScreen` is deleted, its parts redistributed to Today and a new Train hub. All five
RyCalories screens are rewrites, not ports.

**The live session screen changes in no way at all**, and structurally cannot be reached by
the nav rework because it already renders in a shell with no bottom navigation.

The Today hero needs no new maths: it is Iron's already-tested reverse-diet stepper
(`src/domain/nutrition.ts:17`) minus a sum over the day's logged meals, with protein as a
subordinate bar.

### 5.2 Visual direction — chassis and layer, not a blend

**Iron's look is the chassis. RyCalories' pastels become a bounded domain layer on top.**

Iron's near-black ground, single orange accent, big tabular numbers, 44px tap floor and
entire input vocabulary govern everywhere, unchanged. They are engineered for a screen
glanced at between sets and nothing about the pastel treatment improves that job.
RyCalories' pastel fills survive only as large domain-owned surfaces on dashboard and
summary screens, and are **banned from the live session and from every input surface** —
inverting text polarity mid-session is the worst thing you can do to a gym screen.

The asymmetry is real and one-directional, which is exactly why splitting the difference
would be wrong. The two halves stay one app because everything except the fills is
identical, and that is a stronger unifier than hue similarity.

ROADMAP §6's STATE-versus-DOMAIN colour rule is correct and, if anything, understated — the
census confirms Mint does four jobs, Lemon four, Lavender four. Three amendments:

- **Retire Iron's `--c-info`** (`#7dd3fc`). It is functionally the same blue as the proposed
  Sky, and it is currently a *state* colour meaning "calibrating" — it would land on the
  wrong side of the very rule being introduced.
- **Move body/progress off Peach** (already the fat macro in five places) onto a new Sand.
- **Enforce the split with radius as well as hue**, so the two registers cannot collide.

### 5.3 What the mockups decide, and what they do not

Give the design tool the tab names and a data contract, **not** the choice of tabs. The IA
decision is an engineering deliverable in P1; the tab count is the most expensive thing to
change late.

Watch for mockups that specify colour by hue ("the lavender card") rather than by role
("the nutrition card"). Fix the token names and domain roles first so that translation is
mechanical.

---

## 6. Traps — verified, and expensive to rediscover

### 6.1 Corrections to conclusions that looked right

| Believed | Actually |
|---|---|
| `@capacitor/camera`'s FileProvider collides with Iron's | The opposite. Camera ships **no** provider and depends on Iron's existing `file_paths.xml` (`CameraPlugin.java:309`, `:860`). The instruction is **do not delete it**. |
| Add `android.permission.CAMERA` | It depends which camera. For `@capacitor/camera`'s take-a-photo intent, leaving it undeclared is the supported configuration. For a live `getUserMedia` stream in the WebView — what the barcode scanner uses — it must be declared: Capacitor's `BridgeWebChromeClient.onPermissionRequest` maps the page's request to a runtime `CAMERA` prompt, and an undeclared permission is silently denied. Declared, with `uses-feature android.hardware.camera required=false`. |
| Bump `compileSdk` to 36 to match RyCalories | Breaks CI (§P1.4). Nothing shows ML Kit needs it. |
| A failed Dexie upgrade is a harmless no-op | It preserves the data and **bricks the app**. Hence P1.1. |
| fake-indexeddb tests guarantee the migration | They pass on a pattern that fails on a real WebView. On-device gate required. |
| Native surface is ~350 lines | ~550–700 once the `analyze()` signature refactor is counted. |
| Zero cloud has one exception (Open Food Facts) | **Three**, listed in Settings → About: Open Food Facts (name lookup and barcode scan, one toggle), the Video link on an exercise (opens the browser on a tap), and ML Kit's `datatransport/cct` telemetry while the assistant runs — `genai-prompt`'s POM pulls it, and no opt-out is documented. |

### 6.2 Bugs found in RyCalories that the handover did not list

- **The portion multiplier scales calories and macros but not grams**
  (`MainViewModel.kt:275-300`). Left in place this would have quietly poisoned the entire
  food-memory strategy at its root, since memory stores per-100g and derives portions.
  Making per-100g-plus-grams the only stored state, with all totals recomputed on read,
  makes this bug unrepresentable rather than fixed.
- The truncation path in §2.1, which is the most dangerous line in either codebase.

ROADMAP §1's own list is accurate. Its first two entries are now fixed in the port rather
than carried across: the brand-match false positive (`ProductLookup.kt:157`) — a query naming a
brand now requires a shared brand token, absolutely, and scoring is symmetric so a variety
multipack cannot outrank the product it contains — and the missing Atwater cross-check, which
is in `src/domain/food.ts` with asymmetric margins and an absolute floor. §1.2, the barcode
overwriting the wrong item, applies only to the photo-enrichment path and lands with P4. §1.3
("can't log to a past day") and §1.6 (absolute photo paths) are already dissolved: `Meal`
separates `date` from `loggedAt`, and `photoPath` is documented as relative to the data
directory, never absolute.

### 6.3 Three ways a Playwright assertion proves nothing

Found the hard way in September 2026, after a real data bug (an unrelated Settings tap silently
starting the reverse diet, `saveSettings` stamping `calorieStartDate` on any save) sat behind a
green CI tick for days.

| The shape | Why it passes without proving anything |
|---|---|
| Do an async thing, then assert something is **unchanged** | `toHaveValue` / `toBeVisible` / `toContainText` pass on the FIRST poll that matches. At the moment of the click the old value is still correct, so the assertion passes instantly — before the change it guards against can arrive. `settings.spec.ts` passed this way in CI in 675 ms while failing 4/4 times locally. |
| Wait on a **transient signal a previous occurrence could satisfy** | A toast lives 2200 ms (`Toast.tsx`) and repeats verbatim. `home-weight-delta.spec.ts` deleted four routines in a loop waiting on a shared "Routine deleted" toast; the last iteration had no following click to force a real wait, `page.goto('/')` tore down the document mid-transaction, a routine survived, and the rotation then moved off the routine the test asserted on. Wait on the item's own row disappearing, as `guidance.spec.ts` does. |
| **Sample state once, without retrying** | `getAttribute('class')` does not poll. Sets are logged by a fired-and-forgotten handler, so the Dexie write and the liveQuery re-render land after the click resolves. That is what made `overload.spec.ts`'s superset test fail once and pass on retry. Use `expectClass` in `e2e/fresh.ts`. |

Two structural consequences, both now in place:
- **`retries: 0`.** Playwright reports "failed once, passed on retry" as a plain success, so the
  flake was invisible in the CI step result. CI is the only gate this app has.
- **Run the browser CI runs.** Local runs pinned `/opt/pw-browsers/chromium`, twelve major Chromium
  versions behind the build `@playwright/test` ships, and local and CI disagreed on real tests.
  `playwright.config.ts` now prefers the Playwright-managed build and keeps the sandbox binary only
  as a fallback.

Related: **a fix scoped to one screen is not a fix.** The 0 kg lock-in guard went onto
`ExerciseDetailScreen`'s sheet and missed `SummaryScreen`'s — the path taken at the end of every
session. Nothing below the UI has a floor, so ask where else the same control appears.

### 6.4 History safety — what the backup work taught

The owner lost workout history across an ordinary update, and nothing in the code explains it:
the signing key, `applicationId`, monotonic `versionCode`, WebView origin, Dexie name and the
additive schema were all checked clean. So the defence is detection and recovery, not a cause:
automatic backups to `Documents/Iron` (daily, after every finished workout, before every
migration and every reset, wipe or replace-restore), a loss notice on Home when session or set
counts drop below a baseline without an in-app delete, and a Backups card in Settings.

- **Pruning by age alone destroys the copy that matters.** After a loss the app keeps backing up
  the smaller data set, so the newest-14 rule would evict the last complete copy within two
  weeks. The backups holding the most sessions and the most sets are never pruned.
- **A Dexie DBCore middleware must not be `async`.** Its own return value is a plain Promise that
  drops Dexie's transaction zone, and every multi-table transaction that deleted through it
  failed with `PrematureCommitError`. Chain `.then()` on the promise `mutate` returns.
- **`Table.clear()` fires no `deleting` hook.** Only a `dbcore` `mutate` hook sees every delete
  path (`delete`, `bulkDelete`, `where().delete()`, `clear()`).
- **A wait on persisted state can be satisfied by the previous page load.** The baseline and the
  notice outlive a reload; waiting on them made "no notice after reload" pass before the check
  ran. `main.tsx` marks `<html data-history-check="done">` once per load for tests to wait on.
- **A re-import cannot tell "edited in Iron" from "changed in Hevy" without a fingerprint.**
  Sessions carry `importHash`; one without it that already matches the CSV is unchanged (and
  adopts one), not an edit.
- **Only the phone can prove** that files land in the public Documents folder, survive an update,
  and whether a reinstall can still list them. Restore after a reinstall is designed for the worst
  case: a file picker.

### 6.5 The glass workout screen — traps paid for in Phase 3

- **Lightning CSS drops `backdrop-filter` written before `-webkit-backdrop-filter`.** Tailwind v4's
  CSS backend silently removed the standard property, so every glass layer would have shipped with
  no blur. Write the prefixed one first. Check computed style, not source.
- **A timer that one effect arms and a later run of the same effect cancels leaves stale state.**
  The completion hold kept `currentKey` on a finished exercise for good whenever anything else moved
  it inside the 1.8 s window. The decision is now a pure function (`domain/completionHold.ts`), and
  every transition clears the hold before deciding.
- **`animations: 'disabled'` freezes CSS, not script.** Summary's figures count up in
  `requestAnimationFrame`, and a design shot caught "1 set · 813 kg" beside "3 sets". The hero
  marks `data-settled` and shots wait for it.
- **One-shot `isVisible()` was in eleven specs.** Every finish-sheet and rest-timer check now waits
  through `clickIfPresent`, scoped to the dialog.
- **A retyped set keeps its RIR.** Changing a set to Failure in the edit sheet left an inherited
  "Easy" RIR 3 on it, which could qualify a failed lift for a double increment. A non-working type
  now clears it.
- **Only the phone can prove** blur smoothness while scrolling on the Fold, how the haptics feel, the
  fold/unfold reflow mid-workout, and the Archivo rendering.

### 6.6 Barcode lookup — the second scan

- **Open Food Facts answers an unknown barcode with HTTP 404**, and a JSON `{"status":0}` body.
  It does not use a 200 for this. The live API was checked with curl. Every test had modelled a miss
  as a 200, so the app threw real misses away as failures. The owner saw "Lookup unavailable.", the
  miss was never cached, and the sheet did not change. A route or mock for an external service
  copies the service's real status codes, not the ones the code expects.
- **A failed scan must not leave the previous product on screen.** The sheet kept the last label
  under a small "Not found" line, and Save logged the old food. A draft whose figures came from a
  label (`fromLabel`, which survives a weight change) is cleared when a scan finds nothing.
- **A scan replaces the brand; it does not fall back to it.** `l.brand || p.brand` put the last
  product's brand onto a brandless one.
- **One decoded frame is not a read.** The camera loop now needs the same code on two consecutive
  frames (`src/domain/barcodeRead.ts`). A misread frame cannot be produced from the static fake
  camera, so only the pure rule is tested for it.


### 6.7 Cooked meals — traps paid for

- **`DB_VERSION` is hand-maintained and gates the pre-migration backup.** Adding `version(3)`
  without bumping it would have made `probe.version < DB_VERSION * 10` false for exactly the
  upgrade being shipped, so no backup. `src/db/db.test.ts` now fails if it drifts from `db.verno`,
  and `migration-v3.spec.ts` was shown to fail with it wound back to 2.
- **Round then sum, everywhere a total sits beside its rows** — and a share must scale that same
  shown total. Scaling the unrounded sum logged 429 kcal for a whole omelette the review called
  430.
- **The curated alias must not outrank what the owner taught the app.** With the alias first, a
  corrected egg weight or a scanned bacon pack was remembered and never used again.
- **Never block the Nano plugin's single worker thread on inference.** Every method's completion
  runs on it; `analyzeMeal` decodes there and hands inference back through a listener.
- **On Android 11+, `<input type=file capture>` needs a `<queries>` entry for IMAGE_CAPTURE**, or
  Capacitor's chooser can silently fall back to a file picker.
- **A tight loop of set-done clicks logs the wrong sets.** The table only moves on when the live
  query answers; filling the next row first types into the row still live. `logOneSet` in
  `e2e/fresh.ts` waits for the set's own logged row.

### 6.8 Pull-to-close sheets — traps paid for

- **React's `onTouchMove` is passive**, so it cannot `preventDefault` and the list scrolls under
  the dragged sheet. The listeners are added by hand with `{ passive: false }`.
- **The browser decides at the first touchmove, not ours.** Chrome swallows about 16 px of slop,
  then the first touchmove is the only one that can stop a scroll starting. Whose gesture it is
  gets decided there, once; a move that arrives uncancelable already belongs to the browser.
- **A touch that starts while a list is still coasting from a fling arrives uncancelable** (a
  Chrome intervention). A test that swipes again straight after a flinging scroll passes whatever
  the sheet decides; `swipe({ holdMs })` lifts the finger without speed.
- **Synthetic DOM `TouchEvent`s prove nothing here** — no native scroll, no `touch-action`. `swipe`
  in `e2e/fresh.ts` goes through CDP `Input.dispatchTouchEvent`, with explicit timestamps: a CDP
  round trip is tens of milliseconds, and without them every flick measured as a slow pull.
- **Drag state is written straight onto the panel**, not through React state, so a test watching
  `data-drag-state` sees a drag inside the touch handler, not a render later.
- **"Wait a frame, then see if the panel is still there" is a race.** After a pull-away the sheet
  asks its caller to close and slides back up if the caller declined. Judged one animation frame
  later, a slow render left the panel in place and a closing sheet bounced up first (one full local
  run in about ten). The close now runs inside `flushSync`, so the panel's presence is the answer
  the moment it returns; the test forces every frame ahead of React's render so the old order
  cannot hide. A close that navigates is a transition `flushSync` cannot flush — close the sheet's
  own state first.
- Each of the four behaviours (scroll first, flick, settle back, top-only Escape) was shown to fail
  its test when broken on purpose.

### 6.9 Paste a routine — traps paid for

- **A tie is not a match.** "Curl" scores the same against DB Curl, Hammer Curl and Neck's alias
  "Neck Curl"; breaking the tie by the shortest name sent a pasted curl to neck work. Two different
  exercises at the same top score now leave the row for the owner, and an exercise matched on its
  own name beats one matched only through an alias.
- **A chatbot's routine is not one exercise per line.** It numbers supersets "A1." / "B2)", puts
  two exercises on a line ("Superset: Bench 3x10, Row 3x10"), labels groups ("Superset 1:",
  "Circuit (3 rounds):") that must not start a new routine, writes warm-up and cool-down blocks
  and tempo/rest notes that are not exercises, gives minutes ("3x1 min"), weight ranges
  ("@ 70-80kg", which starts at the lower end) and open reps ("3xAMRAP", "3 sets to failure").
  Each of those left junk in a name or saved a note as an exercise before; each has a test in
  `routineText.test.ts` shown to fail on the old parser.
- **A regex's optional unit swallowed the space after the numbers**, so " and " never matched as a
  separator between two exercises. The whitespace belongs inside the optional group.

---

## 7. Repo and release

Both branches live in `ryanfjmorgan93/RyCalories` with **no common ancestor and no `main`**.
That should be resolved deliberately: keep this branch as the line of development, publish
under one rolling release tag, and retire the Kotlin branch to a tag. Nothing now depends on
that branch — with no meal history to extract, it can be tagged and abandoned today.

Do not change the `applicationId` or the signing key. Both apps' handovers record the same
hard-won lesson: Android treats a changed ID as a different app, with an empty data
directory. The merged app keeps `com.rycalories.iron` and its existing keystore, regardless
of what the app is eventually called on the launcher.

---

## 8. Open questions for the owner

1. **Photos: Dexie blobs or Capacitor Filesystem?** *Answered for cooked meals (P5b): meal
   photos are not stored at all.* Still open if a feature ever needs to keep one. Note `@capacitor/camera` returns a path
   into `cacheDir`, so a photo must be explicitly copied to `Directory.Data` before its path
   is durable. Note also that the PWA build has no camera, no filesystem and no Nano — so
   browser meal entry needs a defined story either way.
2. **Does the PWA build remain a target at all**, or is the APK now the only artifact?
3. **What is the app called?** Naming is free; changing the package ID is not.

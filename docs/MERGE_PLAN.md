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

**Iron itself is closed:** its manifest sets `android:allowBackup="false"`, guarded by
`src/db/manifest.test.ts`. Its own backups (Documents/Iron, Settings → Export) are the only copy
that leaves the app's storage.

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
6. ✅ **Playwright in CI.** `build-apk.yml` runs `npm test` (line 35) and then
   `npx playwright test` (line 41) before the web build and the APK, with `retries: 0` (§6.3),
   so a red e2e stops the release.

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
- ✅ `foods` was declared in v1 to avoid a later migration, populated by nothing. It is
  now the **food memory**: `src/db/foodRepo.ts` writes it when a meal is logged and reads it
  for the picker's ranked suggestions.

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

### P5d — The coach, on the phone's own Nano 4 · **M** · ✅ shipped

Option 3 of the coach choices. The Fold 8 is on Google's nano-v4 list (Gemini Nano 4, built on
Gemma 4), so the owner chose that over downloading Gemma 4 through LiteRT-LM: no 3 GB download,
nothing new leaving the phone, Settings → About unchanged.

- **The fuller variant.** `NanoPlugin` keeps the default client for Ask, meal naming and
  estimates, and builds a second with `ModelPreference.FULL` (genai-prompt 1.0.0-beta4) that the
  coach alone uses; every method takes `model: 'full' | 'default'`. Settings → Assistant has a
  Coach model line whose detail reads the base model name and token limit on the phone.
- **Streamed.** The fuller variant is slow (about 5 tokens a second measured on a Pixel), so
  `generateStream` forwards each `StreamingCallback.onNewText` piece as a `nanoStream` event and
  the answer grows on screen.
- **Fitted, not guessed.** `coachContextLadder` (`src/domain/coach.ts`) offers the owner's data
  fullest first — the same lines as Copy for Claude, food averaged over logged days only — and
  the store counts each rung with `countTokens` until prompt plus the reply's room fits
  `getTokenLimit`. An exercise the question names keeps its 26 weeks and is the last thing cut.
  Each answer says what it read ("Read: training 8 weeks · food 4 weeks · …").
- **One box, and the app builds the routine.** There is no Ask / Build toggle. `routeCoachMessage`
  (`src/domain/coachIntent.ts`) reads each message: a request for a routine is built at once by
  `buildRoutines` from the owner's exercises, the library and `loadRoutineInput`
  (`src/db/routineBuildQueries.ts`: their routines, niggles from the last 14 days, stalled lifts),
  with no model call; anything else is a question. A built routine shows what was read
  ("Read: shoulders, rear delts · 6 exercises"), about N min, Why (the builder's reason lines,
  collapsed), Shuffle (same request, new seed) and Review routine — the same Paste a routine
  review, matching, Choose/Add new and one-transaction save. Words the rules read nothing from
  are offered to the default model on a tap ("Not read: …", Read with assistant), which may only
  fill options. A question is sent with the last three exchanges, the last routine built and its
  reasons, and the owner's data; the oldest turns are dropped first when the prompt does not fit.
  Entry points: Progress → Coach, and Routines → New routine → Draft with coach (the first
  message there is a build whatever it says).

### P6 — Explicitly deferred to v1.1

The strength-versus-cut "Loop" chart — the cross-domain tier not chosen for v1. Recorded here so
it is deferred deliberately rather than forgotten. (Adaptive TDEE was on this list too and shipped
as P7, in a form that shows a figure only when its inputs allow one.)

Food memory was on this list and has been pulled forward into P3: it turned out to be the
difference between a logger that is used daily and one that is abandoned, which puts it under
§2.3 rather than in the intelligence tier.

### P7 — Maintenance calories · **S** · ✅ shipped

A "Maintenance" card on Progress, under Eating, over the same 2/4/8-week window. It is arithmetic
on the owner's own logs, not a model: what was eaten on the days that were logged, against how far
the scales moved.

- **The maths** (`estimateMaintenance`, `src/domain/energy.ts`). Intake is the mean kcal over
  logged days only. Weight is the mean of the readings in the first 7 days of the window against
  the mean of the readings in the last 7, never one day against another. Between the two groups'
  centre dates (the mean of their dates, rounded to a day) the change in kg becomes a daily
  balance at 7,700 kcal a kg; maintenance is intake minus that balance, to the nearest 50, and
  never clamped. The rate line ("At your logged 2,400 a day, about −0.1 kg a week") is worked from
  the ROUNDED maintenance, so the figure and the line under it agree.
- **Four gates, checked in this order**, each of which replaces the figure with the one fact that
  fell short (`energyText.ts` words them; the counts are always available): the window must be long
  enough for its two week-groups' centres ever to sit 14 days apart, so the 2-week window says
  "Needs the 4 or 8 week window" rather than a span it could never reach; a weigh-in is needed in
  both the first and the last week of the window; the two centres must be at least 14 days apart;
  and at least 0.8 of the window's days must be logged. A gated estimate carries no figure and no
  advice.
- **Today is left out of intake.** A day still being eaten is not a day's intake: a breakfast
  logged at ten would pull the figure down until the evening. The card passes `today`, and intake
  and the logged-days count are read over finished days only ("of 27"); today's weigh-in still
  counts, because a reading is complete when it is taken.
- **Why 0.8 and not the 0.5 that lets Eating show an average.** An average over half a window
  still describes those days. A maintenance figure needs more: it assumes the unlogged days were
  eaten like the logged ones, and every kcal of error in that intake mean lands in the estimate
  one for one, where the weight change it is set against is small. At 0.8 no more than one day in
  five rests on the assumption. The gate's "Needs 23 of 28 days logged" is worked out with the
  same comparison the gate uses (`loggedDaysNeeded`), so the line and the gate cannot disagree.
- The figure is an estimate of a body that is not a calorimeter: 7,700 kcal a kg is the usual
  conventional value, water moves the scales, and the card shows the days and weigh-ins it stands
  on beside it ("22 of 28 days logged · weigh-ins 1–5 Sep (3) and 22–26 Sep (3)").

### P8 — Short session · **M** · ✅ shipped

For the day the owner cannot face one of the five routines: Home → Short session. A typed request
("can't be bothered, four light exercises") or chips build a 30 to 45 minute session. Decided with
the owner: the typed line is read by **rules first**, and on an explicit tap the phone's assistant
may read what the rules could not; a quick session **counts toward the weekly target and streak**
and does not advance the routine rotation.

- **Generator** (`src/domain/quickSession.ts`, pure, seeded; the UI passes the seed). Focus by need
  (days since trained, capped at 14, plus twice any shortfall against `weeklySetTargets`; muscles
  trained under two days ago sit out, then the rule relaxes and says so; a little seeded wobble so
  Shuffle can swap muscles that are about equally due). A muscle named on its own may take the whole
  plan; otherwise at most two per muscle. Light = machines, cables and isolation, 2 to 3 sets of 10
  to 15 at 65% of the working weight through `deloadLoad`; no barbell compounds, hinges or standard
  lifts. No base weight means calibrating, the existing "you pick it" path. The estimate is sets ×
  (40 s work + rest) + 60 s setup per exercise, doubled work for one-sided lifts, times the owner's
  own pace (median of actual over modelled over recent sessions, at least three, clamped 0.6 to
  1.6). It is shown as "about N min" and **never clamped into 30 to 45**.
- **Request** (`quickRequest.ts`): counts, light words, "can't be bothered"-type moods, minutes,
  macro and single muscles, equipment, negation. What it cannot read is `residue`, shown as a
  fact ("Not read: …"). The assistant path (`state/quickIntent.ts`) sends the typed text to the
  default on-device model with a strict JSON-options prompt, 20 s timeout; the reply is validated
  and fills only fields the rules and the owner's taps left unset, and never an exercise or a
  weight. Real replies are checked only on the phone.
- **Storage**: no routine-free session exists, so Start creates a **hidden one-off routine**
  (`Routine.quick`, `archived: true`, `order: -1`, no `targetMinutes`) and a session with
  `Session.quick` (`'light' | 'normal'`), in one transaction with the live-session check.
  Nothing is written while previewing or shuffling.
- **Progression**: a quick session writes no weight decision (except the `calibrating` row the
  four "calibrating means no records" readers rely on), never proposes a lock-in, and a light
  session stays out of the e1RM series, strength cards and records. It counts for volume, weekly
  sets, the calendar and History.

### P9 — The exercise catalogue · **M** · ✅ shipped

518 exercises beside the 302 diagrams and 27 seeds, from free-exercise-db (Unlicense; the photos'
original source is not stated by it or by its upstream, see `docs/ATTRIBUTION.md`). Two 320 px
WebP photos each (about 6.3 MB committed in `assets/catalogue-frames/`), steps in a separate lazy
file. **Not database rows:** an exercise gets a row (`demo: 'cat:<slug>'`, which is also the dedupe
key) only when added from the Exercises list or a picker (see P9b), or when a quick session uses it. That keeps the seed,
Hevy ids, deleted seed rows and the exercise-count tests untouched. Generated by hand
(`npm run catalogue`, network needed), never in CI.

What the review of the generated data changed, all in `scripts/lib/` so a regeneration keeps it:
- **Muscle groups** follow the app's own convention, by name, in `MUSCLE_OVERRIDES`: the dataset
  files the powerlifting bench variants under triceps and scatters the deadlift, pullover and
  clean/snatch/jerk families over four groups each. Clean, snatch and jerk are "full body" (the
  shrugs stay traps); note `full body` is outside `TRAINABLE` in `quickSession.ts` and outside
  `LOWER_BODY_GROUPS`, so those lifts are not drawn by a quick session and count as upper body.
- **Kind**: pull-ups, chins, dips and muscle-ups the dataset files under equipment "other" (or none)
  are `bodyweight_plus`, so they can start at 0 kg; assisted work stays `reps`.
- **Equipment**: an EZ bar the dataset calls a barbell is `other` (no 20 kg warm-up ramp).
- **Compound**: body-only abdominal work and four named one-joint moves are isolation (75 s rest).
- **Repeats**: 21 more reviewed repeats (`REVIEWED_DUPLICATES`), and the script now refuses a
  catalogue in which two entries share a name key. `catalogue.test.ts` holds a hand-written list of
  the repeats a person found, which the name matcher could not.
- **Pictures**: not every photo is 3:2, so the catalogue's pictures are letterboxed (`object-contain`),
  never cropped; a `cat:` key whose picture is gone shows an empty box (`data-testid="demo-missing"`)
  rather than a broken image; the library says "Library unavailable", not "No matches", when the
  catalogue chunk could not be fetched.

### P9b — The whole library on show · **M** · ✅ shipped

The owner's words: "why are there only 27 exercises in the library?" The Exercises screen listed
the 27 database rows and kept the other 820 behind a search box. It now lists everything, with no
typing: one list (`buildExerciseList` in `src/domain/library.ts`, held by `src/ui/useLibrary.ts`),
the owner's own exercises first and the diagrams and catalogue they have not added after them.
- **Counts line** (`exercise-counts`): "27 yours · 794 in the library". It says "so far" until the
  catalogue has loaded and "catalogue not loaded" if it could not be fetched, never a total that has
  not arrived. The catalogue is fetched when the Exercises screen mounts or a picker opens, not at
  app start (`catalogue.spec.ts` checks Home asks for nothing).
- **Dedupe**: a library entry is dropped when the owner already has it, by the rule
  `findExistingExercise` applies (picture key, then name, then alias). `buildExerciseList` does it with
  sets for speed; `libraryList.test.ts` pins the two together, and `src/db/libraryList.test.ts` does the
  same against the real seed. Adding an entry moves one row from the library to Yours, and
  deleting the exercise puts it back.
- **Exercises screen**: Yours / All toggle, muscle chips over the whole list (a diagram with no group
  files under "other", as it will once added), search ranked as `searchCatalogue` ranks (owned rows
  stay ahead). Rows are drawn 60 at a time by an IntersectionObserver sentinel with a plain More
  button for when there is none (`src/ui/usePaged.tsx`); only drawn rows ask for a thumbnail. A library
  row opens `LibraryPreviewSheet` (the existing `ExerciseDemo`, and Add).
- **Pickers** (`ExercisePicker`: routine editing, a live session's Add, Paste's Choose): the same list;
  a library row is added and handed to `onPick` in one tap. `onPickLibrary` lets a caller take the row
  without adding it, which Paste uses so a cancelled paste leaves nothing behind. `LibrarySheet` is gone.
- **Paste a routine** matches each line against the owner's exercises and the library in one pool
  (`MatchCandidate.library`: at the same score the owner's exercise wins, and a library entry never
  makes a tie ambiguous that the owner's own settles). A library match shows the Library label, and
  `saveParsedRoutines` makes the exercise on Save (`ImportChoice` kinds `demo` and `catalogue` carry the
  entry, so the transaction never fetches anything); the same dedupe rule applies, so saving twice makes one.
- **Traps paid for**: any test that did `getByRole('button', { name: /Romanian Deadlift/ })` on the
  Exercises screen now meets the library's other Romanian deadlifts (strict-mode failure); the owner's
  row is listed first, so `.first()` is the right one. A seeded exercise's own diagram is no longer
  a library row at all (it is the seeded row), so a test that opened it from "the library" opens the
  owned row. The diagrams are 303, not 302: the neck photograph is a bespoke addition.

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
- **A scan can end with an empty name in four ways, and Save stays grey for every one.** The
  database has no entry (HTTP 404, `{"status":0}`); it has one with figures and no name; it has one
  with a name and no energy figure; or it did not answer (a 503 page, the 8 s timeout, no
  connection). Save is disabled only when the name is empty, and nothing said so — the owner scanned
  a pack of chicken fries and a pack of noodles and could not add either. Now a "Needs a name" line
  sits under the Food field whenever the name is empty and a lookup has answered or a figure has been
  typed, and each miss line says what to type. An entry with figures and no name fills the figures
  (`parseProduct` returns `name: ''`; the name-lookup matcher never picks it). An entry with a name
  and no energy fills the name and says "No figures in the database." (`lookupBarcode` returns
  `partial`).
- **Open Food Facts entries are patchy, so `parseProduct` reads what is there.** `energy_100g` is
  kJ by definition and is read as such only when `energy_unit` is kJ or absent; `energy-kj_100g` is
  converted at 4.184 and rounded. The name falls back through `product_name_en`, `generic_name`,
  `abbreviated_product_name` (all requested in `OFF_FIELDS`). Of 12 Indomie Mi Goreng entries on the
  live database, 2 had no nutriments at all — so some packs will always need typing.
- **The 30-day miss cache is per barcode, and it hides a pack that gains an entry.** A status-0
  answer and a status-1 entry the parser refuses were both cached as a miss for `MISS_TTL_MS`. The
  partial (name, no figures) is deliberately not cached: the pack is real and its name worth keeping,
  and the entry may gain figures. Misses carry `missVersion`; one recorded under an older parser
  (`missVersion` absent or behind `MISS_VERSION` in `productRepo.ts`) is asked again rather than
  trusted, so a pack the old parser refused gets a second look. Bump `MISS_VERSION` whenever the
  parser learns to read something it used to refuse.
- **Type it once.** A food saved after a scan the database could not fill is remembered against the
  barcode (`FoodMemory.barcodes`, from `NewMealItem.barcode`, which — like `unit` — is never written
  to the meal row). `lookupBarcode` asks the food memory first, before the cache and before the
  network, so the next scan fills from memory: it beats a cached miss and works offline. The memory
  key is the name, so two packs with the same name share one row: `barcodes` is the union of every
  code typed in against it, and rows written before the list existed are still read through their
  single `barcode` field (`memoryBarcodes`). A memory hit is the user's own entry, so the sheet applies it like a tapped
  suggestion and the recipe builder badges it with `memory.source`, never "label".


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

### 6.10 The coach — traps paid for

- **Exercise names are full of everyday words.** Matching any word of a name read "days in a
  row" as Barbell Row, "bw" as Bodyweight Squat and "did it dip" as Dip; with a real log the
  fullest context rarely fits, and the next rung kept only the misread exercise. Generic words
  (row, leg, back, press, bodyweight, equipment…) now count only as two words side by side ("leg
  press"), and the rest of training shrinks to 4 and 2 weeks before it goes.
- **A model can go quiet for good.** Evicted mid-question, a future may never settle, and the
  screen said "Answering…" for ever. Counting is given 20 s; an answer is given up after 2 min
  with nothing new, the clock restarting with every piece, because the fuller variant can take
  many seconds before its first word.
- **Clear must drop an answer still on its way**, or it reappears when it lands; an epoch in the
  store, bumped by Clear, ignores anything started before it (a question, a build or a Shuffle).

### 6.11 Small faults — traps paid for

- **A toggle that only the in-app path read.** "Notify when rest ends" gated the web
  Notification in `RestTimerBar`, while the timer store scheduled the native notification without
  ever reading it, so switching it off did nothing on the phone. Both paths now ask
  `shouldNotifyRestEnd`, `scheduleRestNotification` cancels first and reads the settings row
  directly (`repo.getSettings` seeds a missing row, a write that path has no business making),
  and turning the toggle off cancels the pending one at once. The plugin cannot run in Vitest, so
  `src/state/timer.test.ts` fakes it and proves only that the toggle reaches the scheduling call;
  a notification actually appearing or not is checked on the phone. The Settings permission row
  read the browser's `Notification`, which in the WebView says "Not supported here"; on the phone
  it now asks the plugin.
- **`allowBackup="true"` with no rules is a cloud upload nobody listed.** Capacitor's template
  ships it on, and Settings → About lists what leaves the device: Android's Auto Backup copies
  the whole IndexedDB to the owner's Google account behind that list. It is off, and a test
  reads the real manifest, because a regenerated `android/` or a `cap` upgrade would quietly put
  the template's line back.

### 6.12 Short session and the catalogue — traps paid for

- **A hidden routine is not in the visible list.** `suggestNextRoutine` looked the last routine up
  in the active list, found nothing for a quick session, and restarted at routine 0. Home now
  passes the last **non-quick** session for the rotation and `lastWasLower` from the true last
  session for the consecutive-lower guard, from one helper shared with Food's leg-day protein
  target (`nextRoutineContext`), so the two screens cannot disagree.
- **A light weight must never become a ghost.** `previousSets` falls back to an exercise's last
  session and `reconcileWeights` proposes weights from it; both skip quick sessions, or a real
  routine would show the 65% weight as what you did last time.
- **Copying a routine-exercise copies `linkProgression`**, which would make the hidden row a link
  leader that real routines adopt. Quick rows are built field by field.
- **Orphans.** Deleting a quick session deletes its hidden routine and rows; `exerciseUsage`, the
  "other copies" line, Ask's prescription lookup and the Archived list all ignore quick routines.
  It also deletes the catalogue exercises its own Start made (`createdAt` equals the session's
  `startedAt`, a `cat:` picture key) once no set log and no routine row uses them; one left
  behind is an ordinary owned exercise, outside the Include new switch and the two-new cap. One
  the owner added from the library first has an earlier `createdAt` and is never touched.
  `deleteExercise` refuses an exercise on the live session's hidden routine.
- **Never await a non-Dexie promise inside a transaction** (the catalogue `import()` is resolved
  before `startQuickSession` opens it).
- **`toBeVisible` passes on a broken image.** The catalogue specs poll `naturalWidth > 0` per
  frame. `vite preview` answers a missing file with `index.html` as 200 `text/html`, so the spec
  also checks the content type.
- **The service worker would precache 6.6 MB of photos.** `globIgnores` keeps `catalogue/**` out
  of the precache (the native app never registers it); a runtime CacheFirst rule serves the web
  build offline once seen.
- **Mapping by name regex misfires.** The Hevy regexes called 12 of 14 timed entries wrong (a
  plain "hang" matches Hang Clean); the catalogue maps from the dataset's own structure. An
  e-z curl bar is not a barbell (a barbell would get a 20 kg warm-up ramp). Exact-name dedupe
  missed near-duplicates ("Hammer Curls"), so the normaliser singularises and expands the app's
  abbreviations, and 46 repeats are on a reviewed list.
- **A per-muscle cap of two blocks "four bicep exercises".** It applies only when no muscle is
  named on its own.
- **The sheet hears every keystroke.** "4" on the way to "45 min" and "four" on the way to
  "fourteen" parse as counts, so a tap displaced by one is kept behind the text
  (`QuickDraft.dropped`) and comes back when the text stops saying anything about that field;
  typed whole, typed a key at a time and pasted give the same options. Known limit: a typed
  focus that a half-typed exclusion cancels and then uncancels ("calves" then ", no lower back")
  reads as a new mention of the focus on the key that uncancels it, and displaces a focus tap.
- **A muscle is never both asked for and ruled out.** Tapping Legs over "no legs" lifts the
  exclusion by tap (`toggleFocus`), and that lift holds while the exclusion is edited around it;
  a muscle the edit newly rules out does not. `effectiveOptions` settles any other overlap:
  typed focus over a tapped exclusion, else the exclusion.
- **Negation reaches across "or", "and" and "nor", not across a comma** ("no calves, legs" is
  still legs minus calves), and over "have", "got", "use", "need", "feel", "like" and "face"
  ("I don't have a barbell" rules the barbell out). A number before sets, reps, days, kg, "x" and
  the like, or either side of "4 x 10", is not an exercise count.
- **Light leaves out the hinge family by name**: deadlifts, good mornings, extensions, swings,
  cleans, snatches, glute-ham raises, rack pulls and pull-throughs. A light weight that floors to
  nothing on the increment grid has no number ("pick a weight"); only added weight can be nothing.
- **'other' is not kit the owner owns.** One logged Neck row (equipment 'other') must not make
  bands, balls and strongman lifts candidates for Include new.
- **The Time chip is lit only while the minutes size the plan**, which is when no count is set.

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

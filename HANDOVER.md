# RyCalories — Handover

Written for a fresh Claude Code session picking this up with zero prior context.
Read this before touching code. It covers what exists, why it's built the way
it is, what's fragile, and the plan to fold it into a single all-in-one fitness
app alongside the user's separate workout tracker ("my own version of Hevy").

**Repo**: `ryanfjmorgan93/RyCalories` (GitHub), branch `claude/meal-calorie-tracker-apk-4g67r7`.
This branch has been the working branch for the whole project so far — check
with the user whether to keep developing on it or cut a new one before the
merge work starts.

**Owner's phone**: Samsung Galaxy Z Fold 8. Every design and compatibility
decision below is tuned for that specific device. If the merged app is meant
to run more broadly, re-verify the Gemini Nano device list and screen-size
assumptions.

---

## 1. What this app is, today

A personal Android app, single user, no accounts, no backend. You take a photo
of a meal (or type what you ate), an on-device AI model identifies the food
and estimates calories/protein/carbs/fat, you confirm and save. It keeps a
daily log with a calorie goal and macro targets, browsable by day.

Everything lives on the phone. No server, no API key, no sign-in, no cost per
use. That constraint (zero cost, zero cloud) was a deliberate pivot partway
through — see §3.

---

## 2. Tech stack

- **Kotlin + Jetpack Compose**, single `Activity`, no navigation library —
  screens are a hand-rolled sealed-class state machine in the ViewModel
  (`Screen` sealed interface in `MainViewModel.kt`).
- **minSdk 31** (Android 12), **compileSdk 36**, **AGP 8.13.2**, **Kotlin 2.2.21**.
- State: a single `AndroidViewModel` (`MainViewModel`) holding `StateFlow`s;
  screens `collectAsStateWithLifecycle()`. No Hilt/Dagger, no Room — see §5.
- Persistence: hand-rolled JSON file (`org.json`), not a database. Deliberately
  simple for a single-user app with a few hundred rows at most.
- Build/release: GitHub Actions builds and publishes a signed release APK to a
  rolling GitHub Release on every push. See §7 — this took several rounds to
  get right and has real gotchas.

No third-party backend, no analytics, no crash reporting. Nothing calls home
except the two things noted in §4.4 (barcode/label lookup) which are
per-request and anonymous.

---

## 3. The AI engine story (read this — it explains the shape of `ai/`)

This app went through three different inference strategies in one build day.
The code still carries scars from all three; understanding the history
explains design choices that would otherwise look odd.

**v1 — Anthropic Claude API (cloud).** First working version called
`claude-opus-5` via the official Anthropic Java SDK, sending the photo as a
base64 image with structured JSON output. Worked great, but the user
discovered mid-project that this costs real money per photo (a few cents each
via API key, separate from any Claude subscription). That was a surprise and
not what they wanted for a hobby project. **This code path was fully removed.**
If you see references to Anthropic/Claude API integration in old git log
messages, ignore them — it's gone from the app.

**v2 — Gemini Nano on-device, via ML Kit GenAI Prompt API.** Free, offline,
zero cost. This is the *primary* engine today. Implemented in
`ai/OnDeviceMealAnalyzer.kt`. Key facts:

- Uses `com.google.mlkit:genai-prompt:1.0.0-beta4` (beta library, Google can
  break it).
- Gemini Nano availability is gated by Google's **AICore** service, which is
  device- and rollout-dependent — not just "does this model of phone support
  it" but "has AICore fetched the config that turns it on for this specific
  install." On the user's own Fold 8 (a device Google's docs list as
  supported), the model reported `UNAVAILABLE` for hours after AICore was
  updated, then started working with no app change. **Do not treat an
  `UNAVAILABLE` status as a hard capability check — it's often just AICore
  being lazy about fetching config.**
- AICore actually exposes *multiple* model variants (full/fast ×
  stable/preview). `OnDeviceMealAnalyzer.probe()` tries all four combinations
  and keeps the best one, building a human-readable diagnostics report
  (device model, AICore version, Play Services version, status of each
  variant) that's shown to the user with a "Copy details" button when nothing
  works. This diagnostics-first approach is what let us actually debug the
  AICore rollout issue live with the user instead of guessing.
- **Structured output is not universally supported.** Samsung's Nano build
  returns `GenAiException` with `errorCode == STRUCTURED_OUTPUT_REQUEST_ERROR`
  (`-104`) for ML Kit's `@Generable`/constrained-decoding structured output
  API (`ai/NanoSchema.kt`), even though the same device supports plain-text
  generation fine. The analyzer tries structured output once, and on that
  specific error **permanently falls back** (per analyzer instance) to asking
  for JSON in the prompt text and parsing it leniently — see `NutritionJson.kt`.
  **Lesson: never assume a documented ML Kit GenAI feature works on a given
  OEM's Nano build. Always have a plain-text-JSON fallback path.**

**v3 — Gemma 3n via MediaPipe, as an insurance fallback.** Implemented in
`ai/GemmaMealAnalyzer.kt`, using `com.google.mediapipe:tasks-genai:0.10.35`.
This is Google's *open*, downloadable multimodal model (~3 GB `.litertlm`
file, gated behind a Hugging Face license click-through), imported once by the
user via Settings and copied into app-private storage. It runs regardless of
AICore/Nano availability, at the cost of a 3 GB download and slower inference.
**As of the last session, Nano started working reliably on the user's phone
and Gemma has never actually been exercised in practice.** It's currently
dead weight (~35 MB of native libs in the APK for 4 CPU architectures, trimmed
to arm64-only) that exists purely as insurance. **When starting the merged
app, seriously consider whether to keep it.** Arguments for dropping it: one
fewer engine to maintain, smaller APK. Arguments for keeping it: if Google
ever fully locks Nano behind something the user's phone doesn't qualify for,
Gemma is the only fallback that still works.

Both Nano and Gemma share one JSON contract and parser (`ai/NutritionJson.kt`)
so behavior is consistent regardless of which engine actually answered.
`MainViewModel.activeEngine()` picks Nano when ready, else Gemma when ready,
else `Engine.NONE` (blocks the "Count it" button).

### 3.1 Accuracy problem discovered: packaged foods

Small on-device models are good at *recognizing* a product ("this is a Trek
Protein Flapjack, Salted Caramel") but bad at *knowing its actual nutrition
numbers* — they hallucinate plausible-looking but wrong calorie/macro figures
for branded packaged food. Home-cooked plates don't have this problem in the
same way (there's no "ground truth" to be wrong about, just portion-size
estimation error).

**Fix implemented**: `ai/ProductLookup.kt`. After the model returns its
estimate, if any item looks packaged (the model was asked to also extract
`brand`, `product`, and `grams` — see the extended `NanoFoodItem` schema and
`NutritionJson.FORMAT_INSTRUCTIONS`), the app automatically — **no user
interaction** — tries to correct it:

1. **Barcode route**: scans the same photo on-device with ML Kit's
   `barcode-scanning` library for EAN-13/EAN-8/UPC-A/UPC-E codes. If found,
   looks up `world.openfoodfacts.org/api/v2/product/<code>.json`.
2. **Name route**: if no barcode, searches
   `search.openfoodfacts.org/search?q=<brand> <product>` (their newer
   search-a-licious API — the old `cgi/search.pl` endpoint was flaky/503ing
   during testing, prefer the new one) and picks the best token-overlap match
   above a threshold, with plural stemming and a small bonus for entries that
   have a known serving/pack size.
3. Real per-100g label values are scaled to the pack/serving size and swap out
   the model's guessed numbers. Items resolved this way get `source = "label"`
   and a green "LABEL" pill in the UI so the user can see which numbers are
   real vs. estimated.
4. Results are cached to `files/product_cache.json` (barcode and name-query
   keyed) so repeat purchases resolve instantly and offline afterward.
5. **Open Food Facts is a crowd-sourced database** — coverage and data quality
   vary. When there's no confident match, the item is left as the model's
   estimate untouched (no LABEL tag = trust it less).

This is the pattern to reuse for anything else where "recognize it, then look
up the real facts" beats "ask the model to know facts it can't reliably know."
Applies equally well to future features like recognizing gym equipment,
supplement labels, etc.

---

## 4. File-by-file map

```
app/src/main/java/com/rycalories/app/
  MainActivity.kt              Single Activity, edge-to-edge, sets Compose content
  ai/
    OnDeviceMealAnalyzer.kt    Gemini Nano: probing, download, inference, structured→plain fallback
    NanoSchema.kt              @Generable/@Guide schema for ML Kit structured output
    GemmaMealAnalyzer.kt       Gemma 3n via MediaPipe (currently unused fallback, kept for insurance)
    NutritionJson.kt           Shared plain-JSON contract + lenient parser (both engines use this)
    ProductLookup.kt           Barcode/name → Open Food Facts → real label nutrition (§3.1)
  data/
    Models.kt                 FoodItem, MealAnalysis, Meal — plain data classes with toJson/fromJson
    MealRepository.kt          Loads/saves files/meals.json, StateFlow<List<Meal>>
    AppSettings.kt              SharedPreferences wrapper: daily calorie goal, Gemma model path
  ui/
    App.kt                     ALL screens + all reusable components (~900 lines, one file — see §6)
    MainViewModel.kt            Navigation state machine, draft state, engine selection, all actions
    Theme.kt                    Dark-only Material3 theme, Palette object, custom Typography
    ImageUtils.kt               Photo decode (ImageDecoder w/ HEIF support + legacy fallback), JPEG encode
```

No `res/layout` XML, no Fragments, no navigation graph. Everything is Compose.
Only XML resources are the manifest, a vector launcher icon, `strings.xml`,
`colors.xml` (just the one launcher-icon background color — the real palette
is `Palette` in `Theme.kt`, not XML), and `file_paths.xml` for FileProvider.

---

## 5. Data model & persistence — deliberately minimal

`data/Models.kt`:
- `FoodItem` — name, portion, calories, protein/carbs/fat grams, optional
  `grams` (portion weight), `brand`/`product` (packaging text), `source`
  (`"model"` or `"label"`).
- `MealAnalysis` — the AI's raw output before the user confirms/saves it
  (mealName, items, totals, confidence, notes). Has a `withItems()` helper
  that recomputes totals — always use this rather than hand-editing totals.
- `Meal` — a saved, confirmed entry: everything in `MealAnalysis` plus an id,
  timestamp, optional photo path, optional raw ingredient text the user typed.

`MealRepository` persists the **entire meal list** as one JSON file
(`files/meals.json`) on every mutation, via a temp-file-then-rename write for
atomicity. This is fine at personal-use scale (hundreds of meals) but **will
not scale** to years of daily logging or to a merged app that also stores
workout history. **When merging with the workout tracker, this is the first
thing to replace** — move to Room (SQLite) with proper tables, or at minimum
split meals into per-day or per-month files. Don't carry the "rewrite the
whole file on every save" pattern into the combined app.

Photos are saved as JPEGs under `files/photos/<mealId>.jpg`. Product-lookup
cache is `files/product_cache.json`, same one-file-rewrite pattern, smaller
data so lower urgency to fix.

Settings (`AppSettings.kt`) is plain `SharedPreferences`: just `daily_goal`
(int) and `gemma_model_path` (nullable string). No user profile, no auth, no
multi-user concept anywhere in this codebase — it assumes exactly one person
using exactly one phone. **This assumption will need conscious decisions when
merging**: does the combined app still assume single-user-no-auth? Almost
certainly yes, given the whole point of this project — but worth confirming
with the user, since a workout app might have more reason to want cloud sync
across devices than a calorie counter does.

---

## 6. Design system — reuse this for the merged app

The UI was deliberately redesigned mid-project after the user shared reference
screenshots of modern fitness/nutrition apps (dark base, chunky pastel cards,
arc gauges). This is now a coherent, from-scratch design system worth
carrying into the merged app rather than reinventing:

**`ui/Theme.kt` — `Palette` object** (not Material3 defaults, a custom object):
- Near-black background (`Bg = #0B0B0F`), slightly lighter card surface
  (`Surface`, `SurfaceHi`), `Outline` for 1dp borders on dark cards.
- Pastel accent set used as *card fill colors*, not just accents: `Lavender`
  (`#D9C8FF`), `Lemon` (`#F4EE7A`), `Mint` (`#4FD08C`), `Peach` (`#FFB38A`),
  `Rose` (`#FF8FA3`), plus `Orange` (`#FF5A1F`) as the primary action color and
  `Paper` (an off-white, `#F7F5FF`) for one card (the week strip).
- Dark theme only — no light mode, this was an explicit choice, not an
  oversight.
- Custom `Typography`: heavier weights, tighter letter-spacing than Material3
  defaults, big `displayLarge`/`displayMedium` for hero numbers.

**Reusable components in `App.kt`** (all `private`, currently — if splitting
into a shared module, these are the ones to promote to `internal`/`public`):
- `PastelCard` / `DarkCard` — the two card archetypes. Pastel = high-emphasis
  content (hero stats, primary CTAs). Dark = list rows, secondary content.
- `ArcGauge` — animated ¾-circle progress arc (used for the calories-remaining
  ring). Generic enough to reuse for e.g. a workout-volume or weekly-workload
  ring in the fitness merge.
- `MacroBar` — animated horizontal pill progress bar.
- `PrimaryButton` (pill, filled), `GhostButton` (pill, outlined dark),
  `RoundIconButton` (circular icon button), `ConfidencePill`, `StatusLine`.
- `ScreenHeader` — back button + title + optional trailing action, used at the
  top of every non-home screen.
- `WeekStrip` — the tappable Mon–Sun day selector on Home. This is generically
  useful for any daily-log app (workouts included) — worth extracting as-is.

If the merge becomes "two feature areas in one app" rather than "two separate
apps," lift `Theme.kt`'s `Palette`/`Type` and the component set above into a
shared `ui/components` package immediately, before nutrition-specific and
workout-specific screens both start reinventing buttons and cards.

---

## 7. Build, signing, and release — non-obvious gotchas

This took multiple broken releases to get right. Do not undo these without
understanding why they're here.

- **Signing key is committed to the repo**: `app/keystore/rycalories.jks`
  (password `rycalories`, alias `rycalories`, both hardcoded in
  `app/build.gradle.kts`). This is intentional for a personal sideloaded app
  — **every APK, whether built locally or by CI, must be signed with the same
  key**, or Android refuses to install an update over the existing app
  ("App not installed" with no useful error). If you rotate or remove this
  key, every user (i.e. the one user) has to uninstall and lose local data
  first. **Do not switch back to the Gradle debug key or a CI-generated
  ephemeral key** — that was the original bug.
- **`versionCode` is derived from the CI run number**:
  `System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull()?.plus(100) ?: 9000` in
  `app/build.gradle.kts`. This guarantees every CI-published build has a
  strictly higher versionCode than the last (Android requires this for an
  install-over-update to be accepted), while local dev builds get a fixed
  high number (`9000`) so they can also install over any CI build for testing.
  If this repo is restructured (e.g. multiple modules/apps), this scheme needs
  to be revisited so versionCodes stay monotonically increasing across
  whatever gets published.
- **GitHub's `/releases/latest` endpoint silently excludes pre-releases.**
  Early CI config published with `prerelease: true`, which made
  `github.com/<owner>/<repo>/releases/latest/download/<file>` 404 forever with
  no useful error. Fixed by publishing as a normal release
  (`prerelease: false`, `make_latest: true`) via `softprops/action-gh-release@v2`
  with a fixed `tag_name: latest` that gets overwritten every push (a rolling
  release, not a new tag per version).
- **The Actions "artifacts" tab always zips the file**, even for a single
  APK. Don't tell the user to download from there for install purposes — it
  produces a `.zip` containing the `.apk`, which is an extra confusing step on
  mobile. The stable **install URL** is:
  `https://github.com/ryanfjmorgan93/RyCalories/releases/latest/download/RyCalories.apk`
  — same link forever, always the newest build, no zip.
- **Native library size**: MediaPipe's `tasks-genai`/`tasks-core` ship
  binaries for 4 ABIs by default (~35MB each unstripped for arm64 alone,
  more for the others). `app/build.gradle.kts` restricts to
  `ndk { abiFilters += "arm64-v8a" }` since the target device is arm64-only.
  If the merged app ever needs to support x86 emulators or older devices,
  revisit this.
- **R8/ProGuard is on for release builds** (`isMinifyEnabled = true`,
  `isShrinkResources = true`). `app/proguard-rules.pro` has hand-written keep
  rules for: the `@Generable` schema classes and their generated
  `*_GeneratedProvider` classes (KSP-generated, reflection-discovered via
  `ServiceLoader` — R8 can't see the reflection and will strip them silently
  if not kept), the entire `com.google.mlkit.genai.**` and
  `com.google.mediapipe.**` packages (both do enough JNI/reflection that
  selective keeping wasn't worth the risk of a release-only crash), and
  `com.google.protobuf.**` (MediaPipe's wire format). **If you add another
  `@Generable` data class, it does not need a new keep rule** (the wildcard
  `com.rycalories.app.ai.**_GeneratedProvider` catches it) but does need the
  KSP annotation processor to actually run — check
  `app/build/generated/ksp/*/kotlin/.../…_GeneratedProvider.kt` exists after a
  build if structured output silently stops working for a new schema.
- **CI workflow**: `.github/workflows/build-apk.yml`. Installs Android SDK
  platform 36 + build-tools 35.0.0 via `android-actions/setup-android@v3`,
  runs `./gradlew assembleRelease`, renames the output to a fixed
  `RyCalories.apk`, uploads as both a run artifact and the rolling release
  asset. Runs on every push to any branch.

### Local dev environment notes (this sandbox specifically)

This session had no pre-installed Android SDK; it was set up from scratch:
Android command-line tools downloaded from `dl.google.com`, platforms 35/36
and build-tools installed via `sdkmanager`, `local.properties` pointing
`sdk.dir` at `/opt/android-sdk`. The Gradle wrapper was generated with
`gradle wrapper --gradle-version 8.14.3`. If a fresh session doesn't have this
already, redo it the same way — `dl.google.com` and `repo1.maven.org` were
both reachable from this sandbox's network policy. No physical device or
emulator was ever available in this environment — **all testing has been the
user manually installing the APK on their own Fold 8 and reporting back with
screenshots.** Budget for that round-trip latency; there is no way to run or
screenshot the app from inside a Claude Code session here.

---

## 8. What's fixed, and the lessons behind each fix (so you don't reintroduce them)

| Symptom | Real cause | Fix |
|---|---|---|
| "Could not read that image" on every gallery photo | `BitmapFactory.decodeStream` with `inJustDecodeBounds=true` *always* returns `null` by design — the original code treated that null as "unreadable," rejecting every photo regardless of format | Read the *measured bounds*, not the return value, to judge success. Also switched the primary decode path to `ImageDecoder` (handles HEIF/WebP + EXIF rotation natively), keeping the old `BitmapFactory` path only as a fallback |
| `STRUCTURED_OUTPUT_REQUEST_ERROR` (-104) on Nano | Samsung's Nano build doesn't support ML Kit's constrained-decoding structured output feature, despite it being a documented API | Catch that specific `GenAiException.errorCode`, remember it per-analyzer-instance, fall back to plain-text-JSON prompting for the rest of that session |
| `releases/latest` 404 | Pre-releases are excluded from GitHub's `/latest` resolution | Publish as a normal (non-pre-)release |
| "App not installed" on update | APK signed with Gradle's auto-generated debug key, which differs machine-to-machine / build-to-build | Commit one fixed release keystore, sign every build with it |
| Trek bar showing invented nutrition numbers | Small on-device model can *recognize* packaged products but doesn't reliably *know* their real nutrition — this is a knowledge-limitation, not a prompting problem | Don't try to prompt-engineer around it. Recognize + look up real data instead (§3.1) |

The throughline: **on-device beta APIs (ML Kit GenAI, AICore) lie about their
own capabilities more than you'd expect from Google's docs.** Always build a
diagnostics path and a fallback rather than trusting a single status check.
This will very likely bite again if the merged app leans further into
on-device AI (e.g. for exercise-photo form-checking or similar).

---

## 9. Open threads / known limitations (not yet fixed)

- **Malformed JSON from small models isn't retried.** When the plain-JSON
  fallback path (or Gemma) returns unparseable text, the user sees an error
  and has to manually tap Retry. An automatic single retry-with-clarification
  would probably fix most of these for free. Not built yet.
- **No manual edit of a saved/estimated item's numbers.** If the model or the
  label lookup gets something wrong, there's no way to correct it in the UI —
  you can only Retry the whole analysis or accept it as-is. Flagged as a
  wanted feature.
- **No weekly/trends view**, no home-screen widget, no blur/quality check on
  captured photos before sending to the model. All previously discussed as
  "someday" ideas, none built.
- **`GemmaMealAnalyzer` is untested in practice** (see §3) — the code path
  compiles and was reasoned through carefully against MediaPipe's documented
  API, but has never actually run an inference on-device because Nano has
  been available whenever tested. Treat it as unverified if it's ever needed.
- **The Open Food Facts lookup sends the recognized product name (or scanned
  barcode) to a third-party server.** This is the *only* network call
  anywhere in the app, and it's scoped to packaged-food items only — but it's
  worth being upfront with the user that "fully offline" has one narrow,
  intentional exception. Nothing else about the meal (photo, other items,
  history) is ever transmitted.
- **Single JSON-file persistence won't scale** — see §5. This is the most
  important thing to fix before merging with a second data-heavy feature area
  (workout history).

---

## 10. The merge goal: combine with the user's workout tracker ("my own Hevy")

The user has separately built their own Hevy-style workout tracking app and
wants to combine it with this one into **a single all-in-one fitness app**
they'll keep extending over time. As of this handover:

- **The workout app's repo/location is unknown to this session.** It did not
  show up in the GitHub repos this session has access to
  (`ryanfjmorgan93/RyCalories`, `ReVanced_Stuff`, `Wallet_Tracking_App`,
  `Flight-Check-RyAir`). **First step of the merge work: ask the user where
  that project lives** — a GitHub repo not yet granted to this session, a
  different account, or built entirely in a different tool/session. Do not
  assume anything about its stack, architecture, or code quality until you've
  actually looked at it.
- Once you have it, the same kind of read-everything pass this document
  represents should be done on the workout app before deciding how to merge.

### Questions to resolve before writing any merge code

1. **One app or two, sharing a design system?** True merge (single APK, one
   nav shell, calories + workouts as two tabs/sections) vs. two apps that just
   look and feel consistent. A true merge is almost certainly the actual ask
   ("all-in-one fitness app"), but confirm — the workout app might have
   constraints (different minSdk, different architecture, different language
   even) that make a true merge nontrivial.
2. **Data layer**: this app's one-JSON-file `MealRepository` will not extend
   cleanly to also hold workout sets/sessions/PRs. Decide once, up front,
   likely **Room (SQLite)** for both nutrition and workout data, with a proper
   schema (tables for meals, food items, workouts, exercises, sets), rather
   than bolting a second ad-hoc JSON file on. This is the single highest-value
   piece of groundwork before merging features.
3. **Navigation**: this app has no nav library (hand-rolled `Screen` sealed
   class in the ViewModel). That was fine for ~5 screens; a combined app with
   two feature areas each with their own screens will likely want
   Navigation-Compose with a bottom nav bar (Home/Nutrition tab, Workouts tab,
   maybe a combined Today/Dashboard tab, Settings). Worth introducing
   properly rather than growing the sealed class further.
4. **Design system**: reuse `Palette`/`Type`/component set from `Theme.kt` and
   `App.kt` (§6) as the shared visual language — assuming the workout app
   doesn't already have an equally-developed one worth keeping instead. Don't
   let two different design languages coexist in one app.
5. **Package/app identity**: current `applicationId` is `com.rycalories.app`,
   `namespace com.rycalories.app`. A combined app will want a new identity
   (new name, new package, new launcher icon, new signing key or a decision to
   keep this one) — decide with the user rather than silently keeping
   "RyCalories" as the combined app's name if it's meant to be bigger than
   that now.
6. **Does workout tracking need any AI at all?**, and if so, is the same
   on-device-first philosophy (§3) the right call there too, or was that
   specifically a nutrition-photo-recognition need that doesn't generalize?
   Don't assume; ask, or read the workout app's existing approach once you
   have access to it.
7. **Keep the AI-engine lessons (§3, §8) in mind for anything new that uses
   ML Kit GenAI or similar on-device beta APIs** — the "probe, don't trust a
   single status check; always have a plain-text fallback" pattern is
   reusable well beyond nutrition.

### What to definitely carry over as-is

- The signing/versioning/CI release approach (§7) — it works, is well
  understood now, and the gotchas were expensive to learn.
- The design system (§6) — genuinely good, user-approved, worth extending.
- The barcode/name → real-data lookup pattern (§3.1) — the meta-pattern
  ("recognize with the cheap model, verify against a real database") is
  broadly reusable.
- The philosophy of **zero cost, zero cloud, zero account** unless the user
  explicitly asks for an exception (as they did, narrowly, for the Open Food
  Facts lookup). This was a hard-learned preference from the very first
  session — don't reintroduce a paid API or a cloud dependency without
  raising it explicitly first, the way the original Claude-API-costs-money
  surprise should have been raised but wasn't.

---

## 11. Quick-start for the next session

```bash
git clone https://github.com/ryanfjmorgan93/RyCalories.git
cd RyCalories
git checkout claude/meal-calorie-tracker-apk-4g67r7   # or wherever the user says to continue

# Android SDK (if not already present in this sandbox):
mkdir -p /opt/android-sdk/cmdline-tools
cd /opt/android-sdk/cmdline-tools
curl -sSL -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
unzip -q cmdtools.zip && rm cmdtools.zip && mv cmdline-tools latest
yes | latest/bin/sdkmanager --sdk_root=/opt/android-sdk --licenses >/dev/null 2>&1
latest/bin/sdkmanager --sdk_root=/opt/android-sdk "platform-tools" "platforms;android-36" "build-tools;35.0.0"
cd -
echo "sdk.dir=/opt/android-sdk" > local.properties

# Build:
export ANDROID_HOME=/opt/android-sdk
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk

# Ship it (push to the branch; CI builds + publishes automatically):
git push origin <branch>
# then: https://github.com/ryanfjmorgan93/RyCalories/releases/latest/download/RyCalories.apk
```

There is no way to run, screenshot, or test the app from inside a Claude Code
session — no device/emulator is available in this sandbox. Every UI change
needs to go to the user's phone for real verification. Say so plainly rather
than claiming something "works" beyond "it compiles and the logic reads
correctly."

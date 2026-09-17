# Iron

A personal training and nutrition logger: strict double progression on the training side, food
logging on the other, and one record joining them. Offline-first PWA for Android; single user;
kilograms only; no accounts, no backend.

The spec of record for the training half is [docs/BRIEF.md](docs/BRIEF.md); UI conventions are in
[docs/UI_GUIDE.md](docs/UI_GUIDE.md); [docs/MERGE_PLAN.md](docs/MERGE_PLAN.md) covers the merge
with the nutrition app and what remains.

## What it does

- **Progression engine** (`src/domain/engine.ts`, pure, unit-tested): every counted set at or above `repMax` → add the increment; otherwise hold. Warm-ups and drop sets ignored; missing sets count as misses; a failure set counts like a working set and reads as RIR 0. Calibrating exercises record but never decide. Carries and timed work never produce a weight decision. A deload session decides nothing and breaks a stall streak.
- **Set types and effort**: warm-up, working, failure, drop (`src/domain/sets.ts` is the one place that says what each counts for). RIR 0–5 per set, shown as RPE if you prefer (Settings → Logging); stored as RIR either way.
- **Guidance from your own numbers**: Home shows the next session's plan — each exercise's weight × reps × sets, the reason from the last decision ("up 2.5 kg last time", "held: missed sets"), last time's sets and effort, and stall, regression, calibrating or deload flags. Two or more stalled lifts and it offers a deload start.
- **Personal records** (`src/domain/records.ts`): best weight, best e1RM, best set volume, most reps at a weight — flagged on the set row as you log it, on the summary, on the finished session as it stood at the time, and on Progress. A tie is not a record; a drop set never sets one; a record that beats an imported Hevy best says so.
- **Estimated 1RM** (`src/domain/strength.ts`): Epley by default, Brzycki available, and deliberately no estimate past 12 reps. Exercise detail charts top set, e1RM or volume. Strength standards (bodyweight multiples, five levels) for lifts that carry a standard.
- **Volume** (`src/domain/volume.ts`): sets per muscle group this week against your own targets, on a table and on a front/back body map that can also show how recently each muscle was trained.
- **Supersets, plate maths, warm-up ramps, swaps** in the live session: adjacent routine-exercises bracketed, the highlight alternating between them and the rest timer starting after the pair; per-side plates for any barbell weight (bar and plates in Settings); a bar-first warm-up ramp one tap per set; swap a slot for another exercise of the same muscle group for one session.
- **Calendar and streak**: twelve weeks of trained days, a weekly-target streak, and — the one line of encouragement in the app, by the owner's request — a short sentence when the streak is alive.
- **Exercise diagrams**: 302 exercises with three drawn frames each, animated in the app and fully offline, from Workout Guide (CC BY-SA 4.0) with public-domain instructions from free-exercise-db; a Video link opens YouTube. Custom exercises pick a diagram or are created straight from the library.
- **Assistant** (Android only): a small box on Home, an exercise's page and the live session that answers questions from your own data, on the phone, through Gemini Nano (Google AICore via ML Kit). It never opens itself and offers nothing unasked. Settings → Assistant shows the model's status, downloads it, and has a Test button.
- **Suggest, never auto-apply**: stall after three sessions at one weight, hold/drop after two sessions with 2+ sets under `repMin`, double increment when every set hit `repMax` at RIR ≥ 3. Every decision is shown in plain terms on the session summary with **Accept** (default) or **Override**, and logged.
- **Routines** without limit, with per-routine-exercise rep range, weight, increment, cue, notes, optional flag, calibration mode, rest override and (Phase 2) linked progression across routines.
- **Live session**: one scrollable screen, current exercise highlighted, your cue above the inputs, last session's sets one tap away, big ± steppers, one big ✓ that fires the rest timer. Session clock; changes colour past the routine's target length.
- **Rest timer** driven by a deadline (survives reload and backgrounding): Skip, +30 s, vibration and a notification when it ends.
- **History and detail**: per-exercise history, top-set chart, stall badge, lock-in for calibrating lifts.
- **Bodyweight**: log, weekly view, 4-week trend, 7-day delta against the target band.
- **Data**: JSON backup, flat CSV export, Hevy CSV import (idempotent; built against the real export in the repo root), reset to seed.
- **Phase 2/3**: next-routine suggestion with the "never two lower days in a row" rule, fortnightly check-in text, reverse-diet calorie stepper, protein target, leg-day checklist.

### Nutrition

- **Food logging**: a day screen with calories and protein against target, per-meal breakdown and
  day navigation. Meals compose in local state until saved; every number stays editable before and
  after. Logging to a past day is a first-class case, not a workaround.
- **Portions cannot lie** (`src/domain/food.ts`): a portion is either a weight plus per-100g values
  or macros for an unweighed serving, never both, and the eaten macros are always derived. The
  Kotlin original stored the two independently and its multiplier scaled one without the other.
- **Food memory** (`src/domain/foodMemory.ts`): anything eaten before is offered before a number is
  typed, at the weight last eaten. Stored per 100 g, so an unweighed serving is deliberately not
  remembered — it would mean inventing a figure. A model guess can never overwrite a correction.
- **Barcode scan**: the phone camera in the food sheet, decoded on the device (zxing-wasm, bundled), fed
  to the same lookup; a code seen before answers offline. Manual entry if the camera is refused.
- **Label lookup** (`src/domain/products.ts`, `src/db/productRepo.ts`): Open Food Facts by brand and
  product name. A query naming a brand requires a brand match absolutely: returning nothing beats
  putting a rival manufacturer's numbers behind a badge saying they came off a real label. Hits are
  cached indefinitely, misses for thirty days, failures never. Switchable off in Settings, where off
  means no request is made.
- **Repeat a meal**: recent meals de-duplicated by what they are, copied onto the day being viewed.

### Both halves together

- **Protein target follows training**: a leg day raises it, decided in one place
  (`src/db/todayQueries.ts`) so the day screen and Home can never disagree.
- **Progress** (`src/domain/trends.ts`, `src/db/trendQueries.ts`): bodyweight, eating and training
  over two, four or eight weeks. Averages exclude days with nothing logged and always say how many
  days they stand on — counting a blank day as zero is not imprecise, it is false.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Zustand · vite-plugin-pwa · Vitest · Playwright.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # domain, repo, importer and nutrition unit tests (Vitest)
npm run e2e          # acceptance, overload, guidance, nutrition, barcode (fake camera), offline tests (builds first)
npm run build        # tsc + vite build → dist/
```

Seed data (the five routines from the brief) is generated from `scratch/gen/seed.py` into `src/db/seed.ts`; the `equipment`, `demo` and `standard` fields were added by hand afterwards. Exercise diagrams are converted from the `@bryllim/workout-guide` package on every build (`prebuild`) into `public/exercises/`, which is gitignored.

## Android APK

The same app ships as a native Android package (Capacitor shell, assets bundled, works offline, rest-timer notifications and share-sheet exports through the OS, the camera for barcodes, and Gemini Nano for the assistant through Google AICore on phones that have it).

- **Download:** [github.com/ryanfjmorgan93/RyCalories/releases/download/iron-latest/iron.apk](https://github.com/ryanfjmorgan93/RyCalories/releases/download/iron-latest/iron.apk) — a stable link, refreshed by every push. Open it on the phone and allow installs from that source. The workflow run's artifacts also keep an `iron-<sha>.apk` for 90 days if a specific build is needed.
- **Build locally:** Android SDK 35 + JDK 21, then

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the keystore in `android/keystore/` (personal app, committed on purpose) so each new build installs over the previous one and keeps its data.

## Deploy (Vercel, static)

Import the repo in Vercel with framework preset **Vite**. `vercel.json` already rewrites all routes to `index.html` and marks `sw.js` as never cached. Open the deployed URL in Chrome on the phone and choose **Add to Home screen** — the app then runs full-screen and fully offline.

## Hevy import

Settings → Import Hevy CSV → pick `workout_data.csv` (workouts) or `measurement_data.csv` (bodyweight) from Hevy's export. The preview shows how each Hevy exercise maps to the library (aliases are remembered for next time), lets you halve dumbbell weights that were logged as pair totals, and maps Hevy workout titles to routines so "previous session" works from day one. Re-importing the same file changes nothing.

## Layout

```
src/domain      pure logic: types, sets, engine, prescription, records, strength, volume, calendar, plates, warmup, nutrition, assistant prompts
src/data        generated exercise-demo index and instructions
src/db          Dexie schema, seed, repo (all writes), backup, Hevy importer, the query modules (plan, records, volume, calendar, assistant context)
src/state       rest timer store, notifications, the Nano plugin bridge and assistant store
src/ui          primitives, hooks, rest timer bar, pickers, scanner, demo viewer, assistant box
src/screens     one file per screen
android/app     the Capacitor shell and NanoPlugin.java
scripts         exercise-media (build-time diagram conversion), fetch-instructions
e2e             Playwright acceptance, overload, guidance, progress, nutrition, barcode and offline tests
```

# Iron

A personal training and nutrition logger: strict double progression on the training side, food
logging on the other, and one record joining them. Offline-first PWA for Android; single user;
kilograms only; no accounts, no backend.

The spec of record for the training half is [docs/BRIEF.md](docs/BRIEF.md); UI conventions are in
[docs/UI_GUIDE.md](docs/UI_GUIDE.md); [docs/MERGE_PLAN.md](docs/MERGE_PLAN.md) covers the merge
with the nutrition app and what remains.

## What it does

- **Progression engine** (`src/domain/engine.ts`, pure, unit-tested): every working set at or above `repMax` → add the increment; otherwise hold. Warm-ups ignored; missing sets count as misses. Calibrating exercises record but never decide. Carries and timed work never produce a weight decision.
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
npm run e2e          # acceptance, nutrition, offline and merged-day tests in Chromium (builds first)
npm run build        # tsc + vite build → dist/
```

Seed data (the five routines from the brief) is generated from `scratch/gen/seed.py` into `src/db/seed.ts`. Edit the script, not the generated file.

## Android APK

The same app ships as a native Android package (Capacitor shell, assets bundled, works offline, rest-timer notifications and share-sheet exports through the OS).

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
src/domain      pure logic: types, engine, schedule, nutrition, bodyweight, formatting
src/db          Dexie schema, seed, repo (all writes), backup, Hevy importer
src/state       rest timer store, notifications
src/ui          primitives, hooks, rest timer bar, exercise picker
src/screens     one file per screen
e2e             Playwright acceptance and offline tests
```

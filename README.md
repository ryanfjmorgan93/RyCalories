# Iron

A personal workout logger that runs strict double progression for you. Offline-first PWA for Android; single user; kilograms only; no accounts, no backend.

The spec of record is [docs/BRIEF.md](docs/BRIEF.md). UI conventions are in [docs/UI_GUIDE.md](docs/UI_GUIDE.md).

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

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Zustand · vite-plugin-pwa · Vitest · Playwright.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # engine, domain, repo and importer unit tests (Vitest)
npm run e2e          # acceptance + offline tests in headless Chromium (builds first)
npm run build        # tsc + vite build → dist/
```

Seed data (the five routines from the brief) is generated from `scratch/gen/seed.py` into `src/db/seed.ts`. Edit the script, not the generated file.

## Android APK

The same app ships as a native Android package (Capacitor shell, assets bundled, works offline, rest-timer notifications and share-sheet exports through the OS).

- **Download:** every push runs the "Build APK" workflow. Grab `iron-<sha>.apk` from the workflow run's artifacts, or from the rolling [iron-latest release](https://github.com/ryanfjmorgan93/RyCalories/releases/tag/iron-latest). Open it on the phone and allow installs from that source.
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

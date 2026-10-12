# Iron

A personal training and nutrition logger with a coach built in: strict double progression on the
training side, food logging on the other, one record joining them, and Claude as a personal
trainer who has read all of it. Android app (Capacitor), single user, kilograms only, no accounts,
no backend. Tracking works offline; the coach needs signal and the owner's own Claude API key.

The spec of record for the training half is [docs/BRIEF.md](docs/BRIEF.md); UI conventions are in
[docs/UI_GUIDE.md](docs/UI_GUIDE.md); [docs/MERGE_PLAN.md](docs/MERGE_PLAN.md) covers the merge
with the nutrition app and what remains.

## What it does

- **Progression engine** (`src/domain/engine.ts`, pure, unit-tested): when every set reaches `repMax`, the effort you mark decides the step: **Easy** adds two increments, **Good** (or nothing marked) one, **Hard** holds the weight one more session. Below the top of the range it holds. Missing sets count as misses; calibrating exercises record but never decide; carries and timed work never produce a weight decision; a deload session decides nothing. Sets are weight and reps, one tap; warm-up, failure and drop sets are gone (old ones stay in history).
- **Change today only**: any exercise's sets, rep range or weight can be changed for today's session (by hand from the card, or by asking the coach), then kept in the routine or undone. A session cut to two sets is judged against two.
- **Home**: every routine as a card, the most rested first ("Back last trained 6 days ago"), its next-session plan a tap away, plus Short session, today's food at a glance, the Monday weigh-in card and the weekly review.
- **Personal records** (`src/domain/records.ts`): best weight, best e1RM, best set volume, most reps at a weight — flagged on the set row as you log it, on the summary, on the finished session as it stood at the time, and on Progress. A tie is not a record; a drop set never sets one; a record that beats an imported Hevy best says so.
- **Estimated 1RM** (`src/domain/strength.ts`): Epley by default, Brzycki available, and deliberately no estimate past 12 reps. Exercise detail charts top set, e1RM or volume. Strength standards (bodyweight multiples, five levels) for lifts that carry a standard.
- **Volume** (`src/domain/volume.ts`): sets per muscle group this week against your own targets, on a table and on a front/back body map that can also show how recently each muscle was trained.
- **Supersets, plate maths, swaps** in the live session: adjacent routine-exercises bracketed, the highlight alternating between them and the rest timer starting after the pair; per-side plates for any barbell weight (bar and plates in Settings → Advanced); swap a slot for another exercise of the same muscle group for one session.
- **Calendar and streak**: twelve weeks of trained days, a weekly-target streak, and — the one line of encouragement in the app, by the owner's request — a short sentence when the streak is alive.
- **Exercise diagrams**: 302 exercises with three drawn frames each, animated in the app and fully offline, from Workout Guide (CC BY-SA 4.0) with public-domain instructions from free-exercise-db; a Video link opens YouTube. Custom exercises pick a diagram or are created straight from the library.
- **Exercise library**: 518 more exercises from free-exercise-db (public domain), each with two photos and its how-to steps, listed on the Exercises screen below your own (tap one for its pictures and Add) and held outside the database until you add one. The same list is in every exercise picker, where a library exercise is added and used in one tap. Bundled, so it works offline.
- **Short session** (Home → Short session): a typed request or a few chips ("four light exercises", "40 minutes", "no legs") builds a 30 to 45 minute session from your own exercises and history, with the muscles you have left longest first. Weights come from your own numbers; a light session is about 65% of your working weight. Shuffle re-draws. It counts toward your week and streak, never moves a routine's weights, and light sets stay out of e1RM and records.
- **Coach** (Claude, `src/ai/`): a personal trainer that has read your sets, meals, weigh-ins and body scans. It speaks at moments — opening the app, after a set (in the rest bar), after an exercise, after the session, after a meal, at the end of the day, and a weekly review on Monday — and stays quiet when it has nothing useful. Talk to it by voice or text from anywhere: it changes today's session ("only two sets of bench today"), edits or builds routines (built from your own exercises and the library, reviewed before saving), logs food and weight, and remembers notes about you. Sonnet for conversation and photos, Haiku for the short lines; a monthly spend cap (Settings → Claude, default $15) pauses it and leaves tracking untouched. Without a key or signal, routine building and edits still work through the rules coach.
- **Decisions you can override**: stall after three sessions at one weight, hold/drop after two sessions with 2+ sets under `repMin`, and the effort-based step above. Every decision is shown in plain terms on the session summary with its reason ("Marked Hard, so 60 kg again") and **Accept** (default) or **Override**, and logged.
- **Routines** without limit, with per-routine-exercise rep range, weight, increment, cue, notes, optional flag, calibration mode, rest override and (Phase 2) linked progression across routines.
- **Live session**: one scrollable screen, current exercise highlighted, your cue above the inputs, last session's sets one tap away, big ± steppers, one big ✓ that fires the rest timer. Session clock; changes colour past the routine's target length.
- **Rest timer** driven by a deadline (survives reload and backgrounding): Skip, +30 s, vibration and a notification when it ends.
- **History and detail**: per-exercise history, top-set chart, stall badge, lock-in for calibrating lifts.
- **Bodyweight**: log, weekly view, 4-week trend, 7-day delta against the target band.
- **Data**: JSON backup (never containing the Claude key), automatic backups, flat CSV export, reset to seed.
- **Also**: the "never two lower days in a row" guard, reverse-diet calorie stepper, protein target, leg-day checklist.
- **Reminders** (local notifications, no AI): log your food (20:30, skipped once you have), a training nudge naming neglected muscle groups after two rest days, and the Monday weigh-in. Each with a toggle and a time in Settings.
- **Body scans**: InBody results imported from the InBody app's CSV export (share it to Iron, or Progress → Import), or read from a photo of the printed sheet by Claude and confirmed; skeletal muscle, fat mass and their changes on Progress, and in the coach's reviews.

### Nutrition

- **Food logging**: one Add food sheet logs straight to the day's meal for the time of day. Search
  your foods and the UK table, scan a barcode, photograph a plate, or describe what you ate; Claude
  fills in what the app doesn't already know (marked ≈) and it logs at once, with Undo. Amounts are
  natural units — "Whole pack (400 g)", "Half", "2 eggs" — with grams as one option. A label the
  barcode database doesn't know is read from a photo and remembered for next time. A seven-day
  strip shows each day against target; unlogged days stay unlogged.
- **Portions cannot lie** (`src/domain/food.ts`): a portion is either a weight plus per-100g values
  or macros for an unweighed serving, never both, and the eaten macros are always derived. The
  Kotlin original stored the two independently and its multiplier scaled one without the other.
- **Food memory** (`src/domain/foodMemory.ts`): anything eaten before is offered before a number is
  typed, in the unit last used. Stored per 100 g with its pack and serving sizes. Claude's estimate
  can never overwrite a figure from you, a label or the UK table; changing only the amount of a
  scanned food keeps it a label figure.
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

Vite · React 19 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Zustand · Capacitor 7 · Anthropic SDK · Vitest · Playwright.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # domain, repo, importer and nutrition unit tests (Vitest)
npm run e2e          # Playwright against the built app; the Claude API is always mocked (builds first)
npm run build        # tsc + vite build → dist/
```

Seed data (the five routines from the brief) is generated from `scratch/gen/seed.py` into `src/db/seed.ts`; the `equipment`, `demo` and `standard` fields were added by hand afterwards. Exercise diagrams are converted from the `@bryllim/workout-guide` package on every build (`prebuild`) into `public/exercises/`, which is gitignored.

## Android APK

The same app ships as a native Android package (Capacitor shell, assets bundled, tracking works offline, rest-timer notifications and reminders, share-sheet exports and InBody imports through the OS, the camera for barcodes and photos, and the microphone for talking to the coach).

**First run:** create an API key in the Claude Console (console.anthropic.com → API keys), set a monthly spend limit on its workspace there too, then paste the key in Settings → Claude. The key stays on the phone and never enters a backup.

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

## Layout

```
src/domain      pure logic: types, sets, engine, plan overrides, prescription, records, strength, volume, calendar, plates, nutrition, food units, InBody, reminders
src/data        generated exercise-demo index and instructions
src/ai          the coach: Claude client, key, spend cap, context, persona, tools, chat, moments, photo readers
src/db          Dexie schema, seed, repo (all writes), backup, the query modules (plan, records, volume, calendar, home, body scans)
src/platform    share-sheet import and local reminders
src/state       rest timer, notifications, the coach and food stores
src/ui          primitives, hooks, rest timer bar, pickers, scanner, demo viewer, coach sheet and lines, Add food
src/screens     one file per screen
android/app     the Capacitor shell
scripts         exercise-media (build-time diagram conversion), fetch-instructions
e2e             Playwright tests against the built app (Claude mocked)
```

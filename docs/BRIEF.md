# BUILD BRIEF — "IRON" (the spec of record)

## 0. Mission
A personal workout logger that replaces Hevy and runs my progression rules for me. Strict double progression (§4). The app makes the add-weight decision, shows it, and prescribes next session's weight. Everything else — routines, set logging, rest timers, history — fast and clean like Hevy, with no routine cap, my exercise cues on screen, and my data in my own hands. Single user. Phone-first, gym-first, offline-first.

## 1. Who / where
- One user. Android phone (Samsung Galaxy Z Fold8). One-handed, in a gym, sweaty hands, sometimes poor signal.
- Dark mode by default. Big tap targets. Big numbers. Minimal chrome.
- British English everywhere. Kilograms only.
- No accounts, no login, no cloud. Local-first. Export always one tap away.

## 2. Hard constraints
1. PWA. Installable, full-screen, works 100% offline.
2. Local-first: IndexedDB via Dexie. No backend. Data layer designed so sync could be bolted on later.
3. Unlimited routines.
4. Hevy import from `hevy_export.csv` (repo root, real file). Idempotent: re-importing must not create duplicates.
5. Export: full JSON backup + flat CSV, one tap each, from Settings.
6. Progression engine is pure, tested logic (Vitest), built first.
7. Nothing lectures me. No tips, motivational copy, "did you know", coaching prose. The only mid-session prose is my own exercise cue.

## 3. Stack
Vite + React + TypeScript · Tailwind · Dexie · vite-plugin-pwa · Vitest · Zustand. Static deploy to Vercel.

## 4. Training system
### 4.1 Double progression
Routine-exercise carries `[repMin, repMax]`, `currentWeight`, `targetSets`, `increment`.
- After a session: every working set ≥ repMax → prescribe currentWeight + increment. Otherwise hold. Dropping back toward repMin at the new weight is expected; never flag as regression.
- Only working sets count. Warm-ups ignored entirely.
- Fewer sets than targetSets → missing sets count as misses → hold.
- Never change a weight silently. On finish, show every decision in plain terms ("RDL: 8/8/8/8 at 110 → 115 next time") with Accept (default) and Override (type a number). Override wins and is stored. Log every decision (ProgressionDecision).

### 4.2 Increments (per-exercise, editable defaults)
Barbell/plate-loaded lower 5 kg · upper 2.5 kg · dumbbell 2 kg · weighted bodyweight (back extension) base 0, added kg is the weight, increment 5 · stack machines 5 kg default.

### 4.3 Stall and regression — suggest, never auto-apply
- Stall: 3 consecutive sessions at the same weight with no progression → mark "stalled" on detail page. Not sooner.
- Regression: 2+ working sets below repMin in 2 consecutive sessions → suggest hold or drop one increment. Shown on summary; I decide.
- Optional RIR (0–5) per set. repMax on every set with RIR ≥ 3 → suggest double increment. I decide.

### 4.4 Calibration mode
`mode: "calibrating"`: no prescribed weight; log any weight per set; engine records but decides nothing. "Lock in" → pick weight → mode normal, currentWeight set, double progression starts next session.

### 4.5 Set types and exercise kinds
Set type: warmup | working. Kinds: reps (weight × reps) · bodyweight_plus (added kg × reps) · carry (weight × distance m or time s; a set = one walk) · timed (seconds). Unilateral: flag; log once per set, "per leg" implied.

### 4.6 Cues and notes
Optional one-line cue (verbatim) and notes per routine-exercise. Cue shows in-session above the logging row. The only prose shown in-session.

### 4.7 Optional exercises
`optional: true` sit at the bottom, de-emphasised, one-tap Skip. Non-optional need a confirm to skip.

### 4.8 Progression scope
currentWeight, mode, increment, rep range live on the routine-exercise. Same exercise in two routines progresses independently (Phase 1). Phase 2: optional "link progression" toggle.

## 5. Session-length features
- Session clock always visible while live.
- Rest timer auto-starts on set done. Defaults by tag: compound 150 s · isolation 75 s · carry 90 s. Editable per exercise. Skip, +30 s. Runs in background; notification/vibration when it ends (permission asked once).
- Optional target session length per routine; when over, the clock changes colour. No text nag.
- Fast logging: tap a previous-session set to auto-fill · ± increment on weight · ±1 on reps · one big ✓ Set done that fires the rest timer · numeric keyboard on every number field.

## 6. Data model
See `src/domain/types.ts` (Exercise, Routine, RoutineExercise, Session, SetLog, ProgressionDecision, Bodyweight, Settings). Stable UUIDs everywhere.

## 7. Screens — Phase 1
1. Home — "Next up" with Start (next routine in order after the last completed; §8 rules). Routine list. Last 3 sessions. Bodyweight quick-add.
2. Routines — list, reorder, create / edit / duplicate / delete, unlimited. Editing = add / remove / reorder exercises; set sets, rep range, increment, cue, optional flag, mode, rest override.
3. Exercise library — seeded. Add custom. Tag muscle group, compound, lower-body, kind, unilateral.
4. Live session — all exercises on one scrollable screen, current highlighted; per exercise: name · cue · target line · previous session's sets in grey · input rows · ✓ Set done. Rest timer pinned bottom. Optional exercises at the end, de-emphasised, Skip.
5. Session summary — duration, sets, every decision with Accept / Override, stall/regression/double-increment suggestions, niggle chips (lower back · hamstring DOMS · knee · shoulder · other + free text, severity 1–3), Save.
6. Exercise detail — history table (date · sets · weight × reps) · line chart of top-set weight over time · stall badge · current mode / weight / increment · Lock-in if calibrating · edit.
7. Bodyweight — log · weekly view · 4-week trend line · weekly delta vs target band.
8. Settings / Data — export JSON · export CSV · import Hevy CSV · reset to seed (dev) · targets · theme.

## 8. Weekly structure (Phase 2, design now)
Default order Hinge → Push → Squat → Pull → Day 5. Never two lower-body days consecutive; Day 5 moveable/droppable. Home suggests next up with one-tap override; lower after lower → one soft warning, then allow.

## 9. Check-in and nutrition (Phase 2/3, tiny)
- Fortnightly check-in view: current weight for RDL · Hip Thrust · Bench · Back Squat, bodyweight trend last 14 days, niggles in window. One-tap "Copy check-in" → plain text to clipboard.
- Reverse-diet stepper: +200 kcal every 14 days from 1,900 (start date = day Settings first saved) to a 3,000 ceiling. Today's target on Home.
- Protein 170 g default, 200 g on lower-body days.
- Leg-day checklist on lower-body sessions: Electrolytes (intra-workout) · Protein 200 g today.
- Out of scope: food logging, barcode scanning, calorie databases, macro tracking.

## 10. Seed data
See `scratch/gen/seed.py` → `src/db/seed.ts` (five routines, §10 tables verbatim). Bodyweight 74 kg seeded on first run. Targets: 80–82 kg band, +0.25–0.5 kg/week. Rest defaults compound 150 · isolation 75 · carry 90.

## 11. Acceptance — Phase 1
1. Engine unit tests for every §4.1 row + warm-ups ignored · missing sets → hold · calibrating → no decision · bodyweight_plus progresses on added kg · carry never produces a weight decision.
2. Start Routine 1, RDL 110 × 8,8,8,8 → summary proposes 115 → Accept → next session prescribes 115.
3. RDL 110 × 8,8,7,6 → hold 110.
4. Override 115 → 112.5 → next session prescribes 112.5; decision log shows the override.
5. Back Squat starts calibrating; log any weights; lock in; progression starts.
